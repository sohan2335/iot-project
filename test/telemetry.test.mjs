import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, ingest, validatePacket } from '../telemetry.mjs';
const packet = (extra = {}) => ({ deviceId: 'esp32-street-01', night: true, ldr: 3000, brightness: [1, 0, 0, 0], detected: [true, false, false], ...extra });
test('integrates power over equal valid intervals and excludes missing telemetry', () => {
  const s = newState(10); ingest(s, packet(), 1000); ingest(s, packet(), 11000);
  assert.equal(s.coveredSeconds, 10); assert.ok(Math.abs(s.smartWh - 10 * 10 / 3600) < 1e-12); assert.ok(Math.abs(s.baselineWh - 40 * 10 / 3600) < 1e-12);
  const energy = s.smartWh; ingest(s, packet(), 100000); assert.equal(s.smartWh, energy); assert.equal(s.coveredSeconds, 10);
});
test('daylight baseline is zero and controller-meter power can cause negative savings', () => {
  const s = newState(10); ingest(s, packet({ night: false, brightness: [0, 0, 0, 0], powerW: 2 }), 1000); ingest(s, packet({ night: false, powerW: 2 }), 11000);
  assert.equal(s.baselineWh, 0); assert.ok(s.smartWh > 0); assert.equal(s.basis, 'measured');
});
test('PWM estimates use four actual brightness levels', () => {
  const s = newState(4); ingest(s, packet({ brightness: [1, .5, .25, 0] }), 1000); assert.equal(s.latest.powerW, 7); assert.equal(s.latest.baselineW, 16); assert.equal(s.basis, 'estimated');
});
test('rejects malformed samples and prevents cross-device totals', () => {
  assert.throws(() => validatePacket(packet({ brightness: [1, 0, 0, 2] })));
  assert.throws(() => validatePacket(packet({ powerW: -1 })));
  assert.throws(() => validatePacket(packet({ deviceId: 'another-device' })));
  assert.throws(() => validatePacket(packet({ night: 'false' })));
  assert.throws(() => validatePacket(packet({ night: null })));
});
test('does not repeatedly count a held vehicle detection as new activity', () => {
  const s = newState(); ingest(s, packet(), 1000); ingest(s, packet(), 3000); assert.equal(s.events.filter(e => e.message.includes('IR1')).length, 1);
});
test('four-LED project uses 0.020 W per lamp and a four-lamp nighttime baseline', () => {
  const s = newState();
  ingest(s, packet({ brightness: [1, 1, 0, 0] }), 1000);
  assert.equal(s.latest.powerW, .040);
  assert.equal(s.latest.baselineW, .080);
  ingest(s, packet({ brightness: [0, 0, 0, 1] }), 3000);
  assert.equal(s.latest.powerW, .020);
  assert.ok(Math.abs(s.smartWh - .040 * 2 / 3600) < 1e-12);
});
test('LDR is optional and legacy values are discarded while disabled', () => {
  const noLdr = packet(); delete noLdr.ldr;
  const s = newState(); ingest(s, noLdr, 1000);
  assert.equal(s.latest.ldr, null); assert.equal(s.latest.ldrEnabled, false);
  ingest(s, packet({ ldr: 3100 }), 3000);
  assert.equal(s.latest.ldr, null); assert.equal(s.latest.ldrEnabled, false);
  assert.equal(s.latest.powerW, .020);
});
test('requires three sensor inputs independently of four LED outputs', () => {
  const s = newState();
  ingest(s, packet({ detected: [false, false, true], brightness: [0, 0, 1, 1] }), 1000);
  assert.equal(s.latest.detected.length, 3);
  assert.equal(s.latest.brightness.length, 4);
  assert.equal(s.latest.powerW, .040);
  assert.equal(s.latest.baselineW, .080);
  assert.equal(s.sensorCount, 3); assert.equal(s.lightCount, 4);
  assert.throws(() => validatePacket(packet({ detected: [false, false, false, true] })));
  assert.throws(() => validatePacket(packet({ brightness: [1, 1, 0] })));
});
