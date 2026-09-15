using System.IO;
using System.Text.Json;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Extraction;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.ReadOnly)]
[Regeneration(RegenerationOption.Manual)]
public class ExportCatalogCommand : IExternalCommand
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        try
        {
            TypeCatalogPayload payload = TypeCatalogExtractor.Extract(commandData.Application);
            string json = JsonSerializer.Serialize(payload, Options);
            string path = Write(json);

            int placed = payload.Types.Count(t => t.PlacedCount > 0);
            var dialog = new TaskDialog("StudioPractice Connector")
            {
                MainInstruction = "Catalog exported",
                MainContent =
                    $"{payload.Types.Count} model types ({placed} placed), " +
                    $"{payload.Levels.Count} levels, {payload.TitleBlocks.Count} title blocks, " +
                    $"{payload.Views.Count} views.\n\n" +
                    $"Saved to:\n{path}\n\n" +
                    "Run `npm run build-pack` in web/v2 to regenerate the SKU pack.",
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
            TaskDialog.Show("StudioPractice Connector", "Catalog export failed:\n" + ex.Message);
            return Result.Failed;
        }
    }

    private static string Write(string json)
    {
        Directory.CreateDirectory(BomJson.OutputDirectory);
        string path = Path.Combine(BomJson.OutputDirectory, "type-catalog.json");
        File.WriteAllText(path, json);

        string repoOutput = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            @"source\repos\StudioPractice.RevitConnector\output\type-catalog.json");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(repoOutput)!);
            File.WriteAllText(repoOutput, json);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }

        return path;
    }
}
