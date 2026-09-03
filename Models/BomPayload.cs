using System.Text.Json.Serialization;

namespace StudioPractice.RevitConnector.Models;

public sealed class BomPayload
{
    [JsonPropertyName("documentKind")]
    public string DocumentKind { get; set; } = "";

    [JsonPropertyName("title")]
    public string Title { get; set; } = "";

    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("activeView")]
    public string ActiveView { get; set; } = "";

    [JsonPropertyName("viewType")]
    public string ViewType { get; set; } = "";

    [JsonPropertyName("extractedAt")]
    public string ExtractedAt { get; set; } = "";

    [JsonPropertyName("units")]
    public string Units { get; set; } = "meters / square meters / cubic meters";

    [JsonPropertyName("lines")]
    public List<BomLine> Lines { get; set; } = [];

    [JsonPropertyName("instances")]
    public List<TakeoffInstance> Instances { get; set; } = [];

    [JsonPropertyName("plans")]
    public List<PlanSketch> Plans { get; set; } = [];

    [JsonPropertyName("sketchForms")]
    public List<SketchForm> SketchForms { get; set; } = [];

    [JsonPropertyName("meshes")]
    public List<ModelMesh> Meshes { get; set; } = [];
}

public sealed class ModelMesh
{
    [JsonPropertyName("elementId")]
    public string ElementId { get; set; } = "";

    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("fill")]
    public string Fill { get; set; } = "#c4a574";

    [JsonPropertyName("stroke")]
    public string Stroke { get; set; } = "#8a7352";

    [JsonPropertyName("positions")]
    public List<double> Positions { get; set; } = [];

    [JsonPropertyName("indices")]
    public List<int> Indices { get; set; } = [];
}

public sealed class PlanSketch
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("viewType")]
    public string ViewType { get; set; } = "";

    [JsonPropertyName("discipline")]
    public string Discipline { get; set; } = "";

    [JsonPropertyName("level")]
    public string Level { get; set; } = "";

    [JsonPropertyName("elevation")]
    public double Elevation { get; set; }

    [JsonPropertyName("isActive")]
    public bool IsActive { get; set; }

    [JsonPropertyName("sketchForms")]
    public List<SketchForm> SketchForms { get; set; } = [];
}

public sealed class BomLine
{
    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("family")]
    public string Family { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("model")]
    public string Model { get; set; } = "";

    [JsonPropertyName("quantity")]
    public double Quantity { get; set; }

    [JsonPropertyName("unit")]
    public string Unit { get; set; } = "ea";

    [JsonPropertyName("length")]
    public double? Length { get; set; }

    [JsonPropertyName("area")]
    public double? Area { get; set; }

    [JsonPropertyName("volume")]
    public double? Volume { get; set; }

    [JsonPropertyName("elementIds")]
    public List<string> ElementIds { get; set; } = [];
}

public sealed class TakeoffInstance
{
    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("model")]
    public string Model { get; set; } = "";

    [JsonPropertyName("family")]
    public string Family { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("elementId")]
    public string ElementId { get; set; } = "";

    [JsonPropertyName("count")]
    public double Count { get; set; } = 1;

    [JsonPropertyName("length")]
    public double? Length { get; set; }

    [JsonPropertyName("area")]
    public double? Area { get; set; }

    [JsonPropertyName("volume")]
    public double? Volume { get; set; }

    [JsonPropertyName("perimeter")]
    public double? Perimeter { get; set; }

    [JsonPropertyName("level")]
    public string? Level { get; set; }

    [JsonPropertyName("phaseCreated")]
    public string? PhaseCreated { get; set; }

    [JsonPropertyName("phaseDemolished")]
    public string? PhaseDemolished { get; set; }
}

public sealed class SketchForm
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    [JsonPropertyName("elementId")]
    public string ElementId { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("isSolid")]
    public bool? IsSolid { get; set; }

    [JsonPropertyName("depth")]
    public double? Depth { get; set; }

    [JsonPropertyName("sill")]
    public double? Sill { get; set; }

    [JsonPropertyName("volume")]
    public double? Volume { get; set; }

    [JsonPropertyName("material")]
    public string? Material { get; set; }

    [JsonPropertyName("profileLoops")]
    public List<SketchLoop> ProfileLoops { get; set; } = [];
}

public sealed class SketchLoop
{
    [JsonPropertyName("curves")]
    public List<SketchCurve> Curves { get; set; } = [];

    [JsonPropertyName("length")]
    public double Length { get; set; }
}

public sealed class SketchCurve
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    [JsonPropertyName("length")]
    public double Length { get; set; }

    [JsonPropertyName("start")]
    public double[]? Start { get; set; }

    [JsonPropertyName("end")]
    public double[]? End { get; set; }
}
