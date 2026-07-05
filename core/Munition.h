// ============================================================================
//  Munition.h  —  Physical description of a projectile / round.
//
//  This is the data-driven heart of the weapon catalog. Every field is a real,
//  measurable physical quantity so configurations can be authored from public
//  firing tables and manufacturer data. The solver consumes this verbatim.
//
//  Drag model
//  ----------
//  The user-supplied equation uses an explicit Cd and reference area A. Real
//  projectiles have a strongly Mach-dependent Cd (transonic drag rise). We
//  therefore store Cd as a small table Cd(Mach) and interpolate. Setting a
//  single-entry table reproduces the "constant Cd" case exactly.
// ============================================================================
#pragma once
#include <algorithm>
#include <string>
#include <vector>

namespace ua {

// One point of a drag curve: Cd measured at a given Mach number.
struct DragPoint { double mach; double cd; };

// Optional rocket-motor description (thrust phase for MLRS / tactical missiles).
struct RocketMotor {
    bool   enabled       = false;
    double thrust        = 0.0;   // N, along the velocity vector while burning
    double burnTime      = 0.0;   // s
    double propellantMass = 0.0;  // kg expelled linearly over burnTime
};

struct Munition {
    std::string name        = "Generic";
    double mass             = 43.2;    // kg (initial, incl. propellant if rocket)
    double diameter         = 0.155;   // m (caliber) -> reference area
    double muzzleVelocity   = 684.0;   // m/s at the gun (0 for pure rockets)

    // Mach-dependent drag. Ordered by ascending Mach. Values below/above the
    // table clamp to the end points. Defaults approximate a modern spin-
    // stabilized HE shell (G7-like: low subsonic drag, transonic peak, then
    // a slow supersonic decline).
    std::vector<DragPoint> dragCurve = {
        {0.0, 0.14}, {0.7, 0.15}, {0.9, 0.20}, {1.0, 0.36},
        {1.2, 0.34}, {2.0, 0.29}, {3.0, 0.26}, {5.0, 0.24}
    };

    RocketMotor motor;

    // Warhead / payload metadata (drives VFX & camera shake, not trajectory).
    double warheadMassTNTeq = 6.6;   // kg TNT-equivalent for explosion scaling
    double fuzeDelay        = 0.0;   // s after impact (0 = point detonation)

    // Cross-sectional reference area A = pi * (d/2)^2.
    double referenceArea() const {
        const double r = 0.5 * diameter;
        return 3.14159265358979323846 * r * r;
    }

    // Cd(Mach) with linear interpolation and end-point clamping.
    double dragCoefficient(double mach) const {
        if (dragCurve.empty()) return 0.30;
        if (mach <= dragCurve.front().mach) return dragCurve.front().cd;
        if (mach >= dragCurve.back().mach)  return dragCurve.back().cd;
        for (size_t i = 1; i < dragCurve.size(); ++i) {
            if (mach <= dragCurve[i].mach) {
                const DragPoint& a = dragCurve[i - 1];
                const DragPoint& b = dragCurve[i];
                const double t = (mach - a.mach) / (b.mach - a.mach);
                return a.cd + t * (b.cd - a.cd);
            }
        }
        return dragCurve.back().cd;
    }
};

} // namespace ua
