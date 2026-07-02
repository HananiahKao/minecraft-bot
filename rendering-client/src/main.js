/**
 * Main rendering client - Phase 3
 * Camera follows bot position (server-authoritative)
 * WASD/mouse sent as control states to bridge → server physics runs
 */

import { MinecraftRenderer } from './renderer.js';
import { InputHandler } from './input.js';
import { BridgeConnection } from './connection.js';

let renderer = null;
let inputHandler = null;
let connection = null;
let worker = null;
let _hotbarSlots = Array(9).fill(null); // { name, count } or null
let _heldSlot = 0;
const INPUT_SEND_INTERVAL = 50; // one Minecraft tick
const CHUNK_RENDER_RADIUS = 5;  // keep chunks within this many chunks of bot
let lastBotChunkX = null;
let lastBotChunkZ = null;
const rawChunkQueue = [];       // raw JSON strings — parsed lazily in frame loop
const chunkQueue = [];          // parsed chunk objects waiting to be added to scene
const unloadQueue = [];         // [chunkX, chunkZ] pairs waiting to be removed
const _chunkBlockData = new Map(); // chunkKey → Map<"lx,y,lz", name> — kept in sync for fast block updates

// ── Event log ────────────────────────────────────────────────────────────────
const EVENT_MAX = 100;
const _events = [];
let _activeTab = 'snaps'; // 'snaps' | 'events'

function wallClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function logEvent(type, data) {
  const t = ((performance.now() - _sessionStart) / 1000).toFixed(2);
  const entry = { t, type, ...data };
  _events.push(entry);
  if (_events.length > EVENT_MAX) _events.shift();
  let msg = `[EVENT ${wallClock()} +${t}s] ${type}`;
  for (const [k, v] of Object.entries(data)) msg += ` ${k}=${v}`;
  console.log(msg);
}

// ── Jump detection state ──────────────────────────────────────────────────────
let _lastBotY = null;
let _lastYDelta = 0;
let _jumpStartY = null;
let _jumpStartTime = null;
let _jumpPeakTime = null;

function init() {
  const container = document.getElementById('canvas');
  renderer = new MinecraftRenderer(container);
  inputHandler = new InputHandler(renderer.camera);

  connection = new BridgeConnection(
    onChunkReceived,
    onBotReady,
    onBotPosition,
    onError,
    onHotbar,
    onHeldSlot
  );

  connection.onRawChunk = (raw) => rawChunkQueue.push(raw);

  // Geometry worker — builds Float32Arrays off the main thread
  worker = new Worker('/src/chunk-worker.js');
  worker.onerror = (e) => console.error('[worker error]', e.message, e.filename, e.lineno);
  worker.onmessage = ({ data }) => {
    if (data.empty) return;
    if (data.unknown) data.unknown.forEach(n => _unknownBlocks.add(n));
    const t0 = performance.now();
    renderer.applyChunkGeometry(data.x, data.z, data.positions, data.normals, data.colors);
    _chunkBuildTimes.push(performance.now() - t0);
    _totalVertices = renderer.totalVertices;
    if (!_loadPhaseStart) _loadPhaseStart = performance.now();
    _loadPhaseRecorded = false;
  };

  connection.connect().catch((err) => {
    console.error('Failed to connect:', err.message);
    updateStatus('Connection failed. Retrying...');
  });

  // Decouple input from render loop — fires at steady 20Hz regardless of fps
  setInterval(() => {
    if (connection && connection.isConnected && inputHandler) {
      const tb = renderer ? renderer.targetedBlock : null;
      const tf = renderer ? renderer.targetedFace : null;
      const controls = inputHandler.getControls();
      connection.sendPlayerInput(controls, inputHandler.getMCYaw(), inputHandler.getMCPitch(), tb, tf);
      if (controls.slotChanged) {
        _heldSlot = controls.selectedSlot;
        updateHotbar();
        connection.send({ type: 'held_slot_change', slot: _heldSlot });
      }
    }
  }, INPUT_SEND_INTERVAL);

  startUpdateLoop();
}

function onBotReady(position, gameMode) {
  console.log('🤖 Bot ready at', position, 'mode:', gameMode);
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);
  // survival/adventure: 4.5 block reach; creative: 5 blocks
  renderer.setReach(gameMode === 'creative' ? 5 : 4.5);
  updateStatus(`🎮 Playing | Chunks: ${renderer.chunkMeshes.size}`);
  const cx = Math.floor(position[0] / 16);
  const cz = Math.floor(position[2] / 16);
  lastBotChunkX = cx;
  lastBotChunkZ = cz;
  requestMissingChunks(cx, cz);
}

function onBotPosition(position) {
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);

  // Jump detection — track Y changes to identify start/peak/land
  const y = position[1];
  if (_lastBotY !== null) {
    const delta = y - _lastBotY;
    if (Math.abs(delta) > 0.005) {
      if (_lastYDelta <= 0 && delta > 0.05) {
        // Rising from ground → jump started
        _jumpStartY = _lastBotY;
        _jumpStartTime = performance.now();
        _jumpPeakTime = null;
        logEvent('JUMP_START', { y: _lastBotY.toFixed(2), fps: _currentFps });
      } else if (_jumpStartTime && _jumpPeakTime === null && _lastYDelta > 0 && delta <= 0) {
        // Was rising, now falling → peak
        _jumpPeakTime = performance.now();
        const rise = (_jumpPeakTime - _jumpStartTime).toFixed(0);
        logEvent('JUMP_PEAK', { y: y.toFixed(2), rise: rise + 'ms', fps: _currentFps });
      } else if (_jumpStartTime && _jumpPeakTime && _lastYDelta < 0 && delta >= -0.01) {
        // Was falling, now stopped → landed
        const dur = (performance.now() - _jumpStartTime).toFixed(0);
        const flag = parseInt(dur) < 450 ? 'FAST' : parseInt(dur) > 750 ? 'SLOW' : 'ok';
        logEvent('JUMP_LAND', { y: y.toFixed(2), dur: dur + 'ms', exp: '600ms', flag, fps: _currentFps });
        _jumpStartTime = null;
        _jumpPeakTime = null;
        _jumpStartY = null;
      }
      _lastYDelta = delta;
    }
  }
  _lastBotY = y;

  const cx = Math.floor(position[0] / 16);
  const cz = Math.floor(position[2] / 16);
  if (cx !== lastBotChunkX || cz !== lastBotChunkZ) {
    lastBotChunkX = cx;
    lastBotChunkZ = cz;
    scheduleUnloadDistantChunks(cx, cz);
    requestMissingChunks(cx, cz);
  }
}

function requestMissingChunks(cx, cz) {
  const needed = [];
  for (let x = cx - CHUNK_RENDER_RADIUS; x <= cx + CHUNK_RENDER_RADIUS; x++) {
    for (let z = cz - CHUNK_RENDER_RADIUS; z <= cz + CHUNK_RENDER_RADIUS; z++) {
      if (!renderer.chunkMeshes.has(`${x},${z}`)) needed.push({ x, z });
    }
  }
  if (needed.length > 0) connection.send({ type: 'request_chunks', chunks: needed });
}

function scheduleUnloadDistantChunks(botChunkX, botChunkZ) {
  for (const key of renderer.chunkMeshes.keys()) {
    const [kx, kz] = key.split(',').map(Number);
    if (Math.abs(kx - botChunkX) > CHUNK_RENDER_RADIUS || Math.abs(kz - botChunkZ) > CHUNK_RENDER_RADIUS) {
      unloadQueue.push([kx, kz]);
    }
  }
}

function onChunkReceived(chunkData) {
  chunkQueue.push(chunkData);
}

function onBlockUpdate(msg) {
  const cx = Math.floor(msg.x / 16);
  const cz = Math.floor(msg.z / 16);
  const ckey = `${cx},${cz}`;
  const blockMap = _chunkBlockData.get(ckey);
  if (!blockMap) return; // chunk not loaded — ignore, it'll arrive in full when loaded

  // Convert world coords to local chunk coords (handles negative world coords)
  const lx = ((msg.x % 16) + 16) % 16;
  const lz = ((msg.z % 16) + 16) % 16;
  const bkey = `${lx},${msg.y},${lz}`;

  if (msg.name === 'air') blockMap.delete(bkey);
  else blockMap.set(bkey, msg.name);

  // Immediately rebuild the chunk from the updated local data
  const blocks = [];
  for (const [k, name] of blockMap) {
    const [x, y, z] = k.split(',').map(Number);
    blocks.push({ x, y, z, name });
  }
  const reserved = (renderer.chunkMeshes.has(ckey) || renderer._updating.has(ckey))
    ? renderer.reserveUpdate(cx, cz)
    : renderer.reserveChunk(cx, cz);
  if (reserved) worker.postMessage({ x: cx, z: cz, blocks });
}

function onError(error) {
  console.error('Bridge error:', error.message);
  updateStatus(`Error: ${error.message}`);
}

function onHotbar(slots, heldSlot) {
  _hotbarSlots = slots;
  if (typeof heldSlot === 'number') _heldSlot = heldSlot;
  updateHotbar();
}

function onHeldSlot(slot) {
  _heldSlot = slot;
  updateHotbar();
}

function updateHotbar() {
  const el = document.getElementById('hotbar');
  if (!el) return;
  el.innerHTML = _hotbarSlots.map((item, i) => {
    const active = i === _heldSlot;
    const label = item ? item.name.replace(/_/g, ' ') : '';
    return `<div style="
      width:44px;height:44px;border:2px solid ${active ? '#ffcc00' : '#555'};
      background:rgba(0,0,0,0.6);border-radius:3px;display:flex;flex-direction:column;
      align-items:center;justify-content:center;font-size:9px;color:${active ? '#ffcc00' : '#aaa'};
      text-align:center;line-height:1.2;overflow:hidden;padding:2px;box-sizing:border-box;
      cursor:pointer" data-slot="${i}">${label}</div>`;
  }).join('');
  el.querySelectorAll('[data-slot]').forEach(div => {
    div.onclick = () => {
      const slot = parseInt(div.dataset.slot);
      _heldSlot = slot;
      if (inputHandler) inputHandler.selectedSlot = slot;
      updateHotbar();
      if (connection) connection.send({ type: 'held_slot_change', slot });
    };
  });
}

let _frameCount = 0;
let _fpsLastTime = performance.now();
let _fpsFrames = 0;
let _currentFps = 0;
let _frameBudgetViolations = 0;
let _lastRafTimestamp = 0;
let _frameTimeSum = 0;
let _frameTimeCount = 0;
let _maxFrameTime = 0;
// Separate idle vs mouse-active frame time buckets
let _idleFrameSum = 0, _idleFrameCount = 0;
let _mouseFrameSum = 0, _mouseFrameCount = 0;
const MOUSE_ACTIVE_WINDOW = 100; // ms — frame counts as mouse-active if moved within this window
const MOUSE_LO_RES_WINDOW = 200; // ms — keep pixel ratio low for this long after last mouse move
let _isLoRes = false;

// Metrics tracking — accumulated
const _chunkBuildTimes = [];
let _totalVertices = 0;
const _unknownBlocks = new Set();
let _minFps = Infinity;
let _loadPhaseStart = null;
let _loadPhaseEnd = null;
let _loadPhaseRecorded = false;
let _initialLoadMs = null;
let _metricsLastUpdate = 0;
let _sessionStart = performance.now();

// Per-second snapshot ring buffer (last 10 seconds)
const SNAPSHOT_COUNT = 10;
const _snapshots = [];   // { t, fps, idleMs, mouseMs, violPct, chunks, dirtyRegions }
// Accumulators reset each second
let _snapIdleSum = 0, _snapIdleCount = 0;
let _snapMouseSum = 0, _snapMouseCount = 0;
let _snapViolations = 0, _snapFrames = 0;
let _snapLastTime = performance.now();

function startUpdateLoop() {
  const loop = (timestamp) => {
    const _frameStart = performance.now();
    // Track wall-clock inter-frame gap (includes GPU time the CPU waits on)
    if (_lastRafTimestamp > 0) {
      const gap = timestamp - _lastRafTimestamp;
      _frameTimeSum += gap;
      _frameTimeCount++;
      if (gap > _maxFrameTime) _maxFrameTime = gap;
      if (gap > 33) _frameBudgetViolations++;
      // Log severe frame drops as events (200ms = ~5fps, clearly pathological)
      if (gap > 200) logEvent('FRAME_DROP', { gap: gap.toFixed(0) + 'ms', fps: _currentFps });
      const mouseActive = inputHandler && (timestamp - inputHandler.lastMouseMoveTime) < MOUSE_ACTIVE_WINDOW;
      if (mouseActive) { _mouseFrameSum += gap; _mouseFrameCount++; }
      else             { _idleFrameSum  += gap; _idleFrameCount++;  }
      // Per-second snapshot accumulators
      _snapFrames++;
      if (gap > 33) _snapViolations++;
      if (mouseActive) { _snapMouseSum += gap; _snapMouseCount++; }
      else             { _snapIdleSum  += gap; _snapIdleCount++;  }
    }
    _lastRafTimestamp = timestamp;
    if (inputHandler) inputHandler.applyMouseLook();

    // Dynamic pixel ratio: drop to 0.5 during mouse movement to reduce GPU fragment load
    if (renderer) {
      const mouseActive = inputHandler && (timestamp - inputHandler.lastMouseMoveTime) < MOUSE_LO_RES_WINDOW;
      if (mouseActive && !_isLoRes) {
        renderer.setPixelRatio(0.5);
        _isLoRes = true;
      } else if (!mouseActive && _isLoRes) {
        renderer.setPixelRatio(window.devicePixelRatio);
        _isLoRes = false;
      }
    }
    requestAnimationFrame(loop);

    // Drain raw message queue — position/ready dispatched immediately, chunks rate-limited
    const _t_parse = performance.now();
    let i = 0;
    while (i < rawChunkQueue.length) {
      const raw = rawChunkQueue[i];
      if (raw.length > 500) {
        try {
          const msg = JSON.parse(raw);
          chunkQueue.push({ x: msg.x, z: msg.z, blocks: msg.blocks });
          // Store block data for fast single-block updates
          const ckey = `${msg.x},${msg.z}`;
          const blockMap = new Map();
          for (const b of msg.blocks) blockMap.set(`${b.x},${b.y},${b.z}`, b.name);
          _chunkBlockData.set(ckey, blockMap);
        } catch (e) {}
        rawChunkQueue.splice(i, 1);
      } else {
        // Small message (position, ready, error, block_update) — parse and dispatch now
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'bot_position') onBotPosition(msg.position);
          else if (msg.type === 'bot_ready') onBotReady(msg.position, msg.gameMode);
          else if (msg.type === 'hotbar') onHotbar(msg.slots, msg.heldSlot);
          else if (msg.type === 'held_slot') onHeldSlot(msg.slot);
          else if (msg.type === 'error') onError(new Error(msg.message));
          else if (msg.type === 'block_update') onBlockUpdate(msg);
        } catch (e) {}
        rawChunkQueue.splice(i, 1);
      }
    }
    const _dt_parse = performance.now() - _t_parse;

    // Drain unload queue (cheap: dispose + remove from scene)
    const _t_unload = performance.now();
    while (unloadQueue.length > 0) {
      const [kx, kz] = unloadQueue.shift();
      renderer.removeChunk(kx, kz);
      _chunkBlockData.delete(`${kx},${kz}`);
    }
    const _dt_unload = performance.now() - _t_unload;

    // Send chunks to geometry worker — rate-limited because postMessage
    // structured-clones the blocks array synchronously before returning.
    // 4 per frame keeps serialization cost < ~30ms.
    const _t_add = performance.now();
    let sent = 0;
    while (chunkQueue.length > 0 && sent < 4) {
      const { x, z, blocks } = chunkQueue.shift();
      const key = `${x},${z}`;
      let reserved = false;
      if (renderer.chunkMeshes.has(key) || renderer._updating.has(key)) {
        // Live update (loaded or mid-rebuild) — last worker result wins
        reserved = renderer.reserveUpdate(x, z);
      } else {
        reserved = renderer.reserveChunk(x, z);
      }
      if (reserved) { worker.postMessage({ x, z, blocks }); sent++; }
    }
    const _dt_add = performance.now() - _t_add;

    const _t_render = performance.now();
    renderer.updateRaycast();
    renderer.render();
    const _dt_render = performance.now() - _t_render;

    const _frameTotal = performance.now() - _frameStart;
    _frameCount++;
    _fpsFrames++;
    const _now = performance.now();
    if (_now - _fpsLastTime >= 250) {
      _currentFps = Math.round(_fpsFrames * 1000 / (_now - _fpsLastTime));
      _fpsFrames = 0;
      _fpsLastTime = _now;
      if (_currentFps > 0 && _currentFps < _minFps) _minFps = _currentFps;
    }
    if (_frameTotal > 33) {
      console.log(`[FRAME-CPU ${wallClock()}] total=${_frameTotal.toFixed(1)}ms parse=${_dt_parse.toFixed(1)} add=${_dt_add.toFixed(1)} unload=${_dt_unload.toFixed(1)} render=${_dt_render.toFixed(1)} | chunks=${renderer.chunkMeshes.size} fps=${_currentFps} raw=${rawChunkQueue.length} q=${chunkQueue.length}`);
    }

    // Detect when initial load phase ends (all queues and pending worker jobs drained)
    if (_loadPhaseStart && !_loadPhaseRecorded && rawChunkQueue.length === 0 && chunkQueue.length === 0 && renderer._pending.size === 0) {
      _loadPhaseEnd = performance.now();
      _initialLoadMs = _loadPhaseEnd - _loadPhaseStart;
      _loadPhaseRecorded = true;
    }

    // Flush per-second snapshot and update panel
    if (_now - _snapLastTime >= 1000) {
      const elapsed = _now - _snapLastTime;
      _snapLastTime = _now;
      const snap = {
        t: Math.round((_now - _sessionStart) / 1000),
        fps: Math.round(_snapFrames * 1000 / elapsed),
        idleMs:  _snapIdleCount  > 0 ? (_snapIdleSum  / _snapIdleCount).toFixed(0)  : '—',
        mouseMs: _snapMouseCount > 0 ? (_snapMouseSum / _snapMouseCount).toFixed(0) : '—',
        violPct: _snapFrames > 0 ? (_snapViolations / _snapFrames * 100).toFixed(0) : '0',
        chunks: renderer ? renderer.chunkMeshes.size : 0,
        pending: renderer ? renderer._pending.size : 0,
      };
      _snapshots.push(snap);
      if (_snapshots.length > SNAPSHOT_COUNT) _snapshots.shift();
      console.log(`[SNAP ${wallClock()} +${snap.t}s] fps=${snap.fps} idle=${snap.idleMs}ms mouse=${snap.mouseMs}ms viol=${snap.violPct}% chunks=${snap.chunks} pending=${snap.pending}`);
      // Reset accumulators
      _snapIdleSum = 0; _snapIdleCount = 0;
      _snapMouseSum = 0; _snapMouseCount = 0;
      _snapViolations = 0; _snapFrames = 0;
    }
    if (_now - _metricsLastUpdate >= 1000) {
      _metricsLastUpdate = _now;
      updateMetrics();
    }

    const fpsStr = `${_currentFps} FPS`;
    const tb = renderer.targetedBlock;
    const targetStr = tb ? ` | ${tb.x} ${tb.y} ${tb.z}` : '';
    if (chunkQueue.length > 0 || unloadQueue.length > 0) {
      updateStatus(`🎮 ${fpsStr} | Chunks: ${renderer.chunkMeshes.size} (+${chunkQueue.length} load, -${unloadQueue.length} unload)${targetStr}`);
    } else {
      updateStatus(`🎮 ${fpsStr} | Chunks: ${renderer.chunkMeshes.size}${targetStr}`);
    }

  };

  requestAnimationFrame(loop);
}

function updateMetrics() {
  const el = document.getElementById('metrics');
  if (!el) return;

  const n = _chunkBuildTimes.length;
  let avgBuild = 0, maxBuild = 0, p95Build = 0;
  if (n > 0) {
    const sum = _chunkBuildTimes.reduce((a, b) => a + b, 0);
    avgBuild = sum / n;
    const sorted = [..._chunkBuildTimes].sort((a, b) => a - b);
    maxBuild = sorted[sorted.length - 1];
    p95Build = sorted[Math.floor(sorted.length * 0.95)];
  }

  const violationPct = _frameTimeCount > 0 ? (_frameBudgetViolations / _frameTimeCount * 100).toFixed(1) : '0.0';
  const avgFrameMs   = _frameTimeCount  > 0 ? (_frameTimeSum  / _frameTimeCount).toFixed(1) : '—';
  const maxFrameMs   = _maxFrameTime    > 0 ? _maxFrameTime.toFixed(1) : '—';
  const idleAvgMs    = _idleFrameCount  > 0 ? (_idleFrameSum  / _idleFrameCount).toFixed(1) : '—';
  const mouseAvgMs   = _mouseFrameCount > 0 ? (_mouseFrameSum / _mouseFrameCount).toFixed(1) : '—';
  const minFpsStr    = _minFps === Infinity ? '—' : _minFps;
  const loadStr      = _initialLoadMs != null ? `${(_initialLoadMs / 1000).toFixed(1)}s` : (_loadPhaseStart ? 'loading...' : '—');
  const vertStr      = _totalVertices > 0 ? `${(_totalVertices / 1e6).toFixed(2)}M` : '0';
  const chunkCount   = renderer ? renderer.chunkMeshes.size : 0;
  const pendingCount = renderer ? renderer._pending.size : 0;

  const unknownList = Array.from(_unknownBlocks).sort();
  const statsLines = [
    ['b', 'Chunk Build (worker)'],
    ['',  `avg: ${avgBuild.toFixed(1)}ms  p95: ${p95Build.toFixed(1)}ms`],
    ['',  `max: ${maxBuild.toFixed(1)}ms  n=${n}`],
    ['b', 'Load Phase'],
    ['',  `initial: ${loadStr}`],
    ['b', 'Rendering'],
    ['',  `frame avg: ${avgFrameMs}ms  max: ${maxFrameMs}ms`],
    ['',  `idle avg: ${idleAvgMs}ms  mouse avg: ${mouseAvgMs}ms`],
    ['',  `fps min: ${minFpsStr}  cur: ${_currentFps}`],
    ['',  `violations (>33ms): ${violationPct}%`],
    ['',  `vertices: ${vertStr}`],
    ['',  `chunks: ${chunkCount}  pending: ${pendingCount}`],
    ['b', `Unknown Blocks (${unknownList.length})`],
    ...( unknownList.length > 0
      ? unknownList.map(n => ['u', n])
      : [['', '(none)']] ),
  ];

  // Build bottom section based on active tab
  const tabSnapsLines = _snapshots.length > 0
    ? [['', 't    fps  idle  mouse  viol% chnk'],
       ...[..._snapshots].reverse().map(s =>
         ['', `+${String(s.t).padEnd(3)} ${String(s.fps).padEnd(4)} ${String(s.idleMs).padEnd(5)} ${String(s.mouseMs).padEnd(6)} ${String(s.violPct).padEnd(5)} ${s.chunks}`]
       )]
    : [['', '(no data yet)']];

  const TYPE_COLOR = { JUMP_START: '#4fc', JUMP_PEAK: '#ff9', JUMP_LAND: '#4fc', FRAME_DROP: '#f66' };
  const tabEventLines = _events.length > 0
    ? [..._events].reverse().slice(0, 20).map(e => {
        const extra = Object.entries(e)
          .filter(([k]) => k !== 't' && k !== 'type')
          .map(([k, v]) => `${k}=${v}`).join(' ');
        return ['ev', e.t, e.type, extra, TYPE_COLOR[e.type] || '#aaa'];
      })
    : [['', '', '(no events yet)', '', '#aaa']];

  // Build plain text for copy (stats + whichever tab is active)
  const activeTabLines = _activeTab === 'snaps' ? tabSnapsLines : tabEventLines.map(([,t,type,extra]) => ['', `+${t}s ${type} ${extra}`]);
  const allPlainLines = [...statsLines, ...activeTabLines];
  const plainText = allPlainLines.map(([, text]) => text).join('\n');

  // Build HTML
  const statsHtml = statsLines.map(([type, text]) => {
    const esc = text.replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    if (type === 'b') return `<br><b>${esc}</b>`;
    if (type === 'u') return `<span style="color:#f9a">${esc}</span>`;
    return esc;
  }).join('<br>');

  const TAB_BTN = (id, label) => {
    const active = _activeTab === id;
    return `<button data-tab="${id}" style="padding:1px 7px;font-size:10px;cursor:pointer;font-family:monospace;` +
      `background:${active ? '#555' : '#222'};color:${active ? '#fff' : '#aaa'};` +
      `border:1px solid ${active ? '#aaa' : '#444'};border-radius:3px;margin-right:3px">${label}</button>`;
  };

  const tabBarHtml = `<br><br>${TAB_BTN('snaps', 'Snaps')}${TAB_BTN('events', 'Events')}`;

  let tabContentHtml;
  if (_activeTab === 'snaps') {
    tabContentHtml = '<br>' + tabSnapsLines.map(([, text]) => {
      return text.replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    }).join('<br>');
  } else {
    tabContentHtml = '<br>' + tabEventLines.map(([, t, type, extra, color]) => {
      const row = `+${t}s&nbsp;<span style="color:${color}">${type}</span>&nbsp;${extra.replace(/ /g, '&nbsp;')}`;
      return row;
    }).join('<br>');
  }

  const copyBtnHtml = `<button id="metrics-copy" style="padding:2px 8px;font-size:10px;cursor:pointer;background:#333;color:#fff;border:1px solid #666;border-radius:3px">Copy</button>`;
  el.innerHTML = copyBtnHtml + '<br><br>' + statsHtml.replace(/^<br>/, '') + tabBarHtml + tabContentHtml;

  // Tab switching
  el.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      _activeTab = btn.dataset.tab;
      updateMetrics();
    };
  });

  const copyBtn = document.getElementById('metrics-copy');
  if (copyBtn) {
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(plainText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    };
  }
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = message;
}

window.addEventListener('DOMContentLoaded', init);
