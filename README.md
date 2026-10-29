# StreetSense: ESP32 Wi-Fi energy dashboard

## Current hardware: 3 IR sensors, 4 LEDs, no LDR

IR1 OUT goes to GPIO 13, IR2 to GPIO 14, IR3 to GPIO 27. LED1–LED4 use GPIO 18, 19, 21 and 22. There is no IR4 and GPIO 26 is unused. Each LED needs its own current-limiting resistor. IR1 activates LED1+LED2, IR2 activates LED2+LED3, IR3 activates LED3+LED4. The furthest active sensor takes priority. The final LED pair stays active for 3 seconds after detection clears. Telemetry includes exactly 3 detection flags and 4 LED brightness values. The nighttime energy baseline still includes all 4 LEDs (0.080 W at the default 0.020 W per LED).

Use the complete `firmware/SmartStreetLighting_WiFi/SmartStreetLighting_WiFi.ino` sketch. It uses three IR sensors and four LEDs, forces night mode, and does not read or transmit an LDR value. Fill in the four Wi-Fi settings at the top. The dashboard retains an LDR property labeled Disabled; it ignores even legacy LDR values. Restart `node server.mjs` after replacing this project and refresh your browser. The generic helper below is retained for compatibility with older integrations, but its LDR argument is ignored in outgoing packets.


A responsive dashboard for the four-LED, three-IR-sensor street-lighting project. Includes an online demo and a local Wi-Fi receiver. No npm dependencies or cloud accounts are needed for the local system. Use Node.js 20 or later.

## Connect your real ESP32

1. Extract this project on your laptop. Open a terminal in the extracted folder and run `node server.mjs`. On Windows you can also double-click `Start-Dashboard.cmd`.
2. Leave the terminal open. It displays a dashboard address such as `http://192.168.1.10:8787`, a telemetry URL ending in `/api/telemetry`, and your generated device key. Use the address belonging to your Wi-Fi adapter, not a VPN or virtual adapter.
3. Connect your laptop and ESP32 to the same Wi-Fi. For a classic ESP32, use a 2.4 GHz network. A phone hotspot can work if it allows connected devices to communicate. In Windows Firewall, allow Node on your private network if prompted. Do not open router ports.
4. Copy `firmware/StreetSenseTelemetry.h` into the folder containing your existing verified Arduino sketch. Copy `firmware/secrets.example.h` there as `secrets.h`. Fill in your own Wi-Fi name/password, the laptop telemetry URL and generated device key. Wi-Fi credentials stay on your ESP32 and in your local secrets file.
5. Add `#include "StreetSenseTelemetry.h"` and `#include "secrets.h"` to your existing sketch. At the end of `setup()`, add:

   ```cpp
   StreetSense::begin(WIFI_SSID, WIFI_PASSWORD, TELEMETRY_URL, DEVICE_KEY);
   ```

6. After your existing sensor reading and LED output logic in `loop()`, add:

   ```cpp
   bool detected[3] = {vehicle1, vehicle2, vehicle3};
   float brightness[4] = {led1Level, led2Level, led3Level, led4Level};
   StreetSense::publish(isNight, ldrRaw, detected, brightness);
   ```

   Replace the example variable names with the variables in YOUR program. Each detection must be `true` when a vehicle is present. Many IR modules are active-low, so normalize your digital readings. Each LED level is 0.0 when off and 1.0 at full power. For PWM, divide the actual duty value by the maximum duty value. Report the LED's actual commanded level, including any hold time, rather than simply copying the IR sensor state. No GPIO pin numbers are assumed or changed by the helper.

7. Upload your updated sketch. Open the local dashboard address from step 2 on your laptop or a phone on the same network. It automatically selects live Wi-Fi mode. Within a few seconds it should show “ESP32 connected.” A first packet starts the session; energy accumulates as more packets arrive.
8. Open Configuration and set the real watts per model LED or lamp. The default **0.020 W per LED is an editable demonstration assumption**, not a measured rating. Changing the live wattage starts a new energy session so old and new settings are not mixed.

`firmware/IntegrationExample/IntegrationExample.ino` demonstrates placement of the calls. Its readings are placeholders; it is NOT your street-light controller and does not read pins or operate lamps. Replace its placeholders or, preferably, integrate the helper into your existing program.

## How the Wi-Fi path works

ESP32 → same Wi-Fi router/hotspot → laptop HTTP receiver → dashboard in a browser.

The ESP32 sends JSON every 2 seconds to `POST /api/telemetry` with `X-Device-Key`. The browser reads `GET /api/state` every 3 seconds. HTTP runs in an ESP32 background task so a network timeout does not pause the lighting loop. Wi-Fi reconnects automatically. The laptop must remain powered on and running the service. Its IP can change after reconnecting: update the URL or reserve the laptop's address in your router.

The hosted HTTPS Site is an interactive demo. Use the included local address for hardware telemetry. This avoids sending packets from a local device into a private, login-protected cloud page. Monitoring from outside your Wi-Fi needs an authenticated HTTPS cloud receiver or MQTT service, which this local version does not provision.

## What the numbers mean

- **Power (W):** current consumption. Without a meter, the estimate equals the sum of four brightness fractions multiplied by configured watts per lamp. This assumes approximately linear electrical power versus brightness.
- **Energy (Wh):** previous packet power × elapsed hours, summed over valid received intervals. It starts after the first packet. Intervals over 15 seconds are excluded from BOTH smart and baseline totals, as are laptop-service restart gaps. Time uses laptop receipt timestamps, not the ESP32 clock. The system does not reconstruct unobserved transitions between packets.
- **Conventional baseline:** four lamps at rated power during night intervals, zero during daytime intervals. The baseline is modeled, not measured.
- **Savings:** conventional Wh minus smart Wh. Percentage = savings / baseline × 100. When the baseline is zero, percentage is unavailable. Negative savings are retained.
- **Estimated values omit ESP32, sensor and conversion losses.** To measure total system consumption, add and calibrate a suitable electrical power sensor, then pass measured whole-system watts as the optional fifth argument to `StreetSense::publish(...)`. Do not label an LED-state estimate as measured. Totals that combine measured and estimated intervals are labeled mixed.
- **Demo mode:** simulated data, with an illustrative 30-minute prefilled session. Demo totals never enter live totals. No hard-coded project savings percentage appears.
- **History:** the laptop retains the latest 1,200 received samples for chart/export. Accumulated session totals continue beyond that history window. Readings and the device key persist under `.local/`; this private folder is excluded from source control and the download.

## Troubleshooting

- **Waiting for ESP32:** check the laptop address, device key, Serial Monitor, and private-network firewall permission. A packet older than 15 seconds appears offline; its power and sensor indicators are marked unavailable.
- **Phone cannot load the dashboard:** ensure the same Wi-Fi, use the laptop LAN IP, disable guest-network client isolation or use a network that permits local device communication.
- **POST 401:** device key mismatch. Copy the key from the running service into `secrets.h`.
- **POST 400:** check three detection booleans, four brightness values from 0 to 1, and a boolean night flag; LDR values are ignored. The device ID must be `esp32-street-01`.
- **No Node command:** install a current Node.js LTS release, reopen the terminal and run again. The included app needs Node.js 20+.
- **Need a fresh lifetime session:** changing the lamp rating starts a fresh session. To remove stored history manually, stop the service and remove `.local/readings.json`; keep `.local/device.key` to retain the device key.

This is a local demonstration service for a trusted private Wi-Fi network. The device key authenticates incoming samples. There are no remote lamp controls and no public internet exposure. Fonts load from Google Fonts when online and fall back to system fonts offline.

## Development and checks

`node --test test/*.test.mjs` checks energy calculations, connection gaps, malformed readings and receiver authentication. Frontend source is in `dist/`, the receiver in `server.mjs`, and energy logic in `telemetry.mjs`.

ESP32 API reference: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html

The ESP32 firmware helper has not been compiled or hardware-tested in this workspace. Actual board upload requires your Arduino-ESP32 setup and existing sketch variables.
