/**
 * Agent Manager — HTTP + WebSocket server for managing autonomous AgentBots.
 *
 * HTTP  GET  /api/agents          → list all agents (snapshot)
 * HTTP  POST /api/agents          → spawn new agent { name, goal }
 * HTTP  POST /api/agents/:name/stop → stop an agent
 * HTTP  DELETE /api/agents/:name  → stop + remove an agent
 * WS   ws://…/ws                  → push updates to all connected UIs
 *
 * Start: node agent-manager.js
 * Env vars:
 *   PORT      (default 3001)
 *   MC_HOST   (default localhost)
 *   MC_PORT   (default 25565)
 *   OMLX_URL  (default http://localhost:8000)
 *   OMLX_MODEL
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import { AgentBot } from './agent-bot.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT    = parseInt(process.env.PORT   ?? '3001');
const MC_HOST = process.env.MC_HOST ?? 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT ?? '25565');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH = path.resolve(__dirname, '../agent-ui/index.html');

const agents = new Map(); // name → AgentBot
const wsClients = new Set();

function broadcast(data) {
  const str = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(str);
  }
}

function allSnapshots() {
  return [...agents.values()].map(a => a.snapshot());
}

// HTTP handler

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Serve the UI
  if (pathname === '/' || pathname === '/index.html') {
    if (!fs.existsSync(UI_PATH)) {
      res.writeHead(404); res.end('agent-ui/index.html not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(UI_PATH));
    return;
  }

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/agents
  if (pathname === '/api/agents' && req.method === 'GET') {
    json(res, allSnapshots());
    return;
  }

  // POST /api/agents — spawn
  if (pathname === '/api/agents' && req.method === 'POST') {
    readBody(req, (body) => {
      let data;
      try { data = JSON.parse(body); } catch { err(res, 400, 'Invalid JSON'); return; }
      const { name, goal } = data;
      if (!name || !goal) { err(res, 400, 'name and goal required'); return; }
      if (!/^[a-zA-Z0-9_]{1,16}$/.test(name)) { err(res, 400, 'name must be 1-16 alphanumeric/underscore chars'); return; }
      if (agents.has(name) && agents.get(name).status === 'running') {
        err(res, 409, `Agent "${name}" already running`); return;
      }

      const agent = new AgentBot({ name, goal, mcHost: MC_HOST, mcPort: MC_PORT });
      agent.onUpdate((snapshot) => {
        broadcast({ type: 'agent_update', agent: snapshot });
      });
      agents.set(name, agent);
      agent.start();

      json(res, { ok: true, agent: agent.snapshot() }, 201);
    });
    return;
  }

  // POST /api/agents/:name/stop
  const stopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    const name = decodeURIComponent(stopMatch[1]);
    const agent = agents.get(name);
    if (!agent) { err(res, 404, 'Agent not found'); return; }
    agent.stop();
    json(res, { ok: true });
    return;
  }

  // DELETE /api/agents/:name
  const delMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (delMatch && req.method === 'DELETE') {
    const name = decodeURIComponent(delMatch[1]);
    const agent = agents.get(name);
    if (!agent) { err(res, 404, 'Agent not found'); return; }
    agent.stop();
    agents.delete(name);
    broadcast({ type: 'agent_removed', name });
    json(res, { ok: true });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// WebSocket

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  // Send current state immediately
  ws.send(JSON.stringify({ type: 'snapshot', agents: allSnapshots() }));
  ws.on('close', () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`Agent Manager running on http://localhost:${PORT}`);
  console.log(`MC server: ${MC_HOST}:${MC_PORT}`);
  console.log(`Claude model: ${process.env.CLAUDE_MODEL ?? 'haiku'}`);
});

// Helpers

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
