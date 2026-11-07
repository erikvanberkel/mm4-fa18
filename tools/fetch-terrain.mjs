// Downloads and caches Mapzen/AWS "terrarium" elevation tiles for the Bay Area,
// composing them into a single Int16 raster at .cache/dem.bin (metres, north-up).
// Data: AWS Open Data Terrain Tiles (USGS NED/3DEP, SRTM, ETOPO1, NOAA). Build-time only.
import fs from 'node:fs';
import { PNG } from 'pngjs';

export const BBOX = { west: -123.25, east: -121.55, south: 37.0, north: 38.35 };
const Z = 11;
const CACHE = new URL('../.cache/', import.meta.url);

const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};
export const x2lon = (x) => (x / 2 ** Z) * 360 - 180;
export const y2lat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** Z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

async function getTile(x, y) {
  const f = new URL(`tiles/${Z}_${x}_${y}.png`, CACHE);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(f, buf);
      return buf;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('failed ' + url);
}

export async function loadDem() {
  const x0 = Math.floor(lon2x(BBOX.west)), x1 = Math.floor(lon2x(BBOX.east));
  const y0 = Math.floor(lat2y(BBOX.north)), y1 = Math.floor(lat2y(BBOX.south));
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const W = tw * 256, H = th * 256;
  const dem = new Int16Array(W * H);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  let done = 0;
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.shift();
      const png = PNG.sync.read(await getTile(tx, ty));
      const ox = (tx - x0) * 256, oy = (ty - y0) * 256;
      for (let py = 0; py < 256; py++)
        for (let px = 0; px < 256; px++) {
          const i = (py * 256 + px) * 4;
          const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          dem[(oy + py) * W + ox + px] = Math.max(-32000, Math.min(32000, Math.round(h)));
        }
      done++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  // Pixel (px,py) -> lon/lat helpers
  const pxLon = (px) => x2lon(x0 + px / 256);
  const pyLat = (py) => y2lat(y0 + py / 256);
  console.log(`DEM ${W}x${H} from ${done} tiles at z${Z}`);
  return { dem, W, H, pxLon, pyLat };
}

if (process.argv[1] && process.argv[1].endsWith('fetch-terrain.mjs')) {
  const { dem, W, H } = await loadDem();
  let min = 1e9, max = -1e9;
  for (const v of dem) { if (v < min) min = v; if (v > max) max = v; }
  console.log('elev range', min, max);
  const out = new PNG({ width: W / 2 | 0, height: H / 2 | 0 });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const h = dem[y * 2 * W + x * 2];
      const i = (y * out.width + x) * 4;
      if (h <= 0) { out.data[i] = 0; out.data[i + 1] = Math.max(30, 110 + h * 2); out.data[i + 2] = Math.max(70, 170 + h * 2); }
      else { const g = Math.min(255, 40 + h * 0.4); out.data[i] = g; out.data[i + 1] = Math.min(255, 90 + h * 0.3); out.data[i + 2] = g * 0.5; }
      out.data[i + 3] = 255;
    }
  fs.writeFileSync(new URL('dem-preview.png', CACHE), PNG.sync.write(out));
  console.log('wrote preview', out.width, out.height);
}
