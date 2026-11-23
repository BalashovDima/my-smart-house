package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"my-smart-house/server/internal/api"
	"my-smart-house/server/internal/config"
	"my-smart-house/server/internal/ingest"
	"my-smart-house/server/internal/store"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	if dir := filepath.Dir(cfg.DBPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			logger.Error("create database directory", "error", err)
			os.Exit(1)
		}
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		logger.Error("open database", "path", cfg.DBPath, "error", err)
		os.Exit(1)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	subscriber := ingest.New(cfg, st, logger)
	go func() {
		if err := subscriber.Run(ctx); err != nil {
			logger.Error("mqtt subscriber stopped", "error", err)
			stop()
		}
	}()

	if cfg.RetentionDays > 0 {
		go retentionLoop(ctx, st, cfg.RetentionDays, logger)
	}

	handler := api.New(st, subscriber, cfg.CORSOrigins, logger).Handler()
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	logger.Info("http listening", "addr", cfg.HTTPAddr, "db", cfg.DBPath,
		"broker", cfg.MQTTURL, "retentionDays", cfg.RetentionDays)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("http server", "error", err)
		os.Exit(1)
	}
}

func retentionLoop(ctx context.Context, st *store.Store, days int, logger *slog.Logger) {
	purge := func() {
		before := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
		deleted, err := st.Purge(ctx, before)
		if err != nil {
			logger.Error("purge old samples", "error", err)
			return
		}
		if deleted > 0 {
			logger.Info("purged old samples", "rows", deleted, "before", time.UnixMilli(before))
		}
	}

	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purge()
		}
	}
}
