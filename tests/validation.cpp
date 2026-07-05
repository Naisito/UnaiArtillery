// ============================================================================
//  validation.cpp  —  Numerical regression / validation harness.
//
//  Builds and runs entirely on the engine-agnostic core. Verifies:
//    (1) Vacuum trajectory RK4 vs closed-form analytic solution.
//    (2) RK4 convergence order (halving dt ~ x16 error reduction).
//    (3) Published max ranges for the real weapon catalog.
//    (4) Crosswind deflection sign & magnitude.
//    (5) Fire-control inverse solve lands on the requested range.
//
//  Build:  g++ -std=c++17 -O2 -I core tests/validation.cpp -o build/validate
// ============================================================================
#include "../core/Atmosphere.h"
#include "../core/BallisticsSolver.h"
#include "../core/WeaponCatalog.h"
#include "../core/WeaponSystem.h"
#include <cmath>
#include <cstdio>

using namespace ua;

static int g_fail = 0;
static void check(const char* label, bool ok) {
    std::printf("   [%s] %s\n", ok ? "PASS" : "FAIL", label);
    if (!ok) ++g_fail;
}

// ---------------------------------------------------------------------------
static void test_vacuum() {
    std::printf("\n(1) Vacuum trajectory: RK4 vs analytic\n");
    Atmosphere atmo;
    SolverConfig cfg;
    cfg.dt = 0.001;
    cfg.enableCoriolis = false;
    cfg.gravity = {0, 0, -9.80665};
    BallisticsSolver solver(atmo, cfg);

    Munition m; // drag disabled below by zeroing density via a vacuum atmo
    m.dragCurve = {{0.0, 0.0}}; // Cd = 0 everywhere -> no drag term

    const double v0 = 300.0, elev = 40.0;
    const double g = 9.80665;
    const Vec3 v = WeaponSystem::launchVelocity(90.0 /*due East*/, elev, v0);
    FlightResult fr = solver.integrate(m, {0, 0, 0}, v);

    // Closed form (flat ground, launch z=0):
    const double el = elev * M_PI / 180.0;
    const double tof = 2.0 * v0 * std::sin(el) / g;
    const double range = v0 * v0 * std::sin(2 * el) / g;
    const double apex = (v0 * std::sin(el)) * (v0 * std::sin(el)) / (2 * g);

    std::printf("   analytic: range=%.3f m  tof=%.3f s  apex=%.3f m\n", range, tof, apex);
    std::printf("   RK4     : range=%.3f m  tof=%.3f s  apex=%.3f m\n",
                fr.downrange, fr.timeOfFlight, fr.apex);

    check("range within 0.05%",  std::fabs(fr.downrange - range) / range < 5e-4);
    check("time  within 0.05%",  std::fabs(fr.timeOfFlight - tof) / tof < 5e-4);
    check("apex  within 0.20%",  std::fabs(fr.apex - apex) / apex < 2e-3);
}

// ---------------------------------------------------------------------------
// Measure RK4 global error at a FIXED time on a NONLINEAR problem (full
// aerodynamic drag). In vacuum the acceleration is constant, so the ODE is
// linear and RK4 is exact to machine precision -- useless for gauging order.
// With drag the acceleration depends nonlinearly on velocity, so RK4 shows its
// true O(dt^4) global error. We compare against a fine-step reference solution.
static Vec3 dragStatePosition(double dt) {
    Atmosphere atmo; SolverConfig cfg;
    cfg.dt = dt; cfg.enableCoriolis = false;
    cfg.maxFlight = 15.0;          // stop mid-flight, before impact
    cfg.groundZ = -1e9;            // no ground impact during the window
    BallisticsSolver solver(atmo, cfg);
    Munition m = WeaponCatalog::M777().round; // real Mach-dependent drag
    Vec3 v = WeaponSystem::launchVelocity(90.0, 45.0, m.muzzleVelocity);
    return solver.integrate(m, {0, 0, 0}, v).impactPoint; // final state @ cap
}

static void test_convergence() {
    std::printf("\n(2) RK4 convergence order on a nonlinear (drag) problem\n");
    const Vec3 ref = dragStatePosition(0.0001); // reference "truth"
    const Vec3 p1 = dragStatePosition(0.02);
    const Vec3 p2 = dragStatePosition(0.01);
    const double e1 = (p1 - ref).length();
    const double e2 = (p2 - ref).length();
    const double ratio = e1 / (e2 + 1e-18);
    std::printf("   err(dt=0.020)=%.3e m  err(dt=0.010)=%.3e m  ratio=%.1fx\n",
                e1, e2, ratio);
    // 4th order => halving dt cuts error ~16x. Accept >10x as clear evidence
    // of high-order (not 1st/2nd-order) convergence.
    check("halving dt cuts error ~16x (>10x)", ratio > 10.0);
}

// ---------------------------------------------------------------------------
static double maxRange(const Weapon& w, int chargeIndex) {
    Atmosphere atmo; SolverConfig cfg;
    cfg.dt = 0.005; cfg.enableCoriolis = true; cfg.latitudeDeg = 40.0;
    WeaponSystem fc(atmo, cfg);
    FireOrder probe; probe.chargeIndex = chargeIndex;
    const double v0 = WeaponSystem::muzzleVelocity(w, probe);
    double best = 0.0;
    for (double el = w.minElevationDeg; el <= w.maxElevationDeg; el += 1.0)
        best = std::max(best, fc.rangeForElevation(w, {0,0,0}, 90.0, v0, el));
    return best;
}

static void test_real_ranges() {
    std::printf("\n(3) Published max ranges (order-of-magnitude validation)\n");
    Weapon mortar = WeaponCatalog::Mortar120();
    Weapon m777   = WeaponCatalog::M777();
    Weapon himars = WeaponCatalog::HIMARS_GMLRS();

    const double rM = maxRange(mortar, (int)mortar.charges.size() - 1);
    const double rH = maxRange(m777,   (int)m777.charges.size() - 1);
    const double rR = maxRange(himars, -1);
    std::printf("   120mm mortar (max charge): %.0f m   (published ~7000-8000 m)\n", rM);
    std::printf("   M777 155mm (Charge 8)    : %.0f m   (published ~24000 m)\n", rH);
    std::printf("   HIMARS GMLRS             : %.0f m   (published ~70000 m)\n", rR);

    check("mortar 120mm in 5.5-9 km",  rM > 5500 && rM < 9000);
    check("M777 in 20-28 km",          rH > 20000 && rH < 28000);
    check("GMLRS in 45-90 km",         rR > 45000 && rR < 90000);
}

// ---------------------------------------------------------------------------
static void test_wind() {
    std::printf("\n(4) Crosswind deflection\n");
    Atmosphere atmo;
    // Wind FROM the West (bearing 270) -> pushes an East-bound shell to +North?
    // FROM West means blowing toward East (+x). For an East-firing shell that's
    // a tailwind (extends range); a wind FROM South pushes the shell North.
    atmo.windField = [](const Vec3&, double){ return Atmosphere::steadyWind(15.0, 180.0); };
    SolverConfig cfg; cfg.dt = 0.005; cfg.enableCoriolis = false;
    BallisticsSolver solver(atmo, cfg);
    Weapon m777 = WeaponCatalog::M777();
    Vec3 v = WeaponSystem::launchVelocity(90.0, 45.0, m777.round.muzzleVelocity);
    FlightResult fr = solver.integrate(m777.round, {0,0,0}, v);
    std::printf("   impact North offset = %.1f m (wind FROM South, 15 m/s)\n",
                fr.impactPoint.y);
    check("south wind pushes shell north (+y)", fr.impactPoint.y > 5.0);
}

// ---------------------------------------------------------------------------
static void test_fire_control() {
    std::printf("\n(5) Fire-control inverse solve\n");
    Atmosphere atmo; SolverConfig cfg; cfg.dt = 0.005;
    WeaponSystem fc(atmo, cfg);
    Weapon m777 = WeaponCatalog::M777();
    const int charge = (int)m777.charges.size() - 1;
    const double target = 15000.0;

    SolveResult lo = fc.solveForRange(m777, {0,0,0}, target, 90.0, charge, false);
    SolveResult hi = fc.solveForRange(m777, {0,0,0}, target, 90.0, charge, true);
    std::printf("   target %.0f m -> low-angle QE=%.2f deg, high-angle QE=%.2f deg\n",
                target, lo.elevationDeg, hi.elevationDeg);

    // Fire the low-angle solution and confirm the impact range.
    FireOrder ord; ord.azimuthDeg = 90.0; ord.chargeIndex = charge;
    ord.elevationDeg = lo.elevationDeg;
    FlightResult fr = fc.fire(m777, {0,0,0}, ord);
    std::printf("   fired low-angle solution -> impact range %.1f m (err %.2f m)\n",
                fr.downrange, fr.downrange - target);

    check("low-angle solution found",  lo.found);
    check("high-angle solution found", hi.found);
    check("high angle steeper than low", hi.elevationDeg > lo.elevationDeg);
    check("impact within 2 m of target", std::fabs(fr.downrange - target) < 2.0);
}

// ---------------------------------------------------------------------------
int main() {
    std::printf("=========================================================\n");
    std::printf("  Unai Artillery — Ballistics Core Validation Harness\n");
    std::printf("=========================================================\n");
    test_vacuum();
    test_convergence();
    test_real_ranges();
    test_wind();
    test_fire_control();
    std::printf("\n---------------------------------------------------------\n");
    if (g_fail == 0) std::printf("  ALL CHECKS PASSED\n");
    else             std::printf("  %d CHECK(S) FAILED\n", g_fail);
    std::printf("=========================================================\n");
    return g_fail == 0 ? 0 : 1;
}
