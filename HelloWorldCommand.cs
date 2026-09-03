using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class HelloWorldCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        UIApplication uiApp = commandData.Application;

        var dialog = new TaskDialog("StudioPractice Connector")
        {
            MainInstruction = "Hello World",
            MainContent =
                "The Revit add-in loaded and ran from the ribbon.\n\n" +
                $"Revit: {uiApp.Application.VersionName}\n" +
                $"Build: {uiApp.Application.VersionBuild}\n\n" +
                "Next: open a model and click Document Info to extract a first payload.",
            CommonButtons = TaskDialogCommonButtons.Ok
        };
        dialog.Show();

        return Result.Succeeded;
    }
}
