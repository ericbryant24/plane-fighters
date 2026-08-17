export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;

/** Wrap an x coordinate into [0, w). */
export function wrapX(x, w) {
  const m = x % w;
  return m < 0 ? m + w : m;
}

/** Shortest signed delta from a to b on a ring of circumference w. */
export function ringDelta(a, b, w) {
  let d = (b - a) % w;
  if (d > w / 2) d -= w;
  if (d < -w / 2) d += w;
  return d;
}

/** Shortest signed angular delta from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}
