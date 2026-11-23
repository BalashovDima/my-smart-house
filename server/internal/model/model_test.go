package model

import (
	"encoding/json"
	"testing"
)

func validState() State {
	return State{
		V:          1,
		ID:         "battmon-A1B2",
		Type:       "battery-monitor",
		FW:         "0.2.0",
		Seq:        42,
		UptimeMs:   123456,
		IntervalMs: 30000,
		RSSI:       -61,
		Calibrated: true,
		PackMv:     13205,
		MinCellMv:  3298,
		MaxCellMv:  3305,
		SpreadMv:   7,
		CellsMv:    []int64{3298, 3300, 3302, 3305},
	}
}

func TestParseTopic(t *testing.T) {
	tests := []struct {
		topic string
		id    string
		kind  Kind
		ok    bool
	}{
		{"smarthouse/battmon-A1B2/state", "battmon-A1B2", KindState, true},
		{"smarthouse/battmon-A1B2/sample", "battmon-A1B2", KindSample, true},
		{"smarthouse/battmon-A1B2/availability", "battmon-A1B2", KindAvailability, true},
		{"other/battmon-A1B2/state", "", 0, false},
		{"smarthouse/battmon-A1B2/state/extra", "", 0, false},
		{"smarthouse//state", "", 0, false},
		{"smarthouse/battmon A1B2/state", "", 0, false},
		{"smarthouse/battmon-A1B2/cmd", "", 0, false},
	}
	for _, test := range tests {
		id, kind, err := ParseTopic("smarthouse", test.topic)
		if test.ok {
			if err != nil || id != test.id || kind != test.kind {
				t.Errorf("ParseTopic(%q) = %q, %v, %v; want %q, %v", test.topic, id, kind, err, test.id, test.kind)
			}
		} else if err == nil {
			t.Errorf("ParseTopic(%q) succeeded, want error", test.topic)
		}
	}
}

func TestParseState(t *testing.T) {
	state := validState()
	payload, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseState(state.ID, payload)
	if err != nil {
		t.Fatalf("ParseState valid payload: %v", err)
	}
	if got.PackMv != state.PackMv || len(got.CellsMv) != 4 {
		t.Fatalf("ParseState returned %+v", got)
	}
}

func TestParseStateDefaultsMissingInterval(t *testing.T) {
	state := validState()
	state.IntervalMs = 0
	payload, _ := json.Marshal(state)
	got, err := ParseState(state.ID, payload)
	if err != nil {
		t.Fatalf("ParseState: %v", err)
	}
	if got.IntervalMs != 30000 {
		t.Fatalf("intervalMs = %d, want 30000", got.IntervalMs)
	}
}

func TestParseStateRejectsBadPayloads(t *testing.T) {
	base := validState()
	payload := func(mutate func(*State)) []byte {
		state := base
		state.CellsMv = append([]int64(nil), base.CellsMv...)
		mutate(&state)
		data, _ := json.Marshal(state)
		return data
	}

	tests := map[string][]byte{
		"bad json":       []byte("{"),
		"wrong version":  payload(func(s *State) { s.V = 2 }),
		"wrong id":       payload(func(s *State) { s.ID = "other" }),
		"missing type":   payload(func(s *State) { s.Type = "" }),
		"empty cells":    payload(func(s *State) { s.CellsMv = nil }),
		"too many cells": payload(func(s *State) { s.CellsMv = make([]int64, 33) }),
		"negative cell":  payload(func(s *State) { s.CellsMv[0] = -1 }),
		"interval":       payload(func(s *State) { s.IntervalMs = 4_000_000 }),
		"min above max":  payload(func(s *State) { s.MinCellMv = 4000 }),
		"rssi":           payload(func(s *State) { s.RSSI = 11 }),
	}
	for name, data := range tests {
		if _, err := ParseState(base.ID, data); err == nil {
			t.Errorf("%s: ParseState succeeded, want error", name)
		}
	}
}

func TestParseAvailability(t *testing.T) {
	for _, test := range []struct {
		payload string
		online  bool
		ok      bool
	}{
		{"online", true, true},
		{"OFFLINE", false, true},
		{" offline\n", false, true},
		{"maybe", false, false},
		{"", false, false},
	} {
		online, err := ParseAvailability([]byte(test.payload))
		if test.ok {
			if err != nil || online != test.online {
				t.Errorf("ParseAvailability(%q) = %v, %v", test.payload, online, err)
			}
		} else if err == nil {
			t.Errorf("ParseAvailability(%q) succeeded", test.payload)
		}
	}
}
