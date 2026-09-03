using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class PlaceRoomCommand : IExternalCommand
{
    private static readonly ObjectSnapTypes Snaps =
        ObjectSnapTypes.Intersections | ObjectSnapTypes.Nearest | ObjectSnapTypes.Points;

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        UIDocument? uiDoc = commandData.Application.ActiveUIDocument;
        if (uiDoc is null || !PlanHost.TryGetFloorPlan(uiDoc, "Place Room", out ViewPlan plan, out Level level))
        {
            return Result.Cancelled;
        }

        Document doc = uiDoc.Document;
        int created = 0;

        try
        {
            while (true)
            {
                XYZ point = uiDoc.Selection.PickPoint(
                    Snaps,
                    "Click inside a closed wall loop. Esc to finish.");
                var uv = new UV(point.X, point.Y);

                using var tx = new Transaction(doc, "Place room");
                tx.Start();
                try
                {
                    Room room = doc.Create.NewRoom(level, uv);
                    doc.Regenerate();
                    if (room.Area <= 0)
                    {
                        doc.Delete(room.Id);
                        tx.RollBack();
                        TaskDialog.Show(
                            "StudioPractice Connector",
                            "That click is not inside a closed, room-bounding loop.\nDraw walls that fully enclose the space, then click again.");
                        continue;
                    }

                    RoomTag tag = doc.Create.NewRoomTag(new LinkElementId(room.Id), uv, plan.Id);
                    tag.HasLeader = false;
                    tx.Commit();
                    created++;
                }
                catch (Autodesk.Revit.Exceptions.InvalidOperationException ex)
                {
                    tx.RollBack();
                    TaskDialog.Show("StudioPractice Connector", "Could not place a room there:\n" + ex.Message);
                }
                catch (Autodesk.Revit.Exceptions.ArgumentException ex)
                {
                    tx.RollBack();
                    TaskDialog.Show("StudioPractice Connector", "Could not place a room there:\n" + ex.Message);
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
            TaskDialog.Show("StudioPractice Connector", "Could not place the room:\n" + ex.Message);
            return Result.Failed;
        }
    }
}
