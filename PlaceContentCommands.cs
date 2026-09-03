using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlacePlumbingCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_PlumbingFixtures,
            "plumbing fixture",
            "Choose a plumbing fixture type, then click in the floor plan. Esc finishes.");
}

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceLightingCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_LightingFixtures,
            "lighting fixture",
            "Choose a lighting fixture type, then click a ceiling, wall, or point in the floor plan. Esc finishes.");
}

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceElectricalCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_ElectricalFixtures,
            "electrical fixture",
            "Choose an electrical fixture type, then click a wall or a point in the floor plan. Esc finishes.");
}

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceFurnitureCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_Furniture,
            "furniture",
            "Choose a furniture type, then click in the floor plan. Esc finishes.");
}

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceCaseworkCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_Casework,
            "casework",
            "Choose a casework type, then click in the floor plan. Esc finishes.");
}
