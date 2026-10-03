package main

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
	maxUsers     = 1000
	maxQueues    = 10000
	maxMessage   = 1000    // characters
	nearbyRadius = 100_000 // meters
	nearbyCount  = 5
	// Every queue starts with this marker at its head; the admin "serves" it to start the queue.
	startMarker = "Start Queue"
)

var queueTTL = 24 * time.Hour // a var so tests can shorten it

var (
	errInvalidLocation = errors.New("invalid location")
	errExists          = errors.New("a queue already exists at this location, join it instead")
	errNotFound        = errors.New("this queue has closed or does not exist")
	errFull            = errors.New("this queue is full")
	errTooManyQueues   = errors.New("too many queues on this server, try again later")
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

// The data model is the Redis one from the Node version, stored by Redka in SQLite:
//
//	queue:<location>  hash:       password (sha256), message, seq (last ticket number), expires (unix ms)
//	users:<location>  sorted set: user id -> ticket number, so rank = position in line
//
// Expiry is ours (the expires field + Sweep) rather than Redka's key TTL: in redka v1.0.1, writing to a
// key whose TTL has passed keeps the old expiry, so a queue re-created at the same spot stayed invisible.
func metaKey(location string) string  { return "queue:" + location }
func usersKey(location string) string { return "users:" + location }

// View is what one subscriber sees of a queue.
type View struct {
	Gone     bool    `json:"gone,omitzero"`
	Length   int     `json:"length"`
	Message  string  `json:"message"`
	Position *int    `json:"position,omitempty"` // 1-based; only sent to a user, null if not in the queue
	Head     *string `json:"head,omitempty"`     // only sent to the admin
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

// Create makes a queue and returns its admin password.
func (s *Store) Create(location string) (string, error) {
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
			"password": hash(password),
			"message":  "",
			"seq":      1,
			"expires":  strconv.FormatInt(time.Now().Add(queueTTL).UnixMilli(), 10),
		}); err != nil {
			return err
		}
		_, err := tx.ZSet().Add(usersKey(location), startMarker, 1)
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

// Join adds a new user to the end of the queue and returns their id.
func (s *Store) Join(location string) (string, error) {
	var id string
	return id, s.update(location, func(tx *redka.Tx) error {
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
		for id = newUserID(); ; id = newUserID() {
			if _, err := tx.ZSet().GetScore(usersKey(location), id); errors.Is(err, redka.ErrNotFound) {
				break
			} else if err != nil {
				return err
			}
		}
		seq, err := tx.Hash().Incr(metaKey(location), "seq", 1)
		if err != nil {
			return err
		}
		_, err = tx.ZSet().Add(usersKey(location), id, float64(seq))
		return err
	})
}

// newUserID returns 6 characters that are hard to confuse when read aloud or handwritten.
func newUserID() string {
	const alphabet = "CDEHKMPRTUWXY012458"
	b := make([]byte, 6)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func (s *Store) Leave(location, user string) error {
	return s.update(location, func(tx *redka.Tx) error {
		if err := exists(tx, location); err != nil {
			return err
		}
		_, err := tx.ZSet().Delete(usersKey(location), user)
		return err
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
		_, err = tx.ZSet().Delete(usersKey(location), head[0].Elem.String())
		return err
	})
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
		message, err := tx.Hash().Get(metaKey(location), "message")
		if err != nil {
			return err
		}
		v.Message = message.String()
		if v.Length, err = tx.ZSet().Len(usersKey(location)); err != nil {
			return err
		}
		if user != "" {
			rank, _, err := tx.ZSet().GetRank(usersKey(location), user)
			if err == nil {
				v.Position = new(int)
				*v.Position = rank + 1
			} else if !errors.Is(err, redka.ErrNotFound) {
				return err
			}
		}
		if admin {
			head, err := tx.ZSet().Range(usersKey(location), 0, 0)
			if err != nil {
				return err
			}
			v.Head = new(string)
			if len(head) > 0 {
				*v.Head = head[0].Elem.String()
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
