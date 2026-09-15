using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector.Extraction;

/// <summary>
/// Dumps every type in the open template so the SKU pack can be regenerated from
/// the firm's own file instead of being transcribed by hand. Emits raw facts
/// only; build-pack.js decides what becomes a SKU.
/// </summary>
public static class TypeCatalogExtractor
{
    public static TypeCatalogPayload Extract(UIApplication uiApp)
    {
        UIDocument uiDoc = uiApp.ActiveUIDocument
            ?? throw new InvalidOperationException("Open the template model first.");

        Document doc = uiDoc.Document;
        if (doc.IsFamilyDocument)
        {
            throw new InvalidOperationException("Open a project, not a family, before exporting the catalog.");
        }

        var payload = new TypeCatalogPayload
        {
            Title = doc.Title,
            Path = string.IsNullOrWhiteSpace(doc.PathName) ? "(unsaved)" : doc.PathName,
            ExtractedAt = DateTime.UtcNow.ToString("o")
        };

        IList<Element> instances = new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .ToElements();

        var placedCount = new Dictionary<ElementId, int>();
        var sample = new Dictionary<ElementId, Element>();
        foreach (Element element in instances)
        {
            ElementId typeId = element.GetTypeId();
            if (typeId == ElementId.InvalidElementId)
            {
                continue;
            }

            placedCount[typeId] = placedCount.GetValueOrDefault(typeId) + 1;
            if (!sample.ContainsKey(typeId))
            {
                sample[typeId] = element;
            }
        }

        payload.Levels = BuildLevels(doc);
        payload.Types = BuildTypes(doc, placedCount, sample);
        payload.TitleBlocks = BuildTitleBlocks(doc);
        payload.Views = BuildViews(doc);

        return payload;
    }

    private static List<CatalogLevel> BuildLevels(Document doc)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(l => l.Elevation)
            .Select(l => new CatalogLevel
            {
                Id = l.Id.Value.ToString(),
                Name = l.Name,
                Elevation = Round(ToMeters(l.Elevation)),
                TypeName = SafeTypeName(doc, l)
            })
            .ToList();
    }

    private static string SafeTypeName(Document doc, Element element)
    {
        try
        {
            return doc.GetElement(element.GetTypeId())?.Name ?? "";
        }
        catch (Exception)
        {
            return "";
        }
    }

    private static List<CatalogType> BuildTypes(
        Document doc,
        IReadOnlyDictionary<ElementId, int> placedCount,
        IReadOnlyDictionary<ElementId, Element> sample)
    {
        var types = new List<CatalogType>();

        foreach (ElementType type in new FilteredElementCollector(doc)
                     .WhereElementIsElementType()
                     .OfClass(typeof(ElementType))
                     .Cast<ElementType>())
        {
            try
            {
                if (type is ViewFamilyType)
                {
                    continue;
                }

                Category? category = type.Category;
                if (category is null || category.CategoryType is not CategoryType.Model)
                {
                    continue;
                }

                var entry = new CatalogType
                {
                    Id = type.Id.Value.ToString(),
                    Category = category.Name,
                    BuiltInCategory = BuiltInCategoryName(category),
                    Family = type.FamilyName,
                    Type = type.Name,
                    Kind = KindOf(type),
                    PlacedCount = placedCount.GetValueOrDefault(type.Id),
                    TypeParams = NumericParams(type)
                };

                ReadCompoundStructure(doc, type, entry);

                if (sample.TryGetValue(type.Id, out Element? instance))
                {
                    entry.InstanceParams = NumericParams(instance);
                    entry.InstanceLevel = LevelNameOf(doc, instance);
                }

                types.Add(entry);
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
            }
            catch (ArgumentException)
            {
            }
        }

        return types
            .OrderBy(t => t.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Family, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string BuiltInCategoryName(Category category)
    {
        try
        {
            return ((BuiltInCategory)category.Id.Value).ToString();
        }
        catch (Exception)
        {
            return "";
        }
    }

    private static string KindOf(ElementType type)
    {
        if (type is FamilySymbol symbol)
        {
            try
            {
                return symbol.Family?.IsInPlace == true ? "In-place" : "Component";
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
                return "Component";
            }
        }

        return "System";
    }

    private static void ReadCompoundStructure(Document doc, ElementType type, CatalogType entry)
    {
        if (type is not HostObjAttributes host)
        {
            return;
        }

        CompoundStructure? structure;
        try
        {
            structure = host.GetCompoundStructure();
        }
        catch (Autodesk.Revit.Exceptions.ApplicationException)
        {
            return;
        }

        if (structure is null)
        {
            return;
        }

        entry.StructureWidth = RoundMm(ToMillimeters(structure.GetWidth()));

        foreach (CompoundStructureLayer layer in structure.GetLayers())
        {
            string material = MaterialName(doc, layer.MaterialId);
            entry.Layers.Add(new CatalogLayer
            {
                Function = layer.Function.ToString(),
                Width = RoundMm(ToMillimeters(layer.Width)),
                Material = material
            });

            if (material.Length > 0 && !entry.Materials.Contains(material))
            {
                entry.Materials.Add(material);
            }
        }
    }

    private static string MaterialName(Document doc, ElementId materialId)
    {
        if (materialId == ElementId.InvalidElementId)
        {
            return "";
        }

        try
        {
            return (doc.GetElement(materialId) as Material)?.Name ?? "";
        }
        catch (Exception)
        {
            return "";
        }
    }

    /// <summary>
    /// Which level a placed instance is hosted on, e.g. a ceiling's "Height Offset From Level"
    /// is meaningless without this — it links the offset back to a specific storey.
    /// </summary>
    private static string? LevelNameOf(Document doc, Element instance)
    {
        try
        {
            ElementId levelId = instance.LevelId;
            if (levelId == ElementId.InvalidElementId)
            {
                return null;
            }

            return (doc.GetElement(levelId) as Level)?.Name;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// Every numeric parameter, keyed by its display name. Lengths are converted
    /// to millimetres so the pack never has to know about Revit's internal feet.
    /// Uniform for every length-typed parameter, including ones a downstream
    /// consumer treats as a level-relative offset (e.g. a ceiling's "Height Offset
    /// From Level") rather than a SKU dimension - build-pack.js is the layer that
    /// knows which convention a given parameter name feeds and converts back to
    /// metres there if it needs to, so this extractor stays a single, unconditional
    /// rule rather than special-casing parameter names.
    /// </summary>
    private static Dictionary<string, double> NumericParams(Element element)
    {
        var values = new Dictionary<string, double>();

        foreach (Parameter parameter in element.Parameters)
        {
            try
            {
                if (parameter.StorageType != StorageType.Double || !parameter.HasValue)
                {
                    continue;
                }

                string name = parameter.Definition?.Name ?? "";
                if (name.Length == 0 || values.ContainsKey(name))
                {
                    continue;
                }

                double raw = parameter.AsDouble();
                ForgeTypeId spec = parameter.Definition!.GetDataType();
                double value = spec == SpecTypeId.Length ? RoundMm(ToMillimeters(raw)) : Round(raw);
                values[name] = value;
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
            }
        }

        return values;
    }

    private static List<CatalogTitleBlock> BuildTitleBlocks(Document doc)
    {
        var sheetCounts = new Dictionary<ElementId, int>();
        foreach (Element block in new FilteredElementCollector(doc)
                     .OfCategory(BuiltInCategory.OST_TitleBlocks)
                     .WhereElementIsNotElementType())
        {
            ElementId typeId = block.GetTypeId();
            sheetCounts[typeId] = sheetCounts.GetValueOrDefault(typeId) + 1;
        }

        var blocks = new List<CatalogTitleBlock>();
        foreach (FamilySymbol symbol in new FilteredElementCollector(doc)
                     .OfCategory(BuiltInCategory.OST_TitleBlocks)
                     .WhereElementIsElementType()
                     .Cast<FamilySymbol>())
        {
            blocks.Add(new CatalogTitleBlock
            {
                Family = symbol.FamilyName,
                Type = symbol.Name,
                Width = RoundMm(ToMillimeters(ParamValue(symbol, BuiltInParameter.SHEET_WIDTH))),
                Height = RoundMm(ToMillimeters(ParamValue(symbol, BuiltInParameter.SHEET_HEIGHT))),
                SheetCount = sheetCounts.GetValueOrDefault(symbol.Id)
            });
        }

        return blocks
            .OrderBy(b => b.Family, StringComparer.OrdinalIgnoreCase)
            .ThenBy(b => b.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static double ParamValue(Element element, BuiltInParameter id)
    {
        try
        {
            Parameter? parameter = element.get_Parameter(id);
            return parameter is null || !parameter.HasValue ? 0 : parameter.AsDouble();
        }
        catch (Autodesk.Revit.Exceptions.ApplicationException)
        {
            return 0;
        }
    }

    private static List<CatalogView> BuildViews(Document doc)
    {
        Dictionary<ElementId, string> sheetByView = [];
        foreach (ViewSheet sheet in new FilteredElementCollector(doc)
                     .OfClass(typeof(ViewSheet))
                     .Cast<ViewSheet>())
        {
            try
            {
                foreach (ElementId viewId in sheet.GetAllPlacedViews())
                {
                    sheetByView[viewId] = sheet.SheetNumber;
                }
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
            }
        }

        var views = new List<CatalogView>();
        foreach (View view in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
        {
            try
            {
                if (view.IsTemplate || view is ViewSheet)
                {
                    continue;
                }

                views.Add(new CatalogView
                {
                    Name = view.Name,
                    ViewType = view.ViewType.ToString(),
                    Level = (view as ViewPlan)?.GenLevel?.Name ?? "",
                    Scale = view.Scale,
                    OnSheet = sheetByView.GetValueOrDefault(view.Id, "")
                });
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
            }
        }

        return views
            .OrderBy(v => v.ViewType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(v => v.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static double ToMeters(double feet) =>
        UnitUtils.ConvertFromInternalUnits(feet, UnitTypeId.Meters);

    private static double ToMillimeters(double feet) =>
        UnitUtils.ConvertFromInternalUnits(feet, UnitTypeId.Millimeters);

    private static double Round(double value) => Math.Round(value, 4);

    /// <summary>Millimetre-scale values are nominal type facts (a wall's stated
    /// thickness, a sheet's stated size), so integer precision matches how the firm
    /// already names them ("220mm", not "220.4mm") rather than carrying float noise
    /// from the feet-to-mm conversion.</summary>
    private static double RoundMm(double value) => Math.Round(value, 0);
}
