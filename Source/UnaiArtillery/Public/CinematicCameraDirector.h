// ============================================================================
//  CinematicCameraDirector.h  —  Smooth cinematic camera modes.
//
//  Three modes for the "toy" feel:
//    * Orbital  : lazy orbit around a focus point (the gun or a target).
//    * Follow   : chase the active projectile, easing to keep it framed with a
//                 lead-ahead so hypersonic rounds don't outrun the camera.
//    * TacticalDrone : high top-down-ish recon view that tracks the impact area.
//
//  All motion is critically-damped (spring interpolation) so there are no harsh
//  cuts — everything glides. Uses UE's built-in view-target blending.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CinematicCameraDirector.generated.h"

class UCameraComponent;
class USpringArmComponent;
class ABallisticProjectile;

UENUM(BlueprintType)
enum class EUnaiCameraMode : uint8
{
    Orbital        UMETA(DisplayName = "Orbital"),
    FollowShell    UMETA(DisplayName = "Follow Projectile"),
    TacticalDrone  UMETA(DisplayName = "Tactical Drone")
};

UCLASS()
class UNAIARTILLERY_API ACinematicCameraDirector : public AActor
{
    GENERATED_BODY()

public:
    ACinematicCameraDirector();

    UFUNCTION(BlueprintCallable, Category = "Camera")
    void SetMode(EUnaiCameraMode NewMode) { Mode = NewMode; }

    /** Focus point for Orbital / Drone modes (e.g. the gun or the target). */
    UFUNCTION(BlueprintCallable, Category = "Camera")
    void SetFocus(const FVector& WorldFocus) { Focus = WorldFocus; }

    /** Attach the follow-camera to a live projectile. */
    UFUNCTION(BlueprintCallable, Category = "Camera")
    void FollowProjectile(ABallisticProjectile* Projectile) { Tracked = Projectile; SetMode(EUnaiCameraMode::FollowShell); }

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camera")
    EUnaiCameraMode Mode = EUnaiCameraMode::Orbital;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camera")
    float OrbitRadius = 3000.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camera")
    float OrbitSpeedDegPerSec = 12.f;

    /** Higher = snappier follow; lower = floatier, more cinematic lag. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camera")
    float PositionStiffness = 4.f;

protected:
    virtual void Tick(float DeltaSeconds) override;

    UPROPERTY(VisibleAnywhere, Category = "Components")
    TObjectPtr<UCameraComponent> Camera;

private:
    FVector Focus = FVector::ZeroVector;
    float   OrbitAngleDeg = 0.f;
    FVector SmoothedLoc = FVector::ZeroVector;

    UPROPERTY() TObjectPtr<ABallisticProjectile> Tracked = nullptr;

    /** Critically-damped move toward a goal (frame-rate independent). */
    FVector SpringTo(const FVector& Current, const FVector& Goal, float Stiffness, float Dt) const;

    void TickOrbital(float Dt);
    void TickFollow(float Dt);
    void TickDrone(float Dt);
};
