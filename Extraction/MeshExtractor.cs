using Autodesk.Revit.DB;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector.Extraction;

public static class MeshExtractor
{
    private const int MaxTriangles = 80_000;
    private const double Tessellation = 0.2;

    private static readonly HashSet<BuiltInCategory> Categories =
    [
        BuiltInCategory.OST_Walls,
        BuiltInCategory.OST_Roofs,
        BuiltInCategory.OST_Floors,
        BuiltInCategory.OST_Doors,
        BuiltInCategory.OST_Windows,
        BuiltInCategory.OST_Columns,
        BuiltInCategory.OST_StructuralColumns,
        BuiltInCategory.OST_StructuralFraming,
        BuiltInCategory.OST_GenericModel,
        BuiltInCategory.OST_Stairs,
        BuiltInCategory.OST_Railings,
        BuiltInCategory.OST_Ceilings,
        BuiltInCategory.OST_Furniture,
        BuiltInCategory.OST_Casework,
        BuiltInCategory.OST_CurtainWallPanels,
        BuiltInCategory.OST_Mass
    ];

    public static List<ModelMesh> Build(Document doc, IEnumerable<Element> elements)
    {
        var options = new Options
        {
            ComputeReferences = false,
            IncludeNonVisibleObjects = true,
            DetailLevel = ViewDetailLevel.Medium
        };

        var meshes = new List<ModelMesh>();
        int triangles = 0;

        foreach (Element element in elements)
        {
            if (triangles >= MaxTriangles)
            {
                break;
            }

            Category? cat = element.Category;
            if (cat is null)
            {
                continue;
            }

            var bic = (BuiltInCategory)cat.Id.Value;
            if (!Categories.Contains(bic))
            {
                continue;
            }

            var builder = new MeshBuilder(element.Id.Value.ToString(), cat.Name, StyleFor(bic));
            AppendElementGeometry(element, options, builder);
            if (builder.TriangleCount == 0)
            {
                continue;
            }

            triangles += builder.TriangleCount;
            meshes.Add(builder.ToModelMesh());
        }

        return meshes;
    }

    private static void AppendElementGeometry(Element element, Options options, MeshBuilder builder)
    {
        try
        {
            GeometryElement? geometry = element.get_Geometry(options);
            if (geometry is not null)
            {
                Append(geometry, builder, Transform.Identity);
            }
        }
        catch (Autodesk.Revit.Exceptions.ApplicationException)
        {
        }

        if (builder.TriangleCount > 0 || element is not FamilyInstance instance)
        {
            return;
        }

        try
        {
            GeometryElement? original = instance.GetOriginalGeometry(options);
            if (original is not null)
            {
                Append(original, builder, instance.GetTotalTransform());
            }
        }
        catch (Autodesk.Revit.Exceptions.ApplicationException)
        {
        }
    }

    private static void Append(GeometryElement geometry, MeshBuilder builder, Transform transform)
    {
        foreach (GeometryObject obj in geometry)
        {
            switch (obj)
            {
                case Solid solid:
                    AddSolid(solid, builder, transform);
                    break;
                case Mesh mesh:
                    AddMesh(mesh, builder, transform);
                    break;
                case GeometryInstance instance:
                    GeometryElement? instGeom = instance.GetInstanceGeometry();
                    if (instGeom is not null)
                    {
                        Append(instGeom, builder, Transform.Identity);
                    }

                    break;
            }
        }
    }

    private static void AddSolid(Solid solid, MeshBuilder builder, Transform transform)
    {
        if (solid.Faces.Size == 0)
        {
            return;
        }

        foreach (Face face in solid.Faces)
        {
            Mesh? mesh;
            try
            {
                mesh = face.Triangulate(Tessellation);
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
                continue;
            }

            if (mesh is not null)
            {
                AddMesh(mesh, builder, transform);
            }
        }
    }

    private static void AddMesh(Mesh mesh, MeshBuilder builder, Transform transform)
    {
        int n = mesh.NumTriangles;
        for (int i = 0; i < n; i++)
        {
            MeshTriangle tri = mesh.get_Triangle(i);
            builder.AddTriangle(
                transform.OfPoint(tri.get_Vertex(0)),
                transform.OfPoint(tri.get_Vertex(1)),
                transform.OfPoint(tri.get_Vertex(2)));
        }
    }

    private static (string Fill, string Stroke) StyleFor(BuiltInCategory category) =>
        category switch
        {
            BuiltInCategory.OST_Walls => ("#c4a574", "#8d7349"),
            BuiltInCategory.OST_Roofs => ("#4a4a4a", "#2f2f2f"),
            BuiltInCategory.OST_Floors or BuiltInCategory.OST_Ceilings => ("#6a6560", "#4a4540"),
            BuiltInCategory.OST_Doors => ("#8b5a2b", "#5c3b1a"),
            BuiltInCategory.OST_Windows => ("#2c3d48", "#1a2830"),
            BuiltInCategory.OST_Columns or BuiltInCategory.OST_StructuralColumns => ("#7a746c", "#4e4943"),
            BuiltInCategory.OST_GenericModel => ("#9a8b78", "#6e6254"),
            BuiltInCategory.OST_Stairs or BuiltInCategory.OST_Railings => ("#5c5348", "#3a342e"),
            BuiltInCategory.OST_Furniture or BuiltInCategory.OST_Casework => ("#a67c52", "#6e4e32"),
            _ => ("#8a8178", "#5c564f")
        };

    private sealed class MeshBuilder
    {
        private readonly string _id;
        private readonly string _category;
        private readonly string _fill;
        private readonly string _stroke;
        private readonly Dictionary<(int, int, int), int> _index = [];
        private readonly List<double> _positions = [];
        private readonly List<int> _indices = [];

        public MeshBuilder(string id, string category, (string Fill, string Stroke) style)
        {
            _id = id;
            _category = category;
            _fill = style.Fill;
            _stroke = style.Stroke;
        }

        public int TriangleCount => _indices.Count / 3;

        public void AddTriangle(XYZ a, XYZ b, XYZ c)
        {
            _indices.Add(Vertex(a));
            _indices.Add(Vertex(b));
            _indices.Add(Vertex(c));
        }

        private int Vertex(XYZ p)
        {
            double x = ToMeters(p.X);
            double y = ToMeters(p.Y);
            double z = ToMeters(p.Z);
            var key = (Hash(x), Hash(y), Hash(z));
            if (_index.TryGetValue(key, out int i))
            {
                return i;
            }

            i = _positions.Count / 3;
            _index[key] = i;
            _positions.Add(Math.Round(x, 3));
            _positions.Add(Math.Round(y, 3));
            _positions.Add(Math.Round(z, 3));
            return i;
        }

        public ModelMesh ToModelMesh() =>
            new()
            {
                ElementId = _id,
                Category = _category,
                Fill = _fill,
                Stroke = _stroke,
                Positions = _positions,
                Indices = _indices
            };

        private static double ToMeters(double value) =>
            UnitUtils.ConvertFromInternalUnits(value, UnitTypeId.Meters);

        private static int Hash(double meters) => (int)Math.Round(meters * 500);
    }
}
