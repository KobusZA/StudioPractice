using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class DocumentInfoCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        UIDocument? uiDoc = commandData.Application.ActiveUIDocument;
        Document? doc = uiDoc?.Document;

        if (doc is null)
        {
            TaskDialog.Show("StudioPractice Connector", "Open a Revit model first, then try Document Info again.");
            return Result.Cancelled;
        }

        string path = doc.PathName;
        if (string.IsNullOrWhiteSpace(path))
        {
            path = "(unsaved)";
        }

        string viewName = uiDoc!.ActiveView?.Name ?? "(none)";

        var dialog = new TaskDialog("StudioPractice Connector")
        {
            MainInstruction = "Document info",
            MainContent =
                $"Title: {doc.Title}\n" +
                $"Path: {path}\n" +
                $"Active view: {viewName}\n" +
                $"Is family: {doc.IsFamilyDocument}",
            CommonButtons = TaskDialogCommonButtons.Ok
        };
        dialog.Show();

        return Result.Succeeded;
    }
}
