/**
 * Block window screen — shows container GUIs opened via bot.activateBlock().
 * Handles crafting tables, chests, furnaces, and any other server-opened window.
 *
 * Slot indices sent from the bridge are the container-only portion (0..inventoryStart-1).
 * Clicks are forwarded as window_click messages to the bridge.
 */

const SLOT_SIZE = 52;
const GAP = 4;

// Parse Mineflayer window title — may be a JSON chat component like {"translate":"container.crafting"}
const TITLE_MAP = {
  'container.crafting': 'Crafting Table',
  'container.chest': 'Chest',
  'container.chestDouble': 'Large Chest',
  'container.shulkerBox': 'Shulker Box',
  'container.furnace': 'Furnace',
  'container.blast_furnace': 'Blast Furnace',
  'container.smoker': 'Smoker',
  'container.enchant': 'Enchanting Table',
  'container.anvil': 'Anvil',
  'container.grindstone_title': 'Grindstone',
  'container.cartography_table': 'Cartography Table',
  'container.loom': 'Loom',
  'container.stonecutter': 'Stonecutter',
  'container.smithing': 'Smithing Table',
  'container.beacon': 'Beacon',
  'container.hopper': 'Hopper',
  'container.dispenser': 'Dispenser',
  'container.dropper': 'Dropper',
  'container.barrel': 'Barrel',
  'container.brewing': 'Brewing Stand',
};
function parseTitle(raw) {
  try {
    const obj = JSON.parse(raw);
    const key = obj.translate || obj.text || '';
    return TITLE_MAP[key] || key.split('.').pop().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  } catch { return raw || 'Container'; }
}

// How many columns to use when auto-laying-out an unknown window type
function columnsFor(n) {
  if (n <= 5) return n;
  if (n % 9 === 0 || n > 9) return 9;
  return Math.ceil(Math.sqrt(n));
}

export class WindowScreen {
  constructor({ onClose, onClickSlot }) {
    this._slots = [];
    this._windowType = null;
    this._playerSlots = [];   // player main inv + hotbar shown below container
    this._inventoryStart = 0; // offset so window_click slot indices are correct
    this._onClose = onClose;
    this._onClickSlot = onClickSlot;
    this._open = false;
    this._heldItem = null;
    this._el = null;
    this._body = null;
    this._cursor = null;
    this._tooltip = null;
    this._buildDOM();
  }

  _buildDOM() {
    const el = document.createElement('div');
    el.id = 'window-screen';
    el.style.cssText = `
      position:fixed;inset:0;display:none;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.65);z-index:200;touch-action:none;overflow-y:auto;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#c6c6c6;border:3px solid #555;border-bottom-color:#111;
      border-right-color:#111;padding:16px;font-family:monospace;
    `;
    this._title = document.createElement('div');
    this._title.style.cssText = `font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;`;
    panel.appendChild(this._title);

    this._body = document.createElement('div');
    panel.appendChild(this._body);

    this._tooltip = document.createElement('div');
    this._tooltip.style.cssText = `
      position:fixed;pointer-events:none;background:rgba(0,0,0,0.85);color:#fff;
      font-size:12px;font-family:monospace;padding:4px 8px;border-radius:3px;
      display:none;z-index:211;white-space:nowrap;
    `;
    document.body.appendChild(this._tooltip);

    this._cursor = document.createElement('div');
    this._cursor.style.cssText = `
      position:fixed;pointer-events:none;z-index:212;display:none;
      width:${SLOT_SIZE}px;height:${SLOT_SIZE}px;
      background:#8b8b8b;border:2px solid #555;border-top-color:#fff;border-left-color:#fff;
      flex-direction:column;align-items:center;justify-content:center;
      font-size:9px;color:#fff;text-align:center;box-sizing:border-box;padding:2px;opacity:0.9;
    `;
    document.body.appendChild(this._cursor);

    el.appendChild(panel);
    document.body.appendChild(el);
    this._el = el;

    el.addEventListener('mousemove', (e) => {
      if (!this._heldItem) return;
      this._cursor.style.left = (e.clientX - SLOT_SIZE / 2) + 'px';
      this._cursor.style.top  = (e.clientY - SLOT_SIZE / 2) + 'px';
    });
    el.addEventListener('mousedown', (e) => { if (e.target === el) { this._clearHeld(); this.close(); } });
    document.addEventListener('keydown', (e) => {
      if (!this._open || e.repeat) return;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'e') { e.preventDefault(); this._clearHeld(); this.close(); }
    });
  }

  open(windowType, title, slots, playerSlots, inventoryStart) {
    this._windowType = windowType;
    this._slots = slots || [];
    this._playerSlots = playerSlots || [];
    this._inventoryStart = inventoryStart || 0;
    this._title.textContent = parseTitle(title);
    this._clearHeld();
    this._render();
    this._el.style.display = 'flex';
    this._open = true;
  }

  close() {
    this._el.style.display = 'none';
    this._tooltip.style.display = 'none';
    this._clearHeld();
    this._open = false;
    if (this._onClose) this._onClose();
  }

  isOpen() { return this._open; }

  updateSlots(slots, playerSlots, cursorItem) {
    this._slots = slots || [];
    if (playerSlots) this._playerSlots = playerSlots;
    if (cursorItem !== undefined) {
      this._heldItem = cursorItem;
      this._renderCursor();
    }
    if (this._open) this._render();
  }

  _renderCursor() {
    const c = this._cursor;
    c.innerHTML = '';
    const item = this._heldItem;
    if (item) {
      const name = document.createElement('div');
      name.style.cssText = `font-size:9px;line-height:1.2;word-break:break-all;text-align:center;text-shadow:1px 1px 0 #000;pointer-events:none;`;
      name.textContent = item.name.replace(/_/g, '\n');
      c.appendChild(name);
      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;`;
        cnt.textContent = item.count;
        c.appendChild(cnt);
      }
      c.style.display = 'flex';
    } else {
      c.style.display = 'none';
    }
  }

  _clearHeld() {
    this._heldItem = null;
    this._cursor.style.display = 'none';
    this._cursor.innerHTML = '';
  }

  _pickUp(item, mx, my) {
    this._heldItem = item;
    const c = this._cursor;
    c.innerHTML = '';
    if (item) {
      const name = document.createElement('div');
      name.style.cssText = `font-size:9px;line-height:1.2;word-break:break-all;text-align:center;text-shadow:1px 1px 0 #000;pointer-events:none;`;
      name.textContent = item.name.replace(/_/g, '\n');
      c.appendChild(name);
      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;`;
        cnt.textContent = item.count;
        c.appendChild(cnt);
      }
    }
    c.style.display = item ? 'flex' : 'none';
    c.style.left = (mx - SLOT_SIZE / 2) + 'px';
    c.style.top  = (my - SLOT_SIZE / 2) + 'px';
  }

  _grid(indices, cols) {
    const g = document.createElement('div');
    g.style.cssText = `display:grid;grid-template-columns:repeat(${cols},${SLOT_SIZE}px);gap:${GAP}px;`;
    for (const idx of indices) g.appendChild(this._makeSlot(idx));
    return g;
  }

  _arrow() {
    const a = document.createElement('div');
    a.textContent = '➜';
    a.style.cssText = `font-size:28px;color:#555;padding:0 8px;align-self:center;`;
    return a;
  }

  _render() {
    const b = this._body;
    b.innerHTML = '';
    const t = String(this._windowType);
    const n = this._slots.length;

    if (t.includes('crafting')) {
      // 3×3 grid (slots 1–9) → arrow → output (slot 0)
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:4px;`;
      row.appendChild(this._grid([1,2,3,4,5,6,7,8,9], 3));
      row.appendChild(this._arrow());
      row.appendChild(this._grid([0], 1));
      b.appendChild(row);

    } else if (t.includes('furnace') || t.includes('smoker') || t.includes('blast')) {
      // Input (slot 0) + fuel (slot 1) → arrow → output (slot 2)
      const left = document.createElement('div');
      left.style.cssText = `display:flex;flex-direction:column;gap:${GAP}px;`;
      left.appendChild(this._grid([0], 1));
      const fuelLbl = document.createElement('div');
      fuelLbl.textContent = '🔥';
      fuelLbl.style.cssText = `text-align:center;font-size:14px;`;
      left.appendChild(fuelLbl);
      left.appendChild(this._grid([1], 1));
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:4px;`;
      row.appendChild(left);
      row.appendChild(this._arrow());
      row.appendChild(this._grid([2], 1));
      b.appendChild(row);

    } else if (t.includes('hopper')) {
      b.appendChild(this._grid([0,1,2,3,4], 5));

    } else {
      // Generic grid — 9-wide if divisible, otherwise auto-columns
      const cols = columnsFor(n);
      b.appendChild(this._grid(Array.from({length: n}, (_, i) => i), cols));
    }

    // Player inventory below container (27 main + 9 hotbar), matching Minecraft UI
    if (this._playerSlots.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = `height:2px;border-top:2px solid #999;margin:10px 0 4px;`;
      b.appendChild(sep);
      const lbl = document.createElement('div');
      lbl.textContent = 'Inventory';
      lbl.style.cssText = `font-size:11px;color:#444;margin-bottom:4px;`;
      b.appendChild(lbl);
      // Main inventory (first 27 of playerSlots)
      b.appendChild(this._playerGrid(0, 27, 9));
      // Gap + hotbar
      const sep2 = document.createElement('div');
      sep2.style.cssText = `height:4px;`;
      b.appendChild(sep2);
      b.appendChild(this._playerGrid(27, 9, 9));
    }
  }

  // Render a slice of _playerSlots as a grid; slot indices are offset by inventoryStart
  _playerGrid(start, count, cols) {
    const g = document.createElement('div');
    g.style.cssText = `display:grid;grid-template-columns:repeat(${cols},${SLOT_SIZE}px);gap:${GAP}px;margin-bottom:${GAP}px;`;
    for (let i = start; i < start + count && i < this._playerSlots.length; i++) {
      g.appendChild(this._makePlayerSlot(i));
    }
    return g;
  }

  _makePlayerSlot(playerIdx) {
    const slotIdx = this._inventoryStart + playerIdx; // actual window slot index for clicks
    const item = this._playerSlots[playerIdx] || null;
    const cell = document.createElement('div');
    cell.style.cssText = `
      width:${SLOT_SIZE}px;height:${SLOT_SIZE}px;
      background:#8b8b8b;border:2px solid #555;border-top-color:#fff;border-left-color:#fff;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      cursor:pointer;position:relative;box-sizing:border-box;
      font-size:9px;color:#fff;text-align:center;overflow:hidden;padding:2px;
      -webkit-tap-highlight-color:transparent;
    `;
    if (item) {
      const name = document.createElement('div');
      name.style.cssText = `font-size:9px;line-height:1.2;word-break:break-all;text-align:center;text-shadow:1px 1px 0 #000;pointer-events:none;`;
      name.textContent = item.name.replace(/_/g, '\n');
      cell.appendChild(name);
      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;`;
        cnt.textContent = item.count;
        cell.appendChild(cnt);
      }
    }
    cell.addEventListener('mouseenter', () => {
      cell.style.background = '#a0a0a0';
      if (item) { this._tooltip.textContent = item.name.replace(/_/g,' ') + (item.count > 1 ? ` ×${item.count}` : ''); this._tooltip.style.display = 'block'; }
    });
    cell.addEventListener('mousemove', (e) => { this._tooltip.style.left = (e.clientX+14)+'px'; this._tooltip.style.top = (e.clientY-6)+'px'; });
    cell.addEventListener('mouseleave', () => { cell.style.background = '#8b8b8b'; this._tooltip.style.display = 'none'; });
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.button === 2 ? 1 : 0;
      if (btn === 0) {
        if (!this._heldItem) {
          this._pickUp(item, e.clientX, e.clientY);
        } else {
          this._pickUp(null, e.clientX, e.clientY);
        }
      } else if (btn === 1 && this._heldItem) {
        const newCount = this._heldItem.count - 1;
        this._pickUp(newCount > 0 ? { ...this._heldItem, count: newCount } : null, e.clientX, e.clientY);
      }
      if (this._onClickSlot) this._onClickSlot(slotIdx, btn);
    });
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    cell.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.changedTouches[0];
      this._pickUp(this._heldItem ? null : item, t ? t.clientX : 0, t ? t.clientY : 0);
      if (this._onClickSlot) this._onClickSlot(slotIdx, 0);
    });
    return cell;
  }

  _makeSlot(idx) {
    const item = this._slots[idx] || null;
    const cell = document.createElement('div');
    cell.style.cssText = `
      width:${SLOT_SIZE}px;height:${SLOT_SIZE}px;
      background:#8b8b8b;border:2px solid #555;border-top-color:#fff;border-left-color:#fff;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      cursor:pointer;position:relative;box-sizing:border-box;
      font-size:9px;color:#fff;text-align:center;overflow:hidden;padding:2px;
      -webkit-tap-highlight-color:transparent;
    `;

    if (item) {
      const name = document.createElement('div');
      name.style.cssText = `font-size:9px;line-height:1.2;word-break:break-all;text-align:center;text-shadow:1px 1px 0 #000;pointer-events:none;`;
      name.textContent = item.name.replace(/_/g, '\n');
      cell.appendChild(name);
      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;`;
        cnt.textContent = item.count;
        cell.appendChild(cnt);
      }
    }

    cell.addEventListener('mouseenter', () => {
      cell.style.background = '#a0a0a0';
      if (item) { this._tooltip.textContent = item.name.replace(/_/g, ' ') + (item.count > 1 ? ` ×${item.count}` : ''); this._tooltip.style.display = 'block'; }
    });
    cell.addEventListener('mousemove', (e) => { this._tooltip.style.left = (e.clientX + 14) + 'px'; this._tooltip.style.top = (e.clientY - 6) + 'px'; });
    cell.addEventListener('mouseleave', () => { cell.style.background = '#8b8b8b'; this._tooltip.style.display = 'none'; });

    cell.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.button === 2 ? 1 : 0;
      if (btn === 0) {
        if (!this._heldItem) {
          this._pickUp(item, e.clientX, e.clientY);
        } else {
          this._pickUp(null, e.clientX, e.clientY);
        }
      } else if (btn === 1 && this._heldItem) {
        const newCount = this._heldItem.count - 1;
        this._pickUp(newCount > 0 ? { ...this._heldItem, count: newCount } : null, e.clientX, e.clientY);
      }
      if (this._onClickSlot) this._onClickSlot(idx, btn);
    });
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    cell.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.changedTouches[0];
      this._pickUp(this._heldItem ? null : item, t ? t.clientX : 0, t ? t.clientY : 0);
      if (this._onClickSlot) this._onClickSlot(idx, 0);
    });

    return cell;
  }
}
