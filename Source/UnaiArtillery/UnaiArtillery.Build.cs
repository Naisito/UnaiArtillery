// ============================================================================
//  UnaiArtillery.Build.cs  —  Module build rules (Unreal Build Tool).
//
//  Key points:
//    * PublicIncludePaths adds the engine-agnostic ballistics core so the .cpp
//      files can #include "BallisticsSolver.h" etc. directly.
//    * Niagara is required for all VFX; CesiumRuntime for the real-world globe.
//    * bUseUnity is left default; the core headers are header-only and cheap.
// ============================================================================
using UnrealBuildTool;
using System.IO;

public class UnaiArtillery : ModuleRules
{
    public UnaiArtillery(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        CppStandard = CppStandardVersion.Cpp17;

        // Engine-agnostic physics core lives at <Project>/core.
        // ModuleDirectory = <Project>/Source/UnaiArtillery
        string CorePath = Path.Combine(ModuleDirectory, "..", "..", "core");
        PublicIncludePaths.Add(Path.GetFullPath(CorePath));

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "Niagara",          // VFX: flash, smoke, trails, explosions, shock
            "GameplayCameras",  // cinematic camera helpers
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "EnhancedInput",    // modern input for aiming controls
        });

        // Cesium for Unreal — real-world 3D terrain/imagery streaming.
        // Requires the plugin installed & enabled in the .uproject.
        if (Target.bBuildEditor || true)
        {
            PrivateDependencyModuleNames.Add("CesiumRuntime");
        }
    }
}
