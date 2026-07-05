// ============================================================================
//  Atmosphere.h  —  International Standard Atmosphere (ISA) + wind field.
//
//  Provides air density rho(h), speed of sound a(h), and a pluggable wind
//  vector w(position, t). Density feeds the aerodynamic drag term; speed of
//  sound feeds the Mach number that drives the Mach-dependent drag curve.
//
//  ISA reference (troposphere, 0..11 km, then lower stratosphere 11..20 km):
//      T0   = 288.15 K,  P0 = 101325 Pa,  rho0 = 1.225 kg/m^3
//      L    = 0.0065 K/m (tropospheric lapse rate)
//      g0   = 9.80665 m/s^2,  R = 287.05287 J/(kg*K)
// ============================================================================
#pragma once
#include "Vec3.h"
#include <algorithm>
#include <cmath>
#include <functional>

namespace ua {

struct AtmoSample {
    double density;      // rho  [kg/m^3]
    double temperature;  // T    [K]
    double pressure;     // P    [Pa]
    double soundSpeed;   // a    [m/s]
};

class Atmosphere {
public:
    // Weather knobs, expressed relative to the ISA baseline.
    double seaLevelTemperatureK = 288.15;  // adjust for hot/cold day
    double seaLevelPressurePa   = 101325.0;

    // Sample the standard atmosphere at geometric altitude h (meters MSL).
    AtmoSample sample(double h) const {
        constexpr double g0 = 9.80665;
        constexpr double R  = 287.05287;
        constexpr double L  = 0.0065;
        constexpr double gamma = 1.4;

        const double T0 = seaLevelTemperatureK;
        const double P0 = seaLevelPressurePa;

        double T, P;
        if (h <= 11000.0) {
            T = T0 - L * h;
            P = P0 * std::pow(T / T0, g0 / (R * L));
        } else {
            // Isothermal layer 11..20 km.
            const double T11 = T0 - L * 11000.0;
            const double P11 = P0 * std::pow(T11 / T0, g0 / (R * L));
            T = T11;
            P = P11 * std::exp(-g0 * (h - 11000.0) / (R * T11));
        }
        T = std::max(T, 150.0); // numerical floor for very high shots
        const double rho = P / (R * T);
        const double a   = std::sqrt(gamma * R * T);
        return {rho, T, P, a};
    }

    double densityAt(double h) const { return sample(h).density; }

    // -- Wind ---------------------------------------------------------------
    // Wind is a full vector field over (position, time) so callers can layer a
    // steady gradient, gusts, or a look-up from real METAR/GFS data. Default is
    // a constant "meteorological" wind blowing FROM a compass bearing.
    std::function<Vec3(const Vec3& pos, double t)> windField =
        [](const Vec3&, double) { return Vec3{0, 0, 0}; };

    Vec3 windAt(const Vec3& pos, double t) const { return windField(pos, t); }

    // Helper: build a steady wind of `speed` (m/s) coming FROM `bearingDeg`
    // (0 = from North, 90 = from East), optionally strengthening with altitude.
    static Vec3 steadyWind(double speed, double bearingDeg) {
        const double br = bearingDeg * M_PI / 180.0;
        // "From" bearing -> the vector points toward the opposite direction.
        // East component = -sin(br), North component = -cos(br).
        return Vec3{-speed * std::sin(br), -speed * std::cos(br), 0.0};
    }
};

} // namespace ua
