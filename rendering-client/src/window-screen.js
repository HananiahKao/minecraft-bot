/**
 * Block window screen — shows container GUIs opened via bot.activateBlock().
 * Handles crafting tables, chests, furnaces, and any other server-opened window.
 *
 * Slot indices sent from the bridge are the container-only portion (0..inventoryStart-1).
 * Clicks are forwarded as window_click messages to the bridge.
 */

const SLOT_SIZE = 52;
const GAP = 4;

// How many columns to use when auto-laying-out an unknown window type
function columnsFor(slotCount) {
  if (slotCount <= 5)  return slotCount;
  if (slotCount <= 9)  return 9;
  if (slotCount % 9 === 0) return 9;
  return Math.ceil(Math.sqrt(slotCount));
}

// Window-type-specific layouts: returns { sections: [{ label, slots[] }] }
// slots[] entries are container slot indices to render in that section.
function layoutFor(windowType, slotCount) {
  const t = String(windowType);

  if (t.includes('crafting')) {
    // Slot 0 = output, 1-9 = 3×3 grid
    return {
      sections: [
        { label: 'Crafting',  slots: [1,2,3,4,5,6,7,8,9], cols: 3 },
        { label: 'Output',    slots: [0],                   cols: 1 },
      ],
    };
  }
  if (t.includes('furnace') || t.includes('smoker') || t.includes('blast')) {
    // 0 = ingredient, 1 = fuel, 2 = output
    return {
      sections: [
        { label: 'Input',  slots: [0], cols: 1 },
        { label: 'Fuel',   slots: [1], cols: 1 },
        { label: 'Output', slots: [2], cols: 1 },
      ],
    };
  }
  if (t.includes('hopper')) {
    return { sections: [{ label: null, slots: [0,1,2,3,4], cols: 5 }] };
  }
  // Generic: lay out all slots in rows
  const cols = columnsFor(slotCount);
  return { sections: [{ label: null, slots: Array.from({ length: slotCount }, (_, i) => i), cols }] };
}

export class WindowScreen {
  constructor({ onClose, onClickSlot }) {
    this._slots = [];
    this._windowType = null;
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

  open(windowType, title, slots) {
    this._windowType = windowType;
    this._slots = slots || [];
    this._title.textContent = title || 'Container';
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

  updateSlots(slots) {
    this._slots = slots || [];
    this._clearHeld();
    if (this._open) this._render();
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

  _render() {
    const b = this._body;
    b.innerHTML = '';
    const layout = layoutFor(this._windowType, this._slots.length);

    for (const section of layout.sections) {
      if (section.label) {
        const lbl = document.createElement('div');
        lbl.textContent = section.label;
        lbl.style.cssText = `font-size:11px;color:#444;margin:6px 0 2px;`;
        b.appendChild(lbl);
      }
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(${section.cols},${SLOT_SIZE}px);gap:${GAP}px;margin-bottom:${GAP * 2}px;`;
      for (const idx of section.slots) grid.appendChild(this._makeSlot(idx));
      b.appendChild(grid);
    }
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
      if (btn === 0) this._pickUp(this._heldItem ? null : item, e.clientX, e.clientY);
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
