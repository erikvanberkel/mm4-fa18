// Geographic reference data for the game world, all in real coordinates.
// Sources: OpenStreetMap (runways, bridges, buildings) and well known survey positions.
//
// World axes: +X = east, +Y = up, +Z = north, metres, origin near downtown San Francisco.

export const ORIGIN = { lat: 37.75, lon: -122.4 };
const M_PER_DEG_LAT = 110990;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toWorld = (lat, lon) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
export const toLatLon = (x, z) => [z / M_PER_DEG_LAT + ORIGIN.lat, x / M_PER_DEG_LON + ORIGIN.lon];

const rwy = (name, ident, lat1, lon1, lat2, lon2, width = 60) => ({ name, ident, a: toWorld(lat1, lon1), b: toWorld(lat2, lon2), width });

// Runway centrelines, end to end.
export const RUNWAYS = [
  rwy('SFO', '10L/28R', 37.62874, -122.3934, 37.61393, -122.35809),
  rwy('SFO', '10R/28L', 37.62628, -122.39309, 37.61209, -122.35926),
  rwy('SFO', '01R/19L', 37.60769, -122.38013, 37.62732, -122.36714),
  rwy('SFO', '01L/19R', 37.60946, -122.38191, 37.6265, -122.37062),
  rwy('OAK', '12/30', 37.7015, -122.21428, 37.72006, -122.24212),
  rwy('OAK', '10R/28L', 37.72872, -122.22592, 37.72228, -122.20604, 46),
  rwy('OAK', '10L/28R', 37.73046, -122.22218, 37.72485, -122.20484, 46),
  rwy('NAS ALAMEDA', '13/31', 37.79431, -122.32847, 37.77678, -122.31454),
  rwy('NAS ALAMEDA', '07/25', 37.79044, -122.3308, 37.79086, -122.30598),
  rwy('NAS MOFFETT', '14L/32R', 37.42888, -122.05458, 37.40555, -122.0426),
  rwy('NAS MOFFETT', '14R/32L', 37.42521, -122.05502, 37.40611, -122.0452),
  rwy('SJC', '12L/30R', 37.37229, -121.93724, 37.3575, -121.92102, 46),
  rwy('SJC', '12R/30L', 37.37104, -121.93906, 37.35624, -121.92284, 46),
  rwy('TRAVIS AFB', '03L/21R', 38.24331, -121.95697, 38.26365, -121.92867, 91),
  rwy('TRAVIS AFB', '03R/21L', 38.26147, -121.92653, 38.28181, -121.89819, 46),
  rwy('HAYWARD', '10R/28L', 37.66204, -122.12981, 37.65517, -122.11474, 46),
  rwy('NAPA', '01L/19R', 38.20798, -122.28529, 38.22321, -122.27798, 46),
  rwy('CONCORD', '01L/19R', 37.98196, -122.06134, 37.99302, -122.05525, 46),
  rwy('HALF MOON BAY', '12/30', 37.51846, -122.50707, 37.50843, -122.4953, 46),
  rwy('LIVERMORE', '07L/25R', 37.69393, -121.8294, 37.69379, -121.81124, 30),
];

// Primary bases named in the mission briefings; `rwy` indexes RUNWAYS, `from` is the starting end.
export const BASES = {
  SFO: { name: 'SFO', title: 'SAN FRANCISCO INTL', rwy: 0, startEnd: 'b', towerAt: toWorld(37.6172, -122.3852) },
  ALAMEDA: { name: 'NAS ALAMEDA', title: 'ALAMEDA NAVAL AIR STATION', rwy: 7, startEnd: 'b', towerAt: toWorld(37.7878, -122.3147) },
  MOFFETT: { name: 'NAS MOFFETT', title: 'MOFFETT FIELD NAS', rwy: 9, startEnd: 'b', towerAt: toWorld(37.4167, -122.0505) },
  OAK: { name: 'OAK', title: 'OAKLAND INTL', rwy: 4, startEnd: 'a', towerAt: toWorld(37.7195, -122.2155) },
};

// USS Enterprise holds station ~20 statute miles off the Golden Gate, as in the manual.
export const CARRIER_START = toWorld(37.775, -122.875);

export const LANDMARKS = {
  goldenGate: { s: toWorld(37.8081, -122.4765), n: toWorld(37.83225, -122.4808) },
  bayBridgeW: { a: toWorld(37.78611, -122.39084), b: toWorld(37.80899, -122.36624) },
  bayBridgeE: { a: toWorld(37.8121, -122.3612), b: toWorld(37.8255, -122.3035) },
  sanMateo: { a: toWorld(37.5729, -122.26313), b: toWorld(37.61671, -122.1557) },
  dumbarton: { a: toWorld(37.4979, -122.13), b: toWorld(37.5141, -122.1083) },
  richmond: { a: toWorld(37.9422, -122.4778), b: toWorld(37.9326, -122.4055) },
  carquinez: { a: toWorld(38.0522, -122.2262), b: toWorld(38.0655, -122.225) },
  transamerica: toWorld(37.79517, -122.40279),
  coit: toWorld(37.80238, -122.40583),
  sutro: toWorld(37.7552, -122.4528),
  alcatraz: toWorld(37.8267, -122.423),
  hangarOne: { c: toWorld(37.41295, -122.05397), heading: 338 },
  hoover: toWorld(37.4276, -122.167),
  campanile: toWorld(37.8721, -122.2578),
  diablo: toWorld(37.8817, -121.9142),
  bonita: toWorld(37.8156, -122.5295),
  farallon: toWorld(37.6994, -123.0017),
  farallonSouth: toWorld(37.6985, -123.0),
  tamDome: toWorld(37.924, -122.596),
  candlestick: toWorld(37.7135, -122.3862),
  coliseum: toWorld(37.7516, -122.2005),
  eaHq: toWorld(37.5642, -122.283), // Gateway Drive, San Mateo: the original's in-joke
  fortPoint: toWorld(37.8106, -122.4771),
  ferry: toWorld(37.7955, -122.3937),
};

// Hand-drawn land-use outlines (lat, lon), clipped to the real coastline by the world builder.
export const URBAN_OUTLINES = [
  // San Francisco + the whole Bay plain. Encloses water; intersecting with land removes it.
  [
    [37.815, -122.53], [37.815, -122.385], [37.84, -122.38], [37.92, -122.395], [37.975, -122.4], [38.035, -122.28],
    [38.035, -122.24], [37.96, -122.29], [37.89, -122.245], [37.8, -122.175], [37.72, -122.105], [37.63, -122.025],
    [37.55, -121.925], [37.45, -121.865], [37.38, -121.785], [37.3, -121.745], [37.235, -121.76], [37.195, -121.85],
    [37.245, -121.975], [37.315, -122.065], [37.4, -122.195], [37.47, -122.285], [37.55, -122.365], [37.63, -122.455],
    [37.665, -122.52], [37.7, -122.53],
  ],
  // Marin: Sausalito to Novato along the 101.
  [
    [37.845, -122.5], [37.875, -122.555], [37.94, -122.57], [37.985, -122.585], [38.07, -122.6], [38.125, -122.6],
    [38.125, -122.525], [38.03, -122.495], [37.96, -122.475], [37.9, -122.455], [37.85, -122.47],
  ],
  // Vallejo / Benicia
  [[38.165, -122.3], [38.165, -122.2], [38.065, -122.115], [38.035, -122.2], [38.08, -122.28]],
  // Walnut Creek / Concord / Tri-Valley
  [
    [38.03, -122.09], [38.03, -121.96], [37.96, -121.94], [37.88, -121.975], [37.82, -121.905], [37.67, -121.74],
    [37.635, -121.89], [37.7, -121.96], [37.8, -122.03], [37.9, -122.09],
  ],
  // Pittsburg / Antioch waterfront
  [[38.045, -121.94], [38.03, -121.74], [37.985, -121.74], [37.995, -121.94]],
  // Petaluma
  [[38.27, -122.68], [38.27, -122.6], [38.215, -122.6], [38.215, -122.67]],
  // Half Moon Bay / Pacifica
  [[37.66, -122.51], [37.66, -122.47], [37.58, -122.49], [37.58, -122.52]],
  [[37.51, -122.5], [37.51, -122.42], [37.44, -122.42], [37.44, -122.47]],
];

export const PARK_OUTLINES = [
  // Golden Gate Park
  [[37.7741, -122.5115], [37.7741, -122.4545], [37.7695, -122.4525], [37.7645, -122.454], [37.7641, -122.5115]],
  // Presidio
  [[37.8085, -122.482], [37.8055, -122.449], [37.788, -122.4475], [37.786, -122.485], [37.79, -122.513], [37.8, -122.5]],
  // Stanford foothills / Palo Alto Baylands reserve
  [[37.46, -122.14], [37.47, -122.09], [37.43, -122.07], [37.42, -122.12]],
];

// Darker concrete for the Financial District.
export const DOWNTOWN_OUTLINE = [
  [37.803, -122.409], [37.803, -122.393], [37.788, -122.387], [37.776, -122.393], [37.782, -122.413],
];

// Paved apron areas under the airfields, painted over land (or bay fill the DEM lacks).
export const APRONS = [
  [[37.6355, -122.4], [37.6325, -122.383], [37.6285, -122.37], [37.6115, -122.348], [37.602, -122.372], [37.6052, -122.385], [37.617, -122.399]],
  [[37.735, -122.232], [37.7335, -122.2], [37.7245, -122.19], [37.697, -122.206], [37.7135, -122.255], [37.7265, -122.236]],
  [[37.7985, -122.341], [37.7985, -122.298], [37.7735, -122.2985], [37.772, -122.335]],
  [[37.434, -122.066], [37.434, -122.048], [37.402, -122.033], [37.4, -122.055]],
  [[37.379, -121.945], [37.376, -121.925], [37.3515, -121.914], [37.353, -121.933]],
  [[38.3, -121.92], [38.29, -121.885], [38.25, -121.905], [38.235, -121.955], [38.25, -121.975]],
];

// Elevation is forced to zero around these points so aprons stay flat.
export const FLATTEN = [
  { at: toWorld(37.62, -122.375), r: 4500 },
  { at: toWorld(37.715, -122.22), r: 4500 },
  { at: toWorld(37.785, -122.32), r: 3500 },
  { at: toWorld(37.415, -122.05), r: 4000 },
  { at: toWorld(37.363, -121.93), r: 3000 },
  { at: toWorld(38.265, -121.93), r: 6000 },
  { at: toWorld(37.513, -122.5), r: 1500 },
  { at: toWorld(38.215, -122.28), r: 1800 },
  { at: toWorld(37.988, -122.057), r: 1800 },
  { at: toWorld(37.658, -122.122), r: 1500 },
  { at: toWorld(37.694, -121.82), r: 1500 },
];

export const CHECKPOINT_NAMES = [
  { name: 'GOLDEN GATE', at: LANDMARKS.fortPoint },
  { name: 'ALCATRAZ', at: LANDMARKS.alcatraz },
  { name: 'FARALLONES', at: LANDMARKS.farallon },
  { name: 'MT DIABLO', at: LANDMARKS.diablo },
  { name: 'MT TAM', at: LANDMARKS.tamDome },
];
