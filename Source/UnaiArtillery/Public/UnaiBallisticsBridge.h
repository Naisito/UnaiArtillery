// ============================================================================
//  UnaiBallisticsBridge.h  —  Glue between the engine-agnostic core and UE5.
//
//  The physics core (../../core) knows nothing about Unreal. This header is the
//  ONE place that translates between the two worlds:
//
//    * Coordinate frames:
//        Core  = ENU, right-handed, METERS   (x=East, y=North, z=Up)
//        UE5   = left-handed,        CENTIMETERS (X=Forward, Y=Right, Z=Up)
//      The battery's geo-anchor defines the ENU origin. Cesium georeferencing
//      places that origin in the UE world; we then convert ENU<->UE locally.
//
//    * Data: USTRUCT mirrors of the core config so designers can tweak weapons
//      and weather in the editor / Blueprints.
//
//  Keeping the conversion isolated here means the solver stays testable off-
//  engine (see tests/validation.cpp) while gameplay code speaks FVector.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "UnaiBallisticsBridge.generated.h"

// 1 meter = 100 Unreal units by default (UE world is centimeters).
namespace UnaiUnits { static constexpr double MetersToUU = 100.0; }

/**
 * Convert a core ENU position/velocity (meters, x=E y=N z=U) to a UE FVector
 * (centimeters). We map East->X, North->Y, Up->Z. UE is left-handed, so this
 * mapping is a pure axis relabel plus unit scale; it preserves Up and yields a
 * consistent, artifact-free world. Handedness only matters for cross products,
 * which the core computes internally in its own frame.
 */
FORCEINLINE FVector EnuToUE(double east_m, double north_m, double up_m)
{
    return FVector(east_m, north_m, up_m) * UnaiUnits::MetersToUU;
}

FORCEINLINE FVector EnuToUE(const FVector& enuMeters)
{
    return enuMeters * UnaiUnits::MetersToUU;
}

/** Inverse: UE centimeters -> ENU meters (as an FVector of meters). */
FORCEINLINE FVector UEToEnu(const FVector& ueCm)
{
    return ueCm / UnaiUnits::MetersToUU;
}

// ---------------------------------------------------------------------------
//  Editor-facing data mirrors
// ---------------------------------------------------------------------------

USTRUCT(BlueprintType)
struct FUnaiDragPoint
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    float Mach = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    float Cd = 0.3f;
};

USTRUCT(BlueprintType)
struct FUnaiRocketMotor
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    bool bEnabled = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "N"))
    float Thrust = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "s"))
    float BurnTime = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "kg"))
    float PropellantMass = 0.f;
};

/** Editor mirror of ua::Munition. Converted to the core struct at fire time. */
USTRUCT(BlueprintType)
struct FUnaiMunition
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    FString Name = TEXT("155mm HE");

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "kg"))
    float Mass = 43.2f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "m"))
    float Diameter = 0.155f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics", meta = (Units = "m/s"))
    float MuzzleVelocity = 684.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    TArray<FUnaiDragPoint> DragCurve;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    FUnaiRocketMotor Motor;

    /** TNT-equivalent yield; scales explosion VFX and camera shake, not flight. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effects", meta = (Units = "kg"))
    float WarheadMassTNTeq = 6.6f;
};

/** A single sampled point of a flown trajectory, surfaced to gameplay/VFX. */
USTRUCT(BlueprintType)
struct FUnaiTrajectoryPoint
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float Time = 0.f;             // s since launch

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    FVector Location = FVector::ZeroVector; // UE world cm

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    FVector Velocity = FVector::ZeroVector; // UE cm/s

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float Mach = 0.f;
};

/** Full flight outcome handed back to the projectile actor and camera. */
USTRUCT(BlueprintType)
struct FUnaiFlightResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    TArray<FUnaiTrajectoryPoint> Path;

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    FVector ImpactPoint = FVector::ZeroVector;

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float ImpactSpeed = 0.f;      // m/s

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float TimeOfFlight = 0.f;

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float MaxMach = 0.f;

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    float Downrange = 0.f;        // m

    UPROPERTY(BlueprintReadOnly, Category = "Ballistics")
    bool bImpacted = false;
};
