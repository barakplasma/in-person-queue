package main

import (
	"errors"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testLocation = "32.0800,34.7800"

func newTestQueue(t *testing.T) (*Store, string) {
	t.Helper()
	s := NewStore()
	password, err := s.Create(testLocation, 32.08, 34.78)
	if err != nil {
		t.Fatal(err)
	}
	return s, password
}

func join(t *testing.T, s *Store, n int) []string {
	t.Helper()
	var ids []string
	for range n {
		id, err := s.Join(testLocation)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
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
	if _, err := s.Create(testLocation, 32.08, 34.78); !errors.Is(err, errExists) {
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
	ids := join(t, s, 3)
	if got := position(s, ids[1]); got != 3 {
		t.Errorf("2nd user's position = %d; want 3 (after the start marker)", got)
	}
	if err := s.Leave(testLocation, ids[0]); err != nil {
		t.Fatal(err)
	}
	if got := position(s, ids[1]); got != 2 {
		t.Errorf("position after someone ahead left = %d; want 2", got)
	}
	if got := position(s, "nobody"); got != 0 {
		t.Errorf("position of unknown user = %d; want none", got)
	}
	if err := s.Leave(testLocation, "nobody"); err != nil || s.View(testLocation, "", false).Length != 3 {
		t.Errorf("leaving as an unknown user changed the queue: %v", err)
	}
}

func TestNext(t *testing.T) {
	s, _ := newTestQueue(t)
	ids := join(t, s, 2)
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
	if _, err := s.Join(testLocation); err != nil {
		t.Errorf("joining an emptied queue: %v", err)
	}
}

func TestJoinLimits(t *testing.T) {
	s, _ := newTestQueue(t)
	if _, err := s.Join("1.0000,1.0000"); !errors.Is(err, errNotFound) {
		t.Errorf("join missing queue err = %v", err)
	}
	join(t, s, maxUsers-1)
	if _, err := s.Join(testLocation); !errors.Is(err, errFull) {
		t.Errorf("join full queue err = %v; want errFull", err)
	}
}

func TestSetMessageTruncatesRunes(t *testing.T) {
	s, _ := newTestQueue(t)
	s.SetMessage(testLocation, strings.Repeat("ש", 2000))
	if got := []rune(s.View(testLocation, "", false).Message); len(got) != maxMessage {
		t.Errorf("message length = %d runes; want %d", len(got), maxMessage)
	}
}

func TestExpiry(t *testing.T) {
	s, password := newTestQueue(t)
	ch, cancel := s.Subscribe(testLocation)
	defer cancel()
	s.now = func() time.Time { return time.Now().Add(queueTTL) }
	if !s.View(testLocation, "", false).Gone || s.Authorized(testLocation, password) || len(s.Nearby(32.08, 34.78)) != 0 {
		t.Error("expired queue still visible")
	}
	s.Sweep()
	select {
	case <-ch:
	default:
		t.Error("subscribers not told about the expired queue")
	}
	if _, err := s.Create(testLocation, 32.08, 34.78); err != nil {
		t.Errorf("can't recreate an expired queue: %v", err)
	}
}

func TestNearby(t *testing.T) {
	s, _ := newTestQueue(t)
	s.Create("32.1000,34.7800", 32.1, 34.78) // ~2.2km
	s.Create("33.5000,34.7800", 33.5, 34.78) // ~158km: out of range
	got := s.Nearby(32.0809, 34.78)
	if len(got) != 2 || got[0].Queue != testLocation || got[1].Queue != "32.1000,34.7800" {
		t.Fatalf("Nearby = %+v", got)
	}
	if math.Abs(got[0].Distance-100) > 1 {
		t.Errorf("distance = %.1fm; want ~100m", got[0].Distance)
	}
}

func TestSaveLoad(t *testing.T) {
	s, password := newTestQueue(t)
	ids := join(t, s, 2)
	s.SetMessage(testLocation, "hello")
	path := filepath.Join(t.TempDir(), "state.json")
	if err := s.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded := NewStore()
	if err := loaded.Load(path); err != nil {
		t.Fatal(err)
	}
	if v := loaded.View(testLocation, ids[1], false); v.Length != 3 || v.Message != "hello" || *v.Position != 3 {
		t.Errorf("loaded view = %+v", v)
	}
	if !loaded.Authorized(testLocation, password) {
		t.Error("password lost across save/load")
	}
	if err := NewStore().Load(filepath.Join(t.TempDir(), "missing.json")); err != nil {
		t.Errorf("missing state file: %v", err)
	}
}
