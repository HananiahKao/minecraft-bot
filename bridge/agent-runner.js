/**
 * agent-runner.js — standalone per-agent process.
 *
 * Each agent runs in its own detached Node.js process so the agent-manager
 * can restart freely without killing bots. The runner:
 *   1. Creates an AgentBot and starts it.
 *   2. Binds a tiny HTTP server on an assigned local port.
 *   3. Pushes state snapshots to agent-manager's /internal/agent-update.
 *   4. Writes itself to .agents-registry.json so the manager can reconnect.
 *
 * CLI: node agent-runner.js --name X --goal Y [--mc-host H] [--mc-port P]
 *                           --manager-port M --runner-port R
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBot } from './agent-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '.agents-registry.json');

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
}

const NAME         = arg('name');
const GOAL         = arg('goal');
const MC_HOST      = arg('mc-host')      || 'localhost';
const MC_PORT      = parseInt(arg('mc-port')      || '25565');
const MANAGER_PORT = parseInt(arg('manager-port') || '3001');
const RUNNER_PORT  = parseInt(arg('runner-port')  || '0');

if (!NAME || !GOAL) {
  process.stderr.write('agent-runner: --name and --goal are required\n');
  process.exit(1);
}

// ── Registry ──────────────────────────────────────────────────────────────────

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return {}; }
}

function registerSelf(port) {
  const reg = readRegistry();
  reg[NAME] = { name: NAME, goal: GOAL, pid: process.pid, port, startedAt: Date.now() };
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

function unregisterSelf() {
  try {
    const reg = readRegistry();
    delete reg[NAME];
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
  } catch {}
}

// ── Push update to manager ────────────────────────────────────────────────────

function pushUpdate(snapshot) {
  const body = JSON.stringify(snapshot);
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: MANAGER_PORT,
      path: '/internal/agent-update',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('error', () => {}); // manager may be restarting, ignore
    req.write(body);
    req.end();
  } catch {}
}

// ── Agent ─────────────────────────────────────────────────────────────────────

const agent = new AgentBot({ name: NAME, goal: GOAL, mcHost: MC_HOST, mcPort: MC_PORT });
agent.onUpdate((snapshot) => pushUpdate(snapshot));
agent.start();

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/state') {
    res.end(JSON.stringify(agent.snapshot()));
    return;
  }

  if (req.method === 'POST' && req.url === '/stop') {
    agent.stop();
    res.end('{"ok":true}');
    return;
  }

  if (req.method === 'POST' && req.url === '/message') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        if (message) agent.injectMessage(message);
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('{"error":"bad json"}'); }
    });
    return;
  }

  res.writeHead(404); res.end('{"error":"not found"}');
});

server.listen(RUNNER_PORT, '127.0.0.1', () => {
  const port = server.address().port;
  registerSelf(port);
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

function shutdown() {
  unregisterSelf();
  try { agent.stop(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('exit', unregisterSelf);
