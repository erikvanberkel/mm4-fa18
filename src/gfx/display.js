// Presents the indexed framebuffer on screen with NO interpolation of any kind.
//
//  - The picture is always scaled by whole numbers (every game pixel becomes the same kx x ky
//    block of screen pixels), chosen to fit the window with the pixel shape closest to a 4:3 tube.
//  - The canvas fills the window and its backing store is sized to the exact device-pixel size the
//    browser will blit (devicePixelContentBoxSize), so the compositor never resamples it. The picture
//    is centred with an integer viewport inside it, never by moving the canvas by a fraction of a pixel.
//  - The shader picks exact texel centres and the texture filter is NEAREST as a second guard.
//  - Without WebGL, the picture is scaled by hand in JavaScript, also nearest-neighbour.
//
// Optional scanlines darken the lower part of each game-pixel row with a hard edge. That is shading,
// not interpolation: no colour is ever blended with its neighbour.

const VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv=vec2(p.x*.5+.5, .5-p.y*.5); gl_Position=vec4(p,0.,1.); }';
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 srcSize;
uniform float mode;   // 0 = pixels, 1 = pixels with scanlines
void main(){
  vec2 centre = (floor(uv * srcSize) + 0.5) / srcSize;
  vec3 col = texture2D(tex, centre).rgb;
  if (mode > 0.5) {
    float row = fract(uv.y * srcSize.y);
    if (row > 0.66) col *= 0.6;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Chooses whole-number scale factors for a window of Wd x Hd device pixels.
// Returns { kx, ky, w, h, integer }. `integer` is false only for windows too small for a clean fit.
export function pickScale(Wd, Hd, SW = 320, SH = 256) {
  const SLACK = 1.02;                       // let the picture overshoot by 2% rather than lose a whole step
  const target = (4 / 3) / (SW / SH);      // pixel width/height ratio that makes the picture 4:3 (1.0667)
  const fitH = Math.min(Hd, Math.floor((Wd * 3) / 4));
  for (let ky = Math.floor((Hd / SH) * SLACK); ky >= 1; ky--) {
    let best = 0, bestErr = Infinity;
    for (const kx of [ky, ky + 1]) {
      if (SW * kx > Wd * SLACK) continue;
      const err = Math.abs(kx / ky - target);
      if (err < bestErr) { bestErr = err; best = kx; }
    }
    if (!best) continue;
    // A whole-number fit that wastes more than half the window falls through to the fractional case.
    if (SH * ky < fitH * 0.5) break;
    return { kx: best, ky, w: SW * best, h: SH * ky, integer: true };
  }
  // Tiny window: nearest-neighbour at a fractional size is the only way to show the whole picture.
  const s = Math.max(0.25, Math.min(Wd / SW, Hd / SH));
  return { kx: s, ky: s, w: Math.max(1, Math.floor(SW * s)), h: Math.max(1, Math.floor(SH * s)), integer: false };
}

export class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 0;
    this.gl = null;
    this.rgba = null;
    this.srcW = 320;
    this.srcH = 256;
    this.bw = 0;            // canvas backing store, in device pixels
    this.bh = 0;
    this.devW = 0;          // exact device-pixel size reported by the browser, when it tells us
    this.devH = 0;
    this.scale = { kx: 1, ky: 1, w: 320, h: 256, integer: true };
    this.view = { x: 0, y: 0, w: 320, h: 256 };
    try {
      this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch { this.gl = null; }
    if (this.gl) {
      try { this._initGL(); } catch (err) { console.warn('WebGL setup failed, using a 2D canvas:', err); this.gl = null; }
    }
    if (!this.gl) this.ctx = canvas.getContext('2d');
    // The canvas always fills the window (see index.html), so it never sits at a fractional position.
    canvas.style.imageRendering = 'pixelated';
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1];
        const dp = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
        if (dp) { this.devW = dp.inlineSize; this.devH = dp.blockSize; } else { this.devW = 0; this.devH = 0; }
        this.layout();
      });
      try { this.ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { this.ro.observe(canvas); }
    }
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  cycleMode() { this.mode = (this.mode + 1) % 2; }

  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.disable(gl.DITHER);
    this.uSrc = gl.getUniformLocation(prog, 'srcSize');
    this.uMode = gl.getUniformLocation(prog, 'mode');
    this.texW = 0;
    this.texH = 0;
  }

  // Sizes the backing store to the window in device pixels and works out where the picture sits in it.
  layout() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const estW = Math.round((c.clientWidth || window.innerWidth) * dpr);
    const estH = Math.round((c.clientHeight || window.innerHeight) * dpr);
    // Use the browser's exact device-pixel size when it agrees with CSS size x pixel ratio (it can
    // differ by a pixel when the product is fractional). If it disagrees wildly, distrust it.
    const exact = this.devW && Math.abs(this.devW - estW) <= 1 && Math.abs(this.devH - estH) <= 1;
    const bw = Math.max(1, exact ? this.devW : estW);
    const bh = Math.max(1, exact ? this.devH : estH);
    if (bw !== this.bw || bh !== this.bh) { c.width = bw; c.height = bh; this.bw = bw; this.bh = bh; this.out = null; }
    const s = pickScale(bw, bh, this.srcW, this.srcH);
    this.scale = s;
    this.view = { x: Math.round((bw - s.w) / 2), y: Math.round((bh - s.h) / 2), w: s.w, h: s.h };
    this._colMap = null;
    this.dirty = true;
  }

  present(gfx) {
    if (gfx.W !== this.srcW || gfx.H !== this.srcH || !this.rgba) {
      const changed = gfx.W !== this.srcW || gfx.H !== this.srcH;
      this.srcW = gfx.W; this.srcH = gfx.H;
      this.bytes = new Uint8Array(gfx.W * gfx.H * 4);
      this.rgba = new Uint32Array(this.bytes.buffer);
      if (changed) this.layout();
    }
    gfx.writeRGBA(this.rgba);
    if (this.gl) this._presentGL(gfx); else this._present2D(gfx);
  }

  _presentGL(gfx) {
    const gl = this.gl, v = this.view;
    if (this.texW !== gfx.W || this.texH !== gfx.H) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gfx.W, gfx.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.texW = gfx.W; this.texH = gfx.H;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gfx.W, gfx.H, gl.RGBA, gl.UNSIGNED_BYTE, this.bytes);
    // black everywhere, then the picture in an integer-sized, integer-positioned viewport
    gl.viewport(0, 0, this.bw, this.bh);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(v.x, v.y, v.w, v.h);
    gl.uniform2f(this.uSrc, gfx.W, gfx.H);
    gl.uniform1f(this.uMode, this.mode);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // No WebGL: scale by hand, nearest-neighbour, straight into a window-sized image.
  _present2D(gfx) {
    const { bw, bh, view: v } = this;
    if (!this.out) {
      this.out = new ImageData(bw, bh);
      this.out32 = new Uint32Array(this.out.data.buffer);
      this.out32.fill(0xff000000);
      this.dirty = true;
    }
    if (!this._colMap || this._colMap.length !== v.w) {
      this._colMap = new Int32Array(v.w);
      for (let x = 0; x < v.w; x++) this._colMap[x] = Math.min(gfx.W - 1, Math.floor((x * gfx.W) / v.w));
    }
    const out = this.out32, src = this.rgba, col = this._colMap;
    const shade = this.mode === 1;
    let prevSrcRow = -1, prevDestRow = -1;
    for (let y = 0; y < v.h; y++) {
      const dy = v.y + y;
      if (dy < 0 || dy >= bh) continue;
      const sy = Math.min(gfx.H - 1, Math.floor((y * gfx.H) / v.h));
      const base = dy * bw + v.x;
      const dark = shade && ((y * gfx.H) / v.h) % 1 > 0.66;
      if (sy === prevSrcRow && prevDestRow >= 0 && !shade) {
        out.copyWithin(base, prevDestRow * bw + v.x, prevDestRow * bw + v.x + v.w); // same game-pixel row: copy
      } else {
        const srow = sy * gfx.W;
        for (let x = 0; x < v.w; x++) {
          const px = src[srow + col[x]];
          const dx = v.x + x;
          if (dx < 0 || dx >= bw) continue;
          out[dy * bw + dx] = dark ? (0xff000000 | ((((px >> 16) & 255) * 0.6) << 16) | ((((px >> 8) & 255) * 0.6) << 8) | ((px & 255) * 0.6)) : px;
        }
      }
      prevSrcRow = sy; prevDestRow = dy;
    }
    this.ctx.putImageData(this.out, 0, 0);
  }
}
