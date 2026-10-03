package main

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	queueTTL     = 24 * time.Hour
	maxUsers     = 1000
	maxQueues    = 10000
	maxMessage   = 1000    // characters
	nearbyRadius = 100_000 // meters
	nearbyCount  = 5
	// Every queue starts with this marker at its head; the admin "serves" it to start the queue.
	startMarker = "Start Queue"
)

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

type Queue struct {
	Location     string    `json:"location"`
	Lat          float64   `json:"lat"`
	Lon          float64   `json:"lon"`
	PasswordHash []byte    `json:"passwordHash"` // sha256; the password itself is never stored
	Message      string    `json:"message"`
	Users        []string  `json:"users"` // index 0 is the head of the queue
	ExpiresAt    time.Time `json:"expiresAt"`
}

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

// Store holds all state in memory behind one mutex.
// ponytail: single process only; put NATS or Postgres LISTEN/NOTIFY between replicas if one ever isn't enough.
type Store struct {
	mu     sync.Mutex
	queues map[string]*Queue
	subs   map[string]map[chan struct{}]struct{}
	dirty  bool
	now    func() time.Time
}

func NewStore() *Store {
	return &Store{
		queues: map[string]*Queue{},
		subs:   map[string]map[chan struct{}]struct{}{},
		now:    time.Now,
	}
}

// get returns a live queue; callers hold s.mu.
func (s *Store) get(location string) (*Queue, error) {
	q := s.queues[location]
	if q == nil || !s.now().Before(q.ExpiresAt) {
		return nil, errNotFound
	}
	return q, nil
}

// changed marks the store for saving and wakes the queue's subscribers; callers hold s.mu.
func (s *Store) changed(location string) {
	s.dirty = true
	for ch := range s.subs[location] {
		select {
		case ch <- struct{}{}:
		default: // already has a pending wake-up; a slow client never blocks anyone
		}
	}
}

func hash(password string) []byte {
	h := sha256.Sum256([]byte(password))
	return h[:]
}

// Create makes a queue and returns its admin password.
func (s *Store) Create(location string, lat, lon float64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.get(location); err == nil {
		return "", errExists
	}
	if len(s.queues) >= maxQueues {
		return "", errTooManyQueues
	}
	password := rand.Text()
	s.queues[location] = &Queue{
		Location:     location,
		Lat:          lat,
		Lon:          lon,
		PasswordHash: hash(password),
		Users:        []string{startMarker},
		ExpiresAt:    s.now().Add(queueTTL),
	}
	s.changed(location)
	return password, nil
}

// Authorized reports whether password is the queue's admin password.
func (s *Store) Authorized(location, password string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	return err == nil && password != "" && subtle.ConstantTimeCompare(hash(password), q.PasswordHash) == 1
}

// Join adds a new user to the end of the queue and returns their id.
func (s *Store) Join(location string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	if err != nil {
		return "", err
	}
	if len(q.Users) >= maxUsers {
		return "", errFull
	}
	id := newUserID()
	for slices.Contains(q.Users, id) {
		id = newUserID()
	}
	q.Users = append(q.Users, id)
	s.changed(location)
	return id, nil
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
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	if err != nil {
		return err
	}
	if i := slices.Index(q.Users, user); i >= 0 {
		q.Users = slices.Delete(q.Users, i, i+1)
		s.changed(location)
	}
	return nil
}

// Next serves the head of the queue.
func (s *Store) Next(location string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	if err != nil {
		return err
	}
	if len(q.Users) > 0 {
		q.Users = q.Users[1:]
		s.changed(location)
	}
	return nil
}

func (s *Store) SetMessage(location, message string) error {
	for utf8.RuneCountInString(message) > maxMessage {
		_, size := utf8.DecodeLastRuneInString(message)
		message = message[:len(message)-size]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	if err != nil {
		return err
	}
	q.Message = message
	s.changed(location)
	return nil
}

// View is the queue as seen by user (may be "") or by the admin.
func (s *Store) View(location, user string, admin bool) View {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, err := s.get(location)
	if err != nil {
		return View{Gone: true}
	}
	v := View{Length: len(q.Users), Message: q.Message}
	if user != "" {
		// ponytail: O(n) per subscriber per change; fine at maxUsers=1000
		if i := slices.Index(q.Users, user); i >= 0 {
			v.Position = new(int)
			*v.Position = i + 1
		}
	}
	if admin {
		head := ""
		if len(q.Users) > 0 {
			head = q.Users[0]
		}
		v.Head = &head
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
func (s *Store) Nearby(lat, lon float64) []Nearby {
	s.mu.Lock()
	var found []Nearby
	for _, q := range s.queues {
		if d := distance(lat, lon, q.Lat, q.Lon); d <= nearbyRadius && s.now().Before(q.ExpiresAt) {
			found = append(found, Nearby{q.Location, d})
		}
	}
	s.mu.Unlock()
	slices.SortFunc(found, func(a, b Nearby) int { return cmp.Compare(a.Distance, b.Distance) })
	return found[:min(len(found), nearbyCount)]
}

// distance is the haversine distance in meters.
func distance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6_371_000
	rad := math.Pi / 180
	dLat, dLon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Pow(math.Sin(dLat/2), 2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Pow(math.Sin(dLon/2), 2)
	return 2 * earthRadius * math.Asin(math.Sqrt(a))
}

// Sweep deletes expired queues and tells their subscribers.
func (s *Store) Sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for location, q := range s.queues {
		if !s.now().Before(q.ExpiresAt) {
			delete(s.queues, location)
			s.changed(location)
		}
	}
}

// Save writes the state to path if it changed, atomically (temp file + rename).
func (s *Store) Save(path string) error {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	data, err := json.Marshal(s.queues)
	s.dirty = false
	s.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err == nil {
		err = syncDir(filepath.Dir(path)) // makes the rename itself survive a power loss
	}
	if err != nil {
		s.mu.Lock()
		s.dirty = true // try again next time
		s.mu.Unlock()
	}
	return err
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// Load reads the state saved by Save; a missing file is an empty store.
func (s *Store) Load(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Unmarshal(data, &s.queues)
}
