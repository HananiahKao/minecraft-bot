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
    this._slots = slots && slots.length ? [...slots] : new Array(46).fill(null);
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
    this._slots = slots && slots.length ? [...slots] : new Array(46).fill(null);
    if (this._open) this._render();
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
