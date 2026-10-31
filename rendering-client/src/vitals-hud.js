/**
 * Health / food / armor / air HUD, built from vanilla's own GUI sprites
 * (extracted from minecraft-assets into assets/textures/gui/hud/). Mirrors
 * vanilla's icon math: each heart/food/armor icon represents 2 points,
 * rendered full/half/empty; the bar simply isn't drawn when the stat is at
 * its default empty state (armor at 0, or fully oxygenated).
 */

const ICON = 27; // 9px native sprite × 3
const HUD = '/assets/textures/gui/hud';

function iconDiv(url) {
  const d = document.createElement('div');
  d.style.width = `${ICON}px`;
  d.style.height = `${ICON}px`;
  d.style.backgroundImage = `url(${url})`;
  d.style.backgroundSize = `${ICON}px ${ICON}px`;
  d.style.imageRendering = 'pixelated';
  d.style.marginRight = `-3px`;
  return d;
}

// value/max in points (2 per icon), 10 icons, full/half/empty variants.
function renderPairBar(container, value, fullUrl, halfUrl, emptyUrl) {
  container.innerHTML = '';
  const amount = Math.max(0, Math.min(20, Math.round(value)));
  for (let i = 0; i < 10; i++) {
    const remaining = amount - i * 2;
    const url = remaining >= 2 ? fullUrl : remaining === 1 ? halfUrl : emptyUrl;
    container.appendChild(iconDiv(url));
  }
}

export class VitalsHud {
  constructor(containerId) {
    this.root = document.getElementById(containerId);
    this.root.innerHTML = `
      <div class="vitals-row" id="vh-armor" style="justify-content:flex-start;"></div>
      <div class="vitals-row" id="vh-air" style="justify-content:flex-end;"></div>
      <div class="vitals-row" style="justify-content:space-between;">
        <div id="vh-health" style="display:flex;"></div>
        <div id="vh-food" style="display:flex;"></div>
      </div>
    `;
    this._armorRow = this.root.querySelector('#vh-armor');
    this._airRow = this.root.querySelector('#vh-air');
    this._healthRow = this.root.querySelector('#vh-health');
    this._foodRow = this.root.querySelector('#vh-food');
  }

  update({ health, food, armor, oxygen }) {
    if (health != null) {
      renderPairBar(this._healthRow, health, `${HUD}/heart/full.png`, `${HUD}/heart/half.png`, `${HUD}/heart/container.png`);
    }
    if (food != null) {
      renderPairBar(this._foodRow, food, `${HUD}/food_full.png`, `${HUD}/food_half.png`, `${HUD}/food_empty.png`);
    }
    if (armor != null) {
      this._armorRow.style.display = armor > 0 ? 'flex' : 'none';
      if (armor > 0) renderPairBar(this._armorRow, armor, `${HUD}/armor_full.png`, `${HUD}/armor_half.png`, `${HUD}/armor_empty.png`);
    }
    if (oxygen != null) {
      this._airRow.style.display = oxygen < 20 ? 'flex' : 'none';
      if (oxygen < 20) {
        this._airRow.innerHTML = '';
        const bubbles = Math.ceil(Math.max(0, oxygen) / 2);
        for (let i = 0; i < bubbles; i++) {
          // The single remaining bubble "bursts" once breath is nearly gone.
          const isLast = i === bubbles - 1;
          const url = isLast && oxygen <= 2 ? `${HUD}/air_bursting.png` : `${HUD}/air.png`;
          this._airRow.appendChild(iconDiv(url));
        }
      }
    }
  }
}
