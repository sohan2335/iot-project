#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>

// -------- EDIT THESE FOUR SETTINGS BEFORE UPLOADING --------
const char *WIFI_SSID = "YOUR_2_4_GHZ_WIFI_NAME";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// Run Start-Dashboard.cmd on your laptop and copy its ESP32 POST URL here.
// Use the laptop's Wi-Fi IP address, NOT localhost or the ESP32's address.
const char *DASHBOARD_URL = "http://10.162.20.241:8788/api/telemetry";
const char *DEVICE_KEY = "PASTE_THE_DEVICE_KEY_PRINTED_BY_THE_LAPTOP_SERVICE";

// Classic ESP32 pin mapping. Change these if your wiring is different.
const int NUM_LIGHTS = 4;
const int NUM_SENSORS = 3;
const int irPins[NUM_SENSORS] = {13, 14, 27};
const int ledPins[NUM_LIGHTS] = {18, 19, 21, 22};
const bool IR_ACTIVE_LOW = true;
const unsigned long HOLD_TIME = 3000;
const unsigned long SEND_INTERVAL = 2000;
const float LED_POWER_W = 0.020f; // Estimated electrical watts per LED.

bool ledState[NUM_LIGHTS] = {false, false, false, false};
bool vehicleDetected[NUM_SENSORS] = {false, false, false};
int activeZone = -1;
unsigned long lastDetectionTime = 0;
double smartEnergyWs = 0;
double normalEnergyWs = 0;
double ledEnergyWs[NUM_LIGHTS] = {0, 0, 0, 0};
unsigned long lastUpdate = 0;
unsigned long lastPrint = 0;
unsigned long lastSend = 0;
const bool nightMode = true; // Manual night mode; no LDR hardware or readings.

// The lighting loop writes snapshots to a one-item queue.
// Wi-Fi and HTTP run in a separate task, so a timeout will not hold LEDs on.
struct TelemetrySnapshot {
  bool night;
  bool detected[NUM_SENSORS];
  bool lights[NUM_LIGHTS];
};
QueueHandle_t telemetryQueue = nullptr;

void telemetryTask(void *parameter) {
  (void)parameter;
  uint32_t lastWifiAttempt = millis() - 10000UL;
  bool previouslyConnected = false;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (previouslyConnected) Serial.println("Wi-Fi disconnected; reconnecting in background.");
      previouslyConnected = false;
      if ((uint32_t)(millis() - lastWifiAttempt) >= 10000UL) {
        lastWifiAttempt = millis();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }

    if (!previouslyConnected) {
      Serial.print("Wi-Fi connected. ESP32 IP: ");
      Serial.println(WiFi.localIP());
      previouslyConnected = true;
    }

    TelemetrySnapshot reading;
    if (xQueueReceive(telemetryQueue, &reading, pdMS_TO_TICKS(500)) != pdTRUE) continue;

    String payload;
    payload.reserve(320);
    payload = "{\"deviceId\":\"esp32-street-01\",\"night\":";
    payload += reading.night ? "true" : "false";
    payload += ",\"ldrEnabled\":false";
    payload += ",\"detected\":[";
    for (int i = 0; i < NUM_SENSORS; i++) {
      if (i > 0) payload += ',';
      payload += reading.detected[i] ? "true" : "false";
    }
    payload += "],\"brightness\":[";
    for (int i = 0; i < NUM_LIGHTS; i++) {
      if (i > 0) payload += ',';
      payload += reading.lights[i] ? "1" : "0";
    }
    payload += "]}";
    // Deliberately omit powerW: these are LED-state estimates, not meter readings.

    WiFiClient client;
    HTTPClient http;
    http.setConnectTimeout(1000);
    http.setTimeout(1500);
    if (http.begin(client, DASHBOARD_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Key", DEVICE_KEY);
      const int status = http.POST(payload);
      if (status == 200) {
        Serial.println("Dashboard telemetry: OK");
      } else {
        Serial.printf("Dashboard telemetry failed: %d (401 = wrong key).\n", status);
      }
      http.end();
    } else {
      Serial.println("Could not start dashboard HTTP request. Check DASHBOARD_URL.");
    }
  }
}

void setLights(int zone) {
  for (int i = 0; i < NUM_LIGHTS; i++) ledState[i] = false;

  // IR1: LED1 + LED2; IR2: LED2 + LED3;
  // IR3: LED3 + LED4. There is no fourth IR sensor.
  if (zone >= 0 && zone < NUM_SENSORS) {
    ledState[zone] = true;
    if (zone + 1 < NUM_LIGHTS) ledState[zone + 1] = true;
  }
  for (int i = 0; i < NUM_LIGHTS; i++) {
    digitalWrite(ledPins[i], ledState[i] ? HIGH : LOW);
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_SENSORS; i++) pinMode(irPins[i], INPUT);
  for (int i = 0; i < NUM_LIGHTS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  telemetryQueue = xQueueCreate(1, sizeof(TelemetrySnapshot));
  if (telemetryQueue != nullptr) {
    if (xTaskCreate(telemetryTask, "StreetSenseWiFi", 6144, nullptr, 1, nullptr) != pdPASS) {
      vQueueDelete(telemetryQueue);
      telemetryQueue = nullptr;
      Serial.println("Wi-Fi task failed to start. Lighting will still operate.");
    }
  } else {
    Serial.println("Telemetry queue failed. Lighting will still operate.");
  }

  lastUpdate = millis();
  Serial.println("Smart street lighting started: 3 IR sensors, 4 LEDs.");
  Serial.println("LED energy is estimated using 0.020 W per LED.");
  Serial.println("LDR disabled: no readings are collected or transmitted.");
}

void loop() {
  unsigned long now = millis();
  unsigned long elapsedMs = now - lastUpdate;
  lastUpdate = now;
  const double elapsedSeconds = elapsedMs / 1000.0;

  // Account for the PREVIOUS output state over the interval that just elapsed.
  if (nightMode) normalEnergyWs += NUM_LIGHTS * LED_POWER_W * elapsedSeconds;
  for (int i = 0; i < NUM_LIGHTS; i++) {
    if (ledState[i]) {
      const double energy = LED_POWER_W * elapsedSeconds;
      ledEnergyWs[i] += energy;
      smartEnergyWs += energy;
    }
  }

  int detectedZone = -1;
  for (int i = 0; i < NUM_SENSORS; i++) {
    vehicleDetected[i] = IR_ACTIVE_LOW
      ? digitalRead(irPins[i]) == LOW
      : digitalRead(irPins[i]) == HIGH;
    if (vehicleDetected[i]) detectedZone = i; // Furthest sensor takes priority.
  }

  if (!nightMode) {
    activeZone = -1;
    setLights(-1);
  } else if (detectedZone >= 0) {
    activeZone = detectedZone;
    lastDetectionTime = now;
    setLights(activeZone);
  } else if (activeZone >= 0 && now - lastDetectionTime >= HOLD_TIME) {
    activeZone = -1;
    setLights(-1);
  }

  if (telemetryQueue != nullptr && now - lastSend >= SEND_INTERVAL) {
    lastSend = now;
    TelemetrySnapshot reading;
    reading.night = nightMode;
    for (int i = 0; i < NUM_SENSORS; i++) reading.detected[i] = vehicleDetected[i];
    for (int i = 0; i < NUM_LIGHTS; i++) {
      reading.lights[i] = ledState[i]; // Report actual held outputs, not IR states.
    }
    xQueueOverwrite(telemetryQueue, &reading);
  }

  if (now - lastPrint >= 2000) {
    lastPrint = now;
    const double smartWh = smartEnergyWs / 3600.0;
    const double normalWh = normalEnergyWs / 3600.0;
    const double savedWh = normalWh - smartWh;
    int lightsOn = 0;
    Serial.println("\n==== STREET LIGHT STATUS ====");
    Serial.print("Mode: "); Serial.println(nightMode ? "NIGHT" : "DAY");
    Serial.print("Active zone: ");
    if (activeZone < 0) Serial.println("NONE"); else Serial.println(activeZone + 1);
    for (int i = 0; i < NUM_LIGHTS; i++) {
      if (ledState[i]) lightsOn++;
      Serial.printf("LED %d: %s | Energy: %.6f Wh\n", i + 1,
                    ledState[i] ? "ON" : "OFF", ledEnergyWs[i] / 3600.0);
    }
    Serial.printf("Estimated LED power: %.3f W\n", lightsOn * LED_POWER_W);
    Serial.printf("Smart LED energy: %.6f Wh\n", smartWh);
    Serial.printf("Conventional LED energy: %.6f Wh\n", normalWh);
    Serial.printf("Energy saved: %.6f Wh\n", savedWh);
    if (normalWh > 0) Serial.printf("Savings: %.2f%%\n", savedWh / normalWh * 100.0);
    else Serial.println("Savings: N/A (no nighttime baseline yet)");
    Serial.println("=============================");
  }
  delay(20);
}
