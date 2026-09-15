using System.Text.Json.Serialization;

namespace StudioPractice.RevitConnector.Models;

/// <summary>
/// A raw dump of every type in the template. Deliberately carries no
/// StudioPractice concepts: the mapping from a Revit type to a SKU lives in
/// web/v2/build-pack.js so it can be tested without Revit.
///
/// Units migration (see UNITS-MIGRATION-PLAN.md): every named linear dimension
/// (<see cref="CatalogType.StructureWidth"/>, <see cref="CatalogLayer.Width"/>,
/// <see cref="CatalogTitleBlock.Width"/>/<see cref="CatalogTitleBlock.Height"/>,
/// and length-typed entries in <see cref="CatalogType.TypeParams"/>/
/// <see cref="CatalogType.InstanceParams"/>) is millimetres.
/// <see cref="CatalogLevel.Elevation"/> stays metres: a storey elevation is a
/// position in the plan's coordinate space, not a named dimension the QS
/// workbook or a wall-type name states in mm.
/// </summary>
public sealed class TypeCatalogPayload
{
    [JsonPropertyName("schema")]
    public string Schema { get; set; } = "sp.catalog/1";

    [JsonPropertyName("title")]
    public string Title { get; set; } = "";

    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("extractedAt")]
    public string ExtractedAt { get; set; } = "";

    [JsonPropertyName("units")]
    public string Units { get; set; } = "millimeters (lengths, widths, structure) / meters (level elevations)";

    [JsonPropertyName("levels")]
    public List<CatalogLevel> Levels { get; set; } = [];

    [JsonPropertyName("types")]
    public List<CatalogType> Types { get; set; } = [];

    [JsonPropertyName("titleBlocks")]
    public List<CatalogTitleBlock> TitleBlocks { get; set; } = [];

    [JsonPropertyName("views")]
    public List<CatalogView> Views { get; set; } = [];
}

public sealed class CatalogLevel
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    /// <summary>Metres. See the units note on <see cref="TypeCatalogPayload"/>.</summary>
    [JsonPropertyName("elevation")]
    public double Elevation { get; set; }

    [JsonPropertyName("typeName")]
    public string TypeName { get; set; } = "";
}

public sealed class CatalogType
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    /// <summary>Revit category name, e.g. "Walls", "Electrical Fixtures".</summary>
    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("builtInCategory")]
    public string BuiltInCategory { get; set; } = "";

    [JsonPropertyName("family")]
    public string Family { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    /// <summary>System, Component, In-place or Annotation.</summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    [JsonPropertyName("placedCount")]
    public int PlacedCount { get; set; }

    /// <summary>Total compound-structure width for system types, in millimetres.</summary>
    [JsonPropertyName("structureWidth")]
    public double? StructureWidth { get; set; }

    [JsonPropertyName("layers")]
    public List<CatalogLayer> Layers { get; set; } = [];

    [JsonPropertyName("materials")]
    public List<string> Materials { get; set; } = [];

    /// <summary>Every numeric type parameter, converted to millimetres where it is a
    /// length. Non-length parameters (counts, unitless values) pass through unconverted;
    /// this dictionary has no per-key unit tag, a known gap tracked in
    /// UNITS-MIGRATION-PLAN.md.</summary>
    [JsonPropertyName("typeParams")]
    public Dictionary<string, double> TypeParams { get; set; } = [];

    /// <summary>Numeric parameters read off one placed instance, for instance-level facts such as sill height.</summary>
    [JsonPropertyName("instanceParams")]
    public Dictionary<string, double> InstanceParams { get; set; } = [];

    /// <summary>Name of the level the sampled instance is hosted on, if Revit can resolve one. Links
    /// instance-level facts (e.g. a ceiling's "Height Offset From Level") back to a specific storey.</summary>
    [JsonPropertyName("instanceLevel")]
    public string? InstanceLevel { get; set; }
}

public sealed class CatalogLayer
{
    [JsonPropertyName("function")]
    public string Function { get; set; } = "";

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("width")]
    public double Width { get; set; }

    [JsonPropertyName("material")]
    public string Material { get; set; } = "";
}

public sealed class CatalogTitleBlock
{
    [JsonPropertyName("family")]
    public string Family { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("width")]
    public double Width { get; set; }

    /// <summary>Millimetres.</summary>
    [JsonPropertyName("height")]
    public double Height { get; set; }

    [JsonPropertyName("sheetCount")]
    public int SheetCount { get; set; }
}

public sealed class CatalogView
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("viewType")]
    public string ViewType { get; set; } = "";

    [JsonPropertyName("level")]
    public string Level { get; set; } = "";

    [JsonPropertyName("scale")]
    public int Scale { get; set; }

    [JsonPropertyName("onSheet")]
    public string OnSheet { get; set; } = "";
}
