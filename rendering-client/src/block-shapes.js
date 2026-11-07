// Block picking (crosshair raycast) shapes — kept separate from
// chunk-worker.js's render model data on purpose. Mirrors vanilla
// Minecraft's own split between a block's rendered model and its actual
// selection/collision VoxelShape: a block's render mesh can be a
// zero-thickness decal (e.g. ladder's textured quad), which is the wrong
// thing to raycast against (no real volume, and numerically fragile at
// grazing angles) — the shapes here always have real thickness instead.

// Fluids never receive or block the crosshair pick, matching vanilla's
// ClipContext.Fluid.NONE used for the block-outline raycast: the ray
// passes straight through water/lava to whatever is actually behind it.
export const LIQUID_BLOCKS = new Set([
  'water', 'flowing_water', 'bubble_column',
  'lava', 'flowing_lava',
]);

// Per-block selection boxes for blocks whose real shape doesn't fill the
// cell. Keyed by block name → function(props) → array of boxes in local
// block space [0,1]. A name with no entry here is treated as a full cube.
export const SELECTION_SHAPES = {
  ladder: (props) => {
    const T = 0.1875; // 3/16 — matches vanilla's ladder selection depth
    // "facing" = direction the rungs face = direction away from the wall.
    // The slab goes on the OPPOSITE side (flush against the wall it's attached to).
    switch (props?.facing) {
      case 'north': return [{ x0: 0,   y0: 0, z0: 1 - T, x1: 1, y1: 1, z1: 1   }];
      case 'south': return [{ x0: 0,   y0: 0, z0: 0,     x1: 1, y1: 1, z1: T   }];
      case 'east':  return [{ x0: 0,   y0: 0, z0: 0,     x1: T, y1: 1, z1: 1   }];
      default:      return [{ x0: 1-T, y0: 0, z0: 0,     x1: 1, y1: 1, z1: 1   }]; // west
    }
  },
};
