package main

import (
	"bufio"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	static, _ := fs.Sub(clientFS, "client")
	srv := httptest.NewServer(newHandler(newTestStore(t), static))
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, method, url, token, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func TestAPI(t *testing.T) {
	srv := newTestServer(t)
	api := srv.URL + "/api/queues"

	resp, created := call(t, "POST", api, "", `{"location":"32.08004,34.78"}`)
	if resp.StatusCode != http.StatusCreated || created["location"] != testLocation {
		t.Fatalf("create = %d %v", resp.StatusCode, created)
	}
	password := created["password"].(string)
	queue := api + "/" + testLocation

	if resp, _ := call(t, "POST", api, "", `{"location":"32.08,34.78"}`); resp.StatusCode != http.StatusConflict {
		t.Errorf("duplicate create = %d; want 409", resp.StatusCode)
	}
	if resp, body := call(t, "GET", api+"?near=nonsense", "", ""); resp.StatusCode != http.StatusBadRequest || !strings.Contains(body["error"].(string), "invalid location") {
		t.Errorf("bad location = %d %v", resp.StatusCode, body)
	}
	if resp, _ := call(t, "POST", api, "", `not json`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad body = %d; want 400", resp.StatusCode)
	}

	for _, wrong := range []string{"", "wrong"} {
		for _, r := range [][2]string{{"GET", "/admin"}, {"POST", "/next"}, {"PUT", "/message"}} {
			if resp, _ := call(t, r[0], queue+r[1], wrong, `{}`); resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s %s with password %q = %d; want 401", r[0], r[1], wrong, resp.StatusCode)
			}
		}
	}
	if resp, _ := call(t, "GET", queue+"/admin", password, ""); resp.StatusCode != http.StatusNoContent {
		t.Errorf("admin check = %d; want 204", resp.StatusCode)
	}

	_, joined := call(t, "POST", queue+"/users", "", "")
	userID, key := joined["userId"].(string), joined["key"].(string)
	if userID != "A001" || key == "" {
		t.Errorf("join = %v", joined)
	}
	call(t, "PUT", queue+"/message", password, `{"message":"<b>hi</b>"}`)

	events, err := http.Get(queue + "/events?user=" + userID)
	if err != nil {
		t.Fatal(err)
	}
	defer events.Body.Close()
	lines := bufio.NewScanner(events.Body)
	next := func() map[string]any {
		for lines.Scan() {
			if data, ok := strings.CutPrefix(lines.Text(), "data: "); ok {
				var v map[string]any
				json.Unmarshal([]byte(data), &v)
				return v
			}
		}
		t.Fatal("event stream ended")
		return nil
	}
	if v := next(); v["length"] != 2.0 || v["position"] != 2.0 || v["message"] != "<b>hi</b>" || v["head"] != nil || len(v["people"].([]any)) != 2 {
		t.Errorf("first event = %v", v)
	}
	call(t, "POST", queue+"/next", password, "")
	if v := next(); v["length"] != 1.0 || v["position"] != 1.0 {
		t.Errorf("event after next = %v", v)
	}
	if resp, _ := call(t, "DELETE", queue+"/users/"+userID, "", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("leave without key = %d; want 401", resp.StatusCode)
	}
	call(t, "DELETE", queue+"/users/"+userID, key, "")
	if v := next(); v["length"] != 0.0 || v["position"] != nil {
		t.Errorf("event after leaving = %v", v)
	}

	if resp, _ := call(t, "GET", queue+"/events?token=wrong", "", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("admin events with wrong token = %d; want 401", resp.StatusCode)
	}
}

func TestStatic(t *testing.T) {
	srv := newTestServer(t)
	for path, want := range map[string]int{
		"/":               http.StatusOK,
		"/queue.html":     http.StatusOK,
		"/vendor/mvp.css": http.StatusOK,
		"/vendor/":        http.StatusNotFound,
		"/../main.go":     http.StatusNotFound,
		"/healthz":        http.StatusOK,
	} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("GET %s = %d; want %d", path, resp.StatusCode, want)
		}
		if resp.Header.Get("Content-Security-Policy") == "" {
			t.Errorf("GET %s: no CSP header", path)
		}
	}
}
