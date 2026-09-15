using System.IO;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Extraction;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector;

public static class ConnectorHotSwap
{
    private static readonly object Gate = new();
    private static Assembly? _logic;
    private static string? _logicPath;
    private static DateTime _logicStamp;
    private static bool _offeredThisSession;

    public static string LoadedPath => _logicPath ?? typeof(App).Assembly.Location;

    public static string? FindNewerBuild()
    {
        DateTime loaded = File.GetLastWriteTimeUtc(typeof(App).Assembly.Location);
        if (_logicPath is not null)
        {
            loaded = _logicStamp;
        }

        string? newest = null;
        DateTime newestStamp = loaded;

        foreach (string candidate in CandidatePaths())
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            DateTime stamp = File.GetLastWriteTimeUtc(candidate);
            if (stamp > newestStamp.AddSeconds(1))
            {
                newest = candidate;
                newestStamp = stamp;
            }
        }

        return newest;
    }

    public static void OfferIfNewer()
    {
        lock (Gate)
        {
            if (_offeredThisSession)
            {
                return;
            }

            string? newer = FindNewerBuild();
            if (newer is null)
            {
                return;
            }

            _offeredThisSession = true;
            var dialog = new TaskDialog("StudioPractice Connector")
            {
                MainInstruction = "Updated connector is ready",
                MainContent =
                    "Revit is still using the add-in it loaded at startup, so Families and other new extract fields are missing.\n\n" +
                    $"Newer build:\n{newer}\n\n" +
                    "Load it now. You do not need to close Revit.",
                CommonButtons = TaskDialogCommonButtons.None
            };
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Load the new connector now");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Keep the old one");

            if (dialog.Show() == TaskDialogResult.CommandLink1)
            {
                LoadFrom(newer);
                TaskDialog.Show(
                    "StudioPractice Connector",
                    "New connector loaded. Click Send to App or Import from Revit to extract Families, views, and sheets.");
            }
        }
    }

    public static bool LoadNewerNow(out string message)
    {
        string? newer = FindNewerBuild();
        if (newer is null)
        {
            message = $"Already using the latest build:\n{LoadedPath}";
            return false;
        }

        LoadFrom(newer);
        message = $"Loaded:\n{LoadedPath}";
        return true;
    }

    public static string ExtractJson(UIApplication app)
    {
        TryLoadNewerSilently();
        Assembly logic;
        lock (Gate)
        {
            logic = _logic ?? typeof(BomExtractor).Assembly;
        }

        if (ReferenceEquals(logic, typeof(BomExtractor).Assembly))
        {
            BomPayload payload = BomExtractor.Extract(app);
            BomJson.Write(payload);
            return BomJson.Serialize(payload);
        }

        return InvokeExtract(logic, app);
    }

    private static void TryLoadNewerSilently()
    {
        string? newer = FindNewerBuild();
        if (newer is not null)
        {
            LoadFrom(newer);
        }
    }

    private static IEnumerable<string> CandidatePaths()
    {
        string addinDir = Path.GetDirectoryName(typeof(App).Assembly.Location) ?? "";
        yield return Path.Combine(addinDir, "StudioPractice.RevitConnector.pending.dll");
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StudioPractice.RevitConnector",
            "StudioPractice.RevitConnector.dll");
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            @"source\repos\StudioPractice.RevitConnector\bin\Debug\StudioPractice.RevitConnector.dll");
    }

    private static void LoadFrom(string source)
    {
        lock (Gate)
        {
            string shadowDir = Path.Combine(
                Path.GetTempPath(),
                "StudioPractice.RevitConnector",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(shadowDir);
            string shadow = Path.Combine(shadowDir, "StudioPractice.RevitConnector.dll");
            File.Copy(source, shadow, true);
            string pdb = Path.ChangeExtension(source, ".pdb");
            if (File.Exists(pdb))
            {
                File.Copy(pdb, Path.ChangeExtension(shadow, ".pdb"), true);
            }

            var alc = new AssemblyLoadContext("StudioPracticeConnector", isCollectible: true);
            alc.Resolving += (_, name) =>
            {
                if (name.Name is "RevitAPI" or "RevitAPIUI")
                {
                    return Assembly.Load(name);
                }

                return null;
            };
            _logic = alc.LoadFromAssemblyPath(shadow);
            _logicPath = source;
            _logicStamp = File.GetLastWriteTimeUtc(source);
        }
    }

    private static string InvokeExtract(Assembly logic, UIApplication app)
    {
        Type extractor = logic.GetType("StudioPractice.RevitConnector.Extraction.BomExtractor")
                        ?? throw new InvalidOperationException("Newer connector is missing BomExtractor.");
        Type json = logic.GetType("StudioPractice.RevitConnector.BomJson")
                    ?? throw new InvalidOperationException("Newer connector is missing BomJson.");

        object payload = extractor.GetMethod("Extract", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, [app])
                         ?? throw new InvalidOperationException("Extract returned nothing.");
        json.GetMethod("Write", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, [payload]);
        return (string)json.GetMethod("Serialize", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, [payload])!;
    }

    public static string Summarize(string json)
    {
        using JsonDocument doc = JsonDocument.Parse(json);
        JsonElement root = doc.RootElement;
        int Count(string name) =>
            root.TryGetProperty(name, out JsonElement arr) && arr.ValueKind == JsonValueKind.Array
                ? arr.GetArrayLength()
                : 0;

        string title = root.TryGetProperty("title", out JsonElement t) ? t.GetString() ?? "" : "";
        string active = root.TryGetProperty("activeView", out JsonElement av) ? av.GetString() ?? "" : "";
        string viewType = root.TryGetProperty("viewType", out JsonElement vt) ? vt.GetString() ?? "" : "";
        return
            $"{title}\n" +
            $"View: {active} ({viewType})\n" +
            $"Families: {Count("families")} types · Views: {Count("views")} · Sheets: {Count("sheets")}\n" +
            $"BOM lines: {Count("lines")}";
    }
}
