using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.Win32;

namespace StudioPractice.RevitConnector;

/// <summary>
/// Turns a planner IFC into a Revit project the user can save as .rvt.
/// File → Open will not do this: that command only lists .rvt/.rte/.rfa, so
/// double-clicking or opening the IFC from there looks like nothing happened.
/// Only Revit can write a .rvt; this is the step that actually produces one.
/// </summary>
[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class OpenIfcCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var picker = new OpenFileDialog
        {
            Title = "Open planner IFC",
            Filter = "IFC files (*.ifc)|*.ifc|All files (*.*)|*.*",
            CheckFileExists = true
        };

        if (picker.ShowDialog() != true)
        {
            return Result.Cancelled;
        }

        string ifcPath = picker.FileName;
        UIApplication uiApp = commandData.Application;
        Document? converted;
        try
        {
            converted = uiApp.Application.OpenIFCDocument(ifcPath);
        }
        catch (Exception ex)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                "Revit could not convert that IFC into a project.\n\n" + ex.Message);
            return Result.Failed;
        }

        if (converted is null)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                "Revit returned no document from that IFC. The file may be empty or unreadable.");
            return Result.Failed;
        }

        int walls = new FilteredElementCollector(converted)
            .OfClass(typeof(Wall))
            .ToElementIds()
            .Count;
        int rooms = new FilteredElementCollector(converted)
            .OfCategory(BuiltInCategory.OST_Rooms)
            .WhereElementIsNotElementType()
            .ToElementIds()
            .Count;

        string rvtPath = Path.ChangeExtension(ifcPath, ".rvt");
        if (File.Exists(rvtPath))
        {
            TaskDialogResult overwrite = TaskDialog.Show(
                "StudioPractice Connector",
                $"{Path.GetFileName(rvtPath)} already exists next to the IFC.\nOverwrite it?",
                TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No);
            if (overwrite != TaskDialogResult.Yes)
            {
                TaskDialog.Show(
                    "StudioPractice Connector",
                    $"The IFC is open as an unsaved project ({walls} walls, {rooms} rooms).\nUse File → Save As to write a .rvt.");
                return Result.Succeeded;
            }
        }

        try
        {
            converted.SaveAs(rvtPath, new SaveAsOptions { OverwriteExistingFile = true });
        }
        catch (Exception ex)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                "The IFC opened, but Revit could not save a .rvt:\n\n" + ex.Message);
            return Result.Failed;
        }

        string summary = $"Saved as a Revit project:\n{rvtPath}\n\n{walls} walls, {rooms} rooms.";
        if (walls == 0)
        {
            summary += "\n\nNo walls came across. Open a 3D view before concluding the model is empty — if it still is, the IFC did not carry geometry Revit could map.";
        }

        TaskDialog.Show("StudioPractice Connector", summary);
        return Result.Succeeded;
    }
}
