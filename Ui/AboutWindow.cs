using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace StudioPractice.RevitConnector.Ui;

public sealed class AboutWindow : Window
{
    public AboutWindow()
    {
        Title = "About";
        Width = 440;
        SizeToContent = SizeToContent.Height;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        Background = Brushes.White;

        var root = new DockPanel { Margin = new Thickness(20) };

        var heading = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
        BitmapImage? logo = App.LoadIcon("logo FULL.png");
        if (logo is not null)
        {
            heading.Children.Add(new Image
            {
                Source = logo,
                Width = 96,
                Height = 96,
                Stretch = Stretch.Uniform,
                HorizontalAlignment = HorizontalAlignment.Left,
                Clip = new EllipseGeometry(new Rect(0, 0, 96, 96)),
                Margin = new Thickness(0, 0, 0, 12)
            });
        }
        else
        {
            heading.Children.Add(new TextBlock
            {
                Text = "Studio Practice",
                FontSize = 22,
                FontWeight = FontWeights.SemiBold
            });
        }
        heading.Children.Add(new TextBlock
        {
            Text = "Revit Connector",
            FontSize = 14,
            Foreground = new SolidColorBrush(Color.FromRgb(92, 74, 168)),
            Margin = new Thickness(0, 2, 0, 0)
        });
        DockPanel.SetDock(heading, Dock.Top);

        var close = new Button
        {
            Content = "Close",
            Width = 96,
            Height = 28,
            HorizontalAlignment = HorizontalAlignment.Right,
            IsDefault = true,
            IsCancel = true,
            Margin = new Thickness(0, 16, 0, 0)
        };
        close.Click += (_, _) =>
        {
            DialogResult = true;
            Close();
        };
        DockPanel.SetDock(close, Dock.Bottom);

        var details = new StackPanel();
        details.Children.Add(InfoRow("Software", "Studio Practice Revit Connector 0.9.4 (mock build)"));
        details.Children.Add(InfoRow(
            "About",
            "Connects Autodesk Revit to the Studio Practice web app so teams can extract BOM data, place content, and keep floor-plan sketches in sync."));
        details.Children.Add(InfoRow("User", "Jordan Hale"));
        details.Children.Add(InfoRow("License", "Commercial — Studio Seat"));
        details.Children.Add(InfoRow("Date", DateTime.Now.ToString("dddd, MMMM d, yyyy")));
        details.Children.Add(InfoRow("Time", DateTime.Now.ToString("h:mm:ss tt")));
        details.Children.Add(InfoRow("Company", "Studio Practice"));

        root.Children.Add(heading);
        root.Children.Add(close);
        root.Children.Add(details);
        Content = root;
    }

    private static UIElement InfoRow(string label, string value)
    {
        var block = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
        block.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(96, 96, 96))
        });
        block.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 1, 0, 0)
        });
        return block;
    }
}
