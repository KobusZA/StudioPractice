using System.IO;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;

namespace StudioPractice.RevitConnector;

public class App : IExternalApplication
{
    public const string TabName = "StudioPractice";
    public const string PanelName = "Connector";

    private LocalConnectorHost? _host;

    public Result OnStartup(UIControlledApplication application)
    {
        try
        {
            application.CreateRibbonTab(TabName);
        }
        catch (Autodesk.Revit.Exceptions.ArgumentException)
        {
            // Tab already exists (e.g. after a reload).
        }

        RibbonPanel panel = application.CreateRibbonPanel(TabName, PanelName);
        string assemblyPath = typeof(App).Assembly.Location;

        var place = new PushButtonData(
            "StudioPractice.PlaceDoor",
            "Place\nDoor",
            assemblyPath,
            "StudioPractice.RevitConnector.PlaceDoorCommand");
        place.ToolTip = "Choose a loaded door type and click a wall in the floor plan. Esc finishes.";
        AssignIcons(place, "PlaceDoor32.png", "PlaceDoor16.png");

        var window = new PushButtonData(
            "StudioPractice.PlaceWindow",
            "Place\nWindow",
            assemblyPath,
            "StudioPractice.RevitConnector.PlaceWindowCommand");
        window.ToolTip = "Choose a loaded window type and click a wall in the floor plan. Esc finishes.";
        AssignIcons(window, "PlaceWindow32.png", "PlaceWindow16.png");

        var drawWall = PlaceButton(
            assemblyPath,
            "StudioPractice.DrawWall",
            "Draw\nWall",
            "StudioPractice.RevitConnector.DrawWallCommand",
            "Choose a wall type and click points in the floor plan. Esc finishes the chain.",
            "DrawWall32.png",
            "DrawWall16.png");
        var placeRoom = PlaceButton(
            assemblyPath,
            "StudioPractice.PlaceRoom",
            "Place\nRoom",
            "StudioPractice.RevitConnector.PlaceRoomCommand",
            "Click inside a closed wall loop to place a room and tag. Esc finishes.",
            "PlaceRoom32.png",
            "PlaceRoom16.png");

        var bom = new PushButtonData(
            "StudioPractice.ExtractBom",
            "Send to\nApp",
            assemblyPath,
            "StudioPractice.RevitConnector.ExtractBomCommand");
        bom.ToolTip = "Extract BOM and floor-plan sketch, save JSON, and serve it to the web app on port 17300.";
        AssignIcons(bom, "SendToApp32.png", "SendToApp16.png");

        var info = new PushButtonData(
            "StudioPractice.DocumentInfo",
            "Document\nInfo",
            assemblyPath,
            "StudioPractice.RevitConnector.DocumentInfoCommand");
        info.ToolTip = "Reads the open model's title, path, and active view.";
        AssignIcons(info, "DocumentInfo32.png", "DocumentInfo16.png");

        var about = new PushButtonData(
            "StudioPractice.About",
            "About",
            assemblyPath,
            "StudioPractice.RevitConnector.AboutCommand");
        about.ToolTip = "Shows Studio Practice product, user, and license details.";
        AssignIcons(about, "About32.png", "About16.png");

        var plumbing = PlaceButton(
            assemblyPath,
            "StudioPractice.PlacePlumbing",
            "Plumbing",
            "StudioPractice.RevitConnector.PlacePlumbingCommand",
            "Choose a loaded plumbing fixture and place it in the floor plan.",
            "PlacePlumbing32.png",
            "PlacePlumbing16.png");
        var lighting = PlaceButton(
            assemblyPath,
            "StudioPractice.PlaceLighting",
            "Lighting",
            "StudioPractice.RevitConnector.PlaceLightingCommand",
            "Choose a loaded lighting fixture and place it in the model.",
            "PlaceLighting32.png",
            "PlaceLighting16.png");
        var electrical = PlaceButton(
            assemblyPath,
            "StudioPractice.PlaceElectrical",
            "Electrical",
            "StudioPractice.RevitConnector.PlaceElectricalCommand",
            "Choose a loaded electrical fixture and place it on a wall or in the floor plan.",
            "PlaceElectrical32.png",
            "PlaceElectrical16.png");

        var furniture = PlaceButton(
            assemblyPath,
            "StudioPractice.PlaceFurniture",
            "Furniture",
            "StudioPractice.RevitConnector.PlaceFurnitureCommand",
            "Choose a loaded furniture type and place it in the floor plan.",
            "PlaceFurniture32.png",
            "PlaceFurniture16.png");
        var casework = PlaceButton(
            assemblyPath,
            "StudioPractice.PlaceCasework",
            "Casework",
            "StudioPractice.RevitConnector.PlaceCaseworkCommand",
            "Choose a loaded casework type and place it in the floor plan.",
            "PlaceCasework32.png",
            "PlaceCasework16.png");

        var fixtureMenu = new PulldownButtonData("StudioPractice.PlaceFixture", "Place\nFixture");
        fixtureMenu.ToolTip = "Place plumbing, lighting, or electrical fixtures from loaded families.";
        AssignIcons(fixtureMenu, "PlaceFixture32.png", "PlaceFixture16.png");

        var furnitureMenu = new PulldownButtonData("StudioPractice.PlaceFurnishing", "Place\nFurniture");
        furnitureMenu.ToolTip = "Place furniture or casework from loaded families.";
        AssignIcons(furnitureMenu, "PlaceFurniture32.png", "PlaceFurniture16.png");

        panel.AddItem(place);
        panel.AddItem(window);
        var fixturePull = (PulldownButton)panel.AddItem(fixtureMenu);
        fixturePull.AddPushButton(plumbing);
        fixturePull.AddPushButton(lighting);
        fixturePull.AddPushButton(electrical);
        var furniturePull = (PulldownButton)panel.AddItem(furnitureMenu);
        furniturePull.AddPushButton(furniture);
        furniturePull.AddPushButton(casework);
        panel.AddItem(drawWall);
        panel.AddItem(placeRoom);
        panel.AddItem(bom);
        panel.AddItem(info);
        panel.AddItem(about);

        try
        {
            _host = new LocalConnectorHost();
            _host.Start();
        }
        catch (Exception)
        {
            _host = null;
        }

        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication application)
    {
        _host?.Dispose();
        _host = null;
        return Result.Succeeded;
    }

    private static PushButtonData PlaceButton(
        string assemblyPath,
        string name,
        string text,
        string className,
        string toolTip,
        string largeIcon,
        string smallIcon)
    {
        var button = new PushButtonData(name, text, assemblyPath, className)
        {
            ToolTip = toolTip
        };
        AssignIcons(button, largeIcon, smallIcon);
        return button;
    }

    private static void AssignIcons(ButtonData button, string largeFileName, string smallFileName)
    {
        BitmapImage? large = LoadIcon(largeFileName);
        BitmapImage? small = LoadIcon(smallFileName);
        if (large is not null)
            button.LargeImage = large;
        if (small is not null)
            button.Image = small;
    }

    private static BitmapImage? LoadIcon(string fileName)
    {
        var assembly = typeof(App).Assembly;
        using Stream? stream = assembly.GetManifestResourceStream(
            $"{assembly.GetName().Name}.Resources.{fileName}");
        if (stream is null)
            return null;

        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        return image;
    }
}
