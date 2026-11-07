// Every vehicle in the game, modelled by hand to true scale (metres).
// Object axes: +X right wing, +Y up, +Z forward.
import { MeshBuilder } from './mesh.js';
import { RAMP, C } from './palette.js';

const ring6 = (z, w, top, bot) => [[-w, 0.1 * top, z], [-w * 0.55, top, z], [w * 0.55, top, z], [w, 0.1 * top, z], [w * 0.6, bot, z], [-w * 0.6, bot, z]];

function addGear(m, noseZ, mainZ, mainX, h) {
  const tag = 'gear';
  const dark = RAMP.dark;
  const wheel = (x, z, r) => {
    m.poly([[x - 0.14, -h, z - r], [x + 0.14, -h, z - r], [x + 0.14, -h, z + r], [x - 0.14, -h, z + r]], C.BLACK, { tag });
    m.poly([[x, -h - 0.02, z - r], [x, -h + r * 1.4, z - r * 0.7], [x, -h + r * 1.4, z + r * 0.7], [x, -h - 0.02, z + r]], C.G1, { tag });
  };
  const strut = (x, z, top) => {
    m.poly([[x - 0.09, top, z], [x + 0.09, top, z], [x + 0.09, -h + 0.2, z], [x - 0.09, -h + 0.2, z]], dark, { tag });
    m.poly([[x, top, z - 0.1], [x, top, z + 0.1], [x, -h + 0.2, z + 0.1], [x, -h + 0.2, z - 0.1]], dark, { tag });
  };
  strut(0, noseZ, -0.4); wheel(0, noseZ, 0.34);
  strut(mainX, mainZ, -0.45); wheel(mainX, mainZ, 0.45);
  strut(-mainX, mainZ, -0.45); wheel(-mainX, mainZ, 0.45);
}

// Tagged station stores, so missiles vanish from the rails when fired.
function addMissile(m, x, y, z, len, tag, rampBody = RAMP.light) {
  const w = 0.09;
  m.poly([[x - w, y, z - len / 2], [x + w, y, z - len / 2], [x + w, y, z + len / 2], [x - w, y, z + len / 2]], rampBody, { tag });
  m.poly([[x, y - w, z - len / 2], [x, y + w, z - len / 2], [x, y + w, z + len / 2], [x, y - w, z + len / 2]], rampBody, { tag });
  m.poly([[x - 0.32, y, z - len / 2], [x + 0.32, y, z - len / 2], [x, y, z - len / 2 + 0.5]], rampBody, { tag });
}

function flame(m, x, y, z, w, tag = 'ab') {
  // Two crossed fire sheets, as in the original's blazing rectangles.
  m.poly([[x - w, y, z], [x + w, y, z], [x, y, z - 3.4]], C.ORANGE, { tag });
  m.poly([[x, y - w, z], [x, y + w, z], [x, y, z - 3.4]], C.YELLOW, { tag });
  m.poly([[x - w * 0.5, y, z], [x + w * 0.5, y, z], [x, y, z - 2.0]], C.PALE, { tag, bias: 0.001 });
}

// ---------------- F/A-18 Hornet: 17.1 m long, 12.3 m span, twin canted fins ----------------
export function buildHornet() {
  const m = new MeshBuilder();
  const skin = RAMP.grey;
  const sect = [
    ring6(8.7, 0.03, 0.02, -0.02),
    ring6(6.4, 0.42, 0.34, -0.42),
    ring6(4.2, 0.62, 0.58, -0.6),
    ring6(1.4, 1.02, 0.68, -0.72),
    ring6(-2.2, 1.55, 0.66, -0.8),
    ring6(-6.2, 1.45, 0.58, -0.6),
    ring6(-8.3, 1.0, 0.42, -0.42),
  ];
  m.loft(sect, skin);
  m.poly(sect[sect.length - 1], C.G1);
  // Canopy
  const can = RAMP.dark;
  m.poly([[-0.42, 0.56, 4.7], [0.42, 0.56, 4.7], [0.32, 1.02, 3.3], [-0.32, 1.02, 3.3]], C.BLUE_D, { bias: 0.002 });
  m.poly([[-0.32, 1.02, 3.3], [0.32, 1.02, 3.3], [0.28, 0.98, 1.6], [-0.28, 0.98, 1.6]], can, { bias: 0.002 });
  m.poly([[-0.42, 0.56, 4.7], [-0.32, 1.02, 3.3], [-0.28, 0.98, 1.6], [-0.62, 0.62, 1.2]], C.BLUE_D, { bias: 0.002 });
  m.poly([[0.42, 0.56, 4.7], [0.32, 1.02, 3.3], [0.28, 0.98, 1.6], [0.62, 0.62, 1.2]], C.BLUE_D, { bias: 0.002 });
  m.poly([[-0.28, 0.98, 1.6], [0.28, 0.98, 1.6], [0.52, 0.67, -0.6], [-0.52, 0.67, -0.6]], skin);
  // LEX and wings
  m.polyM([[0.55, 0.08, 4.6], [1.5, 0.05, 0.4], [1.2, 0.05, -1.5], [0.8, 0.1, 1.4]], skin);
  m.polyM([[1.25, 0.02, 0.6], [6.15, -0.1, -3.9], [6.15, -0.1, -5.0], [1.4, 0.02, -5.1]], skin);
  // Horizontal stabilators
  m.polyM([[1.15, -0.1, -5.8], [3.35, -0.25, -8.1], [3.35, -0.25, -9.0], [1.15, -0.1, -8.1]], skin);
  // Twin vertical fins, canted 20 degrees outward
  m.polyM([[1.1, 0.55, -3.7], [2.35, 3.05, -6.3], [2.35, 3.05, -7.4], [1.1, 0.55, -7.0]], skin);
  // Engine intakes
  m.polyM([[0.75, -0.72, -0.4], [1.65, -0.72, -0.4], [1.65, -1.1, -0.1], [0.75, -1.1, -0.1]], C.BLACK);
  m.polyM([[0.75, -1.1, -0.1], [1.65, -1.1, -0.1], [1.45, -0.85, -3.5], [0.75, -0.85, -3.5]], skin);
  m.polyM([[1.65, -0.72, -0.4], [1.65, -1.1, -0.1], [1.45, -0.85, -3.5], [1.5, -0.6, -3.5]], skin);
  // Nozzles
  m.cylZ = null;
  const nozzle = (x) => {
    const r = 0.5, z0 = -8.0, z1 = -8.9, y = -0.08;
    const a = [], b = [];
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      a.push([x + Math.cos(t) * r, y + Math.sin(t) * r, z0]);
      b.push([x + Math.cos(t) * r * 0.85, y + Math.sin(t) * r * 0.85, z1]);
    }
    m.loft([a, b], RAMP.dark);
    m.poly(b, C.BLACK, { bias: 0.001 });
    flame(m, x, y, z1, 0.5);
  };
  nozzle(0.62); nozzle(-0.62);
  // Stores
  addMissile(m, 6.2, -0.1, -4.2, 2.9, 'store0'); // wingtip Sidewinders
  addMissile(m, -6.2, -0.1, -4.2, 2.9, 'store1');
  addMissile(m, 3.9, -0.42, -3.1, 3.7, 'store2'); // AMRAAMs
  addMissile(m, -3.9, -0.42, -3.1, 3.7, 'store3');
  addMissile(m, 1.4, -1.16, -1.8, 3.7, 'store4');
  addMissile(m, -1.4, -1.16, -1.8, 3.7, 'store5');
  addGear(m, 5.2, -1.6, 1.55, 2.25);
  // Tail hook
  m.poly([[-0.08, -0.6, -6.5], [0.08, -0.6, -6.5], [0.08, -2.2, -8.8], [-0.08, -2.2, -8.8]], C.G8, { tag: 'hook' });
  return m.build();
}

// ---------------- F-16 Falcon: 15 m long, 9.45 m span, single fin ----------------
export function buildFalcon() {
  const m = new MeshBuilder();
  const skin = RAMP.grey;
  m.loft([
    ring6(7.4, 0.02, 0.01, -0.01),
    ring6(5.3, 0.36, 0.32, -0.34),
    ring6(3.3, 0.52, 0.5, -0.5),
    ring6(0.6, 0.72, 0.6, -0.62),
    ring6(-3.6, 0.85, 0.58, -0.62),
    ring6(-6.8, 0.56, 0.44, -0.44),
  ], skin);
  // Chin intake
  m.loft([
    [[-0.5, -0.45, 2.6], [0.5, -0.45, 2.6], [0.5, -1.1, 2.9], [-0.5, -1.1, 2.9]],
    [[-0.5, -0.45, -1.6], [0.5, -0.45, -1.6], [0.5, -0.95, -1.6], [-0.5, -0.95, -1.6]],
  ], skin);
  m.poly([[-0.5, -0.45, 2.6], [0.5, -0.45, 2.6], [0.5, -1.1, 2.9], [-0.5, -1.1, 2.9]], C.BLACK, { bias: 0.002 });
  // Bubble canopy
  m.poly([[-0.34, 0.5, 4.2], [0.34, 0.5, 4.2], [0.2, 1.08, 2.4], [-0.2, 1.08, 2.4]], C.BLUE_D, { bias: 0.002 });
  m.poly([[-0.2, 1.08, 2.4], [0.2, 1.08, 2.4], [0.2, 1.0, 1.2], [-0.2, 1.0, 1.2]], RAMP.dark, { bias: 0.002 });
  m.polyM([[0.34, 0.5, 4.2], [0.2, 1.08, 2.4], [0.2, 1.0, 1.2], [0.55, 0.55, 1.2]], C.BLUE_D, { bias: 0.002 });
  // Cropped delta wing with strake
  m.polyM([[0.5, 0.0, 3.2], [0.9, 0.0, -0.4], [0.72, 0.0, 0.8]], skin);
  m.polyM([[0.75, 0.0, 0.6], [4.75, -0.04, -2.9], [4.75, -0.04, -3.6], [0.85, 0.0, -3.9]], skin);
  // Tailplane
  m.polyM([[0.72, -0.05, -3.9], [2.9, -0.2, -6.4], [2.9, -0.2, -7.1], [0.55, -0.05, -6.3]], skin);
  // Fin
  m.poly([[0, 0.5, -2.6], [0, 3.55, -5.5], [0, 3.55, -6.5], [0, 0.45, -5.9]], skin);
  // Nozzle
  const a = [], b = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    a.push([Math.cos(t) * 0.58, Math.sin(t) * 0.46, -6.8]);
    b.push([Math.cos(t) * 0.46, Math.sin(t) * 0.42, -7.6]);
  }
  m.loft([a, b], RAMP.dark);
  m.poly(b, C.BLACK, { bias: 0.001 });
  flame(m, 0, 0, -7.6, 0.55);
  addMissile(m, 4.8, -0.04, -3.0, 2.9, 'store0');
  addMissile(m, -4.8, -0.04, -3.0, 2.9, 'store1');
  addMissile(m, 3.0, -0.4, -2.2, 3.7, 'store2');
  addMissile(m, -3.0, -0.4, -2.2, 3.7, 'store3');
  addMissile(m, 2.0, -0.4, -2.0, 3.7, 'store4');
  addMissile(m, -2.0, -0.4, -2.0, 3.7, 'store5');
  addGear(m, 3.2, -1.2, 1.2, 1.75);
  m.poly([[-0.08, -0.5, -5.0], [0.08, -0.5, -5.0], [0.08, -1.6, -7.0], [-0.08, -1.6, -7.0]], C.G8, { tag: 'hook' });
  return m.build();
}

// ---------------- MiG-29 Fulcrum: 17.3 m long, 11.4 m span, separated engine nacelles ----------------
export function buildMig() {
  const m = new MeshBuilder();
  const skin = [C.G2, C.G3, C.G4, C.G5, C.G6, C.G7];
  m.loft([
    ring6(9.0, 0.02, 0.01, -0.01),
    ring6(6.3, 0.33, 0.3, -0.3),
    ring6(3.9, 0.56, 0.58, -0.45),
    ring6(1.0, 0.62, 0.55, -0.4),
    ring6(-3.0, 0.55, 0.42, -0.24),
  ], skin);
  // Canopy
  m.poly([[-0.34, 0.5, 4.8], [0.34, 0.5, 4.8], [0.22, 0.98, 3.3], [-0.22, 0.98, 3.3]], C.BLACK, { bias: 0.002 });
  m.polyM([[0.34, 0.5, 4.8], [0.22, 0.98, 3.3], [0.22, 0.86, 2.0], [0.55, 0.55, 2.0]], C.BLACK, { bias: 0.002 });
  // Blended centre body
  m.polyM([[0.3, 0.1, 4.4], [2.2, 0.0, 0.8], [2.4, 0.0, -2.4], [0.55, 0.3, -2.4]], skin);
  // Wings
  m.polyM([[2.0, 0.0, 0.8], [5.7, -0.08, -2.5], [5.7, -0.08, -3.4], [2.2, 0.0, -3.5]], skin);
  // Nacelles
  const nacelle = (x) => {
    const pts = (z, w, h) => [[x - w, -0.1, z], [x, -0.1 + h, z], [x + w, -0.1, z], [x + w * 0.7, -0.1 - h, z], [x - w * 0.7, -0.1 - h, z]];
    m.loft([pts(1.0, 0.56, 0.5), pts(-4.5, 0.62, 0.55), pts(-7.5, 0.52, 0.5), pts(-8.5, 0.42, 0.4)], skin);
    m.poly(pts(1.0, 0.56, 0.5), C.BLACK, { bias: 0.002 });
    m.poly(pts(-8.5, 0.42, 0.4), C.G1, { bias: 0.001 });
    flame(m, x, -0.1, -8.5, 0.42);
  };
  nacelle(1.3); nacelle(-1.3);
  // Stabilators
  m.polyM([[1.5, -0.05, -5.5], [3.75, -0.12, -8.0], [3.75, -0.12, -8.8], [1.5, -0.05, -7.6]], skin);
  // Twin fins with red flash
  m.polyM([[1.85, 0.3, -3.8], [2.15, 2.85, -6.4], [2.15, 2.85, -7.6], [1.85, 0.3, -7.0]], skin);
  m.polyM([[2.0, 1.5, -5.4], [2.1, 2.35, -6.2], [2.1, 2.35, -6.9], [2.0, 1.5, -6.3]], C.RED, { bias: 0.002 });
  addMissile(m, 4.2, -0.5, -1.8, 2.9, 'store0', RAMP.grey);
  addMissile(m, -4.2, -0.5, -1.8, 2.9, 'store1', RAMP.grey);
  return m.build();
}

// ---------------- Boeing 707 family: 46.6 m long, 44.4 m span ----------------
export function build707(airForceOne = false) {
  const m = new MeshBuilder();
  const top = airForceOne ? RAMP.light : RAMP.light;
  const lower = airForceOne ? RAMP.blue : RAMP.grey;
  const fuse = (z, r) => {
    const o = [];
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
      o.push([Math.cos(t) * r, Math.sin(t) * r, z]);
    }
    return o;
  };
  const rampFor = (i) => (i >= 4 ? lower : top); // Lower half of the eight-sided hull
  m.loft([fuse(23.6, 0.05), fuse(21, 1.4), fuse(17.5, 1.95), fuse(-14, 1.95), fuse(-20, 1.2), fuse(-23, 0.2)], top, { rampFor });
  // Cockpit windows and cheatline
  m.poly([[-1.15, 1.05, 20.7], [1.15, 1.05, 20.7], [0.9, 1.5, 19.6], [-0.9, 1.5, 19.6]], C.BLACK, { bias: 0.003 });
  if (airForceOne) {
    m.polyM([[1.97, 0.1, 17], [1.97, 0.75, 17], [1.97, 0.75, -14], [1.97, 0.1, -14]], C.BLUE_L, { bias: 0.003 });
  }
  // Swept wing
  const wr = airForceOne ? RAMP.light : RAMP.grey;
  m.polyM([[1.7, -0.9, 5.5], [22.2, 1.0, -8.4], [22.2, 1.0, -10.0], [8.6, -0.3, -6], [1.7, -0.9, -5.6]], wr);
  // Tailplane and fin
  m.polyM([[1.0, 0.4, -16.6], [7.8, 1.1, -21.8], [7.8, 1.1, -23.2], [1.0, 0.4, -20]], wr);
  m.poly([[0, 1.7, -13.5], [0, 12.4, -21.4], [0, 12.4, -23.6], [0, 1.2, -20.8]], airForceOne ? RAMP.blue : RAMP.grey);
  // Four engines on pylons
  const eng = (x, z, y) => {
    const r = 0.95;
    const ring = (zz, rr) => {
      const o = [];
      for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; o.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr, zz]); }
      return o;
    };
    m.loft([ring(z + 2.2, r * 0.95), ring(z, r), ring(z - 2.3, r * 0.65)], RAMP.grey);
    m.poly(ring(z + 2.2, r * 0.95), C.BLACK, { bias: 0.002 });
    m.poly([[x, y + r * 0.7, z + 0.5], [x, y + 1.9, z - 2.0], [x, y + 1.9, z - 3.6], [x, y + r * 0.6, z - 1.8]], RAMP.grey);
  };
  eng(8.0, 1.2, -2.3); eng(-8.0, 1.2, -2.3); eng(14.0, -2.7, -1.3); eng(-14.0, -2.7, -1.3);
  addGear(m, 17.5, -2.5, 3.5, 3.6);
  return m.build();
}

// ---------------- Air-launched missiles, flares, and small things ----------------
export function buildMissile(length, color = RAMP.light) {
  const m = new MeshBuilder();
  const w = 0.12;
  m.poly([[-w, 0, -length / 2], [w, 0, -length / 2], [w, 0, length / 2], [-w, 0, length / 2]], color);
  m.poly([[0, -w, -length / 2], [0, w, -length / 2], [0, w, length / 2], [0, -w, length / 2]], color);
  m.poly([[-0.42, 0, -length / 2], [0.42, 0, -length / 2], [0, 0, -length / 2 + 0.62]], color);
  m.poly([[0, -0.42, -length / 2], [0, 0.42, -length / 2], [0, 0, -length / 2 + 0.62]], color);
  m.poly([[-0.28, 0, length * 0.3], [0.28, 0, length * 0.3], [0, 0, length * 0.3 - 0.4]], color);
  m.poly([[0, -0.28, length * 0.3], [0, 0.28, length * 0.3], [0, 0, length * 0.3 - 0.4]], color);
  return m.build();
}

// Tomahawk-sized sea-skimmer, with stub wings and a small tail flame.
export function buildCruiseMissile() {
  const m = new MeshBuilder();
  const skin = RAMP.grey;
  const ring = (z, r) => {
    const o = [];
    for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; o.push([Math.cos(t) * r, Math.sin(t) * r, z]); }
    return o;
  };
  m.loft([ring(3.0, 0.05), ring(2.2, 0.27), ring(-2.8, 0.27), ring(-3.0, 0.18)], skin);
  m.polyM([[0.25, 0, 0.5], [1.4, 0, -0.1], [1.4, 0, -0.4], [0.25, 0, -0.2]], skin);
  m.polyM([[0.2, 0, -2.1], [0.6, 0, -2.6], [0.6, 0, -2.8], [0.2, 0, -2.7]], skin);
  m.poly([[0, 0.2, -2.1], [0, 0.65, -2.6], [0, 0.65, -2.8], [0, 0.2, -2.7]], skin);
  m.poly([[-0.15, 0, -3.0], [0.15, 0, -3.0], [0, 0, -4.4]], C.YELLOW);
  return m.build();
}

export function buildParachute() {
  const m = new MeshBuilder();
  const r0 = 3.2, y = 6.0;
  const top = [];
  const low = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    top.push([Math.cos(t) * r0 * 0.5, y + 1.2, Math.sin(t) * r0 * 0.5]);
    low.push([Math.cos(t) * r0, y, Math.sin(t) * r0]);
  }
  m.poly(top, C.G10);
  m.loft([top, low], [C.RED_L, C.G10, C.WHITE], { rampFor: (i) => (i % 2 ? [C.RED_L] : [C.G10]) });
  for (const p of low) m.line([0, 0.7, 0], p, C.G8);
  m.box(0, 0.3, 0, 0.5, 1.2, 0.4, RAMP.dark);
  return m.build();
}

export function buildCanopy() {
  const m = new MeshBuilder();
  m.poly([[-0.45, 0, 1.4], [0.45, 0, 1.4], [0.45, 0, -1.4], [-0.45, 0, -1.4]], C.BLUE_D);
  m.poly([[-0.45, 0, 1.4], [0, 0.45, 0], [0.45, 0, 1.4]], C.G8);
  return m.build();
}

export function buildRaft() {
  const m = new MeshBuilder();
  const o = [];
  for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; o.push([Math.cos(t) * 1.6, Math.sin(t) * 1.6]); }
  m.prismXZ(o, 0, 0.5, [C.ORANGE], [C.YELLOW]);
  m.box(0, 0.8, 0, 0.5, 0.8, 0.5, RAMP.dark);
  m.line([0, 0.6, 0], [0, 4, 0], C.G9);
  m.point([0, 4, 0], C.RED_L);
  return m.build();
}

export function buildPod() {
  const m = new MeshBuilder();
  m.box(0, 0, 0, 0.8, 0.8, 2.4, [C.ORANGE], [C.YELLOW]);
  return m.build();
}

// Small debris plate for explosions.
export function buildShard() {
  const m = new MeshBuilder();
  m.poly([[-1.2, 0, -0.8], [1.2, 0, -0.4], [0.2, 0, 1.2]], RAMP.grey);
  return m.build();
}

// Parked-jet silhouette for the carrier deck.
export function addParkedJet(m, x, y, z, heading, ramp = RAMP.grey) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const P = (a, h, b) => [x + a * c + b * s, y + h, z - a * s + b * c];
  m.poly([P(-0.8, 1, 8), P(0.8, 1, 8), P(1.4, 1, -7), P(-1.4, 1, -7)], ramp);
  m.poly([P(-5.5, 0.9, -3), P(0, 0.9, 1), P(5.5, 0.9, -3), P(5.5, 0.9, -4.5), P(-5.5, 0.9, -4.5)], ramp);
  m.poly([P(-1.3, 1, -4.5), P(-2.2, 3.3, -6.5), P(-2.2, 3.3, -7.3), P(-1.3, 1, -7)], ramp);
  m.poly([P(1.3, 1, -4.5), P(2.2, 3.3, -6.5), P(2.2, 3.3, -7.3), P(1.3, 1, -7)], ramp);
}

// The carrier. Local axes: +Z bow, +X starboard. Deck height is sea level + DECK_Y.
export const DECK_Y = 19;
export const ANGLE_DEG = 9;
export const LANDING = {
  // Centreline of the angled landing deck, ramp to forward end, in ship coordinates.
  from: [-4, -162],
  dir: [-Math.sin((ANGLE_DEG * Math.PI) / 180), Math.cos((ANGLE_DEG * Math.PI) / 180)],
  length: 250,
  wires: [52, 66, 80, 94], // metres up the deck from the ramp
  halfWidth: 17,
};
export const CATAPULT = { x: 8, z0: 44, z1: 154 }; // bow catapult 1: a 110 m stroke, as on a real carrier

export const DECK_OUTLINE = [
  [-14, 166], [12, 166], [30, 110], [38, 30], [38, -148], [26, -166], [-24, -166], [-36, -128], [-54, -35], [-58, 40], [-38, 66], [-27, 118],
];
export function buildCarrier(enemy = false) {
  const m = new MeshBuilder();
  const deckColor = enemy ? C.G1 : C.G2;
  const y = DECK_Y;
  m.poly(DECK_OUTLINE.map(([x, z]) => [x, y, z]), deckColor);
  // Hull: slab sides sweep in from the deck edge to the waterline.
  const hullWater = [[-4, 158], [4, 158], [22, 90], [28, 20], [28, -140], [20, -158], [-20, -158], [-28, -140], [-28, 20], [-22, 90]];
  const hullRamp = RAMP.dark;
  const deckAt = [[-14, 166], [12, 166], [30, 110], [38, 30], [38, -148], [26, -166], [-24, -166], [-36, -128], [-40, 30], [-27, 118]];
  for (let i = 0; i < hullWater.length; i++) {
    const j = (i + 1) % hullWater.length;
    m.poly([[hullWater[i][0], 0, hullWater[i][1]], [hullWater[j][0], 0, hullWater[j][1]], [deckAt[j][0], y - 1, deckAt[j][1]], [deckAt[i][0], y - 1, deckAt[i][1]]], hullRamp);
  }
  // The angled-deck sponson's underside
  m.poly([[-36, y - 1, -128], [-54, y - 1, -35], [-58, y - 1, 40], [-38, y - 1, 66], [-27, y - 1, 118], [-28, y - 11, 20]], C.G1);
  if (!enemy) {
    // Island and mast
    m.box(32, y + 10, 8, 8, 20, 36, RAMP.grey, RAMP.grey);
    m.box(32, y + 23, 2, 6, 6, 14, RAMP.grey, RAMP.grey);
    m.box(32, y + 27, 2, 8, 2, 8, [C.G3], [C.G3]);
    m.line([32, y + 26, 2], [32, y + 46, 2], C.G7);
    m.line([28, y + 40, 2], [36, y + 40, 2], C.G7);
    m.line([29, y + 36, 2], [35, y + 36, 2], C.G7);
    m.line([32, y + 33, 9], [32, y + 41, 2], C.G6);
  }
  // Deck markings
  const dx = LANDING.dir[0], dz = LANDING.dir[1];
  const [lx, lz] = LANDING.from;
  const nx = dz, nz = -dx;
  const lineCol = C.G9;
  const onDeck = (a, b) => [lx + dx * a + nx * b, y + 0.15, lz + dz * a + nz * b];
  m.line(onDeck(0, -LANDING.halfWidth), onDeck(LANDING.length, -LANDING.halfWidth), lineCol);
  m.line(onDeck(0, LANDING.halfWidth), onDeck(LANDING.length, LANDING.halfWidth), lineCol);
  for (let a = 8; a < LANDING.length; a += 18) m.poly([onDeck(a, -0.6), onDeck(a, 0.6), onDeck(a + 8, 0.6), onDeck(a + 8, -0.6)], C.G8, { bias: 0.002 });
  // Arresting wires
  for (const w of LANDING.wires) m.line(onDeck(w, -LANDING.halfWidth + 2), onDeck(w, LANDING.halfWidth - 2), C.G10);
  // Ramp stripes
  m.line([-22, y + 0.15, -165], [24, y + 0.15, -165], C.YELLOW);
  // Catapult tracks
  m.line([CATAPULT.x, y + 0.15, CATAPULT.z0], [CATAPULT.x, y + 0.15, CATAPULT.z1], C.G7);
  m.line([-8, y + 0.15, 12], [-8, y + 0.15, 150], C.G7);
  m.line([-30, y + 0.15, -26], [-22, y + 0.15, 88], C.G6);
  // Parked aircraft forward and aft of the island
  if (!enemy) {
    const pr = RAMP.grey;
    addParkedJet(m, 30, y, 52, 2.5, pr);
    addParkedJet(m, 25, y, 74, 2.5, pr);
    addParkedJet(m, 30, y, -38, 0.6, pr);
    addParkedJet(m, 30, y, -60, 0.6, pr);
    addParkedJet(m, 30, y, -84, 0.6, pr);
    addParkedJet(m, 22, y, -112, 0.4, pr);
    // Fresnel lens (the "meatball"), port side of the deck
    m.box(-40, y + 1.5, -66, 1.5, 3, 1.5, [C.G4], [C.G4]);
  } else {
    // Enemy conning sail and launch rails
    m.box(20, y + 6, -4, 10, 12, 40, RAMP.dark);
    m.box(20, y + 14, -4, 3, 6, 10, RAMP.dark);
    m.poly([[-6, y + 0.2, -20], [6, y + 0.2, -20], [6, y + 0.2, 20], [-6, y + 0.2, 20]], C.RED_D, { bias: 0.002 });
  }
  return m.build();
}

export function buildAll() {
  return {
    F18: buildHornet(),
    F16: buildFalcon(),
    MIG: buildMig(),
    B707: build707(false),
    AF1: build707(true),
    AIM9: buildMissile(2.9),
    AIM120: buildMissile(3.7),
    ENEMYMSL: buildMissile(3.5, RAMP.grey),
    CRUISE: buildCruiseMissile(),
    CHUTE: buildParachute(),
    CANOPY: buildCanopy(),
    RAFT: buildRaft(),
    POD: buildPod(),
    SHARD: buildShard(),
    CARRIER: buildCarrier(false),
    SUBCARRIER: buildCarrier(true),
  };
}
