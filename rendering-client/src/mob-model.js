/**
 * Builds real per-mob 3D models from the trimmed Bedrock-style geometry
 * JSON extracted from prismarine-viewer's entities.json (see
 * scripts/extract-assets/extract.js), as a plain THREE.Group hierarchy —
 * deliberately NOT a THREE.Skeleton/SkinnedMesh. A Group per bone,
 * nested by parent, gives the same ability to animate named limbs
 * (bones.get('leftArm').rotation.x = ...) with ordinary scene-graph
 * composition, which is far simpler to reason about than skinning.
 *
 * UV-unwrap math (elemFaces/addCube) is ported from prismarine-viewer's
 * viewer/lib/entity/Entity.js; the walk-cycle formula below is ported
 * from viewer/lib/entities.js's animateWalk.
 */

import * as THREE from 'three';

// Minecraft/Bedrock box-UV unwrap: for each face, which texture region
// (u0,v0)-(u1,v1) maps to which corner, given a cube's uv origin + size.
const elemFaces = {
  up: {
    dir: [0, 1, 0],
    u0: [0, 0, 1], v0: [0, 0, 0], u1: [1, 0, 1], v1: [0, 0, 1],
    corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]]
  },
  down: {
    dir: [0, -1, 0],
    u0: [1, 0, 1], v0: [0, 0, 0], u1: [2, 0, 1], v1: [0, 0, 1],
    corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]]
  },
  east: {
    dir: [1, 0, 0],
    u0: [1, 0, 1], v0: [0, 0, 1], u1: [1, 0, 2], v1: [0, 1, 1],
    corners: [[1, 1, 1, 1, 0], [1, 0, 1, 1, 1], [1, 1, 0, 0, 0], [1, 0, 0, 0, 1]]
  },
  west: {
    dir: [-1, 0, 0],
    u0: [0, 0, 0], v0: [0, 0, 1], u1: [0, 0, 1], v1: [0, 1, 1],
    corners: [[0, 1, 0, 1, 0], [0, 0, 0, 1, 1], [0, 1, 1, 0, 0], [0, 0, 1, 0, 1]]
  },
  north: {
    dir: [0, 0, -1],
    u0: [0, 0, 1], v0: [0, 0, 1], u1: [1, 0, 1], v1: [0, 1, 1],
    corners: [[1, 0, 0, 1, 1], [0, 0, 0, 0, 1], [1, 1, 0, 1, 0], [0, 1, 0, 0, 0]]
  },
  south: {
    dir: [0, 0, 1],
    u0: [1, 0, 2], v0: [0, 0, 1], u1: [2, 0, 2], v1: [0, 1, 1],
    corners: [[0, 0, 1, 1, 1], [1, 0, 1, 0, 1], [0, 1, 1, 1, 0], [1, 1, 1, 0, 0]]
  }
};

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Builds one cube's geometry, with vertex positions expressed relative to
// `pivot` (bone-local space) rather than absolute model space — the owning
// bone Group supplies the pivot's own world position/rotation.
//
// `bindRotation` is the bone's own static bind_pose_rotation/rotation
// (Bedrock degrees). It is baked directly into this bone's own vertices
// around its own pivot — it must NOT also become the bone Group's
// `.rotation`, or it would additionally rotate every child bone's group
// through ordinary scene-graph composition (Bedrock's bind_pose_rotation
// is a one-time mesh-shape correction for this bone alone, not meant to
// propagate to children — e.g. a cow's "body" bone has bind_pose_rotation
// [90,0,0] purely to orient its own cubes; its legs/head must stay put).
function addCube(attr, pivot, cube, bindRotation, texW, texH) {
  const cubeRotation = new THREE.Euler(0, 0, 0);
  if (cube.rotation) {
    cubeRotation.x = -cube.rotation[0] * Math.PI / 180;
    cubeRotation.y = -cube.rotation[1] * Math.PI / 180;
    cubeRotation.z = -cube.rotation[2] * Math.PI / 180;
  }

  for (const { dir, corners, u0, v0, u1, v1 } of Object.values(elemFaces)) {
    const ndx = attr.positions.length / 3;

    for (const pos of corners) {
      const u = (cube.uv[0] + dot(pos[3] ? u1 : u0, cube.size)) / texW;
      const v = (cube.uv[1] + dot(pos[4] ? v1 : v0, cube.size)) / texH;

      const inflate = cube.inflate || 0;
      let vecPos = new THREE.Vector3(
        cube.origin[0] + pos[0] * cube.size[0] + (pos[0] ? inflate : -inflate),
        cube.origin[1] + pos[1] * cube.size[1] + (pos[1] ? inflate : -inflate),
        cube.origin[2] + pos[2] * cube.size[2] + (pos[2] ? inflate : -inflate)
      );

      vecPos = vecPos.applyEuler(cubeRotation);
      vecPos = vecPos.sub(pivot);
      let normal = new THREE.Vector3(...dir);
      if (bindRotation) {
        vecPos = vecPos.applyEuler(bindRotation);
        normal = normal.applyEuler(bindRotation);
      }

      attr.positions.push(vecPos.x, vecPos.y, vecPos.z);
      attr.normals.push(normal.x, normal.y, normal.z);
      attr.uvs.push(u, v);
    }

    attr.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
  }
}

function buildBoneMesh(jsonBone, bindRotation, material, texW, texH) {
  if (!jsonBone.cubes || jsonBone.cubes.length === 0) return null;

  const attr = { positions: [], normals: [], uvs: [], indices: [] };
  const pivot = new THREE.Vector3(...(jsonBone.pivot || [0, 0, 0]));
  for (const cube of jsonBone.cubes) {
    addCube(attr, pivot, cube, bindRotation, texW, texH);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(attr.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(attr.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(attr.uvs, 2));
  geometry.setIndex(attr.indices);

  return new THREE.Mesh(geometry, material);
}

/**
 * Builds a mob model from trimmed geometry JSON (as written by
 * scripts/extract-assets/extract.js: { texturewidth, textureheight, bones }).
 *
 * Returns { root, bones } — `root` is the THREE.Group to add to the scene
 * (already scaled/oriented), `bones` is a Map<name, Group> for animation
 * lookups (entries may be absent for mobs without arms/legs/head — every
 * caller must tolerate `bones.get(name)` returning undefined).
 */
export function buildMobModel(mobJson, material) {
  const { texturewidth = 64, textureheight = 64, bones: jsonBones } = mobJson;

  const groups = new Map(); // name -> THREE.Group
  const bonesByNameLower = new Map(jsonBones.map(b => [b.name.toLowerCase(), b]));

  for (const jsonBone of jsonBones) {
    const group = new THREE.Group();
    group.name = jsonBone.name;
    // Group.rotation starts at identity and is left there: it's the
    // animatable transform (walk swing, head pitch). The bone's own
    // static bind_pose_rotation/rotation is baked into its mesh instead
    // (see addCube's `bindRotation` param) so it shapes only this bone's
    // own cubes and never cascades into child bones' groups.

    const rotationDeg = jsonBone.bind_pose_rotation || jsonBone.rotation;
    const bindRotation = rotationDeg
      ? new THREE.Euler(
        -rotationDeg[0] * Math.PI / 180,
        -rotationDeg[1] * Math.PI / 180,
        -rotationDeg[2] * Math.PI / 180
      )
      : null;

    if (!jsonBone.neverRender) {
      const mesh = buildBoneMesh(jsonBone, bindRotation, material, texturewidth, textureheight);
      if (mesh) group.add(mesh);
    }

    groups.set(jsonBone.name, group);
  }

  const root = new THREE.Group();
  for (const jsonBone of jsonBones) {
    const group = groups.get(jsonBone.name);
    const parentJson = jsonBone.parent ? bonesByNameLower.get(jsonBone.parent.toLowerCase()) : undefined;

    if (parentJson && groups.has(parentJson.name)) {
      const parentGroup = groups.get(parentJson.name);
      const childPivot = jsonBone.pivot || [0, 0, 0];
      const parentPivot = parentJson.pivot || [0, 0, 0];
      group.position.set(
        childPivot[0] - parentPivot[0],
        childPivot[1] - parentPivot[1],
        childPivot[2] - parentPivot[2]
      );
      parentGroup.add(group);
    } else {
      // Root bone: position at its own absolute pivot (geometry was baked
      // relative to this same pivot in buildBoneMesh, so this places it
      // correctly without double-offsetting).
      const pivot = jsonBone.pivot || [0, 0, 0];
      group.position.set(...pivot);
      root.add(group);
    }
  }

  // Bedrock model units are 1/16 block; model space is x-mirrored relative
  // to world space (same convention prismarine-viewer's Entity.js uses).
  root.scale.set(-1 / 16, 1 / 16, 1 / 16);

  const bones = new Map();
  for (const [name, group] of groups) bones.set(name, group);

  return { root, bones };
}

// Ported verbatim from prismarine-viewer's viewer/lib/entities.js
// animateWalk, adapted to this module's bone Map instead of
// mesh.getObjectByName. `dt` is seconds; prismarine-viewer's `ticks` unit
// is dt/0.05 (its tick is 50ms).
export function animateWalk(bones, walkState, dt, moved) {
  const ticks = dt / 0.05;
  if (ticks === 0) return;

  const leftArm = bones.get('leftArm');
  const rightArm = bones.get('rightArm');
  const leftLeg = bones.get('leftLeg');
  const rightLeg = bones.get('rightLeg');
  if (!leftArm || !rightArm || !leftLeg || !rightLeg) return;

  const target = Math.min(1, moved / ticks * 4);
  walkState.speed += (target - walkState.speed) * (1 - Math.pow(0.6, ticks));
  walkState.pos += walkState.speed * ticks;

  const t = walkState.pos * 0.6662;
  const speed = walkState.speed;
  leftArm.rotation.set(-Math.cos(t) * speed, 0, 0);
  rightArm.rotation.set(-Math.cos(t + Math.PI) * speed, 0, 0);
  leftLeg.rotation.set(-Math.cos(t + Math.PI) * 1.4 * speed, -0.005, 0.005);
  rightLeg.rotation.set(-Math.cos(t) * 1.4 * speed, 0.005, -0.005);
}
