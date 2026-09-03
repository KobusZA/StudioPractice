using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Extraction;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class ExtractBomCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        try
        {
            BomPayload payload = BomExtractor.Extract(commandData.Application);
            string path = BomJson.Write(payload);

            var dialog = new TaskDialog("StudioPractice Connector")
            {
                MainInstruction = "Sent to the connector",
                MainContent =
                    $"{payload.DocumentKind}: {payload.Title}\n" +
                    $"View: {payload.ActiveView} ({payload.ViewType})\n" +
                    $"BOM lines: {payload.Lines.Count}\n" +
                    $"Sketch forms: {payload.SketchForms.Count}\n\n" +
                    $"Saved to:\n{path}\n\n" +
                    "In the web app, click Import from Revit (connector port 17300).",
                CommonButtons = TaskDialogCommonButtons.Ok
            };
            dialog.Show();

            return Result.Succeeded;
        }
        catch (InvalidOperationException ex)
        {
            message = ex.Message;
            TaskDialog.Show("StudioPractice Connector", ex.Message);
            return Result.Cancelled;
        }
        catch (Exception ex)
        {
            message = ex.Message;
            TaskDialog.Show("StudioPractice Connector", "Extract failed:\n" + ex.Message);
            return Result.Failed;
        }
    }
}
