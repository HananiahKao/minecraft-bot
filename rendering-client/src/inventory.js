/**
 * Inventory screen — renders the player's 36 slots (main + hotbar) as an overlay.
 * Slot indices match bot.inventory.slots[] (9–35 = main, 36–44 = hotbar).
 * Click events are forwarded to the bridge via onClickSlot(slotIndex, mouseButton).
 */

const SLOT_SIZE = 52;
const GAP = 4;

// Minecraft inventory layout: 3 rows of 9 (main) + 1 row of 9 (hotbar)
const ROWS = [
  { label: null, slots: range(9, 18) },
  { label: null, slots: range(18, 27) },
  { label: null, slots: range(27, 36) },
  { label: 'hotbar', slots: range(36, 45) },
];

function range(start, end) {
  const r = [];
  for (let i = start; i < end; i++) r.push(i);
  return r;
}

export class InventoryScreen {
  constructor({ onClose, onClickSlot }) {
    this._slots = new Array(45).fill(null);
    this._onClose = onClose;
    this._onClickSlot = onClickSlot;
    this._open = false;
    this._el = null;
    this._grid = null;
    this._tooltip = null;
    this._buildDOM();
  }

  _buildDOM() {
    const el = document.createElement('div');
    el.id = 'inventory-screen';
    el.style.cssText = `
      position:fixed;inset:0;display:none;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.65);z-index:200;touch-action:none;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#c6c6c6;border:3px solid #555;border-bottom-color:#111;
      border-right-color:#111;padding:16px;font-family:monospace;
      image-rendering:pixelated;min-width:${9*(SLOT_SIZE+GAP)+GAP}px;
    `;

    const title = document.createElement('div');
    title.textContent = 'Inventory';
    title.style.cssText = `font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;`;
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = `display:flex;flex-direction:column;gap:${GAP*2}px;`;
    panel.appendChild(grid);
    this._grid = grid;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position:fixed;pointer-events:none;background:rgba(0,0,0,0.85);color:#fff;
      font-size:12px;font-family:monospace;padding:4px 8px;border-radius:3px;
      display:none;z-index:201;white-space:nowrap;
    `;
    document.body.appendChild(tooltip);
    this._tooltip = tooltip;

    el.appendChild(panel);
    document.body.appendChild(el);
    this._el = el;

    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (!this._open) return;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'e') { e.preventDefault(); this.close(); }
    });
  }

  open(slots) {
    this._slots = slots && slots.length ? slots : new Array(45).fill(null);
    this._render();
    this._el.style.display = 'flex';
    this._open = true;
  }

  close() {
    this._el.style.display = 'none';
    this._tooltip.style.display = 'none';
    this._open = false;
    if (this._onClose) this._onClose();
  }

  isOpen() { return this._open; }

  updateSlots(slots) {
    this._slots = slots && slots.length ? slots : new Array(45).fill(null);
    if (this._open) this._render();
  }

  _render() {
    this._grid.innerHTML = '';
    for (let ri = 0; ri < ROWS.length; ri++) {
      const { label, slots } = ROWS[ri];
      if (ri === 3) {
        // Gap between main inventory and hotbar
        const sep = document.createElement('div');
        sep.style.cssText = `height:4px;border-top:2px solid #999;margin:2px 0;`;
        this._grid.appendChild(sep);
      }
      const row = document.createElement('div');
      row.style.cssText = `display:flex;gap:${GAP}px;`;
      for (const idx of slots) {
        row.appendChild(this._makeSlot(idx));
      }
      this._grid.appendChild(row);
    }
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
      const name = item.name.replace(/_/g, '\n');
      const abbr = document.createElement('div');
      abbr.style.cssText = `
        font-size:9px;line-height:1.2;word-break:break-all;text-align:center;
        text-shadow:1px 1px 0 #000;color:#fff;pointer-events:none;
      `;
      abbr.textContent = name;
      cell.appendChild(abbr);

      if (item.count > 1) {
        const cnt = document.createElement('div');
        cnt.style.cssText = `
          position:absolute;bottom:2px;right:3px;font-size:10px;font-weight:bold;
          color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;
        `;
        cnt.textContent = item.count;
        cell.appendChild(cnt);
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

    // Left click (pick up / place)
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this._onClickSlot) this._onClickSlot(idx, e.button === 2 ? 1 : 0);
    });
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

    // Touch support: tap = left click
    cell.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this._onClickSlot) this._onClickSlot(idx, 0);
    });

    return cell;
  }
}
