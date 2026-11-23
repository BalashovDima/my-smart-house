package store

import (
	"context"
	"path/filepath"
	"testing"

	"my-smart-house/server/internal/model"
)

func testState(id string) model.State {
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

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestRetainedStateDoesNotCreateHistory(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	state := testState("battmon-A1B2")

	if err := st.UpsertRetained(ctx, state, []byte(`{"v":1,"id":"battmon-A1B2"}`), 1000); err != nil {
		t.Fatalf("UpsertRetained: %v", err)
	}

	device, err := st.GetDevice(ctx, state.ID)
	if err != nil {
		t.Fatalf("GetDevice: %v", err)
	}
	if device.Online {
		t.Error("device should not be online from a retained state alone")
	}
	if device.LastSeen != 0 {
		t.Errorf("LastSeen = %d, retained state must not create a sample timestamp", device.LastSeen)
	}

	samples, err := st.Samples(ctx, state.ID, 0, 2000, 100, 0)
	if err != nil {
		t.Fatalf("Samples: %v", err)
	}
	if len(samples) != 0 {
		t.Fatalf("retained state created %d samples, want 0", len(samples))
	}
}

func TestLiveStateAvailabilityAndSamples(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	state := testState("battmon-A1B2")

	if err := st.SetAvailability(ctx, state.ID, true, 900); err != nil {
		t.Fatalf("SetAvailability: %v", err)
	}
	for _, ts := range []int64{1000, 1500, 3000} {
		if err := st.UpsertLive(ctx, state, []byte(`{"v":1}`), ts); err != nil {
			t.Fatalf("UpsertLive(%d): %v", ts, err)
		}
	}

	device, err := st.GetDevice(ctx, state.ID)
	if err != nil {
		t.Fatalf("GetDevice: %v", err)
	}
	if !device.Online {
		t.Error("device should be online after availability + live state")
	}
	if device.LastSeen != 3000 {
		t.Errorf("LastSeen = %d, want 3000", device.LastSeen)
	}

	samples, err := st.Samples(ctx, state.ID, 0, 4000, 100, 0)
	if err != nil {
		t.Fatalf("Samples: %v", err)
	}
	if len(samples) != 3 {
		t.Fatalf("raw samples = %d, want 3", len(samples))
	}

	// Buckets of 2 s: 1000/1500 collapse into one, 3000 stays separate.
	stepped, err := st.Samples(ctx, state.ID, 0, 4000, 100, 2000)
	if err != nil {
		t.Fatalf("Samples stepped: %v", err)
	}
	if len(stepped) != 2 {
		t.Fatalf("stepped samples = %d, want 2", len(stepped))
	}
	if stepped[0].TS != 1500 || stepped[1].TS != 3000 {
		t.Fatalf("stepped timestamps = %d, %d", stepped[0].TS, stepped[1].TS)
	}

	deleted, err := st.Purge(ctx, 2000)
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("Purge deleted %d rows, want 2", deleted)
	}
}

func TestListDevices(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertLive(ctx, testState("battmon-0001"), []byte(`{}`), 1000); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertLive(ctx, testState("battmon-0002"), []byte(`{}`), 1000); err != nil {
		t.Fatal(err)
	}

	devices, err := st.ListDevices(ctx)
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	if len(devices) != 2 || devices[0].ID != "battmon-0001" || devices[1].ID != "battmon-0002" {
		t.Fatalf("ListDevices = %+v", devices)
	}
}
