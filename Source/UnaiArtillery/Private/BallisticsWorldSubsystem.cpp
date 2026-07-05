// ============================================================================
//  BallisticsWorldSubsystem.cpp
//
//  Wires the pure C++ ballistics core into the Unreal world. The core headers
//  are included ONLY here (behind a PIMPL) so the rest of the module compiles
//  fast and stays engine-only.
// ============================================================================
#include "BallisticsWorldSubsystem.h"
#include "Engine/World.h"

// The engine-agnostic core. Path is relative to Source/UnaiArtillery/Private;
// add ../../../core to the module's PublicIncludePaths in the .Build.cs.
#include "Atmosphere.h"
#include "BallisticsSolver.h"
#include "WeaponCatalog.h"
#include "WeaponSystem.h"

using namespace ua;

// ---------------------------------------------------------------------------
struct UBallisticsWorldSubsystem::FImpl
{
    Atmosphere Atmo;
    // Latest steady-wind so we can rebuild the field when weather changes.
    double WindSpeed = 0.0;
    double WindBearingDeg = 0.0;

    static Weapon Resolve(EUnaiWeaponId Id)
    {
        switch (Id)
        {
        case EUnaiWeaponId::Mortar120:       return WeaponCatalog::Mortar120();
        case EUnaiWeaponId::M777:            return WeaponCatalog::M777();
        case EUnaiWeaponId::HIMARS_GMLRS:    return WeaponCatalog::HIMARS_GMLRS();
        case EUnaiWeaponId::TacticalMissile: return WeaponCatalog::TacticalMissile();
        }
        return WeaponCatalog::M777();
    }
};

// ---------------------------------------------------------------------------
void UBallisticsWorldSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    Impl = MakeShared<FImpl>();
}

void UBallisticsWorldSubsystem::SetSteadyWind(float SpeedMS, float FromBearingDeg)
{
    if (!Impl) return;
    Impl->WindSpeed = SpeedMS;
    Impl->WindBearingDeg = FromBearingDeg;
    const double spd = SpeedMS, brg = FromBearingDeg;
    // Wind strengthens gently with altitude (Ekman-like), capped at 2x.
    Impl->Atmo.windField = [spd, brg](const Vec3& pos, double /*t*/)
    {
        const double gain = FMath::Clamp(1.0 + pos.z / 8000.0, 1.0, 2.0);
        return Atmosphere::steadyWind(spd * gain, brg);
    };
}

void UBallisticsWorldSubsystem::SetSeaLevelConditions(float TemperatureK, float PressurePa)
{
    if (!Impl) return;
    Impl->Atmo.seaLevelTemperatureK = TemperatureK;
    Impl->Atmo.seaLevelPressurePa   = PressurePa;
}

float UBallisticsWorldSubsystem::AirDensityAtLocation(const FVector& WorldLocation) const
{
    if (!Impl) return 1.225f;
    const double up_m = UEToEnu(WorldLocation).Z;
    return static_cast<float>(Impl->Atmo.densityAt(up_m));
}

// ---------------------------------------------------------------------------
double UBallisticsWorldSubsystem::QueryTerrainHeightMeters(double EastM, double NorthM) const
{
    const UWorld* World = GetWorld();
    if (!World) return 0.0;

    // Trace straight down from high altitude at (East, North) to find ground.
    // Cesium World tiles register as world collision, so a standard line trace
    // returns real topography once the tiles under the trace are streamed in.
    const FVector Start = EnuToUE(EastM, NorthM, 12000.0); // 12 km up
    const FVector End   = EnuToUE(EastM, NorthM, -2000.0); // 2 km down

    FHitResult Hit;
    FCollisionQueryParams Params(SCENE_QUERY_STAT(UnaiTerrain), /*bTraceComplex*/ true);
    if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_WorldStatic, Params))
    {
        return UEToEnu(Hit.ImpactPoint).Z; // ground altitude in meters
    }
    return 0.0; // fall back to sea level if tiles not yet streamed
}

// ---------------------------------------------------------------------------
static FUnaiFlightResult ConvertResult(const FlightResult& fr)
{
    FUnaiFlightResult out;
    out.Path.Reserve(static_cast<int32>(fr.path.size()));
    for (const TrajectorySample& s : fr.path)
    {
        FUnaiTrajectoryPoint p;
        p.Time     = static_cast<float>(s.t);
        p.Location = EnuToUE(s.position.x, s.position.y, s.position.z);
        p.Velocity = EnuToUE(s.velocity.x, s.velocity.y, s.velocity.z); // cm/s
        p.Mach     = static_cast<float>(s.mach);
        out.Path.Add(p);
    }
    out.ImpactPoint  = EnuToUE(fr.impactPoint.x, fr.impactPoint.y, fr.impactPoint.z);
    out.ImpactSpeed  = static_cast<float>(fr.impactSpeed);
    out.TimeOfFlight = static_cast<float>(fr.timeOfFlight);
    out.MaxMach      = static_cast<float>(fr.maxMach);
    out.Downrange    = static_cast<float>(fr.downrange);
    out.bImpacted    = fr.impacted;
    return out;
}

SolverConfig UBallisticsWorldSubsystem_MakeConfig(const UBallisticsWorldSubsystem* Self,
                                                  std::function<double(double,double)> terrain)
{
    SolverConfig cfg;
    cfg.dt = Self->IntegrationStep;
    cfg.latitudeDeg = Self->BatteryLatitudeDeg;
    cfg.enableCoriolis = true;
    if (Self->bUseTerrainCollision) cfg.terrainHeight = std::move(terrain);
    return cfg;
}

// ---------------------------------------------------------------------------
FUnaiFlightResult UBallisticsWorldSubsystem::SolveTrajectory(
    EUnaiWeaponId WeaponId, const FVector& MuzzleWorldLocation,
    float AzimuthDeg, float ElevationDeg, int32 ChargeIndex)
{
    if (!Impl) return {};

    auto terrain = [this](double e, double n) { return QueryTerrainHeightMeters(e, n); };
    SolverConfig cfg = UBallisticsWorldSubsystem_MakeConfig(this, terrain);
    // Ground plane defaults to the muzzle's own altitude if terrain is off.
    const FVector muzzleEnu = UEToEnu(MuzzleWorldLocation);
    cfg.groundZ = muzzleEnu.Z;

    const Weapon w = FImpl::Resolve(WeaponId);
    BallisticsSolver solver(Impl->Atmo, cfg);

    FireOrder order;
    order.azimuthDeg   = AzimuthDeg;
    order.elevationDeg = ElevationDeg;
    order.chargeIndex  = ChargeIndex;

    const double v0 = WeaponSystem::muzzleVelocity(w, order);
    const double el = WeaponSystem::clampElevation(w, ElevationDeg);
    const Vec3 launchVel = WeaponSystem::launchVelocity(AzimuthDeg, el, v0);
    const Vec3 launchPos{ muzzleEnu.X, muzzleEnu.Y, muzzleEnu.Z };

    const FlightResult fr = solver.integrate(w.round, launchPos, launchVel);
    return ConvertResult(fr);
}

bool UBallisticsWorldSubsystem::SolveElevationForTarget(
    EUnaiWeaponId WeaponId, const FVector& MuzzleWorldLocation,
    const FVector& TargetWorldLocation, bool bPreferHighAngle, int32 ChargeIndex,
    float& OutElevationDeg, float& OutTimeOfFlight)
{
    OutElevationDeg = 0.f; OutTimeOfFlight = 0.f;
    if (!Impl) return false;

    auto terrain = [this](double e, double n) { return QueryTerrainHeightMeters(e, n); };
    SolverConfig cfg = UBallisticsWorldSubsystem_MakeConfig(this, terrain);
    const FVector muzzleEnu = UEToEnu(MuzzleWorldLocation);
    const FVector targetEnu = UEToEnu(TargetWorldLocation);
    cfg.groundZ = muzzleEnu.Z;

    const Weapon w = FImpl::Resolve(WeaponId);
    WeaponSystem fc(Impl->Atmo, cfg);

    // Azimuth from muzzle to target (bearing: 0=N/+Y, 90=E/+X).
    const double dE = targetEnu.X - muzzleEnu.X;
    const double dN = targetEnu.Y - muzzleEnu.Y;
    const double azimuth = FMath::RadiansToDegrees(FMath::Atan2(dE, dN));
    const double range = FMath::Sqrt(dE * dE + dN * dN);
    const Vec3 muzzlePos{ muzzleEnu.X, muzzleEnu.Y, muzzleEnu.Z };

    const SolveResult sr = fc.solveForRange(w, muzzlePos, range, azimuth,
                                            ChargeIndex, bPreferHighAngle);
    if (!sr.found) return false;
    OutElevationDeg = static_cast<float>(sr.elevationDeg);
    OutTimeOfFlight = static_cast<float>(sr.timeOfFlight);
    return true;
}
