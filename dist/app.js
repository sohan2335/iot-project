const $ = id => document.getElementById(id);
const defaults = { lampWatts: 0.020, idlePercent: 0 };
let config; try { config = { ...defaults, ...JSON.parse(localStorage.getItem('streetsense.settings') || '{}') }; } catch { config = { ...defaults }; }
if (!(config.lampWatts > 0 && config.lampWatts <= 10000) || !(config.idlePercent >= 0 && config.idlePercent <= 100)) config = { ...defaults };
let mode = 'demo', demo, live = null, busy = false, activities = [], tick = 0, latestTime = 0, liveEventsSeen = new Set();
const number = v => Number.isFinite(v) ? (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2)) : '—';
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3500); }
function event(message, t = Date.now()) { activities.unshift({ message, time: t }); activities = activities.slice(0, 5); }
function demoReadings(zone) {
  const detected = [0, 1, 2].map(i => i === zone);
  const brightness = [0, 1, 2, 3].map(i => zone >= 0 && zone < 3 && (i === zone || i === zone + 1) ? 1 : config.idlePercent / 100);
  return { detected, brightness };
}
function startDemo() {
  const now = Date.now(); demo = { history: [], smartWh: 0, baselineWh: 0, coveredSeconds: 0, basis: 'estimated', events: [] }; tick = 0; activities = []; liveEventsSeen.clear();
  for (let i = 0; i < 60; i++) { const { brightness } = demoReadings(i % 4); const powerW = brightness.reduce((a, b) => a + b * config.lampWatts, 0); const t = now - (60 - i) * 30000; const baselineW = config.lampWatts * 4; demo.smartWh += powerW * 30 / 3600; demo.baselineWh += baselineW * 30 / 3600; demo.coveredSeconds += 30; demo.history.push({ time: t, powerW, baselineW }); }
  demo.latest = { night: true, ldrEnabled: false, ldr: null, brightness: [1, 1, 0, 0], detected: [true, false, false], powerW: config.lampWatts * 2, baselineW: config.lampWatts * 4 }; latestTime = now;
  event('Demo session started · sample readings only'); event('IR1 detected a vehicle · LEDs 1 + 2 active'); render();
}
function demoTick() {
  tick++; const t = Date.now(); const { brightness, detected } = demoReadings(Math.floor(tick / 2) % 4); const powerW = brightness.reduce((a, b) => a + b * config.lampWatts, 0); const dt = Math.max(0, Math.min(15, (t - latestTime) / 1000));
  demo.smartWh += demo.latest.powerW * dt / 3600; demo.baselineWh += demo.latest.baselineW * dt / 3600; demo.coveredSeconds += dt;
  const before = demo.latest.detected; demo.latest = { night: true, ldrEnabled: false, ldr: null, brightness, detected, powerW, baselineW: config.lampWatts * 4 }; demo.history.push({ time: t, powerW, baselineW: config.lampWatts * 4 }); demo.history = demo.history.slice(-60); latestTime = t;
  detected.forEach((v, i) => { if (v && !before[i]) event(`IR${i + 1} detected a vehicle · LEDs ${i + 1} + ${i + 2} active`); }); render();
}
function graph(history) {
  if (!history?.length) { $('chart').innerHTML = '<div class="empty-chart">Waiting for ESP32 readings.<br>Keep the device and laptop on the same Wi-Fi.</div>'; return; }
  const data = history.slice(-60), max = Math.max(...data.map(x => Math.max(x.powerW, x.baselineW)), .001) * 1.2;
  const width = 720, height = 230, left = 47, right = 12, top = 10, bottom = 26, plotW = width - left - right, plotH = height - top - bottom;
  const X = i => left + i / Math.max(1, data.length - 1) * plotW, Y = v => top + plotH - v / max * plotH;
  const path = key => data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)},${Y(d[key]).toFixed(2)}`).join(' ');
  let grid = ''; for (let i = 0; i < 5; i++) { const value = max * i / 4, y = Y(value); grid += `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke="#253744"/><text x="${left - 10}" y="${y + 4}" text-anchor="end" fill="#718b9e" font-size="10">${value < 1 ? value.toFixed(2) : value.toFixed(1)}</text>`; }
  const timeLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1].map(i => `<text x="${X(i)}" y="226" fill="#718b9e" font-size="10" text-anchor="${i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}">${new Date(data[i].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`).join('');
  const p = path('powerW'); $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#96e2b1" stop-opacity=".19"/><stop offset="1" stop-color="#96e2b1" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${p} L${X(data.length - 1)},${Y(0)} L${X(0)},${Y(0)}Z" fill="url(#area)"/><path d="${path('baselineW')}" stroke="#77c9db" stroke-width="2" stroke-dasharray="5 6" fill="none"/><path d="${p}" stroke="#96e2b1" stroke-width="2.5" fill="none" stroke-linejoin="round"/>${timeLabels}</svg>`;
}
function render() {
  const s = mode === 'demo' ? demo : live; const latest = s?.latest; const stale = mode === 'live' && (!latest || Date.now() - latest.receivedAt > 15000); const isDemo = mode === 'demo';
  $('connectionTitle').textContent = isDemo ? 'Demo mode' : stale ? 'Waiting for ESP32' : 'ESP32 connected'; $('connectionDot').className = `status-dot ${isDemo ? '' : stale ? 'offline' : 'live'}`;
  $('connectionText').textContent = isDemo ? 'Simulated readings · no ESP32 connected' : stale ? 'No fresh data · last known values retained' : `Wi-Fi telemetry · ${latest.deviceId}`;
  $('connectButton').textContent = isDemo ? 'Connect ESP32  ↗' : 'Connection details  ↗';
  const saved = s ? s.baselineWh - s.smartWh : 0, percent = s?.baselineWh > 0 ? saved / s.baselineWh * 100 : null;
  $('powerValue').textContent = latest && !stale ? number(latest.powerW) : '—'; $('energyValue').textContent = s ? number(s.smartWh) : '—'; $('savedValue').textContent = s ? number(saved) : '—';
  $('activeValue').textContent = latest && !stale ? latest.brightness.filter(v => v > 0).length : '—';
  $('savingsPercent').textContent = percent === null ? 'No baseline yet' : `${percent.toFixed(1)}% ${percent < 0 ? 'more energy' : 'less energy'}`;
  $('ringValue').textContent = percent === null ? '—' : `${percent.toFixed(1)}%`; $('savingsRing').style.setProperty('--percent', `${Math.min(100, Math.max(0, percent || 0))}%`);
  $('baselineValue').textContent = s ? `${number(s.baselineWh)} Wh` : '—'; $('smartValue').textContent = s ? `${number(s.smartWh)} Wh` : '—';
  const basis = s?.basis === 'measured' ? 'Measured system power' : s?.basis === 'mixed' ? 'Mixed measured and estimated' : 'Estimated from LED states'; $('powerFoot').textContent = latest?.basis === 'measured' ? 'Reported by a whole-system power meter' : 'Estimated from configured lamp wattage'; $('basisDetail').textContent = basis;
  $('estimateNote').textContent = isDemo ? 'Demo estimates, not measured project results. Baseline and smart energy use the same time intervals.' : `${basis}. Gaps longer than 15 seconds are excluded. Baseline is four rated lamps on at night. Savings may be negative.`;
  $('sourceDetail').textContent = isDemo ? 'Simulated demonstration' : stale ? 'Wi-Fi · waiting for fresh data' : 'ESP32 over local Wi-Fi'; $('ratingDetail').textContent = `${number(isDemo ? config.lampWatts : (s?.lampWatts ?? config.lampWatts))} W per lamp`;
  $('coverageDetail').textContent = s ? `${(s.coveredSeconds / 60).toFixed(1)} min of received intervals` : 'No data'; $('energyFoot').textContent = isDemo ? 'Illustrative demo session' : 'Accumulated valid telemetry intervals'; $('activeFoot').textContent = stale ? 'Device status unavailable' : latest?.night ? 'Night · automatic vehicle detection' : 'Daylight · lighting not required';
  $('nightLabel').textContent = stale ? '○  No fresh data' : latest?.night ? '☾  Night mode · LDR disabled' : '☀  Daylight'; $('ldrValue').textContent = 'LDR: Disabled'; $('ldrValue').setAttribute('aria-disabled', 'true'); $('ldrValue').title = 'LDR hardware is not connected. No readings are collected.'; $('lastSeen').textContent = isDemo ? 'Demo updates every 3 seconds' : latest ? `Last packet ${clock(latest.receivedAt)}` : 'Waiting for first packet';
  $('chartRange').textContent = isDemo ? 'Demo session' : 'Wi-Fi session'; $('footerMode').textContent = isDemo ? 'DEMONSTRATION' : stale ? 'DEVICE OFFLINE' : 'WI-FI CONNECTED';
  const brightness = latest?.brightness || [0, 0, 0, 0], detected = (latest?.detected || [false, false, false]).slice(0, 3);
  $('lamps').innerHTML = brightness.map((v, i) => `<div class="lamp ${v > 0 && !stale ? 'on' : ''}" aria-label="Section ${i + 1}: ${stale ? 'unknown' : Math.round(v * 100) + '% brightness'}"><div class="glow" style="opacity:${stale ? 0 : v}"></div><div class="pole"></div></div>`).join('');
  $('sensorRow').innerHTML = detected.map((v, i) => `<div class="sensor ${v && !stale ? 'detected' : ''}"><b>IR${i + 1} &nbsp; <span style="color:${v && !stale ? '#96e2b1' : '#607c8d'}">●</span></b><small>${stale ? 'Unknown' : v ? 'Vehicle detected' : 'No vehicle'}</small></div>`).join('');
  const position = detected.findIndex(Boolean); $('car').style.left = `${position < 0 ? 102 : position * 25 + 9}%`; $('car').style.visibility = stale ? 'hidden' : 'visible';
  graph(s?.history); $('activityList').replaceChildren(...activities.map(e => { const li = document.createElement('li'); const dot = document.createElement('span'); dot.className = 'event-dot'; const label = document.createElement('span'); label.textContent = e.message; const time = document.createElement('time'); time.textContent = clock(e.time); li.append(dot, label, time); return li; }));
}
async function pollLive() {
  if (busy || mode !== 'live') return; busy = true;
  try { const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) }); if (!response.ok) throw Error('Laptop service unavailable'); const data = await response.json(); if (data.kind !== 'streetsense-v1') throw Error('Not a StreetSense service'); live = data; for (const e of (data.events || []).slice().reverse()) if (!liveEventsSeen.has(e.id)) { liveEventsSeen.add(e.id); event(e.message, e.time); } }
  catch { if (!activities.some(e => e.message === 'Laptop service unreachable · checking again')) event('Laptop service unreachable · checking again'); } finally { busy = false; render(); }
}
function openDialog(id) { $(id).showModal(); }
['connectButton', 'helpButton'].forEach(id => $(id).onclick = () => openDialog('connectionDialog'));
['openSettings', 'configureLink'].forEach(id => $(id).onclick = () => { $('lampWattsInput').value = config.lampWatts; $('idleInput').value = config.idlePercent; openDialog('settingsDialog'); });
document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
$('settingsForm').onsubmit = async e => { e.preventDefault(); const next = { lampWatts: +$('lampWattsInput').value, idlePercent: +$('idleInput').value }; if (!(next.lampWatts > 0 && next.lampWatts <= 10000 && next.idlePercent >= 0 && next.idlePercent <= 100)) return;
  if (mode === 'live') { try { const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lampWatts: next.lampWatts }) }); if (!r.ok) throw Error(); } catch { toast('Could not update the laptop service. Settings were not saved.'); return; } }
  config = next; try { localStorage.setItem('streetsense.settings', JSON.stringify(config)); } catch {} $('settingsDialog').close(); if (mode === 'demo') startDemo(); else { live = null; await pollLive(); } toast(mode === 'live' ? 'Lamp rating updated. A new live energy session has started.' : 'Settings saved. New demo session started.'); };
$('liveButton').onclick = async () => { $('connectionFeedback').textContent = 'Checking the laptop service…'; try { const r = await fetch('/api/state', { signal: AbortSignal.timeout(4000), cache: 'no-store' }); if (!r.ok) throw Error(); const state = await r.json(); if (state.kind !== 'streetsense-v1') throw Error(); mode = 'live'; live = state; activities = []; liveEventsSeen.clear(); event('Live Wi-Fi mode enabled · waiting for ESP32 telemetry'); $('connectionDialog').close(); await pollLive(); } catch { $('connectionFeedback').textContent = 'Open the dashboard at the local address shown by node server.mjs. The hosted demo cannot receive packets from your local ESP32.'; } };
$('demoButton').onclick = () => { mode = 'demo'; live = null; startDemo(); $('connectionDialog').close(); toast('Demo mode enabled. No hardware readings shown.'); };
$('exportButton').onclick = () => { const s = mode === 'demo' ? demo : live; if (!s?.history?.length) return toast('No readings available to export yet.'); const rows = ['source,time,power_w,conventional_baseline_w', ...s.history.map(d => `${mode},${new Date(d.time).toISOString()},${d.powerW},${d.baselineW}`)]; const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' })); a.href = url; a.download = `streetsense-${mode}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Readings exported as CSV.'); };
function updateClock() { $('clock').textContent = new Date().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
updateClock(); setInterval(updateClock, 1000); startDemo(); setInterval(() => mode === 'demo' ? demoTick() : pollLive(), 3000);
// A local installation offers Wi-Fi mode immediately; the online site remains an explicit demo.
fetch('/api/state', { signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : null).then(s => { if (s?.kind === 'streetsense-v1') { mode = 'live'; live = s; activities = []; event('Local Wi-Fi service ready · waiting for the ESP32'); render(); } }).catch(() => {});
