import "dotenv/config";
import express from "express";
import { getDb } from "./db.js";
import { CLIENT_REGISTRY } from "./config.js";

const app = express();
const PORT = 3000;

const CLIENT_LABELS: Record<string, string> = {
  acme: "ACME Corp",
  firstbank: "First Bank",
  "a41315dd-fdee-4ff3-a0c9-01905aa9dc2c": "PoC Client",
};

app.get("/api/stats", (_req, res) => {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
        COUNT(*)                                              AS total,
        SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END)  AS delivered,
        SUM(CASE WHEN status='FAILED'    THEN 1 ELSE 0 END)  AS failed,
        SUM(CASE WHEN status='DLQ'       THEN 1 ELSE 0 END)  AS dlq
       FROM delivery_log`
    )
    .get();
  res.json(stats);
});

app.get("/api/clients", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         client_id,
         COUNT(*)                                              AS total,
         SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END)  AS delivered,
         SUM(CASE WHEN status='FAILED'    THEN 1 ELSE 0 END)  AS failed,
         SUM(CASE WHEN status='DLQ'       THEN 1 ELSE 0 END)  AS dlq,
         MAX(delivered_at)                                    AS last_seen
       FROM delivery_log
       GROUP BY client_id`
    )
    .all() as Array<{
    client_id: string;
    total: number;
    delivered: number;
    failed: number;
    dlq: number;
    last_seen: string;
  }>;

  const enriched = rows.map((r) => ({
    ...r,
    label: CLIENT_LABELS[r.client_id] ?? r.client_id,
    auth_type:
      CLIENT_REGISTRY[r.client_id]?.type === "jit" ? "HMAC-SHA256" : "API Key",
  }));

  res.json(enriched);
});

app.get("/api/log", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM delivery_log ORDER BY delivered_at DESC LIMIT 60`
    )
    .all();
  res.json(rows);
});

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML);
});

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>PayCaddy Event Bus — PoC Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0f172a;
    --surface:  #1e293b;
    --border:   #334155;
    --text:     #e2e8f0;
    --muted:    #94a3b8;
    --green:    #22c55e;
    --orange:   #f59e0b;
    --red:      #ef4444;
    --blue:     #3b82f6;
    --radius:   10px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.5;
  }

  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 18px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left { display: flex; align-items: center; gap: 14px; }

  .logo {
    width: 36px; height: 36px;
    background: var(--blue);
    border-radius: 8px;
    display: grid; place-items: center;
    font-size: 18px;
  }

  h1 { font-size: 17px; font-weight: 600; }
  .subtitle { font-size: 12px; color: var(--muted); margin-top: 1px; }

  .pulse {
    display: flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--muted);
  }
  .pulse-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  main { padding: 28px 32px; max-width: 1280px; margin: 0 auto; }

  section { margin-bottom: 32px; }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--muted);
    margin-bottom: 14px;
  }

  /* ── Stat Cards ── */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
    display: flex; flex-direction: column; gap: 6px;
    transition: border-color .2s;
  }
  .stat-card:hover { border-color: var(--blue); }

  .stat-label { font-size: 12px; color: var(--muted); }
  .stat-value { font-size: 36px; font-weight: 700; line-height: 1; }
  .stat-sub   { font-size: 12px; color: var(--muted); }

  .color-green  { color: var(--green); }
  .color-orange { color: var(--orange); }
  .color-red    { color: var(--red); }
  .color-blue   { color: var(--blue); }

  /* ── Client Cards ── */
  .client-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .client-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
    transition: border-color .2s;
  }
  .client-card:hover { border-color: var(--blue); }

  .client-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }

  .client-name { font-weight: 600; font-size: 15px; }
  .client-id   { font-size: 11px; color: var(--muted); margin-top: 2px; font-family: monospace; }

  .badge {
    font-size: 11px; font-weight: 600;
    padding: 3px 9px; border-radius: 99px;
    border: 1px solid;
  }
  .badge-green  { color: var(--green);  border-color: var(--green);  background: #14532d30; }
  .badge-orange { color: var(--orange); border-color: var(--orange); background: #78350f30; }
  .badge-red    { color: var(--red);    border-color: var(--red);    background: #7f1d1d30; }
  .badge-gray   { color: var(--muted);  border-color: var(--border); background: transparent; }

  .client-bar-wrap {
    display: flex; height: 6px; border-radius: 99px;
    overflow: hidden; background: var(--border);
    margin-bottom: 14px;
  }
  .bar-delivered { background: var(--green);  transition: width .4s; }
  .bar-failed    { background: var(--orange); transition: width .4s; }
  .bar-dlq       { background: var(--red);    transition: width .4s; }

  .client-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px; text-align: center;
  }
  .cs-val  { font-size: 20px; font-weight: 700; }
  .cs-lbl  { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .client-meta {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    display: flex; justify-content: space-between;
    font-size: 11px; color: var(--muted);
  }

  /* ── Log Table ── */
  .table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  table {
    width: 100%; border-collapse: collapse;
  }

  thead th {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted);
    padding: 12px 16px;
    background: #0f172a88;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  tbody tr {
    border-bottom: 1px solid var(--border);
    transition: background .15s;
  }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: #334155aa; }
  tbody tr.row-new { animation: rowFlash .6s ease; }

  @keyframes rowFlash {
    0%   { background: #3b82f622; }
    100% { background: transparent; }
  }

  td {
    padding: 11px 16px;
    font-size: 13px;
    vertical-align: middle;
  }

  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600;
    padding: 3px 9px; border-radius: 99px;
  }
  .pill-dot { width: 6px; height: 6px; border-radius: 50%; }

  .pill-DELIVERED { background:#14532d30; color:var(--green); }
  .pill-DELIVERED .pill-dot { background:var(--green); }
  .pill-FAILED    { background:#78350f30; color:var(--orange); }
  .pill-FAILED    .pill-dot { background:var(--orange); }
  .pill-DLQ       { background:#7f1d1d30; color:var(--red); }
  .pill-DLQ       .pill-dot { background:var(--red); }

  .mono { font-family: monospace; font-size: 12px; color: var(--muted); }
  .event-type { color: var(--blue); font-family: monospace; font-size: 12px; }

  .empty {
    text-align: center; padding: 48px; color: var(--muted);
    font-size: 13px;
  }

  .http-ok  { color: var(--green); }
  .http-err { color: var(--red); }
  .http-na  { color: var(--muted); }

  #last-updated {
    font-size: 12px; color: var(--muted);
  }
</style>
</head>
<body>

<header>
  <div class="header-left">
    <div class="logo">⚡</div>
    <div>
      <h1>PayCaddy Event Bus</h1>
      <div class="subtitle">Webhook Delivery — Proof of Concept</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:20px;">
    <span id="last-updated">–</span>
    <div class="pulse">
      <div class="pulse-dot"></div>
      Live
    </div>
  </div>
</header>

<main>

  <!-- Overview Stats -->
  <section>
    <div class="section-title">Overview</div>
    <div class="stat-grid" id="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Events</div>
        <div class="stat-value color-blue" id="stat-total">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Delivered</div>
        <div class="stat-value color-green" id="stat-delivered">–</div>
        <div class="stat-sub" id="stat-rate">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Failed (retrying)</div>
        <div class="stat-value color-orange" id="stat-failed">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dead-Letter Queue</div>
        <div class="stat-value color-red" id="stat-dlq">–</div>
        <div class="stat-sub">exhausted retries</div>
      </div>
    </div>
  </section>

  <!-- Per-Client -->
  <section>
    <div class="section-title">Clients</div>
    <div class="client-grid" id="client-grid">
      <div class="empty">Loading…</div>
    </div>
  </section>

  <!-- Delivery Log -->
  <section>
    <div class="section-title">Delivery Log <span style="font-weight:400">(last 60)</span></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Event Type</th>
            <th>Client</th>
            <th>HTTP</th>
            <th>Attempt</th>
            <th>Message ID</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="log-body">
          <tr><td colspan="7" class="empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </section>

</main>

<script>
const CLIENT_LABELS = {
  acme: 'ACME Corp',
  firstbank: 'First Bank',
  'a41315dd-fdee-4ff3-a0c9-01905aa9dc2c': 'PoC Client',
};

function label(id) { return CLIENT_LABELS[id] ?? id; }
function fmt(ts) {
  if (!ts) return '–';
  const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function pct(n, total) {
  if (!total) return '–';
  return Math.round((n / total) * 100) + '%';
}
function httpClass(code) {
  if (!code) return 'http-na';
  return code < 300 ? 'http-ok' : 'http-err';
}

let prevLogIds = new Set();

async function fetchStats() {
  const [stats, clients, log] = await Promise.all([
    fetch('/api/stats').then(r => r.json()),
    fetch('/api/clients').then(r => r.json()),
    fetch('/api/log').then(r => r.json()),
  ]);
  renderStats(stats);
  renderClients(clients);
  renderLog(log);
  document.getElementById('last-updated').textContent =
    'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderStats(s) {
  const total = s.total || 0;
  document.getElementById('stat-total').textContent     = total;
  document.getElementById('stat-delivered').textContent = s.delivered || 0;
  document.getElementById('stat-failed').textContent    = s.failed || 0;
  document.getElementById('stat-dlq').textContent       = s.dlq || 0;
  document.getElementById('stat-rate').textContent =
    total ? pct(s.delivered, total) + ' success rate' : 'no events yet';
}

function renderClients(clients) {
  const grid = document.getElementById('client-grid');
  if (!clients.length) {
    grid.innerHTML = '<div class="empty">No delivery data yet. Run <code>npm run produce</code> to send events.</div>';
    return;
  }
  grid.innerHTML = clients.map(c => {
    const total = c.total || 0;
    const dp = total ? (c.delivered / total * 100) : 0;
    const fp = total ? (c.failed    / total * 100) : 0;
    const rp = total ? (c.dlq      / total * 100) : 0;

    let badge, badgeClass;
    if (c.dlq > 0)         { badge = 'DLQ'; badgeClass = 'badge-red'; }
    else if (c.failed > 0) { badge = 'Retrying'; badgeClass = 'badge-orange'; }
    else if (c.delivered > 0) { badge = 'Healthy'; badgeClass = 'badge-green'; }
    else                   { badge = 'Idle'; badgeClass = 'badge-gray'; }

    return \`
      <div class="client-card">
        <div class="client-header">
          <div>
            <div class="client-name">\${label(c.client_id)}</div>
            <div class="client-id">\${c.client_id.length > 20 ? c.client_id.slice(0,8)+'…'+c.client_id.slice(-4) : c.client_id}</div>
          </div>
          <span class="badge \${badgeClass}">\${badge}</span>
        </div>

        <div class="client-bar-wrap">
          <div class="bar-delivered" style="width:\${dp}%"></div>
          <div class="bar-failed"    style="width:\${fp}%"></div>
          <div class="bar-dlq"       style="width:\${rp}%"></div>
        </div>

        <div class="client-stats">
          <div>
            <div class="cs-val color-green">\${c.delivered}</div>
            <div class="cs-lbl">Delivered</div>
          </div>
          <div>
            <div class="cs-val color-orange">\${c.failed}</div>
            <div class="cs-lbl">Failed</div>
          </div>
          <div>
            <div class="cs-val color-red">\${c.dlq}</div>
            <div class="cs-lbl">DLQ</div>
          </div>
        </div>

        <div class="client-meta">
          <span>Auth: \${c.auth_type}</span>
          <span>Last: \${fmt(c.last_seen)}</span>
        </div>
      </div>
    \`;
  }).join('');
}

function renderLog(rows) {
  const tbody = document.getElementById('log-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No events yet.</td></tr>';
    return;
  }
  const newIds = new Set(rows.map(r => r.id));
  tbody.innerHTML = rows.map(r => {
    const isNew = !prevLogIds.has(r.id) && prevLogIds.size > 0;
    const http = r.http_status
      ? \`<span class="\${httpClass(r.http_status)}">\${r.http_status}</span>\`
      : '<span class="http-na">–</span>';
    return \`
      <tr class="\${isNew ? 'row-new' : ''}">
        <td><span class="pill pill-\${r.status}"><span class="pill-dot"></span>\${r.status}</span></td>
        <td class="event-type">\${r.event_type}</td>
        <td>\${label(r.client_id)}</td>
        <td>\${http}</td>
        <td style="text-align:center">\${r.attempt}</td>
        <td class="mono">\${r.message_id.slice(0, 8)}…</td>
        <td class="mono">\${fmt(r.delivered_at)}</td>
      </tr>
    \`;
  }).join('');
  prevLogIds = newIds;
}

fetchStats();
setInterval(fetchStats, 2000);
</script>
</body>
</html>`;
