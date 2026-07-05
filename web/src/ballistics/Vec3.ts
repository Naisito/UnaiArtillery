// ============================================================================
//  Vec3.ts — Minimal double-precision 3D vector for the ballistics core.
//
//  1:1 port of core/Vec3.h. JS numbers ARE IEEE-754 doubles, so arithmetic
//  matches the C++ core bit-for-bit as long as operation order is preserved.
//
//  Coordinate convention used across the physics core:
//      x = East   (m)
//      y = North  (m)
//      z = Up     (m)   (gravity points toward -z)
// ============================================================================

export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  add(o: Vec3): Vec3 { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o: Vec3): Vec3 { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s: number): Vec3 { return new Vec3(this.x * s, this.y * s, this.z * s); }
  div(s: number): Vec3 { return new Vec3(this.x / s, this.y / s, this.z / s); }
  neg(): Vec3 { return new Vec3(-this.x, -this.y, -this.z); }

  dot(o: Vec3): number { return this.x * o.x + this.y * o.y + this.z * o.z; }

  cross(o: Vec3): Vec3 {
    return new Vec3(
      this.y * o.z - this.z * o.y,
      this.z * o.x - this.x * o.z,
      this.x * o.y - this.y * o.x,
    );
  }

  lengthSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length(): number { return Math.sqrt(this.lengthSq()); }

  normalized(): Vec3 {
    const len = this.length();
    return len > 1e-12 ? this.div(len) : new Vec3(0, 0, 0);
  }

  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
}
