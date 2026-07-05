// ============================================================================
//  BallisticsWorldSubsystem.h  —  World-scoped ballistics service.
//
//  A UWorldSubsystem is the natural home for the shared solver: it lives for
//  the world's lifetime, is trivially reachable from any actor, and owns the
//  cross-cutting state every shot needs:
//     * the Atmosphere (ISA + wind field, editable live for weather),
//     * the terrain-height callback (raycasts against the Cesium world tiles),
//     * global solver config (dt, latitude for Coriolis, gravity).
//
//  Actors call SolveTrajectory() to get a fully flown FUnaiFlightResult without
//  knowing anything about the core. The heavy integration can be pushed to a
//  worker thread (AsyncTask) because the core is pure and allocation-light.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "UnaiBallisticsBridge.h"
#include "BallisticsWorldSubsystem.generated.h"

UENUM(BlueprintType)
enum class EUnaiWeaponId : uint8
{
    Mortar120     UMETA(DisplayName = "120mm Heavy Mortar"),
    M777          UMETA(DisplayName = "M777 155mm Howitzer"),
    HIMARS_GMLRS  UMETA(DisplayName = "HIMARS / GMLRS"),
    TacticalMissile UMETA(DisplayName = "Tactical Ballistic Missile")
};

UCLASS()
class UNAIARTILLERY_API UBallisticsWorldSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;

    // ---- Weather ----------------------------------------------------------
    /** Steady wind: speed (m/s) coming FROM a compass bearing (0=N, 90=E). */
    UFUNCTION(BlueprintCallable, Category = "Ballistics|Weather")
    void SetSteadyWind(float SpeedMS, float FromBearingDeg);

    /** Sea-level temperature (K) and pressure (Pa) for hot/cold-day tuning. */
    UFUNCTION(BlueprintCallable, Category = "Ballistics|Weather")
    void SetSeaLevelConditions(float TemperatureK, float PressurePa);

    /** Battery latitude drives the Coriolis term for long-range shots. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    float BatteryLatitudeDeg = 40.f;

    /** Integration step (s). 2 ms is the sweet spot for accuracy vs cost. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    float IntegrationStep = 0.002f;

    /** When true, impacts are tested against real Cesium topography. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    bool bUseTerrainCollision = true;

    // ---- Solving ----------------------------------------------------------
    /**
     * Fly a round of `Weapon` from `MuzzleWorldLocation` at the given azimuth,
     * elevation and charge. Returns the complete sampled trajectory in UE space.
     * Synchronous; for many simultaneous shots call SolveTrajectoryAsync.
     */
    UFUNCTION(BlueprintCallable, Category = "Ballistics")
    FUnaiFlightResult SolveTrajectory(EUnaiWeaponId Weapon,
                                      const FVector& MuzzleWorldLocation,
                                      float AzimuthDeg, float ElevationDeg,
                                      int32 ChargeIndex = -1);

    /**
     * Inverse fire-control: find the quadrant elevation that lands `Weapon`'s
     * round on `TargetWorldLocation`. Returns false if out of range. Fills
     * OutElevationDeg and OutTimeOfFlight.
     */
    UFUNCTION(BlueprintCallable, Category = "Ballistics")
    bool SolveElevationForTarget(EUnaiWeaponId Weapon,
                                 const FVector& MuzzleWorldLocation,
                                 const FVector& TargetWorldLocation,
                                 bool bPreferHighAngle,
                                 int32 ChargeIndex,
                                 float& OutElevationDeg,
                                 float& OutTimeOfFlight);

    /** Sample air density (kg/m^3) at a UE world location (for VFX tuning). */
    UFUNCTION(BlueprintCallable, Category = "Ballistics|Weather")
    float AirDensityAtLocation(const FVector& WorldLocation) const;

private:
    // Opaque pointer to the core state (Atmosphere + config), PIMPL-style so
    // the core headers don't leak into other translation units.
    struct FImpl;
    TSharedPtr<FImpl> Impl;

    /** Line-trace the world downward at (east,north) to get ground height (m). */
    double QueryTerrainHeightMeters(double EastM, double NorthM) const;
};
