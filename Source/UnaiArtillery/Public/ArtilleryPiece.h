// ============================================================================
//  ArtilleryPiece.h  —  The weapon actor / in-world fire controller.
//
//  One instance = one gun/launcher on the map. It owns aiming state, talks to
//  the UBallisticsWorldSubsystem to compute trajectories, spawns the visual
//  ABallisticProjectile, and plays the launch signature (muzzle flash, volumetric
//  smoke that drifts with wind, ground shockwave decal/particles).
//
//  This is the "controlador del arma" requested: aim -> solve -> fire -> present.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "BallisticsWorldSubsystem.h"
#include "ArtilleryPiece.generated.h"

class USkeletalMeshComponent;
class USceneComponent;
class UNiagaraSystem;
class ABallisticProjectile;

UCLASS()
class UNAIARTILLERY_API AArtilleryPiece : public AActor
{
    GENERATED_BODY()

public:
    AArtilleryPiece();

    // ---- Configuration ----------------------------------------------------
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon")
    EUnaiWeaponId WeaponType = EUnaiWeaponId::M777;

    /** Charge/zone index into the weapon's charge table (-1 = round default). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon")
    int32 ChargeIndex = -1;

    UPROPERTY(EditDefaultsOnly, Category = "Weapon")
    TSubclassOf<ABallisticProjectile> ProjectileClass;

    // ---- Aiming (degrees) -------------------------------------------------
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Aiming")
    float AzimuthDeg = 0.f;   // compass bearing 0=N, 90=E

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Aiming")
    float ElevationDeg = 45.f;

    // ---- Actions ----------------------------------------------------------
    /** Aim so the round lands on WorldTarget (auto-picks charge if needed). */
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    bool AimAtTarget(const FVector& WorldTarget, bool bPreferHighAngle);

    /** Preview the current trajectory without firing (for the aiming arc UI). */
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    FUnaiFlightResult PreviewTrajectory();

    /** Fire: solves the trajectory, spawns the projectile, plays launch FX. */
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    ABallisticProjectile* Fire();

    UFUNCTION(BlueprintPure, Category = "Weapon")
    bool IsReadyToFire() const { return CooldownRemaining <= 0.f; }

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    /** Socket/point the shell leaves from (muzzle). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USceneComponent> MuzzlePoint;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USkeletalMeshComponent> GunMesh;

    // Launch-signature VFX (assigned in Blueprint).
    UPROPERTY(EditDefaultsOnly, Category = "Effects")
    TObjectPtr<UNiagaraSystem> MuzzleFlashFX;

    UPROPERTY(EditDefaultsOnly, Category = "Effects")
    TObjectPtr<UNiagaraSystem> MuzzleSmokeFX;   // volumetric, drifts with wind

    UPROPERTY(EditDefaultsOnly, Category = "Effects")
    TObjectPtr<UNiagaraSystem> GroundShockwaveFX; // dust ring on the terrain

private:
    UBallisticsWorldSubsystem* Subsystem() const;
    void PlayLaunchFX();

    float CooldownRemaining = 0.f;
};
