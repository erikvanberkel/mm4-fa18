// The flight palette: 32 colours from the OCS 4096-colour space. Values were sampled from
// screenshots of the original, then filled out with the shade ramps the 3D scene needs.
const hex12 = (s) => [parseInt(s[0], 16) * 17, parseInt(s[1], 16) * 17, parseInt(s[2], 16) * 17];

const TABLE = [
  ['BLACK', '000'], ['G1', '111'], ['G2', '222'], ['G3', '333'], ['G4', '444'], ['G5', '555'], ['G6', '666'], ['G7', '777'],
  ['G8', '999'], ['G9', 'bbb'], ['G10', 'ddd'], ['WHITE', 'fff'],
  ['SKY', '447'], ['SEA', '036'], ['SEA2', '025'], ['LAND', '151'], ['LAND_D', '141'], ['LAND_DD', '030'], ['LAND_L', '262'], ['LAND_LL', '373'],
  ['DRY', '562'], ['GREEN', '2a2'], ['RED_D', '800'], ['RED', 'a20'], ['RED_L', 'd31'], ['ORANGE', 'e71'], ['YELLOW', 'fc3'], ['PALE', 'ffa'],
  ['BLUE_T', '55b'], ['BLUE_D', '225'], ['BLUE_L', '68d'], ['BROWN', '742'],
];

export const C = {};
TABLE.forEach(([name], i) => { C[name] = i; });

export const FLIGHT_PALETTE = TABLE.map(([, v]) => hex12(v));

// Shade ramps, darkest to lightest, indexed by lighting.
export const RAMP = {
  grey: [C.G2, C.G3, C.G4, C.G5, C.G6, C.G7, C.G8, C.G9, C.G10],
  light: [C.G5, C.G6, C.G7, C.G8, C.G9, C.G10, C.WHITE],
  dark: [C.BLACK, C.G1, C.G2, C.G3, C.G4],
  land: [C.LAND_DD, C.LAND_D, C.LAND, C.LAND_L, C.LAND_LL],
  high: [C.LAND_D, C.LAND, C.LAND_L, C.LAND_LL, C.DRY],
  urban: [C.G3, C.G4, C.G5, C.G6],
  red: [C.RED_D, C.RED, C.RED_L],
  orange: [C.RED, C.ORANGE, C.YELLOW],
  blue: [C.BLUE_D, C.BLUE_T, C.BLUE_L],
  brown: [C.BROWN, C.DRY],
  flat: [C.BLACK],
};

export function hexPalette(list) {
  return list.map((v) => (typeof v === 'string' ? hex12(v) : v));
}
