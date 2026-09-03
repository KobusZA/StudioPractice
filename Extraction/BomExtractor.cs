using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector.Extraction;

public static class BomExtractor
{
    private static readonly BuiltInCategory[] ProjectCategories =
    [
        BuiltInCategory.OST_Walls,
        BuiltInCategory.OST_Doors,
        BuiltInCategory.OST_Windows,
        BuiltInCategory.OST_Floors,
        BuiltInCategory.OST_Rooms,
        BuiltInCategory.OST_Furniture,
        BuiltInCategory.OST_Casework,
        BuiltInCategory.OST_PlumbingFixtures,
        BuiltInCategory.OST_LightingFixtures,
        BuiltInCategory.OST_ElectricalFixtures,
        BuiltInCategory.OST_MechanicalEquipment,
        BuiltInCategory.OST_SpecialityEquipment,
        BuiltInCategory.OST_GenericModel,
        BuiltInCategory.OST_Stairs,
        BuiltInCategory.OST_Railings,
        BuiltInCategory.OST_Columns,
        BuiltInCategory.OST_StructuralColumns,
        BuiltInCategory.OST_StructuralFraming,
        BuiltInCategory.OST_Ceilings,
        BuiltInCategory.OST_Roofs,
        BuiltInCategory.OST_CurtainWallPanels,
        BuiltInCategory.OST_DuctCurves,
        BuiltInCategory.OST_PipeCurves
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
            ExtractedAt = DateTime.UtcNow.ToString("o")
        };

        IList<Element> elements = CollectProjectElements(doc);

        payload.Lines = BuildLines(doc, elements);
        payload.Instances = BuildInstances(doc, elements);
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
            Category? cat = element.Category;
            if (cat is null)
            {
                continue;
            }

            BuiltInCategory bic = (BuiltInCategory)cat.Id.Value;
            if (bic is not (BuiltInCategory.OST_Walls or BuiltInCategory.OST_Floors or BuiltInCategory.OST_Roofs))
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
                item.Length = Math.Round(length, 4);
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
                item.Perimeter = Math.Round(perimeter, 4);
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
            perimeter = ToMeters(p.AsDouble());
            return perimeter > 0;
        }

        return false;
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
            unit = "m";
            return true;
        }

        Category? cat = element.Category;
        if (cat is null)
        {
            return false;
        }

        BuiltInCategory bic = (BuiltInCategory)cat.Id.Value;
        bool isFamilyDoc = doc.IsFamilyDocument;
        if (!isFamilyDoc && !ProjectCategories.Contains(bic) && element is not Room)
        {
            return false;
        }

        if (!isFamilyDoc && element is not FamilyInstance && element is not HostObject && element is not Room
            && element is not MEPCurve)
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
                => "m",
            BuiltInCategory.OST_Floors or BuiltInCategory.OST_Rooms or BuiltInCategory.OST_Ceilings
                or BuiltInCategory.OST_Roofs => "m2",
            _ => element is CurveElement ? "m" : "ea"
        };
    }

    private static bool TryLength(Element element, out double length)
    {
        length = 0;
        Parameter? p = element.get_Parameter(BuiltInParameter.CURVE_ELEM_LENGTH)
                       ?? element.get_Parameter(BuiltInParameter.INSTANCE_LENGTH_PARAM);
        if (p is { HasValue: true } && p.StorageType == StorageType.Double)
        {
            length = ToMeters(p.AsDouble());
            return length > 0;
        }

        if (element is CurveElement curve && curve.GeometryCurve is not null)
        {
            length = ToMeters(curve.GeometryCurve.Length);
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
            Depth = ToMeters(Math.Abs(extrusion.EndOffset - extrusion.StartOffset)),
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
            double height = ToMeters(p.AsDouble());
            if (height > 0)
            {
                return Math.Round(height, 3);
            }
        }

        return 2.8;
    }

    private static double RoomHeight(Room room)
    {
        try
        {
            double unbounded = ToMeters(room.UnboundedHeight);
            if (unbounded > 0.1)
            {
                return Math.Round(unbounded, 3);
            }
        }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException)
        {
        }

        return 2.8;
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
            Length = ToMeters(width * Math.PI * 0.5),
            Start = Point(hinge),
            End = Point(swing)
        };

        return new SketchForm
        {
            Kind = "Opening",
            ElementId = door.Id.Value.ToString(),
            Name = door.Name,
            Depth = OpeningHeightMeters(door, BuiltInParameter.DOOR_HEIGHT, 2.1),
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
            Depth = OpeningHeightMeters(window, BuiltInParameter.WINDOW_HEIGHT, 1.2),
            Sill = WindowSillMeters(window),
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

    private static double OpeningHeightMeters(FamilyInstance instance, BuiltInParameter heightParam, double fallbackMeters)
    {
        Parameter? parameter = instance.Symbol.get_Parameter(heightParam)
                               ?? instance.get_Parameter(heightParam)
                               ?? instance.Symbol.LookupParameter("Height");
        if (parameter is { HasValue: true } && parameter.StorageType == StorageType.Double)
        {
            double value = ToMeters(parameter.AsDouble());
            if (value > 0)
            {
                return Math.Round(value, 3);
            }
        }

        return fallbackMeters;
    }

    private static double WindowSillMeters(FamilyInstance window)
    {
        Parameter? parameter = window.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
                               ?? window.LookupParameter("Sill Height");
        if (parameter is { HasValue: true } && parameter.StorageType == StorageType.Double)
        {
            double value = ToMeters(parameter.AsDouble());
            if (value >= 0)
            {
                return Math.Round(value, 3);
            }
        }

        return 0.9;
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
            Length = ToMeters(curve.Length)
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

    private static double ToSquareMeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.SquareMeters);

    private static double ToCubicMeters(double internalValue) =>
        UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.CubicMeters);

    private static double Round(double value) => Math.Round(value, 4);
}
