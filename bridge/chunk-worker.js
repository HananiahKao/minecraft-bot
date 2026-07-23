/**
 * BFS reachability worker — runs in a Node.js worker thread.
 *
 * Receives the solid bitmap for a chunk column plus the four neighbour edge
 * bitmaps, runs a flood-fill from sky + open chunk edges, and returns the
 * reached bitmap.  All heavy compute stays off the main event loop so
 * player_input messages are never delayed by chunk processing.
 *
 * Message in:
 *   { solid, nxEdge, pxEdge, nzEdge, pzEdge, W, D, YR, Y_MIN, Y_MAX }
 *   solid   — Uint8Array W×D×YR, transferable (owned by worker while running)
 *   *Edge   — Uint8Array slices of adjacent chunk edge columns, copied (not transferred)
 *
 * Message out:
 *   { reached } — Uint8Array W×D×YR, transferred back to main thread
 */

import { parentPort } from 'worker_threads';

parentPort.on('message', ({ solid, nxEdge, pxEdge, nzEdge, pzEdge, W, D, YR, Y_MIN, Y_MAX }) => {
  const reached = new Uint8Array(W * D * YR);
  // Flat triple-int queue — avoids object allocation inside BFS hot loop.
  const q = new Int32Array(W * D * YR * 3);
  let qHead = 0, qTail = 0;

  const visit = (x, y, z) => {
    if (x < 0 || x >= W || z < 0 || z >= D || y < Y_MIN || y >= Y_MAX) return;
    const i = x + z * W + (y - Y_MIN) * W * D;
    if (solid[i] || reached[i]) return;
    reached[i] = 1;
    q[qTail++] = x; q[qTail++] = y; q[qTail++] = z;
  };

  // Sky seeds — top layer is always open air above build height.
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) visit(x, Y_MAX - 1, z);

  // Vertical edge seeds — only where the adjacent chunk's mirror cell is non-solid.
  // nxEdge[z + yi*D] = solid flag for nx chunk's column x=15 at (z, y).
  // pxEdge[z + yi*D] = solid flag for px chunk's column x=0  at (z, y).
  // nzEdge[x + yi*W] = solid flag for nz chunk's row   z=D-1 at (x, y).
  // pzEdge[x + yi*W] = solid flag for pz chunk's row   z=0   at (x, y).
  for (let yi = 0; yi < YR; yi++) {
    const y = Y_MIN + yi;
    for (let z = 0; z < D; z++) {
      if (!nxEdge[z + yi * D]) visit(0,     y, z);
      if (!pxEdge[z + yi * D]) visit(W - 1, y, z);
    }
    for (let x = 0; x < W; x++) {
      if (!nzEdge[x + yi * W]) visit(x, y, 0);
      if (!pzEdge[x + yi * W]) visit(x, y, D - 1);
    }
  }

  while (qHead < qTail) {
    const x = q[qHead++], y = q[qHead++], z = q[qHead++];
    visit(x-1,y,z); visit(x+1,y,z);
    visit(x,y-1,z); visit(x,y+1,z);
    visit(x,y,z-1); visit(x,y,z+1);
  }

  parentPort.postMessage({ reached }, [reached.buffer]);
});
