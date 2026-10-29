#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <math.h>

// Sends telemetry from a background task so HTTP does not block lighting logic.
// Designed for Arduino-ESP32. No third-party Arduino libraries are required.
namespace StreetSense {
struct Reading { bool night; uint16_t ldr; bool detected[3]; float brightness[4]; float measuredWatts; };
static QueueHandle_t queue = nullptr;
static String wifiName, wifiPassword, endpoint, deviceKey;
static TaskHandle_t worker = nullptr;
static void task(void *) {
  uint32_t lastAttempt = millis() - 10000;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if ((uint32_t)(millis() - lastAttempt) >= 10000) { lastAttempt = millis(); WiFi.begin(wifiName.c_str(), wifiPassword.c_str()); }
      vTaskDelay(pdMS_TO_TICKS(300)); continue;
    }
    Reading r;
    if (xQueueReceive(queue, &r, pdMS_TO_TICKS(500)) != pdTRUE) continue;
    String json = "{\"deviceId\":\"esp32-street-01\",\"night\":";
    json += r.night ? "true" : "false";
    json += ",\"ldrEnabled\":false,\"detected\":[";
    for (int i = 0; i < 3; i++) { if (i) json += ','; json += r.detected[i] ? "true" : "false"; }
    json += "],\"brightness\":[";
    for (int i = 0; i < 4; i++) { if (i) json += ','; json += String(r.brightness[i], 4); }
    json += ']';
    if (isfinite(r.measuredWatts) && r.measuredWatts >= 0) json += ",\"powerW\":" + String(r.measuredWatts, 5);
    json += '}';
    WiFiClient client; HTTPClient http;
    http.setConnectTimeout(1000); http.setTimeout(1500);
    if (http.begin(client, endpoint)) {
      http.addHeader("Content-Type", "application/json"); http.addHeader("X-Device-Key", deviceKey);
      const int status = http.POST(json);
      if (status != 200) Serial.printf("StreetSense POST failed: %d\n", status);
      http.end();
    }
  }
}
inline bool begin(const char *ssid, const char *password, const char *url, const char *key) {
  if (worker) return true;
  wifiName = ssid; wifiPassword = password; endpoint = url; deviceKey = key;
  queue = xQueueCreate(1, sizeof(Reading)); if (!queue) return false;
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  if (xTaskCreate(task, "StreetSenseWiFi", 6144, nullptr, 1, &worker) != pdPASS) { vQueueDelete(queue); queue = nullptr; return false; }
  return true;
}
inline void publish(bool night, uint16_t ldrRaw, const bool detected[3], const float brightness[4], float wholeSystemMeasuredWatts = NAN) {
  if (!queue) return;
  static uint32_t lastSent = 0;
  if ((uint32_t)(millis() - lastSent) < 2000) return;
  lastSent = millis(); Reading r; r.night = night; r.ldr = min((uint16_t)4095, ldrRaw); r.measuredWatts = wholeSystemMeasuredWatts;
  for (int i = 0; i < 3; i++) r.detected[i] = detected[i];
  for (int i = 0; i < 4; i++) { r.brightness[i] = isfinite(brightness[i]) ? constrain(brightness[i], 0.0f, 1.0f) : 0.0f; }
  xQueueOverwrite(queue, &r);
}
}
