package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type Kind int

const (
	KindState Kind = iota
	KindSample
	KindAvailability
)

var (
	ErrBadTopic        = errors.New("bad topic")
	ErrBadState        = errors.New("bad state payload")
	ErrBadAvailability = errors.New("bad availability payload")
)

// State is the subset of the telemetry payload the server needs to validate
// and index. The original payload is stored separately, so unknown fields from
// future device types survive.
type State struct {
	V          int     `json:"v"`
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	FW         string  `json:"fw"`
	Seq        uint64  `json:"seq"`
	UptimeMs   int64   `json:"uptimeMs"`
	IntervalMs int64   `json:"intervalMs"`
	RSSI       int     `json:"rssi"`
	Calibrated bool    `json:"calibrated"`
	PackMv     int64   `json:"packMv"`
	MinCellMv  int64   `json:"minCellMv"`
	MaxCellMv  int64   `json:"maxCellMv"`
	SpreadMv   int64   `json:"spreadMv"`
	CellsMv    []int64 `json:"cellsMv"`
}

// ParseTopic splits <prefix>/<device>/<kind>. The prefix is a single segment.
func ParseTopic(prefix, topic string) (string, Kind, error) {
	rest, ok := strings.CutPrefix(topic, prefix+"/")
	if !ok {
		return "", 0, ErrBadTopic
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || !IsValidDeviceID(parts[0]) {
		return "", 0, ErrBadTopic
	}

	switch parts[1] {
	case "state":
		return parts[0], KindState, nil
	case "sample":
		return parts[0], KindSample, nil
	case "availability":
		return parts[0], KindAvailability, nil
	default:
		return "", 0, ErrBadTopic
	}
}

func IsValidDeviceID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// ParseState validates a state payload and checks that its id matches the
// topic that carried it.
func ParseState(deviceID string, payload []byte) (State, error) {
	var state State
	if err := json.Unmarshal(payload, &state); err != nil {
		return State{}, fmt.Errorf("%w: %v", ErrBadState, err)
	}

	if state.V != 1 {
		return State{}, fmt.Errorf("%w: unsupported schema version %d", ErrBadState, state.V)
	}
	if state.ID != deviceID {
		return State{}, fmt.Errorf("%w: id %q does not match topic", ErrBadState, state.ID)
	}
	if state.Type == "" || len(state.Type) > 64 {
		return State{}, fmt.Errorf("%w: type is required", ErrBadState)
	}
	if len(state.FW) > 64 {
		return State{}, fmt.Errorf("%w: firmware string too long", ErrBadState)
	}
	if state.IntervalMs < 0 || state.IntervalMs > 3_600_000 {
		return State{}, fmt.Errorf("%w: intervalMs out of range", ErrBadState)
	}
	if state.IntervalMs == 0 {
		// Be tolerant of early v1 publishers that omitted the field.
		state.IntervalMs = 30_000
	}
	if len(state.CellsMv) == 0 || len(state.CellsMv) > 32 {
		return State{}, fmt.Errorf("%w: cellsMv must have 1-32 entries", ErrBadState)
	}
	for i, mv := range state.CellsMv {
		if mv < 0 || mv > 100_000 {
			return State{}, fmt.Errorf("%w: cellsMv[%d] out of range", ErrBadState, i)
		}
	}
	for _, field := range []struct {
		name  string
		value int64
	}{
		{"packMv", state.PackMv},
		{"minCellMv", state.MinCellMv},
		{"maxCellMv", state.MaxCellMv},
		{"spreadMv", state.SpreadMv},
	} {
		if field.value < 0 || field.value > 100_000 {
			return State{}, fmt.Errorf("%w: %s out of range", ErrBadState, field.name)
		}
	}
	if state.MinCellMv > state.MaxCellMv {
		return State{}, fmt.Errorf("%w: minCellMv greater than maxCellMv", ErrBadState)
	}
	if state.RSSI < -150 || state.RSSI > 10 {
		return State{}, fmt.Errorf("%w: rssi out of range", ErrBadState)
	}

	return state, nil
}

func ParseAvailability(payload []byte) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(string(payload))) {
	case "online":
		return true, nil
	case "offline":
		return false, nil
	default:
		return false, ErrBadAvailability
	}
}
