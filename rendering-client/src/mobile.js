/**
 * Mobile / touch controls overlay.
 * Injected when the device has touch input (iPad, phone).
 * Feeds directly into InputHandler via setControl().
 *
 * Layout (portrait or landscape iPad):
 *   Bottom-left  — D-pad (forward/back/left/right) + sprint toggle
 *   Bottom-right — Jump, Sneak (hold), Break (hold), Place (tap)
 *   Right area   — touch drag → camera look (handled in InputHandler.setupTouchLook)
 */

export function isMobile() {
  return navigator.maxTouchPoints > 0;
}

export function setupMobileControls(inputHandler) {
  if (!isMobile()) return;
  inputHandler.setupTouchLook();
  injectOverlay(inputHandler);
}

function injectOverlay(inp) {
  const overlay = document.createElement('div');
  overlay.id = 'mobile-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;pointer-events:none;z-index:50;
    user-select:none;-webkit-user-select:none;touch-action:none;
  `;
  overlay.innerHTML = buildHTML();
  document.body.appendChild(overlay);

  // Wire every button using touch events (not pointer events).
  // Reason: on iOS Safari, setPointerCapture on pointerdown is unreliable —
  // a 1px finger drift before liftoff can re-route events to a neighbouring
  // button, causing the wrong control to fire. touchstart/touchend with an
  // explicit touch identifier + stopPropagation avoids this entirely.
  // stopPropagation also prevents the touch from reaching the canvas's
  // touchstart handler (which calls preventDefault for the look gesture).
  const wire = (id, control, toggle = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (toggle) {
      let on = false;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        on = !on; inp.setControl(control, on);
        el.style.background = on ? BTN_ON : BTN_OFF;
      }, { passive: false });
    } else {
      let activeTouchId = null;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (activeTouchId !== null) return; // already held
        activeTouchId = e.changedTouches[0].identifier;
        inp.setControl(control, true);
        el.style.background = BTN_ON;
      }, { passive: false });
      const up = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === activeTouchId) {
            activeTouchId = null;
            inp.setControl(control, false);
            el.style.background = BTN_OFF;
          }
        }
      };
      el.addEventListener('touchend',    up);
      el.addEventListener('touchcancel', up);
    }
  };

  wire('mb-fwd',    'forward');
  wire('mb-back',   'back');
  wire('mb-left',   'left');
  wire('mb-right',  'right');
  wire('mb-jump',   'jump');
  wire('mb-sneak',  'sneak');
  wire('mb-break',  'breakBlock');
  wire('mb-sprint', 'sprint', true);
  wire('mb-inv',    'inventoryToggle', true);

  // Place is a one-shot tap
  const placeEl = document.getElementById('mb-place');
  if (placeEl) {
    placeEl.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      inp.setControl('placePending', true);
      placeEl.style.background = BTN_ON;
      setTimeout(() => { placeEl.style.background = BTN_OFF; }, 120);
    }, { passive: false });
  }
}

const BTN_OFF = 'rgba(0,0,0,0.45)';
const BTN_ON  = 'rgba(255,255,255,0.30)';

function btn(id, label, style = '') {
  return `<div id="${id}" style="
    position:absolute;display:flex;align-items:center;justify-content:center;
    background:${BTN_OFF};border:2px solid rgba(255,255,255,0.35);border-radius:10px;
    color:#fff;font-size:22px;font-family:system-ui;pointer-events:auto;touch-action:none;
    -webkit-tap-highlight-color:transparent;cursor:pointer;${style}
  ">${label}</div>`;
}

const SZ = 68; // button size px
const PAD = 14; // padding from edges
const G = SZ + 8; // grid cell size

function buildHTML() {
  // D-pad: centred on left side, bottom area
  const dL  = PAD;
  const dB  = PAD;            // from bottom
  const dMX = dL + G;         // mid x of D-pad cross
  const dMY = dB + G;         // mid y of D-pad cross (from bottom)

  const abs = (l, b, w = SZ, h = SZ) =>
    `left:${l}px;bottom:${b}px;width:${w}px;height:${h}px;`;

  const dpad =
    btn('mb-fwd',   '▲', abs(dMX, dB + G * 2)) +
    btn('mb-back',  '▼', abs(dMX, dB)) +
    btn('mb-left',  '◀', abs(dL,  dB + G)) +
    btn('mb-right', '▶', abs(dL + G * 2, dB + G)) +
    btn('mb-sprint', '⚡', abs(dL + G, dB + G, SZ, SZ)); // centre = sprint toggle

  // Action buttons: right side
  const rR  = PAD;  // from right
  const rB  = PAD;

  const absr = (r, b, w = SZ, h = SZ) =>
    `right:${r}px;bottom:${b}px;width:${w}px;height:${h}px;`;

  const actions =
    btn('mb-jump',  '🦘', absr(rR + G,     rB + G * 2)) +   // top-centre
    btn('mb-break', '⛏️',  absr(rR + G * 2, rB + G)) +       // mid-left
    btn('mb-place', '🧱', absr(rR,          rB + G)) +        // mid-right
    btn('mb-sneak', '🦆', absr(rR + G,     rB)) +             // bottom-centre
    btn('mb-inv',   '🎒', absr(rR + G * 2, rB + G * 2));     // top-left (inventory)

  return dpad + actions;
}
