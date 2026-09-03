using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

internal static class PlanHost
{
    public static bool TryGetFloorPlan(UIDocument uiDoc, string action, out ViewPlan plan, out Level level)
    {
        plan = null!;
        level = null!;
        Document? doc = uiDoc.Document;
        if (doc is null)
        {
            TaskDialog.Show("StudioPractice Connector", $"Open a project and a floor plan, then try {action} again.");
            return false;
        }

        if (doc.IsFamilyDocument)
        {
            TaskDialog.Show(
                "StudioPractice Connector",
                $"{action} works in a project (.rvt) on a floor plan.");
            return false;
        }

        if (uiDoc.ActiveView is not ViewPlan viewPlan || viewPlan.ViewType != ViewType.FloorPlan)
        {
            TaskDialog.Show("StudioPractice Connector", $"{action} needs an active floor plan view.");
            return false;
        }

        Level? genLevel = viewPlan.GenLevel;
        if (genLevel is null)
        {
            TaskDialog.Show("StudioPractice Connector", $"{action} needs a floor plan associated with a level.");
            return false;
        }

        plan = viewPlan;
        level = genLevel;
        return true;
    }
}
