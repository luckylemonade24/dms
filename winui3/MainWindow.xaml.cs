using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Effects;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.Foundation;

namespace AtlasCardViewer;

public sealed partial class MainWindow : Window
{
    private const int    LAYERS_N = 19;
    private const int    CARD_W   = 264;
    private const int    CARD_H   = 375;
    private const int    COLS     = 15;
    private const double GAP      = 6.0;

    private readonly List<CardItem>              _items    = new();
    private readonly Dictionary<string, CardDef> _cardDefs = new();
    private Frame[]                              _frames   = Array.Empty<Frame>();
    private CanvasBitmap?                        _atlas;
    private CanvasDevice?                        _device;
    private int                                  _allFid   = -1;

    private CardItem?          _lastPreviewCard;
    private CanvasImageSource? _lastPreview;

    public MainWindow()
    {
        InitializeComponent();

        // Window 没有 Loaded，监听 Content 的 Loaded
        if (Content is FrameworkElement fe)
        {
            fe.Loaded += OnContentLoaded;
        }
    }

    private async void OnContentLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement fe)
        {
            fe.Loaded -= OnContentLoaded;
        }

        try { await InitializeAsync(); }
        catch (Exception ex) { await ShowErrorAsync(ex); }
    }

    private async Task ShowErrorAsync(Exception ex)
    {
        var dlg = new ContentDialog
        {
            Title = "加载失败",
            Content = ex.ToString(),
            CloseButtonText = "确定",
            XamlRoot = Content.XamlRoot,
        };
        await dlg.ShowAsync();
    }

    // ================= 初始化 =================
    private async Task InitializeAsync()
    {
        _device = CanvasDevice.GetSharedDevice();

        string baseDir  = AppContext.BaseDirectory;
        string dataPath = Path.Combine(baseDir, "卡牌", "data.json");
        string texPath  = Path.Combine(baseDir, "卡牌", "texture.webp");

        if (!File.Exists(dataPath)) throw new FileNotFoundException("找不到 data.json", dataPath);
        if (!File.Exists(texPath))  throw new FileNotFoundException("找不到 texture.webp", texPath);

        _atlas = await CanvasBitmap.LoadAsync(_device, texPath);

        string json = await File.ReadAllTextAsync(dataPath);
        using var doc = JsonDocument.Parse(json);
        JsonElement root = doc.RootElement;

        JsonElement framesArr = root[1];
        int fCount = framesArr.GetArrayLength() / 6;
        _frames = new Frame[fCount];
        for (int i = 0; i < fCount; i++)
        {
            int p = i * 6;
            _frames[i] = new Frame
            {
                X     = framesArr[p].GetInt32(),
                Y     = framesArr[p + 1].GetInt32(),
                W     = framesArr[p + 2].GetInt32(),
                H     = framesArr[p + 3].GetInt32(),
                Scale = framesArr[p + 5].GetInt32(),
            };
        }

        JsonElement specialArr = root[3];
        for (int i = 0; i + 3 < specialArr.GetArrayLength(); i += 4)
        {
            if (specialArr[i].ValueKind == JsonValueKind.String &&
                specialArr[i].GetString() == "all")
            {
                int fid = specialArr[i + 1].GetInt32();
                if (fid >= 0) _allFid = fid;
            }
        }

        JsonElement cardsArr = root[2];
        int len = cardsArr.GetArrayLength();
        int idx = 0;
        while (idx + 1 < len)
        {
            string name = cardsArr[idx].GetString() ?? "";
            int    mask = cardsArr[idx + 1].GetInt32();
            var def = new CardDef { Name = name, Mask = mask };
            int p = idx + 2;
            for (int j = 0; j < LAYERS_N; j++)
            {
                if ((mask & (1 << j)) != 0)
                {
                    def.Layers.Add(new Layer
                    {
                        Fid   = cardsArr[p].GetInt32(),
                        Dx    = cardsArr[p + 1].GetInt32(),
                        Dy    = cardsArr[p + 2].GetInt32(),
                        Blend = cardsArr[p + 3].GetInt32(),
                    });
                    p += 4;
                }
            }
            _cardDefs[name] = def;
            _items.Add(new CardItem { Name = name, Def = def });
            idx = p;
        }

        UpdateScrollSpacer();
        CardsCanvas.Invalidate();
    }

    private void UpdateScrollSpacer()
    {
        double viewportW = GetViewportWidth();
        if (viewportW <= 0) viewportW = 1000;

        double itemW = (viewportW - (COLS - 1) * GAP) / COLS;
        if (itemW <= 0) itemW = 60;
        double itemH  = itemW * CARD_H / CARD_W;
        int    rows   = (_items.Count + COLS - 1) / COLS;
        double height = rows * itemH + Math.Max(0, rows - 1) * GAP;

        ScrollSpacer.MinHeight = height;
        ScrollSpacer.Width     = viewportW;
        ScrollSpacer.Height    = height;
    }

    private double GetViewportWidth()
    {
        double w = Scroller.ViewportWidth;
        if (w <= 0) w = Scroller.ActualWidth;
        return w;
    }

    private double GetViewportHeight()
    {
        double h = Scroller.ViewportHeight;
        if (h <= 0) h = Scroller.ActualHeight;
        return h;
    }

    private void Scroller_ViewChanged(object? sender, ScrollViewerViewChangedEventArgs e)
    {
        CardsCanvas.Invalidate();
    }

    private void CardsCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateScrollSpacer();
        CardsCanvas.Invalidate();
    }

    // ================= 混合模式映射 =================
    private static BlendEffectMode MapBlend(int idx) => idx switch
    {
        1  => BlendEffectMode.Multiply,
        2  => BlendEffectMode.Screen,
        3  => BlendEffectMode.Overlay,
        4  => BlendEffectMode.Darken,
        5  => BlendEffectMode.Lighten,
        6  => BlendEffectMode.ColorDodge,
        7  => BlendEffectMode.ColorBurn,
        8  => BlendEffectMode.HardLight,
        9  => BlendEffectMode.SoftLight,
        10 => BlendEffectMode.Difference,
        11 => BlendEffectMode.Exclusion,
        12 => BlendEffectMode.Hue,
        13 => BlendEffectMode.Saturation,
        14 => BlendEffectMode.Color,
        15 => BlendEffectMode.Luminosity,
        _  => BlendEffectMode.Multiply,
    };

    // ================= 插值选择：s>1 的像素图层用最近邻 =================
    private static CanvasImageInterpolation PickInterp(float scale)
        => scale > 1f ? CanvasImageInterpolation.NearestNeighbor
                      : CanvasImageInterpolation.Linear;

    // ================= 主绘制 =================
    private void CardsCanvas_Draw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        if (_device is null || _atlas is null) return;
        if (args.DrawingSession.Device != _device) return;

        var ds = args.DrawingSession;

        double viewportW = GetViewportWidth();
        double viewportH = GetViewportHeight();
        if (viewportW <= 0 || viewportH <= 0) return;

        double scrollY = Scroller.VerticalOffset;

        double itemW = (viewportW - (COLS - 1) * GAP) / COLS;
        if (itemW <= 0) return;
        double itemH   = itemW * CARD_H / CARD_W;
        double rowStep = itemH + GAP;

        int totalRows = (_items.Count + COLS - 1) / COLS;
        int firstRow  = Math.Max(0, (int)(scrollY / rowStep));
        int lastRow   = Math.Min(totalRows - 1, (int)((scrollY + viewportH) / rowStep));

        for (int row = firstRow; row <= lastRow; row++)
        {
            float y = (float)(row * rowStep - scrollY);
            for (int col = 0; col < COLS; col++)
            {
                int i = row * COLS + col;
                if (i >= _items.Count) break;
                float x = (float)(col * (itemW + GAP));
                DrawOneCard(ds, _items[i].Def, x, y, (float)itemW, (float)itemH);
            }
        }
    }

    private void DrawOneCard(CanvasDrawingSession ds, CardDef def,
                             float x, float y, float w, float h)
    {
        if (_atlas is null || _device is null) return;

        float sx = w / CARD_W;
        float sy = h / CARD_H;

        bool hasBlend = false;
        foreach (var L in def.Layers)
        {
            if (L.Blend != 0) { hasBlend = true; break; }
        }

        if (!hasBlend)
        {
            if (_allFid >= 0 && _allFid < _frames.Length)
            {
                var f = _frames[_allFid];
                float s = f.Scale == 0 ? 1f : f.Scale;
                ds.DrawImage(_atlas,
                    new Rect(x, y, CARD_W * s * sx, CARD_H * s * sy),
                    new Rect(f.X, f.Y, CARD_W, CARD_H),
                    1.0f, PickInterp(s));
            }

            foreach (var L in def.Layers)
            {
                if (L.Fid < 0 || L.Fid >= _frames.Length) continue;
                var f = _frames[L.Fid];
                if (f.W <= 0 || f.H <= 0) continue;
                float s = f.Scale == 0 ? 1f : f.Scale;

                ds.DrawImage(_atlas,
                    new Rect(x + L.Dx * sx, y + L.Dy * sy,
                             f.W * s * sx, f.H * s * sy),
                    new Rect(f.X, f.Y, f.W, f.H),
                    1.0f, PickInterp(s));
            }
        }
        else
        {
            int outW = (int)Math.Round(w);
            int outH = (int)Math.Round(h);
            if (outW <= 0 || outH <= 0) return;

            using var rt = RenderCard(def, outW, outH);
            ds.DrawImage(rt, new Rect(x, y, w, h));
        }
    }

    private CanvasRenderTarget RenderCard(CardDef def, int outW, int outH)
    {
        if (_device is null || _atlas is null)
            throw new InvalidOperationException("atlas not loaded");

        float sx = (float)outW / CARD_W;
        float sy = (float)outH / CARD_H;

        var result = new CanvasRenderTarget(_device, outW, outH, 96f);

        using (var ds = result.CreateDrawingSession())
        {
            ds.Clear(Colors.Transparent);
            if (_allFid >= 0 && _allFid < _frames.Length)
            {
                var f = _frames[_allFid];
                float s = f.Scale == 0 ? 1f : f.Scale;
                ds.DrawImage(_atlas,
                    new Rect(0, 0, CARD_W * s * sx, CARD_H * s * sy),
                    new Rect(f.X, f.Y, CARD_W, CARD_H),
                    1.0f, PickInterp(s));
            }
        }

        foreach (var layer in def.Layers)
        {
            if (layer.Fid < 0 || layer.Fid >= _frames.Length) continue;
            var f = _frames[layer.Fid];
            if (f.W <= 0 || f.H <= 0) continue;
            float s = f.Scale == 0 ? 1f : f.Scale;

            var dstRect = new Rect(layer.Dx * sx, layer.Dy * sy,
                                   f.W * s * sx, f.H * s * sy);
            var srcRect = new Rect(f.X, f.Y, f.W, f.H);
            var interp  = PickInterp(s);

            if (layer.Blend == 0)
            {
                using var ds = result.CreateDrawingSession();
                ds.DrawImage(_atlas, dstRect, srcRect, 1.0f, interp);
            }
            else
            {
                using var fore = new CanvasRenderTarget(_device, outW, outH, 96f);
                using (var ds = fore.CreateDrawingSession())
                {
                    ds.Clear(Colors.Transparent);
                    ds.DrawImage(_atlas, dstRect, srcRect, 1.0f, interp);
                }

                var next = new CanvasRenderTarget(_device, outW, outH, 96f);
                using (var blend = new BlendEffect
                       {
                           Mode       = MapBlend(layer.Blend),
                           Background = result,
                           Foreground = fore,
                       })
                using (var ds = next.CreateDrawingSession())
                {
                    ds.Clear(Colors.Transparent);
                    ds.DrawImage(blend);
                }

                result.Dispose();
                result = next;
            }
        }

        return result;
    }

    // ================= 悬停预览 =================
    private void Scroller_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        double viewportW = GetViewportWidth();
        if (viewportW <= 0) return;

        var pt = e.GetCurrentPoint(Scroller).Position;
        double scrollY = Scroller.VerticalOffset;

        double itemW = (viewportW - (COLS - 1) * GAP) / COLS;
        if (itemW <= 0) return;
        double itemH   = itemW * CARD_H / CARD_W;
        double rowStep = itemH + GAP;

        double yInContent = pt.Y + scrollY;
        int row = (int)(yInContent / rowStep);
        int col = (int)(pt.X / (itemW + GAP));
        if (row < 0 || col < 0 || col >= COLS) return;

        double localX = pt.X - col * (itemW + GAP);
        double localY = yInContent - row * rowStep;
        if (localX > itemW || localY > itemH) return;

        int i = row * COLS + col;
        if (i < 0 || i >= _items.Count) return;

        var card = _items[i];
        if (ReferenceEquals(card, _lastPreviewCard) && _lastPreview is not null) return;

        try
        {
            var rt  = RenderCard(card.Def, CARD_W, CARD_H);
            var src = new CanvasImageSource(rt, CARD_W, CARD_H);
            _lastPreview     = src;
            _lastPreviewCard = card;
            PreviewImage.Source = src;
        }
        catch { /* 忽略 */ }
    }

    private void Scroller_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        // 默认保留最后一张预览
    }
}