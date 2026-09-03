using System.IO;
using System.Text.Json;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector;

public static class BomJson
{
    public static readonly string OutputDirectory = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "StudioPractice.RevitConnector");

    public static readonly string OutputPath = System.IO.Path.Combine(OutputDirectory, "bom.json");

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true
    };

    public static string? LastJson { get; private set; }

    public static string Serialize(BomPayload payload) => JsonSerializer.Serialize(payload, Options);

    public static string Write(BomPayload payload)
    {
        Directory.CreateDirectory(OutputDirectory);
        string json = Serialize(payload);
        LastJson = json;
        File.WriteAllText(OutputPath, json);

        string repoOutput = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            @"source\repos\StudioPractice.RevitConnector\output\bom.json");
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(repoOutput)!);
            File.WriteAllText(repoOutput, json);
        }
        catch (System.IO.IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }

        return OutputPath;
    }
}
