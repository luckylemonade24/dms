using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace AtlasCardViewer;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        try
        {
            _window.AppWindow.Resize(new SizeInt32(1440, 900));
        }
        catch { /* 某些环境下可能失败，忽略 */ }
        _window.Activate();
    }
}