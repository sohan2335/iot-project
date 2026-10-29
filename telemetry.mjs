export const MAX_GAP_MS = 15000;
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validatePacket(p) {
  if (!p || typeof p !== 'object' || p.deviceId !== 'esp32-street-01') throw Error('deviceId must be esp32-street-01');
  if (typeof p.night !== 'boolean') throw Error('night must be boolean');
  if (!Array.isArray(p.brightness) || p.brightness.length !== 4 || !p.brightness.every(v => finite(v, 0, 1))) throw Error('brightness must contain four values between 0 and 1');
  if (!Array.isArray(p.detected) || p.detected.length !== 3 || !p.detected.every(v => typeof v === 'boolean')) throw Error('detected must contain three booleans for IR1–IR3');
  if (p.powerW !== undefined && !finite(p.powerW, 0, 40000)) throw Error('Optional measured powerW must be a finite nonnegative number');
  // LDR hardware is disabled. Accept old clients but discard their LDR values.
  return { deviceId: p.deviceId, night: p.night, ldrEnabled: false, ldr: null, brightness: p.brightness.slice(), detected: p.detected.slice(), ...(p.powerW !== undefined ? { powerW: p.powerW } : {}) };
}
export function newState(lampWatts = .020) { return { kind: 'streetsense-v1', sensorCount: 3, lightCount: 4, lampWatts, smartWh: 0, baselineWh: 0, coveredSeconds: 0, latest: null, history: [], events: [], basis: 'estimated', sessionStartedAt: Date.now() }; }
export function ingest(state, raw, now = Date.now()) {
  const p = validatePacket(raw), previous = state.latest;
  const basis = p.powerW === undefined ? 'estimated' : 'measured';
  const powerW = p.powerW ?? p.brightness.reduce((sum, v) => sum + v * state.lampWatts, 0);
  const baselineW = p.night ? 4 * state.lampWatts : 0;
  if (previous) { const dt = now - previous.receivedAt; if (dt > 0 && dt <= MAX_GAP_MS) { state.smartWh += previous.powerW * dt / 3600000; state.baselineWh += previous.baselineW * dt / 3600000; state.coveredSeconds += dt / 1000; } }
  state.basis = state.history.length === 0 ? basis : state.basis === basis ? basis : 'mixed';
  function add(message) { state.events.unshift({ id: `${now}-${state.events.length}-${message}`, time: now, message }); state.events = state.events.slice(0, 30); }
  if (!previous || now - previous.receivedAt > MAX_GAP_MS) add('ESP32 connected over Wi-Fi');
  if (previous && previous.night !== p.night) add(p.night ? 'Darkness detected · night mode enabled' : 'Daylight detected · night mode ended');
  p.detected.forEach((v, i) => { if (v && !previous?.detected[i]) add(`IR${i + 1} detected a vehicle`); });
  state.latest = { ...p, powerW, baselineW, basis, receivedAt: now }; state.history.push({ time: now, powerW, baselineW }); state.history = state.history.slice(-1200); return state;
}
