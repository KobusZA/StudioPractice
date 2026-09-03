using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Autodesk.Revit.DB;

namespace StudioPractice.RevitConnector.Ui;

public sealed class FamilyTypeChoice
{
    public required FamilySymbol Symbol { get; init; }
    public required string Family { get; init; }
    public required string Type { get; init; }

    public string Label => $"{Family}  ·  {Type}";

    public override string ToString() => Label;
}

public sealed class LabeledChoice
{
    public required string Label { get; init; }
    public required object Value { get; init; }

    public override string ToString() => Label;
}

public sealed class ChoicePickerWindow : Window
{
    private readonly ListBox _list = new();

    public LabeledChoice? Selected { get; private set; }

    public ChoicePickerWindow(IReadOnlyList<LabeledChoice> items, string title, string prompt, string actionLabel)
    {
        Title = title;
        Width = 420;
        Height = 460;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.CanResize;
        Background = System.Windows.Media.Brushes.White;

        var root = new DockPanel { Margin = new Thickness(16) };

        var heading = new TextBlock
        {
            Text = prompt,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
            FontSize = 13
        };
        DockPanel.SetDock(heading, Dock.Top);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 12, 0, 0)
        };
        var cancel = new Button { Content = "Cancel", Width = 88, Height = 28, Margin = new Thickness(0, 0, 8, 0), IsCancel = true };
        var ok = new Button { Content = actionLabel, MinWidth = 88, Height = 28, Padding = new Thickness(12, 0, 12, 0), IsDefault = true };
        cancel.Click += (_, _) =>
        {
            DialogResult = false;
            Close();
        };
        ok.Click += (_, _) => Accept();
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);
        DockPanel.SetDock(buttons, Dock.Bottom);

        _list.ItemsSource = items;
        _list.DisplayMemberPath = nameof(LabeledChoice.Label);
        _list.BorderThickness = new Thickness(1);
        _list.MouseDoubleClick += OnDoubleClick;
        if (items.Count > 0)
        {
            _list.SelectedIndex = 0;
        }

        root.Children.Add(heading);
        root.Children.Add(buttons);
        root.Children.Add(_list);
        Content = root;
    }

    private void OnDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_list.SelectedItem is LabeledChoice)
        {
            Accept();
        }
    }

    private void Accept()
    {
        if (_list.SelectedItem is not LabeledChoice choice)
        {
            MessageBox.Show(this, "Select a type first.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        Selected = choice;
        DialogResult = true;
        Close();
    }
}
