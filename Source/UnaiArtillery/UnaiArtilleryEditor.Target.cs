using UnrealBuildTool;
using System.Collections.Generic;

public class UnaiArtilleryEditorTarget : TargetRules
{
    public UnaiArtilleryEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("UnaiArtillery");
    }
}
