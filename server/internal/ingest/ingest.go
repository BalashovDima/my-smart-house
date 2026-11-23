package ingest

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"sync/atomic"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"my-smart-house/server/internal/config"
	"my-smart-house/server/internal/model"
	"my-smart-house/server/internal/store"
)

type Subscriber struct {
	cfg   config.Config
	store *store.Store
	log   *slog.Logger

	connected atomic.Bool
	lastMsg   atomic.Int64
}

func New(cfg config.Config, st *store.Store, logger *slog.Logger) *Subscriber {
	return &Subscriber{cfg: cfg, store: st, log: logger}
}

func (s *Subscriber) Connected() bool { return s.connected.Load() }

func (s *Subscriber) LastMessageAt() time.Time {
	ms := s.lastMsg.Load()
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func (s *Subscriber) Run(ctx context.Context) error {
	opts := mqtt.NewClientOptions()
	opts.AddBroker(s.cfg.MQTTURL)
	opts.SetClientID(s.cfg.MQTTClientID)
	if s.cfg.MQTTUsername != "" {
		opts.SetUsername(s.cfg.MQTTUsername)
	}
	if s.cfg.MQTTPassword != "" {
		opts.SetPassword(s.cfg.MQTTPassword)
	}
	opts.SetKeepAlive(30 * time.Second)
	opts.SetPingTimeout(10 * time.Second)
	opts.SetConnectTimeout(10 * time.Second)
	opts.SetAutoReconnect(true)
	opts.SetCleanSession(true)
	opts.SetOrderMatters(false)

	if s.cfg.MQTTCACertFile != "" {
		serverName := s.cfg.MQTTServerName
		if serverName == "" {
			if parsed, err := url.Parse(s.cfg.MQTTURL); err == nil {
				serverName = parsed.Hostname()
			}
		}
		tlsConfig, err := loadTLSConfig(s.cfg.MQTTCACertFile, serverName)
		if err != nil {
			return err
		}
		opts.SetTLSConfig(tlsConfig)
	}

	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) {
		s.connected.Store(false)
		s.log.Warn("mqtt connection lost", "error", err)
	})
	opts.SetOnConnectHandler(func(client mqtt.Client) {
		s.log.Info("mqtt connected", "broker", s.cfg.MQTTURL)
		if err := s.subscribe(client); err != nil {
			s.log.Error("mqtt subscribe failed, reconnecting", "error", err)
			// Do not call Disconnect from the callback itself; it can block the
			// router. A forced reconnect resubscribes through this handler.
			go func() {
				time.Sleep(time.Second)
				client.Disconnect(250)
			}()
			return
		}
		s.connected.Store(true)
	})

	client := mqtt.NewClient(opts)
	for {
		if err := client.Connect().Error(); err != nil {
			s.log.Warn("mqtt connect failed, retrying", "error", err)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(5 * time.Second):
			}
			continue
		}
		break
	}
	defer func() {
		s.connected.Store(false)
		client.Disconnect(250)
	}()

	<-ctx.Done()
	return nil
}

func (s *Subscriber) subscribe(client mqtt.Client) error {
	filters := map[string]byte{
		s.cfg.MQTTTopicPrefix + "/+/state":        1,
		s.cfg.MQTTTopicPrefix + "/+/sample":       1,
		s.cfg.MQTTTopicPrefix + "/+/availability": 1,
	}
	token := client.SubscribeMultiple(filters, s.handleMessage)
	if !token.WaitTimeout(5 * time.Second) {
		return fmt.Errorf("subscribe timed out")
	}
	return token.Error()
}

func (s *Subscriber) handleMessage(_ mqtt.Client, msg mqtt.Message) {
	now := time.Now().UnixMilli()
	s.lastMsg.Store(now)

	deviceID, kind, err := model.ParseTopic(s.cfg.MQTTTopicPrefix, msg.Topic())
	if err != nil {
		s.log.Warn("dropping message with unexpected topic", "topic", msg.Topic())
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch kind {
	case model.KindState:
		state, err := model.ParseState(deviceID, msg.Payload())
		if err != nil {
			s.log.Warn("dropping invalid state payload", "topic", msg.Topic(), "error", err)
			return
		}
		// state is retained and may be a replay; refresh the cache only.
		if err := s.store.UpsertRetained(ctx, state, msg.Payload(), now); err != nil {
			s.log.Error("store retained state", "device", deviceID, "error", err)
		}

	case model.KindSample:
		if msg.Retained() {
			s.log.Warn("ignoring retained sample (must not be retained)", "topic", msg.Topic())
			return
		}
		state, err := model.ParseState(deviceID, msg.Payload())
		if err != nil {
			s.log.Warn("dropping invalid sample payload", "topic", msg.Topic(), "error", err)
			return
		}
		if err := s.store.UpsertLive(ctx, state, msg.Payload(), now); err != nil {
			s.log.Error("store live sample", "device", deviceID, "error", err)
		}

	case model.KindAvailability:
		online, err := model.ParseAvailability(msg.Payload())
		if err != nil {
			s.log.Warn("dropping invalid availability payload", "topic", msg.Topic())
			return
		}
		if err := s.store.SetAvailability(ctx, deviceID, online, now); err != nil {
			s.log.Error("store availability", "device", deviceID, "error", err)
		}
	}
}

func loadTLSConfig(caFile, serverName string) (*tls.Config, error) {
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("read MQTT CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("MQTT CA file %s contains no certificates", caFile)
	}
	return &tls.Config{
		RootCAs:    pool,
		ServerName: serverName,
		MinVersion: tls.VersionTLS12,
	}, nil
}
