using System.Windows.Interop;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Ui;

namespace StudioPractice.RevitConnector;

[Transaction(TransactionMode.ReadOnly)]
[Regeneration(RegenerationOption.Manual)]
public class AboutCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var about = new AboutWindow();
        new WindowInteropHelper(about).Owner = commandData.Application.MainWindowHandle;
        about.ShowDialog();
        return Result.Succeeded;
    }
}
