using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class ExtractBomCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        try
        {
            string json = ConnectorHotSwap.ExtractJson(commandData.Application);
            string path = BomJson.OutputPath;
            if (!File.Exists(path) && !string.IsNullOrEmpty(json))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, json);
            }

            var dialog = new TaskDialog("StudioPractice Connector")
            {
                MainInstruction = "Sent to the connector",
                MainContent =
                    ConnectorHotSwap.Summarize(json) + "\n\n" +
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
