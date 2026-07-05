// ============================================================================
//  CinematicCameraDirector.cpp
// ============================================================================
#include "CinematicCameraDirector.h"
#include "BallisticProjectile.h"
#include "Camera/CameraComponent.h"

ACinematicCameraDirector::ACinematicCameraDirector()
{
    PrimaryActorTick.bCanEverTick = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    SetRootComponent(Camera);
}

FVector ACinematicCameraDirector::SpringTo(const FVector& Current, const FVector& Goal,
                                           float Stiffness, float Dt) const
{
    // Exponential smoothing that is stable and frame-rate independent:
    //   alpha = 1 - exp(-k * dt)   -> critically damped feel without overshoot.
    const float Alpha = 1.f - FMath::Exp(-FMath::Max(Stiffness, 0.01f) * Dt);
    return FMath::Lerp(Current, Goal, Alpha);
}

void ACinematicCameraDirector::Tick(float Dt)
{
    Super::Tick(Dt);
    switch (Mode)
    {
    case EUnaiCameraMode::Orbital:       TickOrbital(Dt); break;
    case EUnaiCameraMode::FollowShell:   TickFollow(Dt);  break;
    case EUnaiCameraMode::TacticalDrone: TickDrone(Dt);   break;
    }
}

void ACinematicCameraDirector::TickOrbital(float Dt)
{
    OrbitAngleDeg = FMath::Fmod(OrbitAngleDeg + OrbitSpeedDegPerSec * Dt, 360.f);
    const float rad = FMath::DegreesToRadians(OrbitAngleDeg);
    const FVector goal = Focus + FVector(FMath::Cos(rad) * OrbitRadius,
                                         FMath::Sin(rad) * OrbitRadius,
                                         OrbitRadius * 0.5f);
    SmoothedLoc = SpringTo(SmoothedLoc, goal, PositionStiffness, Dt);
    SetActorLocation(SmoothedLoc);
    SetActorRotation((Focus - SmoothedLoc).Rotation());
}

void ACinematicCameraDirector::TickFollow(float Dt)
{
    if (!Tracked) { SetMode(EUnaiCameraMode::Orbital); return; }

    const FVector shell = Tracked->GetActorLocation();
    const FVector shellDir = Tracked->GetActorForwardVector();

    // Sit behind and slightly above the shell; lead the framing along velocity
    // so very fast rounds stay centered instead of hugging the screen edge.
    const FVector goal = shell - shellDir * 1200.f + FVector(0, 0, 350.f);
    SmoothedLoc = SpringTo(SmoothedLoc, goal, PositionStiffness, Dt);
    SetActorLocation(SmoothedLoc);

    const FVector lookAt = shell + shellDir * 2500.f; // aim ahead of the shell
    SetActorRotation((lookAt - SmoothedLoc).Rotation());
}

void ACinematicCameraDirector::TickDrone(float Dt)
{
    // High recon view: hover above the focus, tilted down, slow drift.
    const FVector goal = Focus + FVector(0, 0, 8000.f) + FVector(1500.f, 0, 0);
    SmoothedLoc = SpringTo(SmoothedLoc, goal, PositionStiffness * 0.5f, Dt);
    SetActorLocation(SmoothedLoc);
    SetActorRotation((Focus - SmoothedLoc).Rotation());
}
