using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector.Extraction;

public static class BomExtractor
{
    private static readonly HashSet<BuiltInCategory> SkipTakeoffCategories =
    [
        BuiltInCategory.INVALID,
        BuiltInCategory.OST_Cameras,
        BuiltInCategory.OST_CLines,
        BuiltInCategory.OST_Constraints,
        BuiltInCategory.OST_Dimensions,
        BuiltInCategory.OST_Grids,
        BuiltInCategory.OST_Levels,
        BuiltInCategory.OST_Lines,
        BuiltInCategory.OST_Matchline,
        BuiltInCategory.OST_ReferenceLines,
        BuiltInCategory.OST_ReferencePoints,
        BuiltInCategory.OST_RoomSeparationLines,
        BuiltInCategory.OST_SketchLines,
        BuiltInCategory.OST_SectionBox,
        BuiltInCategory.OST_Sheets,
        BuiltInCategory.OST_TitleBlocks,
        BuiltInCategory.OST_Viewports,
        BuiltInCategory.OST_VolumeOfInterest,
        BuiltInCategory.OST_IOSModelGroups,
        BuiltInCategory.OST_IOSDetailGroups,
        BuiltInCategory.OST_IOSAttachedDetailGroups,
        BuiltInCategory.OST_ImportObjectStyles
    ];

    public static BomPayload Extract(UIApplication uiApp)
    {
        UIDocument uiDoc = uiApp.ActiveUIDocument
            ?? throw new InvalidOperationException("Open a Revit model first.");

        Document doc = uiDoc.Document;
        View? view = uiDoc.ActiveView;

        var payload = new BomPayload
        {
            DocumentKind = doc.IsFamilyDocument ? "Family" : "Project",
            Title = doc.Title,
            Path = string.IsNullOrWhiteSpace(doc.PathName) ? "(unsaved)" : doc.PathName,
            ActiveView = view?.Name ?? "(none)",
            ViewType = view?.ViewType.ToString() ?? "",
            ExtractedAt = DateTime.UtcNow.ToString("o"),
            ExtractorVersion = "4"
        };

        IList<Element> elements = CollectProjectElements(doc);

        payload.Lines = BuildLines(doc, elements);
        payload.Instances = BuildInstances(doc, elements);
        try
        {
            payload.Families = BuildFamilies(doc, elements);
        }
        catch (Exception)
        {
            payload.Families = [];
        }
        payload.SketchForms = BuildSketchForms(doc, elements);

        if (payload.SketchForms.Count == 0 && doc.IsFamilyDocument)
        {
            payload.SketchForms = BuildSketchForms(
                doc,
                new FilteredElementCollector(doc).WhereElementIsNotElementType().ToElements());
        }

        if (!doc.IsFamilyDocument)
        {
            payload.Plans = BuildPlanSketches(doc, view);
            try
            {
                payload.Views = BuildViews(doc, view);
            }
            catch (Exception)
            {
                payload.Views = [];
            }

            try
            {
                payload.Sheets = BuildSheets(doc);
            }
            catch (Exception)
            {
                payload.Sheets = [];
            }

            PlanSketch? shown = payload.Plans.FirstOrDefault(p => p.IsActive)
                                ?? payload.Plans.FirstOrDefault();
            if (shown is not null)
            {
                payload.SketchForms = shown.SketchForms;
            }
            else
            {
                payload.SketchForms.AddRange(BuildFloorPlanSketch(elements));
            }
        }

        payload.Meshes = MeshExtractor.Build(doc, elements);

        return payload;
    }

    private static IList<Element> CollectProjectElements(Document doc)
    {
        return new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .ToElements();
    }

    private static List<LoadedFamilyType> BuildFamilies(Document doc, IEnumerable<Element> instances)
    {
        var placed = new Dictionary<ElementId, int>();
        foreach (Element element in instances)
        {
            ElementId typeId = element.GetTypeId();
            if (typeId == ElementId.InvalidElementId)
            {
                continue;
            }

            placed[typeId] = placed.GetValueOrDefault(typeId) + 1;
        }

        var families = new List<LoadedFamilyType>();
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

                Category? cat = type.Category;
                if (cat is null)
                {
                    continue;
                }

                if (cat.CategoryType is not (CategoryType.Model or CategoryType.Annotation))
                {
                    continue;
                }

                families.Add(new LoadedFamilyType
                {
                    Id = type.Id.Value.ToString(),
                    Category = cat.Name,
                    Family = type.FamilyName,
                    Type = type.Name,
                    Kind = FamilyKind(type),
                    PlacedCount = placed.GetValueOrDefault(type.Id)
                });
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
            }
            catch (ArgumentException)
            {
            }
        }

        return families
            .OrderBy(f => f.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(f => f.Family, StringComparer.OrdinalIgnoreCase)
            .ThenBy(f => f.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string FamilyKind(ElementType type)
    {
        if (type is FamilySymbol symbol)
        {
            try
            {
                if (symbol.Family?.IsInPlace == true)
                {
                    return "In-place";
                }
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
            }

            return "Component";
        }

        return type.Category?.CategoryType == CategoryType.Annotation ? "Annotation" : "System";
    }

    private static List<PlanSketch> BuildPlanSketches(Document doc, View? activeView)
    {
        var plans = new List<PlanSketch>();
        ElementId? activeId = activeView?.Id;

        foreach (ViewPlan plan in CollectPlanViews(doc))
        {
            IList<Element> visible = new FilteredElementCollector(doc, plan.Id)
                .WhereElementIsNotElementType()
                .ToElements();

            plans.Add(new PlanSketch
            {
                Id = plan.Id.Value.ToString(),
                Name = plan.Name,
                ViewType = plan.ViewType.ToString(),
                Discipline = DisciplineName(plan.ViewType),
                Level = plan.GenLevel?.Name ?? "",
                Elevation = plan.GenLevel is null ? 0 : Math.Round(ToMeters(plan.GenLevel.Elevation), 3),
                IsActive = activeId is not null && plan.Id == activeId,
                SketchForms = BuildFloorPlanSketch(visible)
            });
        }

        return plans;
    }

    private static IEnumerable<ViewPlan> CollectPlanViews(Document doc)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(ViewPlan))
            .Cast<ViewPlan>()
            .Where(v => !v.IsTemplate && IsExtractablePlan(v.ViewType))
            .OrderBy(v => DisciplineOrder(v.ViewType))
            .ThenBy(v => v.GenLevel?.Elevation ?? 0)
            .ThenBy(v => v.Name, StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsExtractablePlan(ViewType viewType) =>
        viewType is ViewType.FloorPlan or ViewType.EngineeringPlan or ViewType.CeilingPlan;

    private static List<DocumentViewInfo> BuildViews(Document doc, View? activeView)
    {
        Dictionary<ElementId, string> sheetByView = SheetNumbersByView(doc);
        ElementId? activeId = activeView?.Id;
        var views = new List<DocumentViewInfo>();

        foreach (View view in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
        {
            try
            {
                if (!IsBrowsableView(view))
                {
                    continue;
                }

                views.Add(new DocumentViewInfo
                {
                    Id = view.Id.Value.ToString(),
                    Name = view.Name,
                    ViewType = view.ViewType.ToString(),
                    ViewFamily = ViewFamilyName(doc, view),
                    Level = AssociatedLevelName(view),
                    Scale = ViewScale(view),
                    SheetNumber = sheetByView.TryGetValue(view.Id, out string? number) ? number : "",
                    IsActive = activeId is not null && view.Id == activeId
                });
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
            }
            catch (ArgumentException)
            {
            }
        }

        return views
            .OrderBy(v => v.ViewType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(v => v.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<DocumentSheetInfo> BuildSheets(Document doc)
    {
        var sheets = new List<DocumentSheetInfo>();
        foreach (ViewSheet sheet in CollectSheets(doc))
        {
            try
            {
                (string family, string type) = TitleBlock(doc, sheet);
                sheets.Add(new DocumentSheetInfo
                {
                    Id = sheet.Id.Value.ToString(),
                    Number = sheet.SheetNumber,
                    Name = sheet.Name,
                    TitleBlockFamily = family,
                    TitleBlockType = type,
                    Views = sheet.GetAllPlacedViews()
                        .Select(id => doc.GetElement(id))
                        .OfType<View>()
                        .Select(v => v.Name)
                        .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                        .ToList()
                });
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
            }
            catch (ArgumentException)
            {
            }
        }

        return sheets;
    }

    private static IEnumerable<ViewSheet> CollectSheets(Document doc)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(s => !s.IsTemplate)
            .OrderBy(s => s.SheetNumber, StringComparer.OrdinalIgnoreCase)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<ElementId, string> SheetNumbersByView(Document doc)
    {
        var map = new Dictionary<ElementId, string>();
        foreach (ViewSheet sheet in CollectSheets(doc))
        {
            foreach (ElementId viewId in sheet.GetAllPlacedViews())
            {
                map[viewId] = sheet.SheetNumber;
            }
        }

        return map;
    }

    private static (string Family, string Type) TitleBlock(Document doc, ViewSheet sheet)
    {
        FamilyInstance? title = new FilteredElementCollector(doc, sheet.Id)
            .OfCategory(BuiltInCategory.OST_TitleBlocks)
            .WhereElementIsNotElementType()
            .OfType<FamilyInstance>()
            .FirstOrDefault();

        if (title?.Symbol is null)
        {
            return ("", "");
        }

        return (title.Symbol.FamilyName, title.Symbol.Name);
    }

    private static bool IsBrowsableView(View view) =>
        !view.IsTemplate
        && view is not ViewSheet
        && view.ViewType is not ViewType.Internal
            and not ViewType.ProjectBrowser
            and not ViewType.SystemBrowser
            and not ViewType.Undefined;

    private static string ViewFamilyName(Document doc, View view)
    {
        return doc.GetElement(view.GetTypeId()) is ViewFamilyType familyType
            ? familyType.ViewFamily.ToString()
            : view.ViewType.ToString();
    }

    private static string AssociatedLevelName(View view) =>
        view is ViewPlan plan ? plan.GenLevel?.Name ?? "" : "";

    private static string ViewScale(View view)
    {
        try
        {
            return view.Scale > 0 ? $"1:{view.Scale}" : "";
        }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException)
        {
            return "";
        }
    }

    private static string DisciplineName(ViewType viewType) =>
        viewType switch
        {
            ViewType.EngineeringPlan => "Structural Plans",
            ViewType.CeilingPlan => "Ceiling Plans",
            ViewType.FloorPlan => "Floor Plans",
            _ => viewType.ToString()
        };

    private static int DisciplineOrder(ViewType viewType) =>
        viewType switch
        {
            ViewType.FloorPlan => 0,
            ViewType.EngineeringPlan => 1,
            ViewType.CeilingPlan => 2,
            _ => 9
        };

    private static List<BomLine> BuildLines(Document doc, IEnumerable<Element> elements)
    {
        var groups = new Dictionary<string, BomLine>(StringComparer.Ordinal);

        foreach (Element element in elements)
        {
            if (element is CurveElement or GenericForm or View)
            {
                continue;
            }

            if (!TryDescribe(doc, element, out string category, out string family, out string type, out string unit))
            {
                continue;
            }

            string model = TypeMark(doc, element);
            string key = $"{category}|{model}|{family}|{type}|{unit}";
            if (!groups.TryGetValue(key, out BomLine? line))
            {
                line = new BomLine
                {
                    Category = category,
                    Family = family,
                    Type = type,
                    Model = model,
                    Unit = unit
                };
                groups[key] = line;
            }

            line.Quantity += 1;
            line.ElementIds.Add(element.Id.Value.ToString());

            if (TryLength(element, out double length))
            {
                line.Length = (line.Length ?? 0) + length;
            }

            if (TryArea(element, out double area))
            {
                line.Area = (line.Area ?? 0) + area;
            }

            if (TryVolume(element, out double volume))
            {
                line.Volume = (line.Volume ?? 0) + volume;
            }
        }

        return groups.Values
            .OrderBy(l => l.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(l => l.Model, StringComparer.OrdinalIgnoreCase)
            .ThenBy(l => l.Family, StringComparer.OrdinalIgnoreCase)
            .ThenBy(l => l.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<TakeoffInstance> BuildInstances(Document doc, IEnumerable<Element> elements)
    {
        var instances = new List<TakeoffInstance>();

        foreach (Element element in elements)
        {
            if (element is CurveElement or GenericForm or View)
            {
                continue;
            }

            Category? cat = element.Category;
            if (cat is null)
            {
                continue;
            }

            if (!TryDescribe(doc, element, out string category, out string family, out string type, out _))
            {
                continue;
            }

            string model = TypeMark(doc, element);
            if (string.IsNullOrWhiteSpace(model))
            {
                model = type;
            }

            var item = new TakeoffInstance
            {
                Category = category,
                Model = model,
                Family = family,
                Type = type,
                ElementId = element.Id.Value.ToString(),
                Count = 1,
                Level = LevelName(doc, element),
                PhaseCreated = PhaseName(doc, element, BuiltInParameter.PHASE_CREATED),
                PhaseDemolished = PhaseName(doc, element, BuiltInParameter.PHASE_DEMOLISHED)
            };

            if (TryLength(element, out double length))
            {
                item.Length = Math.Round(length, 1);
            }

            if (TryArea(element, out double area))
            {
                item.Area = Math.Round(area, 2);
            }

            if (TryVolume(element, out double volume))
            {
                item.Volume = Math.Round(volume, 2);
            }

            if (TryPerimeter(element, out double perimeter))
            {
                item.Perimeter = Math.Round(perimeter, 1);
            }

            instances.Add(item);
        }

        return instances
            .OrderBy(i => i.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(i => i.Model, StringComparer.OrdinalIgnoreCase)
            .ThenBy(i => i.Type, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string TypeMark(Document doc, Element element)
    {
        ElementId typeId = element.GetTypeId();
        if (typeId != ElementId.InvalidElementId && doc.GetElement(typeId) is Element typeElement)
        {
            string? mark = typeElement.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_MARK)?.AsString();
            if (!string.IsNullOrWhiteSpace(mark))
            {
                return mark.Trim();
            }
        }

        string? instanceMark = element.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString();
        return string.IsNullOrWhiteSpace(instanceMark) ? "" : instanceMark.Trim();
    }

    private static string LevelName(Document doc, Element element)
    {
        if (element.LevelId != ElementId.InvalidElementId)
        {
            return doc.GetElement(element.LevelId)?.Name ?? "";
        }

        BuiltInParameter[] candidates =
        [
            BuiltInParameter.WALL_BASE_CONSTRAINT,
            BuiltInParameter.SCHEDULE_LEVEL_PARAM,
            BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM,
            BuiltInParameter.ROOF_BASE_LEVEL_PARAM
        ];

        foreach (BuiltInParameter bip in candidates)
        {
            Parameter? p = element.get_Parameter(bip);
            if (p is null || !p.HasValue)
            {
                continue;
            }

            if (p.StorageType == StorageType.ElementId)
            {
                ElementId id = p.AsElementId();
                if (id != ElementId.InvalidElementId)
                {
                    return doc.GetElement(id)?.Name ?? "";
                }
            }

            string? text = p.AsValueString();
            if (!string.IsNullOrWhiteSpace(text))
            {
                return text;
            }
        }

        return "";
    }

    private static string PhaseName(Document doc, Element element, BuiltInParameter bip)
    {
        Parameter? p = element.get_Parameter(bip);
        if (p is null || !p.HasValue)
        {
            return "";
        }

        if (p.StorageType == StorageType.ElementId)
        {
            ElementId id = p.AsElementId();
            if (id == ElementId.InvalidElementId)
            {
                return "";
            }

            return doc.GetElement(id)?.Name ?? "";
        }

        return p.AsValueString() ?? "";
    }

    private static bool TryPerimeter(Element element, out double perimeter)
    {
        perimeter = 0;
        Parameter? p = element.get_Parameter(BuiltInParameter.HOST_PERIMETER_COMPUTED)
                       ?? element.get_Parameter(BuiltInParameter.ROOM_PERIMETER);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            perimeter = Math.Round(ToMillimeters(p.AsDouble()), 1);
            return perimeter > 0;
        }

        return false;
    }

    private static bool IsTakeoffElement(Document doc, Element element, BuiltInCategory bic, Category cat)
    {
        if (doc.IsFamilyDocument)
        {
            return true;
        }

        if (element is Room or Area)
        {
            return true;
        }

        if (SkipTakeoffCategories.Contains(bic))
        {
            return false;
        }

        string name = bic.ToString();
        if (name.StartsWith("OST_IOS", StringComparison.Ordinal)
            || name.StartsWith("OST_Sketch", StringComparison.Ordinal))
        {
            return false;
        }

        if (cat.CategoryType != CategoryType.Model)
        {
            return false;
        }

        return element is FamilyInstance
            or HostObject
            or MEPCurve
            or Opening
            or InsulationLiningBase
            or SpatialElement;
    }

    private static bool TryDescribe(
        Document doc,
        Element element,
        out string category,
        out string family,
        out string type,
        out string unit)
    {
        category = "";
        family = "";
        type = "";
        unit = "ea";

        if (element is GenericForm form)
        {
            category = "Sketch form";
            family = form.GetType().Name;
            type = string.IsNullOrWhiteSpace(form.Name) ? form.GetType().Name : form.Name;
            unit = "ea";
            return true;
        }

        if (element is CurveElement curve)
        {
            category = "Sketch curve";
            family = curve.LineStyle?.Name ?? curve.GetType().Name;
            type = curve.GeometryCurve?.GetType().Name ?? "Curve";
            unit = "mm";
            return true;
        }

        Category? cat = element.Category;
        if (cat is null)
        {
            return false;
        }

        BuiltInCategory bic = (BuiltInCategory)cat.Id.Value;
        if (!IsTakeoffElement(doc, element, bic, cat))
        {
            return false;
        }

        category = cat.Name;
        family = element.get_Parameter(BuiltInParameter.ELEM_FAMILY_PARAM)?.AsValueString()
                 ?? (element as FamilyInstance)?.Symbol?.FamilyName
                 ?? cat.Name;
        type = element.get_Parameter(BuiltInParameter.ELEM_TYPE_PARAM)?.AsValueString()
               ?? element.Name;
        unit = UnitFor(bic, element);
        return true;
    }

    private static string UnitFor(BuiltInCategory category, Element element)
    {
        return category switch
        {
            BuiltInCategory.OST_Walls or BuiltInCategory.OST_DuctCurves or BuiltInCategory.OST_PipeCurves
                or BuiltInCategory.OST_Conduit or BuiltInCategory.OST_CableTray
                or BuiltInCategory.OST_FlexDuctCurves or BuiltInCategory.OST_FlexPipeCurves
                => "mm",
            BuiltInCategory.OST_Floors or BuiltInCategory.OST_Rooms or BuiltInCategory.OST_Ceilings
                or BuiltInCategory.OST_Roofs => "m2",
            _ => element is CurveElement ? "mm" : "ea"
        };
    }

    private static bool TryLength(Element element, out double length)
    {
        length = 0;
        Parameter? p = element.get_Parameter(BuiltInParameter.CURVE_ELEM_LENGTH)
                       ?? element.get_Parameter(BuiltInParameter.INSTANCE_LENGTH_PARAM);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            length = Math.Round(ToMillimeters(p.AsDouble()), 1);
            return length > 0;
        }

        if (element is CurveElement curve && curve.GeometryCurve is not null)
        {
            length = Math.Round(ToMillimeters(curve.GeometryCurve.Length), 1);
            return length > 0;
        }

        return false;
    }

    private static bool TryArea(Element element, out double area)
    {
        area = 0;
        if (element is Room room)
        {
            area = ToSquareMeters(room.Area);
            return area > 0;
        }

        Parameter? p = element.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)
                       ?? element.get_Parameter(BuiltInParameter.ROOM_AREA);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            area = ToSquareMeters(p.AsDouble());
            return area > 0;
        }

        return false;
    }

    private static bool TryVolume(Element element, out double volume)
    {
        volume = 0;
        Parameter? p = element.get_Parameter(BuiltInParameter.HOST_VOLUME_COMPUTED)
                       ?? element.get_Parameter(BuiltInParameter.ROOM_VOLUME);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            volume = ToCubicMeters(p.AsDouble());
            return volume > 0;
        }

        double fromSolid = SolidVolume(element);
        if (fromSolid > 0)
        {
            volume = fromSolid;
            return true;
        }

        return false;
    }

    private static List<SketchForm> BuildSketchForms(Document doc, IEnumerable<Element> elements)
    {
        var forms = new List<SketchForm>();

        foreach (Element element in elements)
        {
            if (element is Extrusion extrusion)
            {
                forms.Add(FromExtrusion(doc, extrusion));
            }
            else if (element is GenericForm form)
            {
                forms.Add(new SketchForm
                {
                    Kind = form.GetType().Name,
                    ElementId = form.Id.Value.ToString(),
                    Name = form.Name,
                    Volume = SolidVolume(form),
                    Material = MaterialName(doc, form)
                });
            }
        }

        return forms;
    }

    private static SketchForm FromExtrusion(Document doc, Extrusion extrusion)
    {
        var item = new SketchForm
        {
            Kind = "Extrusion",
            ElementId = extrusion.Id.Value.ToString(),
            Name = extrusion.Name,
            IsSolid = extrusion.IsSolid,
            Depth = Math.Round(ToMillimeters(Math.Abs(extrusion.EndOffset - extrusion.StartOffset)), 0),
            Volume = SolidVolume(extrusion),
            Material = MaterialName(doc, extrusion)
        };

        Sketch? sketch = extrusion.Sketch;
        if (sketch?.Profile is null)
        {
            return item;
        }

        foreach (CurveArray loop in sketch.Profile)
        {
            var sketchLoop = new SketchLoop();
            foreach (Curve curve in loop)
            {
                SketchCurve sc = ToSketchCurve(curve);
                sketchLoop.Curves.Add(sc);
                sketchLoop.Length += sc.Length;
            }

            item.ProfileLoops.Add(sketchLoop);
        }

        return item;
    }

    private static List<SketchForm> BuildFloorPlanSketch(IEnumerable<Element> elements)
    {
        var forms = new List<SketchForm>();

        foreach (Element element in elements)
        {
            if (element is Room room)
            {
                SketchForm? roomForm = FromRoom(room);
                if (roomForm is not null)
                {
                    forms.Add(roomForm);
                }
            }
            else if (element is Wall wall)
            {
                SketchForm? wallForm = FromWall(wall);
                if (wallForm is not null)
                {
                    forms.Add(wallForm);
                }
            }
            else if (element is FamilyInstance instance &&
                     instance.Category?.Id.Value == (int)BuiltInCategory.OST_Doors)
            {
                SketchForm? doorForm = FromDoor(instance);
                if (doorForm is not null)
                {
                    forms.Add(doorForm);
                }
            }
            else if (element is FamilyInstance window &&
                     window.Category?.Id.Value == (int)BuiltInCategory.OST_Windows)
            {
                SketchForm? windowForm = FromWindow(window);
                if (windowForm is not null)
                {
                    forms.Add(windowForm);
                }
            }
        }

        return forms;
    }

    private static SketchForm? FromRoom(Room room)
    {
        var options = new SpatialElementBoundaryOptions
        {
            SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish
        };

        IList<IList<BoundarySegment>>? loops;
        try
        {
            loops = room.GetBoundarySegments(options);
        }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException)
        {
            return null;
        }

        if (loops is null || loops.Count == 0)
        {
            return null;
        }

        string name = string.IsNullOrWhiteSpace(room.Name) ? "Room" : room.Name.Trim();
        var item = new SketchForm
        {
            Kind = "Room",
            ElementId = room.Id.Value.ToString(),
            Name = name,
            Depth = RoomHeight(room)
        };

        foreach (IList<BoundarySegment> loop in loops)
        {
            var sketchLoop = new SketchLoop();
            foreach (BoundarySegment segment in loop)
            {
                Curve? curve = segment.GetCurve();
                if (curve is null)
                {
                    continue;
                }

                SketchCurve sc = ToSketchCurve(curve);
                sketchLoop.Curves.Add(sc);
                sketchLoop.Length += sc.Length;
            }

            if (sketchLoop.Curves.Count > 0)
            {
                item.ProfileLoops.Add(sketchLoop);
            }
        }

        return item.ProfileLoops.Count == 0 ? null : item;
    }

    private static SketchForm? FromWall(Wall wall)
    {
        if (wall.Location is not LocationCurve location || location.Curve is null)
        {
            return null;
        }

        SketchCurve sc = ToSketchCurve(location.Curve);
        return new SketchForm
        {
            Kind = "Wall",
            ElementId = wall.Id.Value.ToString(),
            Name = wall.Name,
            Depth = WallHeight(wall),
            Volume = SolidVolume(wall),
            ProfileLoops =
            [
                new SketchLoop
                {
                    Curves = [sc],
                    Length = sc.Length
                }
            ]
        };
    }

    private static double WallHeight(Wall wall)
    {
        Parameter? p = wall.get_Parameter(BuiltInParameter.WALL_USER_HEIGHT_PARAM);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            double height = ToMillimeters(p.AsDouble());
            if (height > 0)
            {
                return Math.Round(height, 0);
            }
        }

        return 2800;
    }

    private static double RoomHeight(Room room)
    {
        try
        {
            double unbounded = ToMillimeters(room.UnboundedHeight);
            if (unbounded > 100)
            {
                return Math.Round(unbounded, 0);
            }
        }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException)
        {
        }

        return 2800;
    }

    private static SketchForm? FromDoor(FamilyInstance door)
    {
        if (door.Location is not LocationPoint location)
        {
            return null;
        }

        XYZ origin = location.Point;
        XYZ facing = door.FacingOrientation;
        XYZ hand = door.HandOrientation;
        if (facing.IsZeroLength() || hand.IsZeroLength())
        {
            return null;
        }

        facing = facing.Normalize();
        hand = hand.Normalize();
        double width = OpeningWidth(door, BuiltInParameter.DOOR_WIDTH, 0.9);
        XYZ start = origin - hand * (width * 0.5);
        XYZ end = origin + hand * (width * 0.5);
        XYZ hinge = door.HandFlipped ? end : start;
        XYZ swing = hinge + facing * width;

        SketchCurve opening = ToSketchCurve(Line.CreateBound(start, end));
        var arc = new SketchCurve
        {
            Kind = "Arc",
            Length = Math.Round(ToMillimeters(width * Math.PI * 0.5), 1),
            Start = Point(hinge),
            End = Point(swing)
        };

        return new SketchForm
        {
            Kind = "Opening",
            ElementId = door.Id.Value.ToString(),
            Name = door.Name,
            Depth = OpeningHeightMillimeters(door, BuiltInParameter.DOOR_HEIGHT, 2100),
            Sill = 0,
            ProfileLoops =
            [
                new SketchLoop
                {
                    Curves = [opening, arc],
                    Length = opening.Length + arc.Length
                }
            ]
        };
    }

    private static SketchForm? FromWindow(FamilyInstance window)
    {
        if (window.Location is not LocationPoint location)
        {
            return null;
        }

        XYZ origin = location.Point;
        XYZ facing = window.FacingOrientation;
        XYZ hand = window.HandOrientation;
        if (facing.IsZeroLength() || hand.IsZeroLength())
        {
            return null;
        }

        facing = facing.Normalize();
        hand = hand.Normalize();
        double width = OpeningWidth(window, BuiltInParameter.WINDOW_WIDTH, 1.2);
        double depth = UnitUtils.ConvertToInternalUnits(0.12, UnitTypeId.Meters);
        XYZ start = origin - hand * (width * 0.5);
        XYZ end = origin + hand * (width * 0.5);
        XYZ innerStart = start + facing * depth;
        XYZ innerEnd = end + facing * depth;

        SketchCurve outer = ToSketchCurve(Line.CreateBound(start, end));
        SketchCurve inner = ToSketchCurve(Line.CreateBound(innerStart, innerEnd));

        return new SketchForm
        {
            Kind = "Window",
            ElementId = window.Id.Value.ToString(),
            Name = window.Name,
            Depth = OpeningHeightMillimeters(window, BuiltInParameter.WINDOW_HEIGHT, 1200),
            Sill = WindowSillMillimeters(window),
            ProfileLoops =
            [
                new SketchLoop
                {
                    Curves = [outer],
                    Length = outer.Length
                },
                new SketchLoop
                {
                    Curves = [inner],
                    Length = inner.Length
                }
            ]
        };
    }

    private static double OpeningHeightMillimeters(FamilyInstance instance, BuiltInParameter heightParam, double fallbackMm)
    {
        Parameter? parameter = instance.Symbol.get_Parameter(heightParam)
                               ?? instance.get_Parameter(heightParam)
                               ?? instance.Symbol.LookupParameter("Height");
        if (parameter is { HasValue: true } && parameter.StorageType == StorageType.Double)
        {
            double value = ToMillimeters(parameter.AsDouble());
            if (value > 0)
            {
                return Math.Round(value, 0);
            }
        }

        return fallbackMm;
    }

    private static double WindowSillMillimeters(FamilyInstance window)
    {
        Parameter? parameter = window.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
                               ?? window.LookupParameter("Sill Height");
        if (parameter is { HasValue: true } && parameter.StorageType == StorageType.Double)
        {
            double value = ToMillimeters(parameter.AsDouble());
            if (value >= 0)
            {
                return Math.Round(value, 0);
            }
        }

        return 900;
    }

    private static double OpeningWidth(FamilyInstance instance, BuiltInParameter widthParam, double fallbackMeters)
    {
        Parameter? parameter = instance.Symbol.get_Parameter(widthParam)
                               ?? instance.get_Parameter(widthParam)
                               ?? instance.Symbol.LookupParameter("Width");
        if (parameter is { HasValue: true } && parameter.StorageType == StorageType.Double)
        {
            double value = parameter.AsDouble();
            if (value > 0)
            {
                return value;
            }
        }

        return UnitUtils.ConvertToInternalUnits(fallbackMeters, UnitTypeId.Meters);
    }

    private static SketchCurve ToSketchCurve(Curve curve)
    {
        var sc = new SketchCurve
        {
            Kind = curve is Line ? "Line" : curve is Arc ? "Arc" : curve.GetType().Name,
            Length = Math.Round(ToMillimeters(curve.Length), 1)
        };

        if (curve.IsBound)
        {
            sc.Start = Point(curve.GetEndPoint(0));
            sc.End = Point(curve.GetEndPoint(1));
        }

        return sc;
    }

    private static double[] Point(XYZ p) =>
        [Round(ToMeters(p.X)), Round(ToMeters(p.Y)), Round(ToMeters(p.Z))];

    private static string? MaterialName(Document doc, Element element)
    {
        Parameter? p = element.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM);
        if (p is null || p.StorageType != StorageType.ElementId)
        {
            return null;
        }

        ElementId id = p.AsElementId();
        if (id == ElementId.InvalidElementId)
        {
            return null;
        }

        return doc.GetElement(id)?.Name;
    }

    private static double SolidVolume(Element element)
    {
        var options = new Options { ComputeReferences = false };
        GeometryElement? geometry = element.get_Geometry(options);
        if (geometry is null)
        {
            return 0;
        }

        double volume = 0;
        foreach (GeometryObject obj in geometry)
        {
            if (obj is Solid solid && solid.Volume > 0)
            {
                volume += solid.Volume;
            }
            else if (obj is GeometryInstance instance)
            {
                foreach (GeometryObject inner in instance.GetInstanceGeometry())
                {
                    if (inner is Solid innerSolid && innerSolid.Volume > 0)
                    {
                        volume += innerSolid.Volume;
                    }
                }
            }
        }

        return volume > 0 ? ToCubicMeters(volume) : 0;
    }

    private static double ToMeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.Meters);

    private static double ToMillimeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.Millimeters);

    private static double ToSquareMeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.SquareMeters);

    private static double ToCubicMeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.CubicMeters);

    private static double Round(double value) => Math.Round(value, 4);
}
