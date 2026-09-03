using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceWindowCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) =>
        PlaceFamily.Run(
            commandData,
            ref message,
            BuiltInCategory.OST_Windows,
            "window",
            "Choose a window type, then click a wall in the floor plan. Esc finishes.");
}
