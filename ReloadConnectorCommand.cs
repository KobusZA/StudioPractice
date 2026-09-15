using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.Manual)]
[Regeneration(RegenerationOption.Manual)]
public class ReloadConnectorCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        ConnectorHotSwap.LoadNewerNow(out string text);
        TaskDialog.Show("StudioPractice Connector", text);
        return Result.Succeeded;
    }
}
