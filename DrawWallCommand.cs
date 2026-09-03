using System.Windows.Interop;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using StudioPractice.RevitConnector.Ui;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class DrawWallCommand : IExternalCommand
{
    private static readonly ObjectSnapTypes Snaps =
        ObjectSnapTypes.Endpoints
        | ObjectSnapTypes.Midpoints
        | ObjectSnapTypes.Intersections
        | ObjectSnapTypes.Perpendicular
        | ObjectSnapTypes.Nearest
        | ObjectSnapTypes.Points;

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        UIDocument? uiDoc = commandData.Application.ActiveUIDocument;
        if (uiDoc is null || !PlanHost.TryGetFloorPlan(uiDoc, "Draw Wall", out _, out Level level))
        {
            return Result.Cancelled;
        }

        Document doc = uiDoc.Document;
        List<LabeledChoice> types = LoadedWallTypes(doc);
        if (types.Count == 0)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                "No basic wall types are in this project.\nOpen an architectural template, then try Draw Wall again.");
            return Result.Cancelled;
        }

        var picker = new ChoicePickerWindow(
            types,
            "Draw wall",
            "Choose a wall type, then click points in the floor plan. Esc finishes the chain.",
            "Draw");
        new WindowInteropHelper(picker).Owner = commandData.Application.MainWindowHandle;
        if (picker.ShowDialog() != true || picker.Selected?.Value is not WallType wallType)
        {
            return Result.Cancelled;
        }

        double height = WallHeight(wallType, level);
        XYZ? previous = null;
        int created = 0;

        try
        {
            while (true)
            {
                string status = previous is null
                    ? "Click the start of the wall"
                    : "Click the next point. Esc to finish.";
                XYZ point = uiDoc.Selection.PickPoint(Snaps, status);
                if (previous is not null && !previous.IsAlmostEqualTo(point))
                {
                    Line line = Line.CreateBound(previous, point);
                    using var tx = new Transaction(doc, "Draw wall");
                    tx.Start();
                    Wall.Create(doc, line, wallType.Id, level.Id, height, 0, false, false);
                    tx.Commit();
                    created++;
                }

                previous = point;
            }
        }
        catch (Autodesk.Revit.Exceptions.OperationCanceledException)
        {
            return created > 0 ? Result.Succeeded : Result.Cancelled;
        }
        catch (Exception ex)
        {
            message = ex.Message;
            TaskDialog.Show("StudioPractice Connector", "Could not draw the wall:\n" + ex.Message);
            return Result.Failed;
        }
    }

    private static List<LabeledChoice> LoadedWallTypes(Document doc)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(WallType))
            .Cast<WallType>()
            .Where(type => type.Kind is WallKind.Basic or WallKind.Curtain)
            .Select(type => new LabeledChoice
            {
                Label = $"{type.FamilyName}  ·  {type.Name}",
                Value = type
            })
            .OrderBy(t => t.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static double WallHeight(WallType wallType, Level level)
    {
        Parameter? typeHeight = wallType.get_Parameter(BuiltInParameter.WALL_USER_HEIGHT_PARAM);
        if (typeHeight is { HasValue: true } && typeHeight.StorageType == StorageType.Double)
        {
            double value = typeHeight.AsDouble();
            if (value > 0)
            {
                return value;
            }
        }

        Level? above = NextLevel(level);
        if (above is not null)
        {
            double story = above.Elevation - level.Elevation;
            if (story > 0)
            {
                return story;
            }
        }

        return UnitUtils.ConvertToInternalUnits(3.0, UnitTypeId.Meters);
    }

    private static Level? NextLevel(Level level)
    {
        return new FilteredElementCollector(level.Document)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .Where(candidate => candidate.Id != level.Id && candidate.Elevation > level.Elevation)
            .OrderBy(candidate => candidate.Elevation)
            .FirstOrDefault();
    }
}
