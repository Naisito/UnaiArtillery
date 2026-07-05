// ============================================================================
//  WeaponSystem.h  —  Fire-control / weapon controller.
//
//  Sits between the UI and the solver. Responsibilities:
//    * Convert an (azimuth, elevation, muzzle velocity) lay into an ENU launch
//      velocity vector.
//    * Fire a round: build the initial state and run the RK4 solver.
//    * Solve the inverse problem: find the quadrant elevation that lands a
//      given munition on a target at range R. With aerodynamic drag there is
//      no closed form, so we bracket + bisect on the range-vs-elevation curve
//      (which is monotonic on each side of the ~45 deg maximum).
//    * Enforce platform limits (elevation, charge selection).
//
//  This is intentionally engine-agnostic; the Unreal AArtilleryPiece just
//  forwards user input here and renders whatever FlightResult comes back.
// ============================================================================
#pragma once
#include "Atmosphere.h"
#include "BallisticsSolver.h"
#include "WeaponCatalog.h"
#include <cmath>
#include <optional>

namespace ua {

struct FireOrder {
    double azimuthDeg   = 0.0;   // compass bearing to aim (0 = North, 90 = East)
    double elevationDeg = 45.0;  // quadrant elevation
    int    chargeIndex  = -1;    // index into Weapon.charges (-1 => round default)
};

struct SolveResult {
    bool   found = false;
    double elevationDeg = 0.0;
    double timeOfFlight = 0.0;
    double impactSpeed  = 0.0;
    bool   usedHighAngle = false;
};

class WeaponSystem {
public:
    WeaponSystem(const Atmosphere& atmo, const SolverConfig& cfg)
        : atmo_(atmo), cfg_(cfg), solver_(atmo, cfg) {}

    // Effective muzzle velocity for a fire order (charge zone or round default).
    static double muzzleVelocity(const Weapon& w, const FireOrder& order) {
        if (order.chargeIndex >= 0 &&
            order.chargeIndex < static_cast<int>(w.charges.size())) {
            return w.charges[order.chargeIndex].muzzleVelocity;
        }
        return w.round.muzzleVelocity;
    }

    // Build an ENU launch velocity from azimuth + elevation + speed.
    // azimuth: 0 = +North(+y), 90 = +East(+x). elevation above horizon.
    static Vec3 launchVelocity(double azimuthDeg, double elevationDeg, double speed) {
        const double az = azimuthDeg * M_PI / 180.0;
        const double el = elevationDeg * M_PI / 180.0;
        const double horiz = speed * std::cos(el);
        return Vec3{ horiz * std::sin(az),   // East
                     horiz * std::cos(az),   // North
                     speed * std::sin(el) }; // Up
    }

    // Fire a round according to an order; returns the full trajectory.
    FlightResult fire(const Weapon& w, const Vec3& muzzlePos,
                      const FireOrder& order) const {
        const double v0 = muzzleVelocity(w, order);
        const double el = clampElevation(w, order.elevationDeg);
        const Vec3 v = launchVelocity(order.azimuthDeg, el, v0);
        return solver_.integrate(w.round, muzzlePos, v);
    }

    // Ground range achieved for a given elevation (helper for the solver).
    double rangeForElevation(const Weapon& w, const Vec3& muzzlePos,
                             double azimuthDeg, double v0, double elDeg) const {
        const Vec3 v = launchVelocity(azimuthDeg, elDeg, v0);
        return solver_.integrate(w.round, muzzlePos, v).downrange;
    }

    // Inverse problem: find quadrant elevation to hit target at ground range R.
    // `preferHighAngle` picks the steep solution (mortar-style) when both the
    // low (direct-fire) and high (plunging) solutions exist.
    SolveResult solveForRange(const Weapon& w, const Vec3& muzzlePos,
                              double targetRange, double azimuthDeg,
                              int chargeIndex, bool preferHighAngle) const {
        FireOrder probe; probe.chargeIndex = chargeIndex;
        const double v0 = muzzleVelocity(w, probe);

        // Sweep elevation to find the range curve and locate the maximum.
        const double lo = w.minElevationDeg, hi = w.maxElevationDeg;
        const int N = 90;
        double bestEl = lo, bestRange = -1.0;
        std::vector<std::pair<double,double>> curve; // (el, range)
        for (int i = 0; i <= N; ++i) {
            const double el = lo + (hi - lo) * i / N;
            const double r = rangeForElevation(w, muzzlePos, azimuthDeg, v0, el);
            curve.emplace_back(el, r);
            if (r > bestRange) { bestRange = r; bestEl = el; }
        }
        if (targetRange > bestRange) return {}; // out of reach with this charge

        // Two monotonic branches around bestEl. Bisect the requested one.
        auto bisect = [&](double a, double b) -> std::optional<double> {
            double ra = rangeForElevation(w, muzzlePos, azimuthDeg, v0, a) - targetRange;
            for (int it = 0; it < 60; ++it) {
                const double mid = 0.5 * (a + b);
                const double rm = rangeForElevation(w, muzzlePos, azimuthDeg, v0, mid) - targetRange;
                if (std::fabs(rm) < 0.5) return mid; // within 0.5 m
                if ((ra < 0) == (rm < 0)) { a = mid; ra = rm; }
                else b = mid;
            }
            return 0.5 * (a + b);
        };

        std::optional<double> sol;
        if (preferHighAngle) sol = bisect(hi, bestEl);        // steep branch
        else                 sol = bisect(lo, bestEl);        // shallow branch
        if (!sol) return {};

        SolveResult sr;
        FireOrder ord; ord.azimuthDeg = azimuthDeg; ord.elevationDeg = *sol;
        ord.chargeIndex = chargeIndex;
        const FlightResult fr = fire(w, muzzlePos, ord);
        sr.found = true;
        sr.elevationDeg = *sol;
        sr.timeOfFlight = fr.timeOfFlight;
        sr.impactSpeed  = fr.impactSpeed;
        sr.usedHighAngle = preferHighAngle;
        return sr;
    }

    static double clampElevation(const Weapon& w, double el) {
        if (el < w.minElevationDeg) return w.minElevationDeg;
        if (el > w.maxElevationDeg) return w.maxElevationDeg;
        return el;
    }

private:
    const Atmosphere& atmo_;
    SolverConfig      cfg_;
    BallisticsSolver  solver_;
};

} // namespace ua
