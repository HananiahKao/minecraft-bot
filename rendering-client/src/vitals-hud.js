/**
 * Health / food / armor / air HUD, built from vanilla's own GUI sprites
 * (extracted from minecraft-assets into assets/textures/gui/hud/). Mirrors
 * vanilla's icon math: each heart/food/armor icon represents 2 points,
 * rendered full/half/empty.
 *
 * Every icon element is created exactly once, in the constructor, and
 * update() only ever mutates an existing element's background-image (and,
 * for the armor/air rows, visibility) — nothing is ever torn down and
 * rebuilt. That's deliberate: innerHTML = '' followed by re-appending 10
 * fresh divs leaves a brief real (if usually sub-frame) window where the
 * row is empty, and under any jank/GC pause that window becomes a visible
 * flash. Updating existing nodes in place has no such window.
 */

const ICON = 27; // 9px native sprite × 3
const HUD = '/assets/textures/gui/hud';

function makeIconRow(count) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  const icons = [];
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.style.width = `${ICON}px`;
    d.style.height = `${ICON}px`;
    d.style.backgroundSize = `${ICON}px ${ICON}px`;
    d.style.imageRendering = 'pixelated';
    d.style.marginRight = '-3px';
    row.appendChild(d);
    icons.push(d);
  }
  return { row, icons };
}

// value in points (2 per icon), 10 icons, full/half/empty — only touches
// an icon's backgroundImage when the url it needs actually changes.
function setPairBar(icons, value, fullUrl, halfUrl, emptyUrl) {
  const amount = Math.max(0, Math.min(20, Math.round(value)));
  for (let i = 0; i < icons.length; i++) {
    const remaining = amount - i * 2;
    const url = remaining >= 2 ? fullUrl : remaining === 1 ? halfUrl : emptyUrl;
    const bg = `url(${url})`;
    if (icons[i].style.backgroundImage !== bg) icons[i].style.backgroundImage = bg;
  }
}

export class VitalsHud {
  constructor(containerId) {
    this.root = document.getElementById(containerId);
    // #vitals-hud is already position:absolute via CSS, which is enough to
    // serve as the positioning context for the rows below — do NOT set an
    // inline position here, same inline-vs-stylesheet trap as #hotbar.
    //
    // Each row is independently absolutely-positioned (bottom:0 = the row
    // directly above the hotbar, bottom:29 = the row above that). Hiding
    // armor/air must NOT reflow the health/food row — a flex column with
    // display:none siblings does exactly that (every toggle shifts the
    // other rows).
    const armor = makeIconRow(10);
    const air = makeIconRow(10);
    const health = makeIconRow(10);
    const food = makeIconRow(10);

    armor.row.style.position = 'absolute';
    armor.row.style.left = '0';
    armor.row.style.bottom = '29px';
    armor.row.style.justifyContent = 'flex-start';
    armor.row.style.visibility = 'hidden'; // until the first vitals message says otherwise

    air.row.style.position = 'absolute';
    air.row.style.right = '0';
    air.row.style.bottom = '29px';
    air.row.style.visibility = 'hidden';
    air.row.style.flexDirection = 'row-reverse'; // bubbles deplete right-to-left, like vanilla
    air.row.style.justifyContent = 'flex-start';
    for (const icon of air.icons) { icon.style.marginRight = '0'; icon.style.marginLeft = '-3px'; }

    const hpFoodRow = document.createElement('div');
    hpFoodRow.style.position = 'absolute';
    hpFoodRow.style.left = '0';
    hpFoodRow.style.right = '0';
    hpFoodRow.style.bottom = '0';
    hpFoodRow.style.display = 'flex';
    hpFoodRow.style.justifyContent = 'space-between';
    hpFoodRow.appendChild(health.row);
    hpFoodRow.appendChild(food.row);

    this.root.appendChild(armor.row);
    this.root.appendChild(air.row);
    this.root.appendChild(hpFoodRow);

    this._armorRow = armor.row;
    this._armorIcons = armor.icons;
    this._airRow = air.row;
    this._airIcons = air.icons;
    this._healthIcons = health.icons;
    this._foodIcons = food.icons;
  }

  update({ health, food, armor, oxygen, inWater }) {
    if (health != null) {
      setPairBar(this._healthIcons, health, `${HUD}/heart/full.png`, `${HUD}/heart/half.png`, `${HUD}/heart/container.png`);
    }
    if (food != null) {
      setPairBar(this._foodIcons, food, `${HUD}/food_full.png`, `${HUD}/food_half.png`, `${HUD}/food_empty.png`);
    }
    if (armor != null) {
      // visibility, not display: keeps the row's own layout box and its
      // children exactly as they are — showing/hiding never touches the
      // DOM, so there's nothing to reflow or momentarily blank out.
      this._armorRow.style.visibility = armor > 0 ? 'visible' : 'hidden';
      if (armor > 0) setPairBar(this._armorIcons, armor, `${HUD}/armor_full.png`, `${HUD}/armor_half.png`, `${HUD}/armor_empty.png`);
    }
    if (oxygen != null) {
      // Gated on the physics engine's own isInWater signal (the same one
      // driving swim state), not "oxygen < 20" — oxygen is server-authoritative
      // and can read as not-full for a tick or two even when nothing visibly
      // looks like water (regen in progress, or a position desync between
      // the bridge's reported position and what the 3D client renders).
      // Showing the bar only while the bot is actually in water avoids
      // surfacing that gap to the player as a confusing bubble popup on dry land.
      this._airRow.style.visibility = inWater ? 'visible' : 'hidden';
      if (inWater) {
        const bubbles = Math.ceil(Math.max(0, oxygen) / 2);
        for (let i = 0; i < this._airIcons.length; i++) {
          const show = i < bubbles;
          const isLast = i === bubbles - 1;
          const url = !show ? null : (isLast && oxygen <= 2 ? `${HUD}/air_bursting.png` : `${HUD}/air.png`);
          const bg = url ? `url(${url})` : 'none';
          if (this._airIcons[i].style.backgroundImage !== bg) this._airIcons[i].style.backgroundImage = bg;
        }
      }
    }
  }
}
