/**
 * Inventory screen — renders the full player inventory:
 *   Slots 0     : crafting output
 *   Slots 1–4   : crafting input (2×2 grid)
 *   Slots 5–8   : armor (head→feet)
 *   Slots 9–35  : main inventory (3 rows × 9)
 *   Slots 36–44 : hotbar
 * Slot indices match bot.inventory.slots[].
 * Click events are forwarded to the bridge via onClickSlot(slotIndex, mouseButton).
 */

import { makeItemVisual } from './item-icon.js';

const SLOT_SIZE = 52;
const GAP = 4;

function range(start, end) {
  const r = [];
  for (let i = start; i < end; i++) r.push(i);
  return r;
}

// Main inventory rows (used in _render)
const MAIN_ROWS = [
  range(9, 18),
  range(18, 27),
  range(27, 36),
];

export class InventoryScreen {
  constructor({ onClose, onClickSlot }) {
    this._slots = new Array(46).fill(null);
    this._onClose = onClose;
    this._onClickSlot = onClickSlot;
    this._open = false;
    this._el = null;
    this._body = null;
    this._tooltip = null;
    this._heldItem = null;   // item currently "on the cursor" between two clicks
    this._cursor = null;     // floating div that follows the mouse
    this._buildDOM();
  }

  _buildDOM() {
    const el = document.createElement('div');
    el.id = 'inventory-screen';
    el.style.cssText = `
      position:fixed;inset:0;display:none;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.65);z-index:200;touch-action:none;overflow-y:auto;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#c6c6c6;border:3px solid #555;border-bottom-color:#111;
      border-right-color:#111;padding:16px;font-family:monospace;
      image-rendering:pixelated;
    `;

    const title = document.createElement('div');
    title.textContent = 'Inventory';
    title.style.cssText = `font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;`;
    panel.appendChild(title);

    const body = document.createElement('div');
    panel.appendChild(body);
    this._body = body;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position:fixed;pointer-events:none;background:rgba(0,0,0,0.85);color:#fff;
      font-size:12px;font-family:monospace;padding:4px 8px;border-radius:3px;
      display:none;z-index:201;white-space:nowrap;
    `;
    document.body.appendChild(tooltip);
    this._tooltip = tooltip;

    // Floating held-item indicator — follows the mouse while an item is "on the cursor"
    const cursor = document.createElement('div');
    cursor.style.cssText = `
      position:fixed;pointer-events:none;z-index:202;display:none;
      width:${SLOT_SIZE}px;height:${SLOT_SIZE}px;
      background:#8b8b8b;border:2px solid #555;border-top-color:#fff;border-left-color:#fff;
      display:none;flex-direction:column;align-items:center;justify-content:center;
      font-size:9px;color:#fff;text-align:center;box-sizing:border-box;padding:2px;
      opacity:0.9;
    `;
    document.body.appendChild(cursor);
    this._cursor = cursor;

    el.appendChild(panel);
    document.body.appendChild(el);
    this._el = el;

    // Move held-item cursor with the mouse
    el.addEventListener('mousemove', (e) => {
      if (!this._heldItem) return;
      this._cursor.style.left = (e.clientX - SLOT_SIZE / 2) + 'px';
      this._cursor.style.top  = (e.clientY - SLOT_SIZE / 2) + 'px';
    });

    el.addEventListener('mousedown', (e) => {
      if (e.target === el) { this._clearHeld(); this.close(); }
    });
    document.addEventListener('keydown', (e) => {
      if (!this._open) return;
      if (!e.repeat && (e.key === 'Escape' || e.key.toLowerCase() === 'e')) { e.preventDefault(); this._clearHeld(); this.close(); }
    });
  }

  _clearHeld() {
    this._heldItem = null;
    this._cursor.style.display = 'none';
    this._cursor.innerHTML = '';
  }

  _pickUpItem(item, mouseX, mouseY) {
    this._heldItem = item;
    const c = this._cursor;
    c.innerHTML = '';
    if (item) {
      c.appendChild(makeItemVisual(item));
      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;`;
        cnt.textContent = item.count;
        c.appendChild(cnt);
      }
    }
    c.style.display = item ? 'flex' : 'none';
    c.style.left = (mouseX - SLOT_SIZE / 2) + 'px';
    c.style.top  = (mouseY - SLOT_SIZE / 2) + 'px';
  }

  open(slots) {
    this._slots = slots && slots.length ? [...slots] : new Array(46).fill(null);
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

  updateSlots(slots, cursorItem) {
    this._slots = slots && slots.length ? [...slots] : new Array(46).fill(null);
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
      c.appendChild(makeItemVisual(item));
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

  _row(indices) {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:${GAP}px;`;
    for (const idx of indices) row.appendChild(this._makeSlot(idx));
    return row;
  }

  _label(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `font-size:11px;color:#444;margin:6px 0 2px;`;
    return el;
  }

  _sep() {
    const el = document.createElement('div');
    el.style.cssText = `height:2px;border-top:2px solid #999;margin:6px 0 4px;`;
    return el;
  }

  _render() {
    const b = this._body;
    b.innerHTML = '';

    // ── Crafting area (top) ───────────────────────────────────────────────────
    const craftRow = document.createElement('div');
    craftRow.style.cssText = `display:flex;align-items:center;gap:12px;margin-bottom:8px;`;

    // 2×2 grid (slots 1–4)
    const craftGrid = document.createElement('div');
    craftGrid.style.cssText = `display:grid;grid-template-columns:repeat(2,${SLOT_SIZE}px);gap:${GAP}px;`;
    for (const idx of [1, 2, 3, 4]) craftGrid.appendChild(this._makeSlot(idx));

    const arrow = document.createElement('div');
    arrow.textContent = '➜';
    arrow.style.cssText = `font-size:24px;color:#555;`;

    // Crafting output (slot 0)
    const outputWrap = document.createElement('div');
    outputWrap.appendChild(this._makeSlot(0));

    craftRow.appendChild(craftGrid);
    craftRow.appendChild(arrow);
    craftRow.appendChild(outputWrap);
    b.appendChild(craftRow);

    b.appendChild(this._sep());

    // ── Main inventory (slots 9–35) ───────────────────────────────────────────
    for (const rowSlots of MAIN_ROWS) b.appendChild(this._row(rowSlots));

    b.appendChild(this._sep());

    // ── Hotbar (slots 36–44) ─────────────────────────────────────────────────
    b.appendChild(this._label('Hotbar'));
    b.appendChild(this._row(range(36, 45)));
  }

  _makeSlot(idx) {
    const item = this._slots[idx] || null;
    const cell = document.createElement('div');
    cell.dataset.slot = idx;
    cell.style.cssText = `
      width:${SLOT_SIZE}px;height:${SLOT_SIZE}px;
      background:#8b8b8b;border:2px solid #555;border-top-color:#fff;border-left-color:#fff;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      cursor:pointer;position:relative;box-sizing:border-box;
      font-size:9px;color:#fff;text-align:center;overflow:hidden;padding:2px;
      -webkit-tap-highlight-color:transparent;
    `;

    if (item) {
      cell.appendChild(makeItemVisual(item));

      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `
          position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;
          color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;
        `;
        cnt.textContent = item.count;
        cell.appendChild(cnt);
      }

      if (item.maxDurability > 0) {
        const pct = Math.max(0, 1 - item.durabilityUsed / item.maxDurability);
        const barColor = pct > 0.6 ? '#5f5' : pct > 0.3 ? '#ff5' : '#f55';
        const bar = document.createElement('div');
        bar.style.cssText = `position:absolute;bottom:1px;left:2px;right:2px;height:2px;background:#111;pointer-events:none;border-radius:1px;`;
        const fill = document.createElement('div');
        fill.style.cssText = `height:100%;width:${Math.round(pct * 100)}%;background:${barColor};border-radius:1px;`;
        bar.appendChild(fill);
        cell.appendChild(bar);
      }
    }

    // Hover highlight
    cell.addEventListener('mouseenter', (e) => {
      cell.style.background = '#a0a0a0';
      if (item) {
        this._tooltip.textContent = item.name.replace(/_/g, ' ') + (item.count > 1 ? ` ×${item.count}` : '');
        this._tooltip.style.display = 'block';
      }
    });
    cell.addEventListener('mousemove', (e) => {
      this._tooltip.style.left = (e.clientX + 14) + 'px';
      this._tooltip.style.top  = (e.clientY - 6)  + 'px';
    });
    cell.addEventListener('mouseleave', () => {
      cell.style.background = '#8b8b8b';
      this._tooltip.style.display = 'none';
    });

    cell.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.button === 2 ? 1 : 0;
      // Slot 0 is the craft result — can only take from it, never place into it
      const isCraftResult = idx === 0;
      if (btn === 0) {
        let next;
        let slotNext = item; // optimistic new slot state
        if (!this._heldItem) {
          next = item;
          slotNext = null;
        } else if (isCraftResult) {
          next = this._heldItem; // keep held item — can't place into craft result
          slotNext = item;       // slot unchanged
        } else if (!item) {
          next = null;
          slotNext = this._heldItem;
        } else if (this._heldItem.name === item.name) {
          const combined = this._heldItem.count + item.count;
          next = combined <= 64 ? null : { ...this._heldItem, count: combined - 64 };
          slotNext = { ...item, count: Math.min(64, combined) };
        } else {
          next = item;
          slotNext = this._heldItem;
        }
        this._slots[idx] = slotNext;
        this._pickUpItem(next, e.clientX, e.clientY);
        this._render();
      } else if (btn === 1 && this._heldItem && !isCraftResult) {
        const newCount = this._heldItem.count - 1;
        this._slots[idx] = item ? { ...item, count: item.count + 1 } : { ...this._heldItem, count: 1 };
        this._pickUpItem(newCount > 0 ? { ...this._heldItem, count: newCount } : null, e.clientX, e.clientY);
        this._render();
      }
      if (this._onClickSlot) this._onClickSlot(idx, btn);
    });
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

    // Touch support: tap = left click
    cell.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      const pickedUp = this._heldItem ? null : item;
      const touch = e.changedTouches[0];
      this._pickUpItem(pickedUp, touch ? touch.clientX : 0, touch ? touch.clientY : 0);
      if (this._onClickSlot) this._onClickSlot(idx, 0);
    });

    return cell;
  }
}
