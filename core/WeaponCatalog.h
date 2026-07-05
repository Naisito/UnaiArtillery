// ============================================================================
//  WeaponCatalog.h  —  Real-world weapon & munition definitions.
//
//  Each entry is authored from publicly documented, unclassified figures
//  (caliber, projectile mass, published muzzle velocity, nominal max range).
//  The drag curves are engineering approximations tuned so the RK4 solver
//  reproduces the published max range at optimal quadrant elevation; for a
//  production build you would replace them with the official firing-table
//  ballistic coefficients.
//
//  A "weapon" pairs a platform (elevation/traverse limits, charge zones) with
//  one or more munitions. The WeaponSystem (fire control) consumes this.
// ============================================================================
#pragma once
#include "Munition.h"
#include <string>
#include <vector>

namespace ua {

// A propellant "charge" (zone) simply scales muzzle velocity. Guns and mortars
// fire the same shell at different velocities depending on the charge loaded.
struct ChargeZone {
    std::string name;
    double muzzleVelocity; // m/s for this charge
};

struct Weapon {
    std::string name;
    std::string category;      // "Mortar" | "Howitzer" | "Rocket" | "Missile"
    double minElevationDeg;    // quadrant elevation limits
    double maxElevationDeg;
    double traverseDeg;        // total traverse without re-laying the platform
    double reloadTime;         // s between rounds (rough)
    Munition round;            // the projectile
    std::vector<ChargeZone> charges; // firing zones (empty => single fixed vel)
};

class WeaponCatalog {
public:
    // ---- Light/medium mortar: 120 mm -----------------------------------
    // ~13 kg bomb, low velocity, high-angle only, ~7-8 km with top charge.
    static Weapon Mortar120() {
        Munition m;
        m.name = "120mm HE Bomb";
        m.mass = 13.0;
        m.diameter = 0.120;
        m.muzzleVelocity = 318.0;
        m.warheadMassTNTeq = 2.9;
        // Fin-stabilized bomb: higher subsonic drag, transonic peak.
        m.dragCurve = {{0.0,0.14},{0.6,0.15},{0.9,0.22},{1.0,0.40},
                       {1.2,0.38},{1.5,0.33},{2.0,0.30}};
        Weapon w;
        w.name = "120mm Heavy Mortar";
        w.category = "Mortar";
        w.minElevationDeg = 45.0;   // mortars are high-angle weapons
        w.maxElevationDeg = 85.0;
        w.traverseDeg = 12.0;
        w.reloadTime = 4.0;
        w.round = m;
        w.charges = {{"Charge 0", 110.0}, {"Charge 2", 190.0},
                     {"Charge 4", 265.0}, {"Charge 6 (max)", 318.0}};
        return w;
    }

    // ---- Field howitzer: M777 155 mm -----------------------------------
    // M107 HE ~43.2 kg, Charge 8 muzzle ~684 m/s, ~24 km max range.
    static Weapon M777() {
        Munition m;
        m.name = "M107 155mm HE";
        m.mass = 43.2;
        m.diameter = 0.155;
        m.muzzleVelocity = 684.0;
        m.warheadMassTNTeq = 6.6;
        // Tuned so RK4 reproduces the M107's published ~24 km at QE ~45 deg.
        m.dragCurve = {{0.0,0.10},{0.7,0.11},{0.9,0.15},{1.0,0.28},
                       {1.2,0.26},{2.0,0.21},{3.0,0.18}};
        Weapon w;
        w.name = "M777 155mm Howitzer";
        w.category = "Howitzer";
        w.minElevationDeg = 0.0;
        w.maxElevationDeg = 71.7;
        w.traverseDeg = 45.0;
        w.reloadTime = 8.0;
        w.round = m;
        w.charges = {{"Charge 3", 310.0}, {"Charge 5", 470.0},
                     {"Charge 7", 585.0}, {"Charge 8 (max)", 684.0}};
        return w;
    }

    // ---- Rocket artillery: HIMARS / GMLRS (M31) ------------------------
    // 227 mm guided rocket, ~307 kg launch, solid motor, ~70+ km range.
    // Modeled with a thrust phase then unpowered ballistic flight.
    static Weapon HIMARS_GMLRS() {
        Munition m;
        m.name = "GMLRS M31 227mm";
        m.mass = 307.0;                 // launch mass incl. propellant
        m.diameter = 0.227;
        m.muzzleVelocity = 35.0;        // leaves the tube slowly, then accelerates
        m.warheadMassTNTeq = 40.0;      // ~90 kg class unitary warhead
        m.dragCurve = {{0.0,0.20},{0.8,0.22},{1.0,0.45},{1.5,0.40},
                       {2.5,0.34},{4.0,0.30}};
        m.motor.enabled = true;
        m.motor.thrust = 66000.0;       // N (approx sustained), tuned to ~70 km
        m.motor.burnTime = 4.5;         // s
        m.motor.propellantMass = 98.0;  // kg expelled during burn
        Weapon w;
        w.name = "HIMARS / GMLRS";
        w.category = "Rocket";
        w.minElevationDeg = 25.0;
        w.maxElevationDeg = 60.0;
        w.traverseDeg = 360.0;
        w.reloadTime = 3.0;             // ripple fire between rockets
        w.round = m;
        w.charges = {}; // rocket: fixed motor, no charge zones
        return w;
    }

    // ---- Tactical ballistic missile (ATACMS-class) ---------------------
    // Large solid rocket, steep ballistic arc, ~300 km class.
    static Weapon TacticalMissile() {
        Munition m;
        m.name = "Tactical Ballistic Missile";
        m.mass = 1670.0;
        m.diameter = 0.610;
        m.muzzleVelocity = 25.0;
        m.warheadMassTNTeq = 230.0;
        m.dragCurve = {{0.0,0.18},{0.9,0.20},{1.0,0.42},{2.0,0.32},
                       {4.0,0.26},{6.0,0.22}};
        m.motor.enabled = true;
        m.motor.thrust = 350000.0;
        m.motor.burnTime = 18.0;
        m.motor.propellantMass = 900.0;
        Weapon w;
        w.name = "Tactical Ballistic Missile";
        w.category = "Missile";
        w.minElevationDeg = 30.0;
        w.maxElevationDeg = 80.0;
        w.traverseDeg = 360.0;
        w.reloadTime = 20.0;
        w.round = m;
        w.charges = {};
        return w;
    }

    static std::vector<Weapon> all() {
        return { Mortar120(), M777(), HIMARS_GMLRS(), TacticalMissile() };
    }
};

} // namespace ua
