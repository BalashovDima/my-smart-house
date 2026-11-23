package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-smart-house/server/internal/model"
	"my-smart-house/server/internal/store"
)

const (
	defaultLimit = 1000
	maxLimit     = 10000
)

type StatusProvider interface {
	Connected() bool
	LastMessageAt() time.Time
}

type Server struct {
	store   *store.Store
	ingest  StatusProvider
	origins map[string]bool
	log     *slog.Logger
}

func New(st *store.Store, ingest StatusProvider, origins []string, logger *slog.Logger) *Server {
	allowed := make(map[string]bool, len(origins))
	for _, origin := range origins {
		allowed[origin] = true
	}
	return &Server{store: st, ingest: ingest, origins: allowed, log: logger}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/devices", s.handleDevices)
	mux.HandleFunc("GET /api/devices/{id}", s.handleDevice)
	mux.HandleFunc("GET /api/devices/{id}/samples", s.handleSamples)
	mux.HandleFunc("GET /api/health", s.handleHealth)
	return s.withCORS(mux)
}

type deviceResponse struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Name       string          `json:"name,omitempty"`
	FW         string          `json:"fw,omitempty"`
	Online     bool            `json:"online"`
	FirstSeen  *time.Time      `json:"firstSeen,omitempty"`
	LastSeen   *time.Time      `json:"lastSeen,omitempty"`
	IntervalMs int64           `json:"intervalMs,omitempty"`
	Latest     json.RawMessage `json:"latest,omitempty"`
}

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := s.store.ListDevices(r.Context())
	if err != nil {
		s.log.Error("list devices", "error", err)
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	out := make([]deviceResponse, 0, len(devices))
	for _, device := range devices {
		out = append(out, toDeviceResponse(device, time.Now().UTC()))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !model.IsValidDeviceID(id) {
		writeError(w, http.StatusBadRequest, "invalid device id")
		return
	}

	device, err := s.store.GetDevice(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "device not found")
		return
	}
	if err != nil {
		s.log.Error("get device", "device", id, "error", err)
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, toDeviceResponse(device, time.Now().UTC()))
}

type sampleResponse struct {
	TS   time.Time       `json:"ts"`
	Data json.RawMessage `json:"data"`
}

type samplesResponse struct {
	Device  string           `json:"device"`
	From    time.Time        `json:"from"`
	To      time.Time        `json:"to"`
	StepSec int64            `json:"stepSec"`
	Count   int              `json:"count"`
	Samples []sampleResponse `json:"samples"`
}

func (s *Server) handleSamples(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !model.IsValidDeviceID(id) {
		writeError(w, http.StatusBadRequest, "invalid device id")
		return
	}

	now := time.Now().UTC()
	from, err := parseTimeQuery(r, "from", now.Add(-24*time.Hour))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid from")
		return
	}
	to, err := parseTimeQuery(r, "to", now)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid to")
		return
	}
	if from.After(to) {
		writeError(w, http.StatusBadRequest, "from must be before to")
		return
	}

	limit, err := parseIntQuery(r, "limit", defaultLimit)
	if err != nil || limit < 1 || limit > maxLimit {
		writeError(w, http.StatusBadRequest, "limit must be 1-10000")
		return
	}
	stepSec, err := parseIntQuery(r, "step", 0)
	if err != nil || stepSec < 0 || stepSec > 86400 {
		writeError(w, http.StatusBadRequest, "step must be 0-86400 seconds")
		return
	}

	if _, err := s.store.GetDevice(r.Context(), id); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "device not found")
		return
	} else if err != nil {
		s.log.Error("get device", "device", id, "error", err)
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	samples, err := s.store.Samples(r.Context(), id, from.UnixMilli(), to.UnixMilli(), int(limit), stepSec*1000)
	if err != nil {
		s.log.Error("query samples", "device", id, "error", err)
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	out := samplesResponse{
		Device:  id,
		From:    from.UTC(),
		To:      to.UTC(),
		StepSec: stepSec,
		Count:   len(samples),
		Samples: make([]sampleResponse, 0, len(samples)),
	}
	for _, sample := range samples {
		out.Samples = append(out.Samples, sampleResponse{
			TS:   time.UnixMilli(sample.TS).UTC(),
			Data: sample.Payload,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	dbOK := true
	if err := s.store.Ping(ctx); err != nil {
		dbOK = false
	}

	last := s.ingest.LastMessageAt()
	var lastValue any
	if !last.IsZero() {
		lastValue = last
	}

	status := http.StatusOK
	if !dbOK {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ok": dbOK,
		"mqtt": map[string]any{
			"connected":     s.ingest.Connected(),
			"lastMessageAt": lastValue,
		},
		"db": map[string]any{"ok": dbOK},
	})
}

func toDeviceResponse(device store.Device, now time.Time) deviceResponse {
	out := deviceResponse{
		ID:         device.ID,
		Type:       device.Type,
		Name:       device.Name,
		FW:         device.FW,
		Online:     device.Online,
		IntervalMs: device.IntervalMs,
		Latest:     device.LastPayload,
	}
	if device.FirstSeen > 0 {
		t := time.UnixMilli(device.FirstSeen).UTC()
		out.FirstSeen = &t
	}
	if device.LastSeen > 0 {
		t := time.UnixMilli(device.LastSeen).UTC()
		out.LastSeen = &t
	}
	// LWT is the primary signal, but a silenced device should not stay
	// "online" forever if the broker never delivers it.
	if out.Online && device.IntervalMs > 0 && device.LastSeen > 0 {
		staleAfter := time.Duration(3*device.IntervalMs) * time.Millisecond
		if now.Sub(time.UnixMilli(device.LastSeen)) > staleAfter {
			out.Online = false
		}
	}
	return out
}

func parseTimeQuery(r *http.Request, key string, fallback time.Time) (time.Time, error) {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback, nil
	}
	if ms, err := strconv.ParseInt(value, 10, 64); err == nil {
		return time.UnixMilli(ms).UTC(), nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed, nil
}

func parseIntQuery(r *http.Request, key string, fallback int64) (int64, error) {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback, nil
	}
	return strconv.ParseInt(value, 10, 64)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (s.origins["*"] || s.origins[origin]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": message})
}
