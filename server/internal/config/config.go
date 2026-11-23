package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config is the complete server configuration. Everything is set through the
// environment so the same binary works locally and in the compose stack.
type Config struct {
	HTTPAddr string

	MQTTURL         string
	MQTTClientID    string
	MQTTUsername    string
	MQTTPassword    string
	MQTTTopicPrefix string
	MQTTCACertFile  string
	MQTTServerName  string

	DBPath        string
	RetentionDays int

	CORSOrigins []string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		MQTTURL:         env("MQTT_URL", "ssl://localhost:8883"),
		MQTTClientID:    env("MQTT_CLIENT_ID", "smarthouse-server"),
		MQTTUsername:    env("MQTT_USER", "smarthouse-server"),
		MQTTPassword:    env("MQTT_PASS", ""),
		MQTTTopicPrefix: env("MQTT_TOPIC_PREFIX", "smarthouse"),
		MQTTCACertFile:  env("MQTT_CA_FILE", ""),
		MQTTServerName:  env("MQTT_TLS_SERVER_NAME", ""),
		DBPath:          env("DB_PATH", "./data/smarthouse.db"),
		CORSOrigins:     splitList(env("CORS_ORIGINS", "http://localhost:5173")),
	}

	days, err := strconv.Atoi(env("RETENTION_DAYS", "180"))
	if err != nil || days < 0 {
		return Config{}, fmt.Errorf("RETENTION_DAYS must be a non-negative integer")
	}
	cfg.RetentionDays = days

	parsed, err := url.Parse(cfg.MQTTURL)
	if err != nil || parsed.Host == "" {
		return Config{}, fmt.Errorf("MQTT_URL must be a complete broker URL")
	}
	switch parsed.Scheme {
	case "tcp", "mqtt":
		parsed.Scheme = "tcp"
	case "ssl", "tls", "mqtts":
		parsed.Scheme = "ssl"
	default:
		return Config{}, fmt.Errorf("unsupported MQTT_URL scheme %q", parsed.Scheme)
	}
	cfg.MQTTURL = parsed.String()

	if !validTopicPrefix(cfg.MQTTTopicPrefix) {
		return Config{}, fmt.Errorf("MQTT_TOPIC_PREFIX must be 1-64 letters, digits, '.', '_' or '-'")
	}

	return cfg, nil
}

func validTopicPrefix(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
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

func env(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func splitList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
