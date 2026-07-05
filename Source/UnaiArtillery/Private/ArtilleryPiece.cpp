// ============================================================================
//  ArtilleryPiece.cpp
// ============================================================================
#include "ArtilleryPiece.h"
#include "BallisticProjectile.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Engine/World.h"

AArtilleryPiece::AArtilleryPiece()
{
    PrimaryActorTick.bCanEverTick = true;

    GunMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("GunMesh"));
    SetRootComponent(GunMesh);

    MuzzlePoint = CreateDefaultSubobject<USceneComponent>(TEXT("MuzzlePoint"));
    MuzzlePoint->SetupAttachment(GunMesh);
    MuzzlePoint->SetRelativeLocation(FVector(300.f, 0.f, 100.f)); // tip of the barrel
}

void AArtilleryPiece::BeginPlay()
{
    Super::BeginPlay();
}

void AArtilleryPiece::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (CooldownRemaining > 0.f)
        CooldownRemaining = FMath::Max(0.f, CooldownRemaining - DeltaSeconds);

    // Visually orient the barrel toward the current azimuth/elevation. Bearing
    // 0 = +Y (North); UE yaw 0 = +X, so yaw = 90 - azimuth. Pitch = elevation.
    const FRotator Aim(ElevationDeg, 90.f - AzimuthDeg, 0.f);
    if (GunMesh) GunMesh->SetWorldRotation(Aim);
}

UBallisticsWorldSubsystem* AArtilleryPiece::Subsystem() const
{
    return GetWorld() ? GetWorld()->GetSubsystem<UBallisticsWorldSubsystem>() : nullptr;
}

bool AArtilleryPiece::AimAtTarget(const FVector& WorldTarget, bool bPreferHighAngle)
{
    UBallisticsWorldSubsystem* Ss = Subsystem();
    if (!Ss || !MuzzlePoint) return false;

    const FVector muzzle = MuzzlePoint->GetComponentLocation();

    // Point the azimuth straight at the target on the horizontal plane.
    const FVector delta = WorldTarget - muzzle;
    AzimuthDeg = FMath::RadiansToDegrees(FMath::Atan2(delta.X /*East*/, delta.Y /*North*/));

    float outEl = 0.f, outTof = 0.f;
    const bool ok = Ss->SolveElevationForTarget(
        WeaponType, muzzle, WorldTarget, bPreferHighAngle, ChargeIndex, outEl, outTof);
    if (ok) ElevationDeg = outEl;
    return ok;
}

FUnaiFlightResult AArtilleryPiece::PreviewTrajectory()
{
    UBallisticsWorldSubsystem* Ss = Subsystem();
    if (!Ss || !MuzzlePoint) return {};
    return Ss->SolveTrajectory(WeaponType, MuzzlePoint->GetComponentLocation(),
                               AzimuthDeg, ElevationDeg, ChargeIndex);
}

ABallisticProjectile* AArtilleryPiece::Fire()
{
    UBallisticsWorldSubsystem* Ss = Subsystem();
    if (!Ss || !MuzzlePoint || !IsReadyToFire() || !ProjectileClass) return nullptr;

    const FVector muzzle = MuzzlePoint->GetComponentLocation();
    const FUnaiFlightResult flight =
        Ss->SolveTrajectory(WeaponType, muzzle, AzimuthDeg, ElevationDeg, ChargeIndex);

    FActorSpawnParameters Params;
    Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    ABallisticProjectile* Proj = GetWorld()->SpawnActor<ABallisticProjectile>(
        ProjectileClass, muzzle, MuzzlePoint->GetComponentRotation(), Params);

    if (Proj)
    {
        // Warhead yield is data-driven per weapon; the subsystem knows it, but
        // for brevity we pass a representative value the projectile scales VFX by.
        Proj->Launch(flight, /*WarheadTNTeq*/ 6.6f);
    }

    PlayLaunchFX();
    CooldownRemaining = 4.0f; // reload; real value comes from the weapon data
    return Proj;
}

void AArtilleryPiece::PlayLaunchFX()
{
    if (!MuzzlePoint) return;
    const FVector loc = MuzzlePoint->GetComponentLocation();
    const FRotator rot = MuzzlePoint->GetComponentRotation();
    UWorld* World = GetWorld();

    // Blinding muzzle flash (a bright transient point/rect light should live in
    // the Niagara system so Lumen picks it up and lights the surroundings).
    if (MuzzleFlashFX)
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(World, MuzzleFlashFX, loc, rot);

    // Volumetric muzzle smoke — its Niagara graph reads the wind from the
    // subsystem so the cloud drifts consistently with the projectile physics.
    if (MuzzleSmokeFX)
    {
        UNiagaraComponent* Smoke =
            UNiagaraFunctionLibrary::SpawnSystemAtLocation(World, MuzzleSmokeFX, loc, rot);
        if (Smoke && Subsystem())
        {
            const float density = Subsystem()->AirDensityAtLocation(loc);
            Smoke->SetFloatParameter(TEXT("AirDensity"), density);
        }
    }

    // Ground shockwave: a dust ring on the terrain under the muzzle blast.
    if (GroundShockwaveFX)
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(
            World, GroundShockwaveFX, FVector(loc.X, loc.Y, GetActorLocation().Z));
}
