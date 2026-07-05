// ============================================================================
//  BallisticProjectile.cpp
// ============================================================================
#include "BallisticProjectile.h"
#include "Components/StaticMeshComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/PlayerController.h"

ABallisticProjectile::ABallisticProjectile()
{
    PrimaryActorTick.bCanEverTick = true;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    SetRootComponent(Mesh);
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); // physics is authoritative

    TrailFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("TrailFX"));
    TrailFX->SetupAttachment(Mesh);
    TrailFX->bAutoActivate = false;

    ShockRefractionFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("ShockRefractionFX"));
    ShockRefractionFX->SetupAttachment(Mesh);
    ShockRefractionFX->bAutoActivate = false;
}

void ABallisticProjectile::Launch(const FUnaiFlightResult& InFlight, float InWarheadTNTeq)
{
    Flight = InFlight;
    WarheadTNTeq = InWarheadTNTeq;
    Elapsed = 0.f;
    bImpacted = false;
    FlightDuration = Flight.TimeOfFlight > 0.f ? Flight.TimeOfFlight
                     : (Flight.Path.Num() ? Flight.Path.Last().Time : 0.f);

    if (Flight.Path.Num() > 0)
        SetActorLocation(Flight.Path[0].Location);

    if (TrailFX) TrailFX->Activate(true);
    if (ShockRefractionFX) ShockRefractionFX->Activate(true);
}

void ABallisticProjectile::EvaluatePath(float T, FVector& OutLoc, FVector& OutVel, float& OutMach) const
{
    const int32 N = Flight.Path.Num();
    if (N == 0) { OutLoc = GetActorLocation(); OutVel = FVector::ZeroVector; OutMach = 0.f; return; }
    if (T <= Flight.Path[0].Time) { const auto& p = Flight.Path[0]; OutLoc = p.Location; OutVel = p.Velocity; OutMach = p.Mach; return; }
    if (T >= Flight.Path[N - 1].Time) { const auto& p = Flight.Path[N - 1]; OutLoc = p.Location; OutVel = p.Velocity; OutMach = p.Mach; return; }

    // Binary search for the bracketing samples (paths can be thousands of pts).
    int32 lo = 0, hi = N - 1;
    while (hi - lo > 1)
    {
        const int32 mid = (lo + hi) / 2;
        (Flight.Path[mid].Time <= T ? lo : hi) = mid;
    }
    const FUnaiTrajectoryPoint& a = Flight.Path[lo];
    const FUnaiTrajectoryPoint& b = Flight.Path[hi];
    const float span = FMath::Max(b.Time - a.Time, KINDA_SMALL_NUMBER);
    const float f = (T - a.Time) / span;
    OutLoc  = FMath::Lerp(a.Location, b.Location, f);
    OutVel  = FMath::Lerp(a.Velocity, b.Velocity, f);
    OutMach = FMath::Lerp(a.Mach, b.Mach, f);
}

void ABallisticProjectile::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (bImpacted || Flight.Path.Num() == 0) return;

    Elapsed += DeltaSeconds * TimeDilation;

    FVector loc, vel; float mach;
    EvaluatePath(Elapsed, loc, vel, mach);

    SetActorLocation(loc);
    if (!vel.IsNearlyZero())
        SetActorRotation(vel.Rotation()); // nose follows velocity

    // Drive VFX parameters. The Niagara systems read these user params:
    //   "Mach"      -> trail widens & condensation appears in the transonic band
    //   "Altitude"  -> thinner contrail in low-density high air
    //   "Speed"     -> exhaust stretch
    if (TrailFX)
    {
        TrailFX->SetFloatParameter(TEXT("Mach"), mach);
        TrailFX->SetFloatParameter(TEXT("Altitude"), loc.Z);
        TrailFX->SetFloatParameter(TEXT("Speed"), vel.Size());
    }
    if (ShockRefractionFX)
    {
        // Air-refraction cone only meaningful above ~Mach 0.9; scale hard above 1.
        const float shock = FMath::Clamp((mach - 0.9f) / 0.6f, 0.f, 1.f);
        ShockRefractionFX->SetFloatParameter(TEXT("ShockStrength"), shock);
    }

    if (Elapsed >= FlightDuration)
        HandleImpact();
}

void ABallisticProjectile::HandleImpact()
{
    bImpacted = true;
    const FVector impact = Flight.ImpactPoint;
    SetActorLocation(impact);

    if (TrailFX) TrailFX->Deactivate();            // stop emitting, let it dissipate
    if (ShockRefractionFX) ShockRefractionFX->Deactivate();

    // Volumetric explosion scaled by warhead yield.
    if (ImpactExplosionFX)
    {
        UNiagaraComponent* Boom = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
            GetWorld(), ImpactExplosionFX, impact, FRotator::ZeroRotator);
        if (Boom)
        {
            const float yieldScale = FMath::Pow(WarheadTNTeq / 6.6f, 1.f / 3.f); // cube-root of energy
            Boom->SetFloatParameter(TEXT("YieldScale"), yieldScale);
            Boom->SetFloatParameter(TEXT("ImpactSpeed"), Flight.ImpactSpeed);
        }
    }

    // Distance-attenuated camera shake: closer + bigger warhead = stronger.
    if (APlayerController* PC = UGameplayStatics::GetPlayerController(GetWorld(), 0))
    {
        if (APawn* Pawn = PC->GetPawn())
        {
            const float dist = FVector::Dist(Pawn->GetActorLocation(), impact) / 100.f; // m
            const float yield = WarheadTNTeq;
            // Shockwave amplitude ~ yield^(1/3) / distance, clamped for sanity.
            const float amp = FMath::Clamp(FMath::Pow(yield, 1.f / 3.f) * 800.f / FMath::Max(dist, 20.f), 0.f, 12.f);
            PC->ClientStartCameraShake(nullptr, amp); // supply a UCameraShakeBase subclass in BP
        }
    }

    OnImpact.Broadcast(impact, Flight.ImpactSpeed);
    SetLifeSpan(3.0f); // let trails/debris settle, then clean up
}
