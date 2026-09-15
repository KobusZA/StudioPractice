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

    [JsonPropertyName("extractorVersion")]
    public string ExtractorVersion { get; set; } = "";

    // Units migration (see UNITS-MIGRATION-PLAN.md): linear dimensions and lengths
    // (BomLine.Length, TakeoffInstance.Length/.Perimeter, SketchForm.Depth/.Sill,
    // SketchLoop.Length, SketchCurve.Length) are millimetres. Coordinates
    // (SketchCurve.Start/.End) stay metres - they are plan-sketch positions, not
    // named dimensions. Areas and volumes stay square/cubic metres throughout.
    [JsonPropertyName("units")]
    public string Units { get; set; } =
        "millimeters (lengths, perimeters) / meters (coordinates) / square meters / cubic meters";

    [JsonPropertyName("lines")]
    public List<BomLine> Lines { get; set; } = [];

    [JsonPropertyName("instances")]
    public List<TakeoffInstance> Instances { get; set; } = [];

    [JsonPropertyName("plans")]
    public List<PlanSketch> Plans { get; set; } = [];

    [JsonPropertyName("views")]
    public List<DocumentViewInfo> Views { get; set; } = [];

    [JsonPropertyName("sheets")]
    public List<DocumentSheetInfo> Sheets { get; set; } = [];

    [JsonPropertyName("families")]
    public List<LoadedFamilyType> Families { get; set; } = [];

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

public sealed class LoadedFamilyType
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("family")]
    public string Family { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    [JsonPropertyName("placedCount")]
    public int PlacedCount { get; set; }
}

public sealed class DocumentViewInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("viewType")]
    public string ViewType { get; set; } = "";

    [JsonPropertyName("viewFamily")]
    public string ViewFamily { get; set; } = "";

    [JsonPropertyName("level")]
    public string Level { get; set; } = "";

    [JsonPropertyName("scale")]
    public string Scale { get; set; } = "";

    [JsonPropertyName("sheetNumber")]
    public string SheetNumber { get; set; } = "";

    [JsonPropertyName("isActive")]
    public bool IsActive { get; set; }
}

public sealed class DocumentSheetInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("number")]
    public string Number { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("titleBlockFamily")]
    public string TitleBlockFamily { get; set; } = "";

    [JsonPropertyName("titleBlockType")]
    public string TitleBlockType { get; set; } = "";

    [JsonPropertyName("views")]
    public List<string> Views { get; set; } = [];
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

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("length")]
    public double? Length { get; set; }

    /// <summary>Square metres.</summary>
    [JsonPropertyName("area")]
    public double? Area { get; set; }

    /// <summary>Cubic metres.</summary>
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

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("length")]
    public double? Length { get; set; }

    /// <summary>Square metres.</summary>
    [JsonPropertyName("area")]
    public double? Area { get; set; }

    /// <summary>Cubic metres.</summary>
    [JsonPropertyName("volume")]
    public double? Volume { get; set; }

    /// <summary>Millimetres.</summary>
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

    /// <summary>Millimetres - a wall/room/opening height, not a coordinate.</summary>
    [JsonPropertyName("depth")]
    public double? Depth { get; set; }

    /// <summary>Millimetres - a window's sill height above its host wall's base.</summary>
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

    /// <summary>Millimetres - the sum of this loop's curve lengths.</summary>
    [JsonPropertyName("length")]
    public double Length { get; set; }
}

public sealed class SketchCurve
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("length")]
    public double Length { get; set; }

    /// <summary>Metres - a plan-sketch coordinate, not a named dimension. Deliberately
    /// not converted to millimetres by the units migration (see UNITS-MIGRATION-PLAN.md
    /// open decisions): this is a position in the same coordinate space the web canvas
    /// already draws in, not a fact a QS workbook or wall-type name states in mm.</summary>
    [JsonPropertyName("start")]
    public double[]? Start { get; set; }

    /// <summary>Metres - see <see cref="Start"/>.</summary>
    [JsonPropertyName("end")]
    public double[]? End { get; set; }
}
