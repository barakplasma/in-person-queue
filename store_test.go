package main

import (
	"errors"
	"math"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nalgeon/redka"
)

const testLocation = "32.0800,34.7800"

// newTestStore opens a fresh in-memory database.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore("file:/" + t.Name() + ".db?vfs=memdb")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func newTestQueue(t *testing.T) (*Store, string) {
	t.Helper()
	s := newTestStore(t)
	password, err := s.Create(testLocation, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	return s, password
}

// join adds n users and returns their ids and leave keys.
func join(t *testing.T, s *Store, n int) (ids, keys []string) {
	t.Helper()
	for range n {
		id, key, err := s.Join(testLocation)
		if err != nil {
			t.Fatal(err)
		}
		ids, keys = append(ids, id), append(keys, key)
	}
	return ids, keys
}

func position(s *Store, user string) int {
	if p := s.View(testLocation, user, false).Position; p != nil {
		return *p
	}
	return 0
}

func TestParseLocation(t *testing.T) {
	for in, want := range map[string]string{
		" 32.08004 , 34.78 ": "32.0800,34.7800",
		"-0.00001,-0.00001":  "0.0000,0.0000",
		"-33.9,151":          "-33.9000,151.0000",
		"90,-180":            "90.0000,-180.0000",
	} {
		if _, _, got, err := parseLocation(in); err != nil || got != want {
			t.Errorf("parseLocation(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", ",", "1", "1,2,3", "a,b", "91,0", "0,181", "1e3,0", "<b>,1", "NaN,0"} {
		if _, _, _, err := parseLocation(in); !errors.Is(err, errInvalidLocation) {
			t.Errorf("parseLocation(%q) err = %v; want errInvalidLocation", in, err)
		}
	}
}

func TestCreate(t *testing.T) {
	s, password := newTestQueue(t)
	if v := s.View(testLocation, "", true); v.Length != 1 || *v.Head != startMarker {
		t.Errorf("new queue = %+v; want just the start marker", v)
	}
	if !s.Authorized(testLocation, password) {
		t.Error("creator's password rejected")
	}
	if _, err := s.Create(testLocation, time.Time{}); !errors.Is(err, errExists) {
		t.Errorf("second create err = %v; want errExists (would hijack the admin)", err)
	}
	if !s.Authorized(testLocation, password) {
		t.Error("password changed by a second create")
	}
}

func TestAuthorized(t *testing.T) {
	s, _ := newTestQueue(t)
	for _, p := range []string{"", "wrong"} {
		if s.Authorized(testLocation, p) {
			t.Errorf("Authorized(%q) = true", p)
		}
	}
	if s.Authorized("1.0000,1.0000", "") {
		t.Error("authorized for a queue that doesn't exist")
	}
}

func TestPositions(t *testing.T) {
	s, _ := newTestQueue(t)
	ids, keys := join(t, s, 3)
	if !slices.Equal(ids, []string{"A001", "A002", "A003"}) {
		t.Errorf("ids = %v; want tickets in order", ids)
	}
	if got := position(s, ids[1]); got != 3 {
		t.Errorf("2nd user's position = %d; want 3 (after the start marker)", got)
	}
	for _, key := range []string{"", "wrong", keys[1]} {
		if err := s.Leave(testLocation, ids[0], key); !errors.Is(err, errUnauthorized) {
			t.Errorf("leaving as %s with key %q err = %v; want errUnauthorized", ids[0], key, err)
		}
	}
	if err := s.Leave(testLocation, ids[0], keys[0]); err != nil {
		t.Fatal(err)
	}
	if got := position(s, ids[1]); got != 2 {
		t.Errorf("position after someone ahead left = %d; want 2", got)
	}
	if got := position(s, "nobody"); got != 0 {
		t.Errorf("position of unknown user = %d; want none", got)
	}
	if err := s.Leave(testLocation, "nobody", ""); err == nil || s.View(testLocation, "", false).Length != 3 {
		t.Errorf("leaving as an unknown user changed the queue: %v", err)
	}
}

func TestTicketID(t *testing.T) {
	for n, want := range map[int]string{1: "A001", 999: "A999", 1000: "B000", 1234: "B234", maxTicket: "Z999"} {
		if got := ticketID(n); got != want {
			t.Errorf("ticketID(%d) = %q; want %q", n, got, want)
		}
	}
}

func TestPeople(t *testing.T) {
	before := time.Now().UnixMilli()
	s, _ := newTestQueue(t)
	ids, _ := join(t, s, 2)
	s.Next(testLocation)
	v := s.View(testLocation, ids[1], false)
	if len(v.People) != 2 || v.People[0].ID != ids[0] || v.People[1].ID != ids[1] {
		t.Fatalf("people = %+v; want %v in order", v.People, ids)
	}
	for _, p := range v.People {
		if p.Joined < before || p.Joined > time.Now().UnixMilli() {
			t.Errorf("%s joined at %d; want about now", p.ID, p.Joined)
		}
	}
}

func TestTicketsRunOut(t *testing.T) {
	s, _ := newTestQueue(t)
	s.db.Update(func(tx *redka.Tx) error {
		_, err := tx.Hash().Set(metaKey(testLocation), "seq", maxTicket-1)
		return err
	})
	if ids, _ := join(t, s, 1); ids[0] != "Z999" {
		t.Errorf("last ticket = %q; want Z999", ids[0])
	}
	if _, _, err := s.Join(testLocation); !errors.Is(err, errFull) {
		t.Errorf("join after the last ticket err = %v; want errFull", err)
	}
	if v := s.View(testLocation, "", false); v.Length != 2 {
		t.Errorf("failed join changed the queue: %+v", v)
	}
}

func TestNext(t *testing.T) {
	s, _ := newTestQueue(t)
	ids, _ := join(t, s, 2)
	s.Next(testLocation)
	if head := *s.View(testLocation, "", true).Head; head != ids[0] {
		t.Errorf("head after serving the start marker = %q; want %q", head, ids[0])
	}
	s.Next(testLocation)
	s.Next(testLocation)
	s.Next(testLocation) // empty: no-op
	if v := s.View(testLocation, "", true); v.Length != 0 || *v.Head != "" {
		t.Errorf("emptied queue = %+v", v)
	}
	if _, _, err := s.Join(testLocation); err != nil {
		t.Errorf("joining an emptied queue: %v", err)
	}
}

func TestJoinLimits(t *testing.T) {
	s, _ := newTestQueue(t)
	if _, _, err := s.Join("1.0000,1.0000"); !errors.Is(err, errNotFound) {
		t.Errorf("join missing queue err = %v", err)
	}
	join(t, s, maxUsers-1)
	if _, _, err := s.Join(testLocation); !errors.Is(err, errFull) {
		t.Errorf("join full queue err = %v; want errFull", err)
	}
}

func TestSetMessageTruncatesRunes(t *testing.T) {
	s, _ := newTestQueue(t)
	s.SetMessage(testLocation, strings.Repeat("ש", maxMessage+1))
	if got := []rune(s.View(testLocation, "", false).Message); len(got) != maxMessage {
		t.Errorf("message length = %d runes; want %d", len(got), maxMessage)
	}
}

func TestExpiry(t *testing.T) {
	defer func(ttl time.Duration) { queueTTL = ttl }(queueTTL)
	queueTTL = 500 * time.Millisecond
	s, password := newTestQueue(t)
	join(t, s, 1)
	ch, cancel := s.Subscribe(testLocation)
	defer cancel()
	time.Sleep(600 * time.Millisecond)
	nearby, _ := s.Nearby(32.08, 34.78)
	if !s.View(testLocation, "", false).Gone || s.Authorized(testLocation, password) || len(nearby) != 0 {
		t.Error("expired queue still visible")
	}
	if _, _, err := s.Join(testLocation); !errors.Is(err, errNotFound) {
		t.Errorf("join expired queue err = %v; want errNotFound", err)
	}
	if err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ch:
	default:
		t.Error("subscribers not told about the expired queue")
	}
	if _, err := s.Create(testLocation, time.Time{}); err != nil {
		t.Errorf("can't recreate an expired queue: %v", err)
	}
	if v := s.View(testLocation, "", true); v.Length != 1 || *v.Head != startMarker {
		t.Errorf("recreated queue = %+v; want a fresh one", v)
	}
}

func TestEmptiedQueueKeepsExpiring(t *testing.T) {
	defer func(ttl time.Duration) { queueTTL = ttl }(queueTTL)
	queueTTL = 500 * time.Millisecond
	s, _ := newTestQueue(t)
	s.Next(testLocation) // queue is now empty
	join(t, s, 1)        // users set is created again
	time.Sleep(600 * time.Millisecond)
	if !s.View(testLocation, "", false).Gone {
		t.Error("queue outlived its TTL after being emptied and refilled")
	}
}

func TestNearby(t *testing.T) {
	s, _ := newTestQueue(t)
	s.Create("32.1000,34.7800", time.Time{}) // ~2.2km
	s.Create("33.5000,34.7800", time.Time{}) // ~158km: out of range
	got, err := s.Nearby(32.0809, 34.78)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Queue != testLocation || got[1].Queue != "32.1000,34.7800" {
		t.Fatalf("Nearby = %+v", got)
	}
	if math.Abs(got[0].Distance-100) > 1 {
		t.Errorf("distance = %.1fm; want ~100m", got[0].Distance)
	}
}

func TestPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queues.db")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	password, err := s.Create(testLocation, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	ids, _ := join(t, s, 2)
	s.SetMessage(testLocation, "hello")
	s.Close()

	s, err = OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if v := s.View(testLocation, ids[1], false); v.Length != 3 || v.Message != "hello" || v.Position == nil || *v.Position != 3 {
		t.Errorf("after restart: %+v", v)
	}
	if !s.Authorized(testLocation, password) {
		t.Error("password lost across restart")
	}
	if id, _, err := s.Join(testLocation); err != nil || id != "A003" || position(s, id) != 4 {
		t.Errorf("join after restart: %q at %d, %v; want position 4", id, position(s, id), err)
	}
}

func TestCloses(t *testing.T) {
	s := newTestStore(t)
	for _, bad := range []time.Time{time.Now().Add(-time.Minute), time.Now().Add(maxOpen + time.Hour)} {
		if _, err := s.Create(testLocation, bad); !errors.Is(err, errInvalidCloses) {
			t.Errorf("Create closing at %v err = %v; want errInvalidCloses", bad, err)
		}
	}
	closes := time.Now().Add(72 * time.Hour).Truncate(time.Millisecond)
	if _, err := s.Create(testLocation, closes); err != nil {
		t.Fatal(err)
	}
	if got := s.View(testLocation, "", false).Closes; got != closes.UnixMilli() {
		t.Errorf("closes = %d; want %d", got, closes.UnixMilli())
	}
}

func TestServiceEstimate(t *testing.T) {
	s, _ := newTestQueue(t)
	ago := func(d time.Duration) { // pretends the last serve was d ago
		s.db.Update(func(tx *redka.Tx) error {
			_, err := tx.Hash().Set(metaKey(testLocation), "served", strconv.FormatInt(time.Now().Add(-d).UnixMilli(), 10))
			return err
		})
	}
	service := func() float64 { return s.View(testLocation, "", false).ServiceSeconds }
	join(t, s, 3)
	ago(time.Hour)
	s.Next(testLocation) // the start marker: starting the queue isn't service time
	if got := service(); got != 0 {
		t.Errorf("estimate after starting = %v; want none yet", got)
	}
	ago(60 * time.Second)
	s.Next(testLocation)
	if got := service(); math.Abs(got-60) > 1 {
		t.Errorf("estimate after one 60s serve = %v; want 60", got)
	}
	ago(30 * time.Second)
	s.Next(testLocation)
	if want := 0.3*30 + 0.7*60; math.Abs(service()-want) > 1 {
		t.Errorf("estimate after a 30s serve = %v; want the moving average %v", service(), want)
	}
	s.Next(testLocation) // empty now
	ago(time.Hour)       // idle for an hour
	join(t, s, 1)        // restarts the clock
	s.Next(testLocation)
	if got := service(); got > 51 {
		t.Errorf("estimate = %v; idle time leaked into it", got)
	}
}
