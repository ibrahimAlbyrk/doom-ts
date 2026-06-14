// FROZEN CONTRACT — 2D vector type + pure math helpers.
// Plain {x,y} objects (struct-of-entities friendly); functions never allocate
// unless they return a new Vec2, and the `*Into` variants write to an out param
// for hot loops.

export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = {
  create(x = 0, y = 0): Vec2 {
    return { x, y };
  },

  clone(v: Vec2): Vec2 {
    return { x: v.x, y: v.y };
  },

  set(out: Vec2, x: number, y: number): Vec2 {
    out.x = x;
    out.y = y;
    return out;
  },

  add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  scale(v: Vec2, s: number): Vec2 {
    return { x: v.x * s, y: v.y * s };
  },

  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },

  /** 2D cross product (z component) — sign gives turn direction. */
  cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
  },

  lengthSq(v: Vec2): number {
    return v.x * v.x + v.y * v.y;
  },

  length(v: Vec2): number {
    return Math.hypot(v.x, v.y);
  },

  distanceSq(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  },

  distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  },

  normalize(v: Vec2): Vec2 {
    const len = Math.hypot(v.x, v.y);
    return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
  },

  /** Rotate by `rad` radians (CCW). */
  rotate(v: Vec2, rad: number): Vec2 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  },

  /** Angle of the vector in radians, [-PI, PI]. */
  angle(v: Vec2): number {
    return Math.atan2(v.y, v.x);
  },

  /** Unit vector for an angle in radians. */
  fromAngle(rad: number, len = 1): Vec2 {
    return { x: Math.cos(rad) * len, y: Math.sin(rad) * len };
  },

  lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  },
};
