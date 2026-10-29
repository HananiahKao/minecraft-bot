// Single source of truth for which Minecraft version's data to pull from
// minecraft-assets/prismarine-viewer. Bump this one value when the server
// moves to a new Minecraft version, then re-run extract.js and
// build-blocks.js — both read it from here instead of hardcoding it
// themselves.
module.exports = { MC_VERSION: '1.20.1' };
