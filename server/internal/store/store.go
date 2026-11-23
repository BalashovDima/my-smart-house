package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite"

	"my-smart-house/server/internal/model"
)

const schema = `
CREATE TABLE IF NOT EXISTS devices (
	id            TEXT PRIMARY KEY,
	type          TEXT NOT NULL DEFAULT '',
	name          TEXT NOT NULL DEFAULT '',
	fw            TEXT NOT NULL DEFAULT '',
	first_seen    INTEGER NOT NULL,
	last_seen     INTEGER NOT NULL,
	online        INTEGER NOT NULL DEFAULT 0,
	interval_ms   INTEGER NOT NULL DEFAULT 0,
	last_payload  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS samples (
	device_id  TEXT NOT NULL,
	ts         INTEGER NOT NULL,
	payload    TEXT NOT NULL,
	PRIMARY KEY (device_id, ts)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);

PRAGMA user_version = 1;
`

type Store struct {
	db *sql.DB
}

type Device struct {
	ID          string
	Type        string
	Name        string
	FW          string
	FirstSeen   int64
	LastSeen    int64
	Online      bool
	IntervalMs  int64
	LastPayload json.RawMessage
}

type Sample struct {
	TS      int64
	Payload json.RawMessage
}

func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// One writer and one reader connection keeps SQLITE_BUSY out of a
	// single-host home deployment; queries are small and indexed.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// UpsertLive records a non-retained sample: history plus the current device
// row.
func (s *Store) UpsertLive(ctx context.Context, state model.State, raw []byte, ts int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO devices (id, type, fw, first_seen, last_seen, online, interval_ms, last_payload)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type        = CASE WHEN excluded.type <> '' THEN excluded.type ELSE devices.type END,
			fw          = CASE WHEN excluded.fw <> '' THEN excluded.fw ELSE devices.fw END,
			last_seen   = excluded.last_seen,
			online      = 1,
			interval_ms = excluded.interval_ms,
			last_payload = excluded.last_payload
	`, state.ID, state.Type, state.FW, ts, ts, state.IntervalMs, string(raw)); err != nil {
		return fmt.Errorf("upsert device: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT OR REPLACE INTO samples (device_id, ts, payload) VALUES (?, ?, ?)
	`, state.ID, ts, string(raw)); err != nil {
		return fmt.Errorf("insert sample: %w", err)
	}

	return tx.Commit()
}

// UpsertRetained refreshes the cached state after a server restart without
// creating a history row or bumping last_seen. Retained messages can be hours
// old, so treating them as fresh samples would corrupt the timeline.
func (s *Store) UpsertRetained(ctx context.Context, state model.State, raw []byte, ts int64) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO devices (id, type, fw, first_seen, last_seen, online, interval_ms, last_payload)
		VALUES (?, ?, ?, ?, 0, 0, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type        = CASE WHEN excluded.type <> '' THEN excluded.type ELSE devices.type END,
			fw          = CASE WHEN excluded.fw <> '' THEN excluded.fw ELSE devices.fw END,
			interval_ms = excluded.interval_ms,
			last_payload = excluded.last_payload
	`, state.ID, state.Type, state.FW, ts, state.IntervalMs, string(raw))
	if err != nil {
		return fmt.Errorf("upsert retained state: %w", err)
	}
	return nil
}

func (s *Store) SetAvailability(ctx context.Context, deviceID string, online bool, ts int64) error {
	onlineInt := 0
	if online {
		onlineInt = 1
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO devices (id, first_seen, last_seen, online)
		VALUES (?, ?, 0, ?)
		ON CONFLICT(id) DO UPDATE SET online = excluded.online
	`, deviceID, ts, onlineInt)
	if err != nil {
		return fmt.Errorf("set availability: %w", err)
	}
	return nil
}

func (s *Store) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, type, name, fw, first_seen, last_seen, online, interval_ms, last_payload
		FROM devices ORDER BY id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []Device
	for rows.Next() {
		device, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (s *Store) GetDevice(ctx context.Context, deviceID string) (Device, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, type, name, fw, first_seen, last_seen, online, interval_ms, last_payload
		FROM devices WHERE id = ?
	`, deviceID)
	return scanDevice(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanDevice(row rowScanner) (Device, error) {
	var device Device
	var online int
	var payload string
	if err := row.Scan(&device.ID, &device.Type, &device.Name, &device.FW,
		&device.FirstSeen, &device.LastSeen, &online, &device.IntervalMs,
		&payload); err != nil {
		return Device{}, err
	}
	device.Online = online != 0
	if payload != "" {
		device.LastPayload = json.RawMessage(payload)
	}
	return device, nil
}

// Samples returns raw samples in ascending time order. When stepMs is positive,
// only the newest sample in each bucket is returned, which keeps long ranges
// small while staying device-type agnostic.
func (s *Store) Samples(ctx context.Context, deviceID string, from, to int64, limit int, stepMs int64) ([]Sample, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if stepMs > 0 {
		rows, err = s.db.QueryContext(ctx, `
			SELECT ts, payload FROM (
				SELECT ts, payload,
				       ROW_NUMBER() OVER (PARTITION BY (ts / ?) ORDER BY ts DESC) AS rn
				FROM samples
				WHERE device_id = ? AND ts >= ? AND ts <= ?
			)
			WHERE rn = 1
			ORDER BY ts ASC
			LIMIT ?
		`, stepMs, deviceID, from, to, limit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT ts, payload FROM samples
			WHERE device_id = ? AND ts >= ? AND ts <= ?
			ORDER BY ts ASC
			LIMIT ?
		`, deviceID, from, to, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var samples []Sample
	for rows.Next() {
		var sample Sample
		var payload string
		if err := rows.Scan(&sample.TS, &payload); err != nil {
			return nil, err
		}
		sample.Payload = json.RawMessage(payload)
		samples = append(samples, sample)
	}
	return samples, rows.Err()
}

func (s *Store) Purge(ctx context.Context, before int64) (int64, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM samples WHERE ts < ?`, before)
	if err != nil {
		return 0, err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if deleted > 0 {
		// Let SQLite refresh statistics after a large delete.
		_, _ = s.db.ExecContext(ctx, `PRAGMA optimize`)
	}
	return deleted, nil
}
