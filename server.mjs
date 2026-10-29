import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { newState, ingest } from './telemetry.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ key, storageDir = path.join(root, '.local'), now = Date.now } = {}) {
  await fs.mkdir(storageDir, { recursive: true });
  if (!key) { try { key = (await fs.readFile(path.join(storageDir, 'device.key'), 'utf8')).trim(); } catch { key = crypto.randomBytes(24).toString('hex'); await fs.writeFile(path.join(storageDir, 'device.key'), key, { mode: 0o600 }); } }
  let state = newState(); try { const saved = JSON.parse(await fs.readFile(path.join(storageDir, 'readings.json'), 'utf8')); if (saved.kind === 'streetsense-v1') state = saved; } catch {}
  // No packet interval may bridge a service restart.
  state.sensorCount = 3; state.lightCount = 4;
  if (state.latest) { state.latest.receivedAt = 0; state.latest.ldr = null; state.latest.ldrEnabled = false; state.latest.detected = (state.latest.detected || []).slice(0, 3); }
  state.events = state.events.filter(event => !event.message.includes('IR4'));
  let persistChain = Promise.resolve();
  const save = () => { const snapshot = JSON.stringify(state); persistChain = persistChain.catch(() => {}).then(async () => { const temp = path.join(storageDir, 'readings.tmp'); await fs.writeFile(temp, snapshot); await fs.rename(temp, path.join(storageDir, 'readings.json')); }); return persistChain; };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
  async function body(req) { if (!String(req.headers['content-type'] || '').startsWith('application/json')) { const e = Error('Content-Type must be application/json'); e.status = 415; throw e; } let size = 0, chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 8192) { const e = Error('Packet too large'); e.status = 413; throw e; } chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString()); }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
      if (req.method === 'POST' && url.pathname === '/api/telemetry') {
        const supplied = Buffer.from(String(req.headers['x-device-key'] || '')); const expected = Buffer.from(key);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Invalid device key' });
        ingest(state, await body(req), now()); await save(); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/config') {
        const origin = req.headers.origin;
        if (!origin || new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Configuration requires this dashboard origin' });
        const p = await body(req); if (typeof p.lampWatts !== 'number' || !Number.isFinite(p.lampWatts) || p.lampWatts <= 0 || p.lampWatts > 10000) return json(res, 400, { error: 'Invalid lamp wattage' });
        state = newState(p.lampWatts); await save(); return json(res, 200, { ok: true });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
      if (!files[url.pathname]) return json(res, 404, { error: 'Not found' });
      const file = files[url.pathname], data = await fs.readFile(path.join(root, 'dist', file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(data);
    } catch (e) { json(res, e.status || 400, { error: e.message }); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000;
  return { server, key, state: () => state };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp({ key: process.env.TELEMETRY_KEY }); const port = Number(process.env.PORT || 8787);
  app.server.on('error', error => { console.error(`Could not start StreetSense on port ${port}: ${error.code}. Choose another port with the PORT environment variable and update the ESP32 telemetry URL.`); process.exitCode = 1; });
  app.server.listen(port, '0.0.0.0', () => { console.log(`\nStreetSense is ready: http://localhost:${port}\n`); for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) console.log(`Wi-Fi dashboard: http://${entry.address}:${port}\nESP32 POST URL: http://${entry.address}:${port}/api/telemetry`); console.log(`\nDevice key (paste into your ESP32 config): ${app.key}\nKeep this service running during your demonstration.\n`); });
}
