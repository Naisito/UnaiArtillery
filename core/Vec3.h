// ============================================================================
//  Vec3.h  —  Minimal double-precision 3D vector for the ballistics core.
//
//  Engine-agnostic. Coordinate convention used across the physics core:
//      x = East   (m)
//      y = North  (m)
//      z = Up     (m)   (gravity points toward -z)
//
//  This maps cleanly onto a local ENU (East-North-Up) tangent frame anchored
//  at the battery position. The engine adapter (Unreal/Unity) is responsible
//  for converting ENU <-> engine world space (see docs/ARCHITECTURE.md).
// ============================================================================
#pragma once
#include <cmath>

// M_PI is a POSIX/GNU extension, not ISO C++. Provide it portably so the core
// compiles under strict -std=c++17 on MSVC/MinGW as well as GCC/Clang.
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace ua {

struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;

    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    Vec3  operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3  operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3  operator*(double s)      const { return {x * s, y * s, z * s}; }
    Vec3  operator/(double s)      const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3  operator-()              const { return {-x, -y, -z}; }

    double dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }

    Vec3 cross(const Vec3& o) const {
        return { y * o.z - z * o.y,
                 z * o.x - x * o.z,
                 x * o.y - y * o.x };
    }

    double lengthSq() const { return x * x + y * y + z * z; }
    double length()   const { return std::sqrt(lengthSq()); }

    Vec3 normalized() const {
        const double len = length();
        return (len > 1e-12) ? (*this / len) : Vec3{0, 0, 0};
    }
};

inline Vec3 operator*(double s, const Vec3& v) { return v * s; }

} // namespace ua
