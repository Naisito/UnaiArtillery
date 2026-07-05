using UnrealBuildTool;
using System.Collections.Generic;

public class UnaiArtilleryTarget : TargetRules
{
    public UnaiArtilleryTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("UnaiArtillery");
    }
}
