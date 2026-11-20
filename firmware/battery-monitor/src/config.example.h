#pragma once

// Copy to config.h and adjust for your board. config.h is gitignored so local
// pin/credential changes do not get committed.

#define FW_VERSION "0.1.0"

// mDNS host becomes "<DEVICE_HOSTNAME>-<last4ofMac>.local".
#define DEVICE_HOSTNAME "battmon"

// SoftAP name becomes "<AP_SSID_PREFIX>-<last4ofMac>". Empty password = open AP.
// Only active while unprovisioned or while the router is unreachable.
#define AP_SSID_PREFIX "BattMon"
#define AP_PASSWORD ""

// Op-amp supply switch (transistor/MOSFET gate, not the op-amp rail directly).
static constexpr int PIN_OPAMP_POWER = 25;
static constexpr int OPAMP_POWER_ON_LEVEL = HIGH;
static constexpr int OPAMP_POWER_OFF_LEVEL = LOW;

// ADC1 channels only: ADC2 is unusable while Wi-Fi is active.
// Order = cell 1..4.
static constexpr uint8_t ADC_PINS[] = {32, 33, 34, 35};
static constexpr int ADC_CHANNEL_COUNT = sizeof(ADC_PINS) / sizeof(ADC_PINS[0]);

// Time for the op-amp outputs to settle after power-up, before sampling.
static constexpr uint32_t OPAMP_SETTLE_MS = 100;
// Time between measurement bursts.
static constexpr uint32_t SAMPLE_INTERVAL_MS = 1000;
// Burst samples per channel, grouped into blocks. The reported count is the
// median of the block means: robust against Wi-Fi TX spikes, but with the
// noise of a much longer average. Must be a multiple of ADC_BLOCK_SIZE.
static constexpr int ADC_SAMPLES_PER_READ = 48;
static constexpr int ADC_BLOCK_SIZE = 8;

#define NVS_NAMESPACE "battmon"
