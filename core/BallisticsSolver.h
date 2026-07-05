// ============================================================================
//  BallisticsSolver.h  —  RK4 trajectory integrator (the simulator's heart).
//
//  Integrates the equation of motion supplied in the design brief:
//
//      m dv/dt = m*g  -  (1/2) * rho * Cd * A * |v - w| * (v - w)
//
//  plus two effects that matter for real long-range artillery and are cheap
//  to add to the same ODE:
//
//    * Coriolis acceleration  a_cor = -2 * (Omega x v)   (Earth rotation)
//    * Rocket thrust phase     +F_thrust * v_hat  with linear mass loss
//
//  Integration is classical 4th-order Runge-Kutta (RK4) on the first-order
//  state s = [position, velocity, mass]. RK4 gives O(dt^4) local accuracy,
//  which for a 1 ms step keeps a multi-second flight essentially exact (see
//  the vacuum regression test in tests/validation.cpp).
//
//  The solver is deterministic and engine-agnostic: give it a Munition, a
//  launch state, and an Atmosphere, and it returns the full sampled path.
// ============================================================================
#pragma once
#include "Atmosphere.h"
#include "Munition.h"
#include "Vec3.h"
#include <vector>

namespace ua {

// One integrated sample of the flight, handed to VFX / camera / logging.
struct TrajectorySample {
    double t;        // s since launch
    Vec3   position; // ENU meters
    Vec3   velocity; // m/s
    double mach;     // |v| / a(h)
    double mass;     // kg (changes during rocket burn)
    double drag;     // instantaneous drag force magnitude (N)
};

struct FlightResult {
    std::vector<TrajectorySample> path;
    Vec3   impactPoint{};
    double impactSpeed = 0.0;
    double timeOfFlight = 0.0;
    double apex = 0.0;         // max altitude reached (m)
    double maxMach = 0.0;
    double downrange = 0.0;    // horizontal distance launch->impact (m)
    bool   impacted = false;
};

struct SolverConfig {
    double dt          = 0.002;   // s, fixed integration step (RK4)
    double maxFlight   = 400.0;   // s, safety cap
    double groundZ     = 0.0;     // impact plane altitude (ENU z). A terrain
                                  // callback can override this per-step.
    bool   enableCoriolis = true;
    double latitudeDeg    = 40.0; // battery latitude (for Coriolis)
    Vec3   gravity        = {0.0, 0.0, -9.80665};
    int    sampleEvery    = 1;    // store 1 of every N steps (path decimation)

    // Optional terrain height query: given (east, north) return ground z (m).
    // When set, the solver detects impact against real topography instead of a
    // flat plane. Defaults to the flat groundZ plane.
    std::function<double(double east, double north)> terrainHeight;
};

class BallisticsSolver {
public:
    BallisticsSolver(const Atmosphere& atmo, const SolverConfig& cfg)
        : atmo_(atmo), cfg_(cfg) {
        // Earth angular velocity in the local ENU frame.
        // Omega_earth = 7.2921159e-5 rad/s. In ENU at latitude phi:
        //   Omega = |O| * (0, cos phi, sin phi)   (East, North, Up)
        const double O   = 7.2921159e-5;
        const double phi = cfg_.latitudeDeg * M_PI / 180.0;
        omega_ = Vec3{0.0, O * std::cos(phi), O * std::sin(phi)};
    }

    // Integrate a full trajectory from launch to impact (or time cap).
    FlightResult integrate(const Munition& round,
                           const Vec3& launchPos,
                           const Vec3& launchVel) const {
        FlightResult out;
        State s{launchPos, launchVel, round.mass};

        double t = 0.0;
        int step = 0;
        double prevGround = groundAt(s.pos);

        pushSample(out, round, s, t);

        const int maxSteps = static_cast<int>(cfg_.maxFlight / cfg_.dt);
        for (step = 0; step < maxSteps; ++step) {
            const State prev = s;
            const double prevZ = prev.pos.z;
            prevGround = groundAt(prev.pos);

            s = rk4Step(round, s, t, cfg_.dt);
            t += cfg_.dt;

            // Track apex / max Mach from the live state.
            out.apex = std::max(out.apex, s.pos.z);

            // Ground / terrain intersection between prev and current.
            // We only count a *descending* crossing (vel.z <= 0) as an impact.
            // This gate is what makes the launch boundary well-behaved: an
            // ascending shot starts exactly on the ground plane but moves up,
            // so it never false-triggers; a level/plunging shot from ground
            // level correctly registers a near-immediate impact.
            const double curGround = groundAt(s.pos);
            const bool wasAbove = (prevZ - prevGround) >= 0.0;
            const bool nowBelow = (s.pos.z - curGround) < 0.0;
            if (wasAbove && nowBelow && s.vel.z <= 0.0) {
                // Linear interpolation to the crossing for a clean impact point.
                const double f0 = prevZ - prevGround;
                const double f1 = s.pos.z - curGround;
                const double frac = f0 / (f0 - f1);
                State hit;
                hit.pos = prev.pos + (s.pos - prev.pos) * frac;
                hit.vel = prev.vel + (s.vel - prev.vel) * frac;
                hit.mass = s.mass;
                pushSample(out, round, hit, t - cfg_.dt + frac * cfg_.dt);
                out.impacted     = true;
                out.impactPoint  = hit.pos;
                out.impactSpeed  = hit.vel.length();
                out.timeOfFlight = t - cfg_.dt + frac * cfg_.dt;
                break;
            }

            if (step % cfg_.sampleEvery == 0) pushSample(out, round, s, t);
        }

        if (!out.impacted) { // hit time cap
            out.impactPoint  = s.pos;
            out.impactSpeed  = s.vel.length();
            out.timeOfFlight = t;
        }
        Vec3 horiz{out.impactPoint.x - launchPos.x,
                   out.impactPoint.y - launchPos.y, 0.0};
        out.downrange = horiz.length();
        for (const auto& p : out.path) out.maxMach = std::max(out.maxMach, p.mach);
        return out;
    }

private:
    struct State { Vec3 pos, vel; double mass; };

    const Atmosphere& atmo_;
    SolverConfig      cfg_;
    Vec3              omega_;

    double groundAt(const Vec3& p) const {
        return cfg_.terrainHeight ? cfg_.terrainHeight(p.x, p.y) : cfg_.groundZ;
    }

    // Time-derivative of the state: the physics live here.
    State derivative(const Munition& round, const State& s, double t) const {
        State d;
        d.pos = s.vel; // dx/dt = v

        const AtmoSample air = atmo_.sample(s.pos.z);
        const Vec3 wind = atmo_.windAt(s.pos, t);
        const Vec3 vRel = s.vel - wind;          // airspeed vector
        const double vRelMag = vRel.length();

        // --- Aerodynamic drag: -1/2 rho Cd A |vRel| vRel -----------------
        Vec3 aDrag{0, 0, 0};
        if (vRelMag > 1e-6 && air.density > 0.0) {
            const double mach = vRelMag / air.soundSpeed;
            const double Cd   = round.dragCoefficient(mach);
            const double A    = round.referenceArea();
            const double fMag = 0.5 * air.density * Cd * A * vRelMag; // scalar
            aDrag = (vRel * (-fMag * vRelMag)) / (vRelMag * s.mass);
            // = -(1/2 rho Cd A |vRel|) * vRel / m   (force / mass)
        }

        // --- Gravity ------------------------------------------------------
        const Vec3 aGrav = cfg_.gravity;

        // --- Coriolis: -2 (Omega x v) ------------------------------------
        Vec3 aCor{0, 0, 0};
        if (cfg_.enableCoriolis) aCor = omega_.cross(s.vel) * (-2.0);

        // --- Rocket thrust (optional, along velocity) --------------------
        Vec3 aThrust{0, 0, 0};
        double dmdt = 0.0;
        if (round.motor.enabled && t < round.motor.burnTime && s.mass > 0.0) {
            const Vec3 dir = (vRelMag > 1e-6) ? s.vel.normalized()
                                              : Vec3{0, 0, 1};
            aThrust = dir * (round.motor.thrust / s.mass);
            dmdt = -round.motor.propellantMass / round.motor.burnTime;
        }

        d.vel  = aGrav + aDrag + aCor + aThrust;
        d.mass = dmdt;
        return d;
    }

    // Classical RK4 over the compound state.
    State rk4Step(const Munition& round, const State& s, double t, double dt) const {
        const State k1 = derivative(round, s, t);
        const State k2 = derivative(round, add(s, k1, dt * 0.5), t + dt * 0.5);
        const State k3 = derivative(round, add(s, k2, dt * 0.5), t + dt * 0.5);
        const State k4 = derivative(round, add(s, k3, dt),       t + dt);

        State out;
        out.pos  = s.pos  + (k1.pos  + k2.pos * 2 + k3.pos * 2 + k4.pos)  * (dt / 6.0);
        out.vel  = s.vel  + (k1.vel  + k2.vel * 2 + k3.vel * 2 + k4.vel)  * (dt / 6.0);
        out.mass = s.mass + (k1.mass + 2 * k2.mass + 2 * k3.mass + k4.mass) * (dt / 6.0);
        if (out.mass < 1e-6) out.mass = s.mass; // guard
        return out;
    }

    static State add(const State& s, const State& k, double h) {
        return { s.pos + k.pos * h, s.vel + k.vel * h, s.mass + k.mass * h };
    }

    void pushSample(FlightResult& out, const Munition& round,
                    const State& s, double t) const {
        const AtmoSample air = atmo_.sample(s.pos.z);
        const Vec3 wind = atmo_.windAt(s.pos, t);
        const Vec3 vRel = s.vel - wind;
        const double vRelMag = vRel.length();
        const double mach = vRelMag / air.soundSpeed;
        const double Cd = round.dragCoefficient(mach);
        const double A = round.referenceArea();
        const double drag = 0.5 * air.density * Cd * A * vRelMag * vRelMag;
        out.path.push_back({t, s.pos, s.vel, mach, s.mass, drag});
    }
};

} // namespace ua
