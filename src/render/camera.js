// Camera construction. A camera is an orthonormal basis plus a position:
//   r = screen right, u = screen up, f = view direction (all world space).

// The world is left-handed: X east, Y up, Z north. Looking north, right is east, so
// right = up x forward and the camera's up = forward x right. (The mirror-image formulas flip
// the whole picture left-to-right, which is how the external views once came out.)
export function makeCamera(x, y, z, f, up = [0, 1, 0]) {
  let [fx, fy, fz] = f;
  let l = Math.hypot(fx, fy, fz) || 1;
  fx /= l; fy /= l; fz /= l;
  let rx = up[1] * fz - up[2] * fy, ry = up[2] * fx - up[0] * fz, rz = up[0] * fy - up[1] * fx;
  l = Math.hypot(rx, ry, rz);
  if (l < 1e-6) { rx = 1; ry = 0; rz = 0; l = 1; } // looking straight up or down
  rx /= l; ry /= l; rz /= l;
  const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
  return { x, y, z, rx, ry, rz, ux, uy, uz, fx, fy, fz, zoom: 1, near: 1 };
}

// Cockpit camera: sits at the pilot's eye in the jet's own frame, with head look.
// look: {yaw, pitch} in radians relative to the nose.
export function cockpitCamera(jet, look = null) {
  const sp = jet.spec;
  const ex = jet.x + jet.fx * sp.eyeZ + jet.ux * sp.eyeY;
  const ey = jet.y + jet.fy * sp.eyeZ + jet.uy * sp.eyeY;
  const ez = jet.z + jet.fz * sp.eyeZ + jet.uz * sp.eyeY;
  let fx = jet.fx, fy = jet.fy, fz = jet.fz, rx = jet.rx, ry = jet.ry, rz = jet.rz, ux = jet.ux, uy = jet.uy, uz = jet.uz;
  if (look && (look.yaw || look.pitch)) {
    const cy = Math.cos(look.yaw), sy = Math.sin(look.yaw);
    let nfx = fx * cy + rx * sy, nfy = fy * cy + ry * sy, nfz = fz * cy + rz * sy;
    let nrx = rx * cy - fx * sy, nry = ry * cy - fy * sy, nrz = rz * cy - fz * sy;
    fx = nfx; fy = nfy; fz = nfz; rx = nrx; ry = nry; rz = nrz;
    const cp = Math.cos(look.pitch), sp2 = Math.sin(look.pitch);
    nfx = fx * cp + ux * sp2; nfy = fy * cp + uy * sp2; nfz = fz * cp + uz * sp2;
    const nux = ux * cp - fx * sp2, nuy = uy * cp - fy * sp2, nuz = uz * cp - fz * sp2;
    fx = nfx; fy = nfy; fz = nfz; ux = nux; uy = nuy; uz = nuz;
  }
  return { x: ex, y: ey, z: ez, rx, ry, rz, ux, uy, uz, fx, fy, fz, zoom: 1, near: 0.6 };
}

// Orbiting external camera around a target. azimuth is relative to the target's heading.
export function orbitCamera(target, dist, azimuth, elevation, zoom = 1) {
  const h = Math.atan2(target.fx, target.fz) + azimuth;
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  const x = target.x - Math.sin(h) * ce * dist;
  const y = target.y + se * dist;
  const z = target.z - Math.cos(h) * ce * dist;
  const cam = makeCamera(x, y, z, [target.x - x, target.y - y, target.z - z]);
  cam.zoom = zoom;
  cam.near = 1;
  return cam;
}

// Fixed-position camera that tracks a target, as the tower and "spotter plane" views do.
export function trackingCamera(pos, target, zoom = 1) {
  const cam = makeCamera(pos[0], pos[1], pos[2], [target.x - pos[0], target.y - pos[1], target.z - pos[2]]);
  cam.zoom = zoom;
  cam.near = 1;
  return cam;
}
