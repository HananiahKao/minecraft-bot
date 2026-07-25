/**
 * Agent Manager — HTTP + WebSocket server.
 *
 * Each agent runs as a separate detached child process (agent-runner.js).
 * The manager survives independently: restarting it does NOT kill running bots.
 * On startup it reads .agents-registry.json and reconnects to surviving runners.
 *
 * Endpoints:
 *   GET  /api/agents              → list snapshots
 *   POST /api/agents              → spawn { name, goal }
 *   POST /api/agents/:name/stop   → stop
 *   POST /api/agents/:name/message → inject user message
 *   DELETE /api/agents/:name      → stop + remove
 *   POST /internal/agent-update   → runner pushes state (internal)
 *   WS   /ws                      → live updates to UI
 */

import http from 'node:http';
import net  from 'node:net';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT    = parseInt(process.env.PORT    ?? '3001');
const MC_HOST = process.env.MC_HOST ?? 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT ?? '25565');

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH       = path.resolve(__dirname, '../agent-ui/index.html');
const RUNNER_BIN    = path.join(__dirname, 'agent-runner.js');
const REGISTRY_PATH = path.join(__dirname, '.agents-registry.json');

// name → { name, goal, pid, port }
const agentMeta  = new Map();
// name → latest snapshot from runner
const agentState = new Map();
const wsClients  = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcast(data) {
  const str = JSON.stringify(data);
  for (const ws of wsClients) if (ws.readyState === 1) ws.send(str);
}

function allSnapshots() {
  return [...agentState.values()];
}

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return {}; }
}

function removeFromRegistry(name) {
  try {
    const reg = readRegistry();
    delete reg[name];
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
  } catch {}
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function fetchRunner(port, path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Reconnect survivors on startup ────────────────────────────────────────────

async function reconnectSurvivors() {
  const reg = readRegistry();
  for (const [name, meta] of Object.entries(reg)) {
    try {
      const snapshot = await fetchRunner(meta.port, '/state');
      agentMeta.set(name, meta);
      agentState.set(name, snapshot);
      console.log(`↩  Reconnected to ${name} (port ${meta.port}, pid ${meta.pid})`);
    } catch {
      console.log(`✗  ${name} not responding on port ${meta.port} — removing from registry`);
      removeFromRegistry(name);
    }
  }
}

// ── Spawn a new agent runner ──────────────────────────────────────────────────

async function spawnAgent(name, goal) {
  // Pre-allocate a port so we know it before the child starts.
  // The child binds to exactly this port — no stdout handshake needed.
  const runnerPort = await getFreePort();

  const child = spawn(process.execPath, [
    RUNNER_BIN,
    '--name',         name,
    '--goal',         goal,
    '--mc-host',      MC_HOST,
    '--mc-port',      String(MC_PORT),
    '--manager-port', String(PORT),
    '--runner-port',  String(runnerPort),
  ], {
    detached: true,
    stdio: 'ignore',  // fully detached — no pipe death on manager restart
  });

  child.unref();

  const meta = { name, goal, pid: child.pid, port: runnerPort };
  agentMeta.set(name, meta);
  return meta;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Serve UI (always read fresh from disk — no restart needed for HTML changes)
  if (pathname === '/' || pathname === '/index.html') {
    if (!fs.existsSync(UI_PATH)) { res.writeHead(404); res.end('UI not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(UI_PATH));
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Internal: runner pushes state updates here
  if (pathname === '/internal/agent-update' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const snapshot = JSON.parse(body);
        const name = snapshot.name;
        if (name) {
          agentState.set(name, snapshot);
          broadcast({ type: 'agent_update', agent: snapshot });
        }
      } catch {}
      res.writeHead(204); res.end();
    });
    return;
  }

  // GET /api/agents
  if (pathname === '/api/agents' && req.method === 'GET') {
    json(res, allSnapshots());
    return;
  }

  // POST /api/agents — spawn
  if (pathname === '/api/agents' && req.method === 'POST') {
    readBody(req, async (body) => {
      let data;
      try { data = JSON.parse(body); } catch { err(res, 400, 'Invalid JSON'); return; }
      const { name, goal } = data;
      if (!name || !goal) { err(res, 400, 'name and goal required'); return; }
      if (!/^[a-zA-Z0-9_]{1,16}$/.test(name)) { err(res, 400, 'invalid name'); return; }
      const existing = agentMeta.get(name);
      if (existing) {
        try {
          const state = await fetchRunner(existing.port, '/state');
          if (state.status === 'running' || state.status === 'connecting') {
            err(res, 409, `Agent "${name}" already running`); return;
          }
        } catch {}
      }

      try {
        const meta = await spawnAgent(name, goal);
        // Seed state map with a placeholder so UI shows it immediately
        agentState.set(name, { name, goal, status: 'connecting', goalDone: false, logs: [], position: null, health: null, food: null, inventory: [] });
        broadcast({ type: 'agent_update', agent: agentState.get(name) });
        json(res, { ok: true, name, port: meta.port }, 201);
      } catch (spawnErr) {
        err(res, 500, `Spawn failed: ${spawnErr.message}`);
      }
    });
    return;
  }

  // POST /api/agents/:name/stop
  const stopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    const name = decodeURIComponent(stopMatch[1]);
    const meta = agentMeta.get(name);
    if (!meta) { err(res, 404, 'Agent not found'); return; }
    fetchRunner(meta.port, '/stop', 'POST').catch(() => {});
    json(res, { ok: true });
    return;
  }

  // POST /api/agents/:name/message
  const msgMatch = pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
  if (msgMatch && req.method === 'POST') {
    const name = decodeURIComponent(msgMatch[1]);
    const meta = agentMeta.get(name);
    if (!meta) { err(res, 404, 'Agent not found'); return; }
    readBody(req, (body) => {
      let data;
      try { data = JSON.parse(body); } catch { err(res, 400, 'Invalid JSON'); return; }
      if (!data.message) { err(res, 400, 'message required'); return; }
      fetchRunner(meta.port, '/message', 'POST', { message: data.message }).catch(() => {});
      json(res, { ok: true });
    });
    return;
  }

  // DELETE /api/agents/:name
  const delMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (delMatch && req.method === 'DELETE') {
    const name = decodeURIComponent(delMatch[1]);
    const meta = agentMeta.get(name);
    if (!meta) { err(res, 404, 'Agent not found'); return; }
    fetchRunner(meta.port, '/stop', 'POST').catch(() => {});
    agentMeta.delete(name);
    agentState.delete(name);
    removeFromRegistry(name);
    broadcast({ type: 'agent_removed', name });
    json(res, { ok: true });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', agents: allSnapshots() }));
  ws.on('close', () => wsClients.delete(ws));
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, async () => {
  console.log(`Agent Manager running on http://localhost:${PORT}`);
  console.log(`MC server: ${MC_HOST}:${MC_PORT}`);
  console.log(`Claude model: ${process.env.CLAUDE_MODEL ?? 'haiku'}`);
  await reconnectSurvivors();
  // Broadcast restored state to any early WS connections
  broadcast({ type: 'snapshot', agents: allSnapshots() });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function err(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => cb(body));
}
