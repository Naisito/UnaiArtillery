// ============================================================================
//  BallisticProjectile.h  —  Visual playback actor for one flown round.
//
//  The trajectory is precomputed by the subsystem (deterministic, physically
//  correct). This actor is a *presenter*: it walks the sampled path over time,
//  drives the mesh transform, the condensation/exhaust trail, the transonic
//  air-refraction effect, and finally spawns the impact FX + camera shake.
//
//  Splitting "simulate once, present smoothly" from the physics keeps the sim
//  frame-rate independent and lets the follow-camera and VFX read ahead.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UnaiBallisticsBridge.h"
#include "BallisticProjectile.generated.h"

class UStaticMeshComponent;
class UNiagaraComponent;
class UNiagaraSystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnProjectileImpact,
    FVector, ImpactLocation, float, ImpactSpeed);

UCLASS()
class UNAIARTILLERY_API ABallisticProjectile : public AActor
{
    GENERATED_BODY()

public:
    ABallisticProjectile();

    /** Hand the actor a precomputed trajectory and let it fly it out. */
    UFUNCTION(BlueprintCallable, Category = "Ballistics")
    void Launch(const FUnaiFlightResult& InFlight, float InWarheadTNTeq);

    /** Fired when the round reaches its impact point. */
    UPROPERTY(BlueprintAssignable, Category = "Ballistics")
    FOnProjectileImpact OnImpact;

    /** Current normalized progress 0..1 along the path (for the HUD/camera). */
    UFUNCTION(BlueprintPure, Category = "Ballistics")
    float GetFlightAlpha() const { return FlightDuration > 0.f ? Elapsed / FlightDuration : 0.f; }

protected:
    virtual void Tick(float DeltaSeconds) override;

    // -- Components ---------------------------------------------------------
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> Mesh;

    /** Condensation trail / rocket exhaust; parameters driven by Mach + altitude. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UNiagaraComponent> TrailFX;

    /** Screen-space heat-haze / refraction sphere, scaled up above Mach 1. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UNiagaraComponent> ShockRefractionFX;

    // -- Authorable assets --------------------------------------------------
    UPROPERTY(EditDefaultsOnly, Category = "Effects")
    TObjectPtr<UNiagaraSystem> ImpactExplosionFX;

    /** Playback speed multiplier (1 = real time; slow-mo for the money shot). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
    float TimeDilation = 1.f;

private:
    UPROPERTY() FUnaiFlightResult Flight;
    float Elapsed = 0.f;
    float FlightDuration = 0.f;
    float WarheadTNTeq = 6.6f;
    bool  bImpacted = false;

    /** Sample the path at time t (s) with linear interpolation between points. */
    void EvaluatePath(float T, FVector& OutLoc, FVector& OutVel, float& OutMach) const;

    void HandleImpact();
};
