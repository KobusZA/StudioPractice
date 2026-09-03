using System.Windows.Interop;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using StudioPractice.RevitConnector.Ui;

namespace StudioPractice.RevitConnector;

internal static class PlaceFamily
{
    private static readonly ObjectSnapTypes Snaps =
        ObjectSnapTypes.Endpoints
        | ObjectSnapTypes.Midpoints
        | ObjectSnapTypes.Intersections
        | ObjectSnapTypes.Perpendicular
        | ObjectSnapTypes.Nearest
        | ObjectSnapTypes.Points;

    public static Result Run(
        ExternalCommandData commandData,
        ref string message,
        BuiltInCategory category,
        string noun,
        string prompt)
    {
        string titleNoun = Capitalize(noun);
        UIDocument? uiDoc = commandData.Application.ActiveUIDocument;
        if (uiDoc is null || !PlanHost.TryGetFloorPlan(uiDoc, $"Place {titleNoun}", out _, out Level level))
        {
            return Result.Cancelled;
        }

        Document doc = uiDoc.Document;
        List<FamilyTypeChoice> types = LoadedTypes(doc, category);
        if (types.Count == 0)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                $"No {noun} types are loaded in this project.\nLoad a family (Insert → Load Family), then try Place {titleNoun} again.");
            return Result.Cancelled;
        }

        var picker = new ChoicePickerWindow(
            types.Select(t => new LabeledChoice { Label = t.Label, Value = t }).ToList(),
            $"Place {noun}",
            prompt,
            "Place");
        new WindowInteropHelper(picker).Owner = commandData.Application.MainWindowHandle;
        if (picker.ShowDialog() != true || picker.Selected?.Value is not FamilyTypeChoice choice)
        {
            return Result.Cancelled;
        }

        FamilySymbol symbol = choice.Symbol;
        int created = 0;
        try
        {
            if (!symbol.IsActive)
            {
                using var tx = new Transaction(doc, $"Activate {noun} type");
                tx.Start();
                symbol.Activate();
                doc.Regenerate();
                tx.Commit();
            }

            bool wallHosted = IsWallHosted(symbol, category);
            var hostFilter = new HostSelectionFilter(category);
            bool wallOnly = category is BuiltInCategory.OST_Doors or BuiltInCategory.OST_Windows;
            string hostPrompt = wallOnly
                ? $"Click a wall to place the {noun}. Esc to finish."
                : $"Click a wall, floor, or ceiling to place the {noun}. Esc to finish.";

            while (true)
            {
                try
                {
                    if (wallHosted)
                    {
                        Reference hostRef = uiDoc.Selection.PickObject(
                            ObjectType.PointOnElement,
                            hostFilter,
                            hostPrompt);
                        Element host = doc.GetElement(hostRef);
                        XYZ point = PointOnHost(host, hostRef.GlobalPoint);
                        using var tx = new Transaction(doc, $"Place {noun}");
                        tx.Start();
                        doc.Create.NewFamilyInstance(point, symbol, host, level, StructuralType.NonStructural);
                        tx.Commit();
                    }
                    else
                    {
                        XYZ point = uiDoc.Selection.PickPoint(Snaps, $"Click to place the {noun}. Esc to finish.");
                        using var tx = new Transaction(doc, $"Place {noun}");
                        tx.Start();
                        doc.Create.NewFamilyInstance(point, symbol, level, StructuralType.NonStructural);
                        tx.Commit();
                    }

                    created++;
                }
                catch (Exception ex) when (ex is Autodesk.Revit.Exceptions.InvalidOperationException
                    or Autodesk.Revit.Exceptions.ArgumentException
                    or Autodesk.Revit.Exceptions.InvalidObjectException)
                {
                    TaskDialog.Show("StudioPractice Connector", $"Could not place the {noun} there:\n" + ex.Message);
                }
            }
        }
        catch (Autodesk.Revit.Exceptions.OperationCanceledException)
        {
            return created > 0 ? Result.Succeeded : Result.Cancelled;
        }
        catch (Exception ex)
        {
            message = ex.Message;
            TaskDialog.Show("StudioPractice Connector", $"Could not place the {noun}:\n" + ex.Message);
            return Result.Failed;
        }
    }

    private static bool IsWallHosted(FamilySymbol symbol, BuiltInCategory category)
    {
        if (category is BuiltInCategory.OST_Doors or BuiltInCategory.OST_Windows)
        {
            return true;
        }

        return symbol.Family.FamilyPlacementType is FamilyPlacementType.OneLevelBasedHosted;
    }

    private static XYZ PointOnHost(Element host, XYZ pick)
    {
        if (host is Wall { Location: LocationCurve location })
        {
            IntersectionResult? projection = location.Curve.Project(pick);
            if (projection is not null)
            {
                return projection.XYZPoint;
            }
        }

        return pick;
    }

    private static List<FamilyTypeChoice> LoadedTypes(Document doc, BuiltInCategory category)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(category)
            .Cast<FamilySymbol>()
            .Select(symbol => new FamilyTypeChoice
            {
                Symbol = symbol,
                Family = symbol.FamilyName,
                Type = symbol.Name
            })
            .OrderBy(t => t.Family, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string Capitalize(string noun) =>
        string.IsNullOrEmpty(noun) ? noun : char.ToUpperInvariant(noun[0]) + noun[1..];

    private sealed class HostSelectionFilter : ISelectionFilter
    {
        private readonly BuiltInCategory _category;

        public HostSelectionFilter(BuiltInCategory category) => _category = category;

        public bool AllowElement(Element elem)
        {
            if (_category is BuiltInCategory.OST_Doors or BuiltInCategory.OST_Windows)
            {
                return elem is Wall;
            }

            return elem is HostObject;
        }

        public bool AllowReference(Reference reference, XYZ position) => true;
    }
}
