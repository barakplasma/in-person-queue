package main

import (
	"cmp"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/nalgeon/redka"
	_ "modernc.org/sqlite" // pure-Go SQLite driver: no cgo, cross-compiles everywhere
)

const (
	maxUsers     = 1000  // waiting at once
	maxTicket    = 25999 // A001 … Z999, see ticketID
	maxQueues    = 10000
	maxMessage   = 10000   // characters
	nearbyRadius = 100_000 // meters
	nearbyCount  = 5
	// Every queue starts with this marker at its head; the admin "serves" it to start the queue.
	startMarker = "Start Queue"
)

var queueTTL = 24 * time.Hour // how long a queue stays open unless its admin picks a time; a var so tests can shorten it

const (
	maxOpen = 366 * 24 * time.Hour // the latest closing time an admin can pick
	// Weight of the newest service time in the moving average: recent serves count most,
	// so the estimate follows a speed change within a few serves.
	serviceSmoothing = 0.3
)

var (
	errInvalidLocation = errors.New("invalid location")
	errExists          = errors.New("a queue already exists at this location, join it instead")
	errNotFound        = errors.New("this queue has closed or does not exist")
	errFull            = errors.New("this queue is full")
	errUnauthorized    = errors.New("not authorized for this queue")
	errTooManyQueues   = errors.New("too many queues on this server, try again later")
	errInvalidCloses   = errors.New("the closing time must be in the future, and within a year")
)

var locationRE = regexp.MustCompile(`^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$`)

// parseLocation parses "lat,lon", rounds to 4 decimals (~11m, so admins at
// the same spot share one queue) and returns the canonical "lat,lon".
func parseLocation(s string) (lat, lon float64, location string, err error) {
	m := locationRE.FindStringSubmatch(s)
	if m != nil {
		lat, _ = strconv.ParseFloat(m[1], 64)
		lon, _ = strconv.ParseFloat(m[2], 64)
	}
	if m == nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return 0, 0, "", fmt.Errorf("%w: %q", errInvalidLocation, s)
	}
	lat, lon = round4(lat), round4(lon)
	return lat, lon, strconv.FormatFloat(lat, 'f', 4, 64) + "," + strconv.FormatFloat(lon, 'f', 4, 64), nil
}

func round4(x float64) float64 {
	return math.Round(x*1e4)/1e4 + 0 // + 0 turns -0 into 0
}

// Data model (see docs/adr/0002-embedded-database.md), stored by Redka in SQLite:
//
//	queue:<location>  hash:       password (sha256), message, seq (last ticket number), expires (unix ms),
//	                              joined:<user id> (unix ms) for everyone in line,
//	                              served (unix ms: the last serve, or when the line last became busy),
//	                              service (ms: moving average of the time to serve one person)
//	users:<location>  sorted set: user id -> ticket number, so rank = position in line
//
// Expiry is ours (the expires field + Sweep), not Redka's key TTL: in redka v1.0.1, writing to a key whose
// TTL has passed keeps the old expiry, so a queue re-created at the same spot stayed invisible.
func metaKey(location string) string  { return "queue:" + location }
func usersKey(location string) string { return "users:" + location }

// View is what one subscriber sees of a queue.
type View struct {
	Gone     bool     `json:"gone,omitzero"`
	Length   int      `json:"length"`
	Message  string   `json:"message"`
	Position *int     `json:"position,omitempty"` // 1-based; only sent to a user, null if not in the queue
	Head     *string  `json:"head,omitempty"`     // only sent to the admin
	People   []Person `json:"people"`             // everyone in line, in order
	Closes   int64    `json:"closes"`             // unix ms
	// Estimated time to serve one person (see estimateService), 0 until the admin has served someone.
	// Someone at position p waits about (p-1) × this; someone joining now, about length × this.
	ServiceSeconds float64 `json:"serviceSeconds,omitzero"`
}

type Person struct {
	ID     string `json:"id"`
	Joined int64  `json:"joined"` // unix ms
}

type Nearby struct {
	Queue    string  `json:"queue"`
	Distance float64 `json:"distance"` // meters
}

// Store keeps queues in Redka (SQLite) and wakes event streams when a queue changes.
type Store struct {
	db   *redka.DB
	mu   sync.Mutex // guards subs
	subs map[string]map[chan struct{}]struct{}
}

// OpenStore opens (or creates) the database at path.
// Use "file:/name.db?vfs=memdb" for a database that only lives in memory.
func OpenStore(path string) (*Store, error) {
	db, err := redka.Open(path, &redka.Options{
		DriverName: "sqlite",
		// Redka's documented defaults, except synchronous=full: every committed change survives a power loss.
		Pragma: map[string]string{
			"journal_mode": "wal",
			"synchronous":  "full",
			"temp_store":   "memory",
			"foreign_keys": "on",
		},
	})
	if err != nil {
		return nil, err
	}
	return &Store{db: db, subs: map[string]map[chan struct{}]struct{}{}}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// changed wakes the queue's subscribers.
func (s *Store) changed(location string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs[location] {
		select {
		case ch <- struct{}{}:
		default: // already has a pending wake-up; a slow client never blocks anyone
		}
	}
}

// update runs f in a transaction and wakes the queue's subscribers if it succeeded.
func (s *Store) update(location string, f func(tx *redka.Tx) error) error {
	err := s.db.Update(f)
	if err == nil {
		s.changed(location)
	}
	return err
}

// exists returns errNotFound unless the queue is live.
func exists(tx *redka.Tx, location string) error {
	v, err := tx.Hash().Get(metaKey(location), "expires")
	if errors.Is(err, redka.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	// a decimal string, because unix milliseconds don't fit in a 32-bit int (linux/arm)
	expires, err := strconv.ParseInt(v.String(), 10, 64)
	if err == nil && time.Now().UnixMilli() >= expires {
		return errNotFound
	}
	return err
}

func hash(password string) []byte {
	h := sha256.Sum256([]byte(password))
	return h[:]
}

// Create makes a queue that closes at closes (zero: after queueTTL) and returns its admin password.
func (s *Store) Create(location string, closes time.Time) (string, error) {
	if closes.IsZero() {
		closes = time.Now().Add(queueTTL)
	}
	if time.Until(closes) <= 0 || time.Until(closes) > maxOpen {
		return "", errInvalidCloses
	}
	password := rand.Text()
	return password, s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err == nil {
			return errExists
		} else if !errors.Is(err, errNotFound) {
			return err
		}
		// clear what an expired queue (not swept yet) left behind at this location
		if _, err := tx.Key().Delete(metaKey(location), usersKey(location)); err != nil {
			return err
		}
		if queues, err := tx.Key().Keys(metaKey("*")); err != nil {
			return err
		} else if len(queues) >= maxQueues {
			return errTooManyQueues
		}
		if _, err := tx.Hash().SetMany(metaKey(location), map[string]any{
			"password":              hash(password),
			"message":               "",
			"seq":                   0,
			"expires":               strconv.FormatInt(closes.UnixMilli(), 10),
			"joined:" + startMarker: now(),
		}); err != nil {
			return err
		}
		_, err := tx.ZSet().Add(usersKey(location), startMarker, 0)
		return err
	})
}

// Authorized reports whether password is the queue's admin password.
func (s *Store) Authorized(location, password string) bool {
	if password == "" {
		return false
	}
	var stored []byte
	s.db.View(func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		v, err := tx.Hash().Get(metaKey(location), "password")
		stored = v.Bytes()
		return err
	})
	return subtle.ConstantTimeCompare(hash(password), stored) == 1
}

// Join adds a new user to the end of the queue. It returns their id, and the key they need to leave.
func (s *Store) Join(location string) (id, key string, err error) {
	err = s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		n, err := tx.ZSet().Len(usersKey(location))
		if err != nil {
			return err
		}
		if n >= maxUsers {
			return errFull
		}
		if n == 0 { // the line was idle: service time counts from now, not from the last serve
			if _, err := tx.Hash().Set(metaKey(location), "served", now()); err != nil {
				return err
			}
		}
		seq, err := tx.Hash().Incr(metaKey(location), "seq", 1)
		if err != nil {
			return err
		}
		if seq > maxTicket {
			return errFull
		}
		id = ticketID(seq)
		if key, err = leaveKey(tx, location, id); err != nil {
			return err
		}
		if _, err := tx.Hash().Set(metaKey(location), "joined:"+id, now()); err != nil {
			return err
		}
		_, err = tx.ZSet().Add(usersKey(location), id, float64(seq))
		return err
	})
	return id, key, err
}

// ticketID is a letter and 3 digits, like the paper tickets at an Israeli post office:
// 1 is A001, 999 is A999, 1000 is B000, … 25999 is Z999.
func ticketID(n int) string {
	return fmt.Sprintf("%c%03d", 'A'+n/1000, n%1000)
}

// leaveKey proves who joined as id. Ids are sequential and easy to guess, so leaving needs this key.
// It is an HMAC keyed by the queue's password hash, which never leaves the server, so there is nothing more to store.
func leaveKey(tx *redka.Tx, location, id string) (string, error) {
	secret, err := tx.Hash().Get(metaKey(location), "password")
	mac := hmac.New(sha256.New, secret.Bytes())
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil)[:16]), err
}

func now() string { return strconv.FormatInt(time.Now().UnixMilli(), 10) }

// remove takes id out of the line.
func remove(tx *redka.Tx, location, id string) error {
	if _, err := tx.ZSet().Delete(usersKey(location), id); err != nil {
		return err
	}
	_, err := tx.Hash().Delete(metaKey(location), "joined:"+id)
	return err
}

func (s *Store) Leave(location, id, key string) error {
	return s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		want, err := leaveKey(tx, location, id)
		if err != nil {
			return err
		}
		if subtle.ConstantTimeCompare([]byte(key), []byte(want)) != 1 {
			return errUnauthorized
		}
		return remove(tx, location, id)
	})
}

// Next serves the head of the queue.
func (s *Store) Next(location string) error {
	return s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		head, err := tx.ZSet().Range(usersKey(location), 0, 0)
		if err != nil || len(head) == 0 {
			return err
		}
		if head[0].Elem.String() != startMarker { // serving the marker only starts the queue
			if err := estimateService(tx, location); err != nil {
				return err
			}
		}
		if _, err := tx.Hash().Set(metaKey(location), "served", now()); err != nil {
			return err
		}
		return remove(tx, location, head[0].Elem.String())
	})
}

// estimateService folds the time since the last serve into the average time to serve one person.
//
// Queueing theory: with one server, the wait at position p is the service time of the p-1 people ahead,
// so by Little's law (L = λW) the estimate only needs the service rate. That rate is measured, not assumed:
// an exponentially weighted moving average of the time between serves, counted only while people were
// waiting (Join restarts the clock when the line was empty), so idle time doesn't inflate it.
func estimateService(tx *redka.Tx, location string) error {
	v, err := tx.Hash().GetMany(metaKey(location), "served", "service")
	if err != nil {
		return err
	}
	served, err := strconv.ParseInt(v["served"].String(), 10, 64)
	if err != nil {
		return nil // never served yet: no interval to measure
	}
	interval := float64(time.Now().UnixMilli() - served)
	avg, err := strconv.ParseFloat(v["service"].String(), 64)
	if err == nil {
		interval = serviceSmoothing*interval + (1-serviceSmoothing)*avg
	}
	_, err = tx.Hash().Set(metaKey(location), "service", strconv.FormatFloat(interval, 'f', 0, 64))
	return err
}

func (s *Store) SetMessage(location, message string) error {
	for utf8.RuneCountInString(message) > maxMessage {
		_, size := utf8.DecodeLastRuneInString(message)
		message = message[:len(message)-size]
	}
	return s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		_, err := tx.Hash().Set(metaKey(location), "message", message)
		return err
	})
}

// View is the queue as seen by user (may be "") or by the admin.
func (s *Store) View(location, user string, admin bool) View {
	var v View
	err := s.db.View(func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		meta, err := tx.Hash().GetMany(metaKey(location), "message", "expires", "service")
		if err != nil {
			return err
		}
		v.Message = meta["message"].String()
		v.Closes, _ = strconv.ParseInt(meta["expires"].String(), 10, 64)
		if ms, err := strconv.ParseFloat(meta["service"].String(), 64); err == nil {
			v.ServiceSeconds = math.Round(ms) / 1000
		}
		line, err := tx.ZSet().Range(usersKey(location), 0, maxUsers-1)
		if err != nil {
			return err
		}
		fields := make([]string, len(line))
		for i, item := range line {
			fields[i] = "joined:" + item.Elem.String()
		}
		joined := map[string]redka.Value{}
		if len(fields) > 0 {
			if joined, err = tx.Hash().GetMany(metaKey(location), fields...); err != nil {
				return err
			}
		}
		v.People = make([]Person, len(line))
		for i, item := range line {
			id := item.Elem.String()
			ms, _ := strconv.ParseInt(joined[fields[i]].String(), 10, 64)
			v.People[i] = Person{id, ms}
			if id == user {
				v.Position = new(i + 1)
			}
		}
		v.Length = len(line)
		if admin {
			v.Head = new("")
			if len(line) > 0 {
				*v.Head = v.People[0].ID
			}
		}
		return nil
	})
	if err != nil {
		return View{Gone: true}
	}
	return v
}

// Subscribe returns a channel that receives a value whenever the queue changes.
func (s *Store) Subscribe(location string) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.subs[location] == nil {
		s.subs[location] = map[chan struct{}]struct{}{}
	}
	s.subs[location][ch] = struct{}{}
	return ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.subs[location], ch)
		if len(s.subs[location]) == 0 {
			delete(s.subs, location)
		}
	}
}

// Nearby returns the closest live queues within nearbyRadius.
// ponytail: O(n) scan over all queues; add a geohash grid if there are ever >10k live queues.
func (s *Store) Nearby(lat, lon float64) ([]Nearby, error) {
	var found []Nearby
	err := s.db.View(func(tx *redka.Tx) error {
		keys, err := tx.Key().Keys(metaKey("*"))
		for _, k := range keys {
			qlat, qlon, location, err := parseLocation(strings.TrimPrefix(k.Key, metaKey("")))
			if d := distance(lat, lon, qlat, qlon); err == nil && d <= nearbyRadius && exists(tx, location) == nil {
				found = append(found, Nearby{location, d})
			}
		}
		return err
	})
	slices.SortFunc(found, func(a, b Nearby) int { return cmp.Compare(a.Distance, b.Distance) })
	return found[:min(len(found), nearbyCount)], err
}

// distance is the haversine distance in meters.
func distance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6_371_000
	rad := math.Pi / 180
	dLat, dLon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Pow(math.Sin(dLat/2), 2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Pow(math.Sin(dLon/2), 2)
	return 2 * earthRadius * math.Asin(math.Sqrt(a))
}

// Sweep deletes expired queues and wakes their subscribers, so their pages can say so.
func (s *Store) Sweep() error {
	var expired []string
	err := s.db.Update(func(tx *redka.Tx) error {
		keys, err := tx.Key().Keys(metaKey("*"))
		for _, k := range keys {
			location := strings.TrimPrefix(k.Key, metaKey(""))
			if exists(tx, location) == errNotFound {
				if _, err := tx.Key().Delete(metaKey(location), usersKey(location)); err != nil {
					return err
				}
				expired = append(expired, location)
			}
		}
		return err
	})
	for _, location := range expired {
		s.changed(location)
	}
	return err
}
