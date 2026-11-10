using System.Collections.Generic;

namespace AtlasCardViewer;

public sealed class CardDef
{
    public string Name { get; set; } = "";
    public int    Mask { get; set; }
    public List<Layer> Layers { get; } = new();
}

public struct Layer
{
    public int Fid;
    public int Dx;
    public int Dy;
    public int Blend;
}

public struct Frame
{
    public int X, Y, W, H, Scale;
}

public sealed class CardItem
{
    public string  Name { get; set; } = "";
    public CardDef Def  { get; set; } = null!;
}