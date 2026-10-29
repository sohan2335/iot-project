import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
test('Wi-Fi ingest authentication, validation, persistence and same-origin config', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'streetsense-test-')); const app = await createApp({ key: 'test-only-key', storageDir: dir }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`, p = { deviceId: 'esp32-street-01', night: true, ldr: 3000, brightness: [1, 0, 0, 0], detected: [true, false, false] };
  const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await post('/api/telemetry', p)).status, 401);
    assert.equal((await post('/api/telemetry', { ...p, brightness: [2] }, { 'X-Device-Key': 'test-only-key' })).status, 400);
    assert.equal((await post('/api/telemetry', p, { 'X-Device-Key': 'test-only-key' })).status, 200);
    let state = await (await fetch(base + '/api/state')).json(); assert.equal(state.latest.powerW, .020); assert.equal(state.history.length, 1); assert.equal(JSON.stringify(state).includes('test-only-key'), false);
    assert.equal(state.latest.ldr, null); assert.equal(state.latest.ldrEnabled, false);
    const withoutLdr = { ...p }; delete withoutLdr.ldr;
    assert.equal((await post('/api/telemetry', withoutLdr, { 'X-Device-Key': 'test-only-key' })).status, 200);
    assert.equal((await post('/api/config', { lampWatts: 10 }, { Origin: 'http://unrelated.example' })).status, 403);
    assert.equal((await post('/api/config', { lampWatts: 10 }, { Origin: base })).status, 200);
    state = await (await fetch(base + '/api/state')).json(); assert.equal(state.lampWatts, 10); assert.equal(state.latest, null);
  } finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
