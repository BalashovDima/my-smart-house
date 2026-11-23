package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"my-smart-house/server/internal/model"
	"my-smart-house/server/internal/store"
)

type fakeStatus struct {
	connected bool
	last      time.Time
}

func (f fakeStatus) Connected() bool          { return f.connected }
func (f fakeStatus) LastMessageAt() time.Time { return f.last }

func testServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(st, fakeStatus{connected: true, last: time.Now()}, []string{"http://localhost:5173"}, logger), st
}

func state(id string) model.State {
	return model.State{
		V:          1,
		ID:         id,
		Type:       "battery-monitor",
		FW:         "0.2.0",
		Seq:        1,
		IntervalMs: 30000,
		RSSI:       -60,
		Calibrated: true,
		PackMv:     13200,
		MinCellMv:  3290,
		MaxCellMv:  3310,
		SpreadMv:   20,
		CellsMv:    []int64{3290, 3300, 3300, 3310},
	}
}

func TestDevicesAndSamples(t *testing.T) {
	srv, st := testServer(t)
	device := state("battmon-A1B2")
	now := time.Now().UnixMilli()
	payload, _ := json.Marshal(device)
	if err := st.UpsertLive(context.Background(), device, payload, now); err != nil {
		t.Fatal(err)
	}

	handler := srv.Handler()

	t.Run("devices", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/devices", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		var devices []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &devices); err != nil {
			t.Fatal(err)
		}
		if len(devices) != 1 || devices[0]["id"] != device.ID {
			t.Fatalf("devices = %v", devices)
		}
		if devices[0]["online"] != true {
			t.Fatalf("online = %v", devices[0]["online"])
		}
	})

	t.Run("samples", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/devices/"+device.ID+"/samples?from=0", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		var out samplesResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.Count != 1 {
			t.Fatalf("count = %d, want 1", out.Count)
		}
	})

	t.Run("samples unknown device", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/devices/battmon-NOPE/samples", nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("health", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})
}

func TestCORS(t *testing.T) {
	srv, _ := testServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	srv.Handler().ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}
