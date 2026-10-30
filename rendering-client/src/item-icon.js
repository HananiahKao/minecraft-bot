/**
 * Shared helper for showing a real item icon (from the extracted
 * textures/items/ assets) instead of a plain text name, in the hotbar,
 * inventory screen, and chest/window screen. Same fallback philosophy as
 * everywhere else in this codebase: an item not in the manifest (no
 * validated icon) just keeps showing its name as text, unchanged.
 */

let _iconNames = null; // Set<string> once loaded, null until then
fetch('/assets/manifest.json')
  .then(r => r.json())
  .then(d => { _iconNames = new Set(d.items || []); })
  .catch(() => { _iconNames = new Set(); });

export function hasItemIcon(name) {
  return !!(_iconNames && _iconNames.has(name));
}

export function itemIconUrl(name) {
  return `/assets/textures/items/${name}.png`;
}

// Builds the DOM node that represents an item's name/appearance in a slot —
// a pixelated icon if one's available, otherwise the existing text-name
// fallback (same styling as the call sites already used). `size` controls
// the icon's rendered size in px.
export function makeItemVisual(item, size = 32) {
  if (hasItemIcon(item.name)) {
    const icon = document.createElement('div');
    icon.style.cssText = `
      width:${size}px;height:${size}px;
      background-image:url(${itemIconUrl(item.name)});
      background-size:contain;background-repeat:no-repeat;background-position:center;
      image-rendering:pixelated;pointer-events:none;
    `;
    return icon;
  }
  const name = document.createElement('div');
  name.style.cssText = `
    font-size:9px;line-height:1.2;word-break:break-all;text-align:center;
    text-shadow:1px 1px 0 #000;color:#fff;pointer-events:none;
  `;
  name.textContent = item.name.replace(/_/g, '\n');
  return name;
}
