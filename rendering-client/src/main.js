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
let totalChunksLoaded = 0;
const INPUT_SEND_INTERVAL = 50; // one Minecraft tick
const CHUNK_RENDER_RADIUS = 5;  // keep chunks within this many chunks of bot
const CHUNKS_PER_FRAME = 1;     // max chunks to build geometry for per frame
let lastBotChunkX = null;
let lastBotChunkZ = null;
const rawChunkQueue = [];       // raw JSON strings — parsed lazily in frame loop
const chunkQueue = [];          // parsed chunk objects waiting to be added to scene
const unloadQueue = [];         // [chunkX, chunkZ] pairs waiting to be removed

function init() {
  const container = document.getElementById('canvas');
  renderer = new MinecraftRenderer(container);
  inputHandler = new InputHandler(renderer.camera);

  connection = new BridgeConnection(
    onChunkReceived,
    onBotReady,
    onBotPosition,
    onError
  );

  connection.onRawChunk = (raw) => rawChunkQueue.push(raw);

  connection.connect().catch((err) => {
    console.error('Failed to connect:', err.message);
    updateStatus('Connection failed. Retrying...');
  });

  // Decouple input from render loop — fires at steady 20Hz regardless of fps
  setInterval(() => {
    if (connection && connection.isConnected && inputHandler) {
      connection.sendPlayerInput(inputHandler.getControls(), inputHandler.getMCYaw(), inputHandler.getMCPitch());
    }
  }, INPUT_SEND_INTERVAL);

  startUpdateLoop();
}

function onBotReady(position) {
  console.log('🤖 Bot ready at', position);
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);
  updateStatus(`🎮 Playing | Chunks: ${totalChunksLoaded}`);
}

function onBotPosition(position) {
  renderer.setCameraPosition(position[0], position[1] + 1.6, position[2]);

  const cx = Math.floor(position[0] / 16);
  const cz = Math.floor(position[2] / 16);
  if (cx !== lastBotChunkX || cz !== lastBotChunkZ) {
    lastBotChunkX = cx;
    lastBotChunkZ = cz;
    scheduleUnloadDistantChunks(cx, cz);
  }
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

function onError(error) {
  console.error('Bridge error:', error.message);
  updateStatus(`Error: ${error.message}`);
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

    // Parse raw chunk JSON (deferred from onmessage to avoid blocking input)
    const _t_parse = performance.now();
    for (let i = 0; i < CHUNKS_PER_FRAME && rawChunkQueue.length > 0; i++) {
      try {
        const msg = JSON.parse(rawChunkQueue.shift());
        chunkQueue.push({ x: msg.x, z: msg.z, blocks: msg.blocks });
      } catch (e) {}
    }
    const _dt_parse = performance.now() - _t_parse;

    // Drain unload queue first (cheap: just dispose + remove from scene)
    const _t_unload = performance.now();
    for (let i = 0; i < CHUNKS_PER_FRAME && unloadQueue.length > 0; i++) {
      const [kx, kz] = unloadQueue.shift();
      renderer.removeChunk(kx, kz);
      totalChunksLoaded--;
    }
    const _dt_unload = performance.now() - _t_unload;

    // Enqueue new chunks (stores blocks + marks region dirty, no geometry yet)
    for (let i = 0; i < CHUNKS_PER_FRAME && chunkQueue.length > 0; i++) {
      const chunkData = chunkQueue.shift();
      try {
        const queued = renderer.addChunk(chunkData.x, chunkData.z, chunkData.blocks);
        if (queued) {
          totalChunksLoaded++;
          if (!_loadPhaseStart) _loadPhaseStart = performance.now();
          _loadPhaseRecorded = false;
        }
      } catch (e) {
        console.error('Failed to enqueue chunk:', e.message);
      }
    }

    // Flush one dirty region per frame (builds merged geometry for all chunks in it)
    const _t_add = performance.now();
    const regionResult = renderer.flushDirtyRegions();
    if (regionResult) {
      _chunkBuildTimes.push(regionResult.buildMs);
      _totalVertices = regionResult.vertexCount;
    }
    const _dt_add = performance.now() - _t_add;

    const _t_render = performance.now();
    renderer.render();
    const _dt_render = performance.now() - _t_render;

    const _dt_input = 0;

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
      console.log(`[FRAME-CPU] total=${_frameTotal.toFixed(1)}ms parse=${_dt_parse.toFixed(1)} add=${_dt_add.toFixed(1)} unload=${_dt_unload.toFixed(1)} render=${_dt_render.toFixed(1)} input=${_dt_input.toFixed(1)} | chunks=${renderer.chunkMeshes.size} fps=${_currentFps} raw=${rawChunkQueue.length} q=${chunkQueue.length}`);
    }

    // Detect when initial load phase ends (queues drain after receiving chunks)
    if (_loadPhaseStart && !_loadPhaseRecorded && rawChunkQueue.length === 0 && chunkQueue.length === 0) {
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
        dirty: renderer ? renderer._dirtyRegions.size : 0,
      };
      _snapshots.push(snap);
      if (_snapshots.length > SNAPSHOT_COUNT) _snapshots.shift();
      console.log(`[SNAP +${snap.t}s] fps=${snap.fps} idle=${snap.idleMs}ms mouse=${snap.mouseMs}ms viol=${snap.violPct}% chunks=${snap.chunks} dirty=${snap.dirty}`);
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
    if (chunkQueue.length > 0 || unloadQueue.length > 0) {
      updateStatus(`🎮 ${fpsStr} | Chunks: ${totalChunksLoaded} (+${chunkQueue.length} load, -${unloadQueue.length} unload)`);
    } else {
      updateStatus(`🎮 ${fpsStr} | Chunks: ${totalChunksLoaded}`);
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
  const regionCount  = renderer ? renderer._regionMeshes.size : 0;

  // Single source of truth — [type, text]; type 'b' = bold header
  const lines = [
    ['b', 'Chunk Build'],
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
    ['',  `chunks: ${chunkCount}  regions (draw calls): ${regionCount}`],
  ];

  // Recent snapshots log — newest first
  const snapLines = _snapshots.length > 0
    ? [['b', 'Recent (per second)'],
       ['', 't    fps  idle  mouse  viol% chnk'],
       ...[..._snapshots].reverse().map(s =>
         ['', `+${String(s.t).padEnd(3)} ${String(s.fps).padEnd(4)} ${String(s.idleMs).padEnd(5)} ${String(s.mouseMs).padEnd(6)} ${String(s.violPct).padEnd(5)} ${s.chunks}`]
       )]
    : [];

  const allLines = [...lines, ...snapLines];
  const plainText = allLines.map(([, text]) => text).join('\n');
  const html = allLines.map(([type, text]) => {
    const escaped = text.replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    return type === 'b' ? `<br><b>${escaped}</b>` : escaped;
  }).join('<br>');

  el.innerHTML = html.replace(/^<br>/, '') +
    `<br><br><button id="metrics-copy" style="padding:2px 8px;font-size:10px;cursor:pointer;background:#333;color:#fff;border:1px solid #666;border-radius:3px">Copy</button>`;

  const btn = document.getElementById('metrics-copy');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(plainText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    };
  }
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = message;
}

window.addEventListener('DOMContentLoaded', init);
