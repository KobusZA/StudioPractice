using System.IO;
using System.Net;
using System.Text;
using Autodesk.Revit.UI;
using StudioPractice.RevitConnector.Extraction;
using StudioPractice.RevitConnector.Models;

namespace StudioPractice.RevitConnector;

public sealed class LocalConnectorHost : IExternalEventHandler, IDisposable
{
    public const int Port = 17300;

    private readonly ExternalEvent _externalEvent;
    private readonly HttpListener _listener = new();
    private readonly object _gate = new();
    private TaskCompletionSource<string>? _pending;
    private bool _started;

    public LocalConnectorHost()
    {
        _externalEvent = ExternalEvent.Create(this);
    }

    public void Start()
    {
        if (_started)
        {
            return;
        }

        _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        _listener.Start();
        _started = true;
        _ = Task.Run(ListenAsync);
    }

    public void Stop()
    {
        if (!_started)
        {
            return;
        }

        _started = false;
        try
        {
            _listener.Stop();
        }
        catch (ObjectDisposedException)
        {
        }
    }

    public void Dispose()
    {
        Stop();
        _listener.Close();
        _externalEvent.Dispose();
    }

    public string GetName() => "StudioPractice BOM extract";

    public void Execute(UIApplication app)
    {
        TaskCompletionSource<string>? pending;
        lock (_gate)
        {
            pending = _pending;
        }

        if (pending is null)
        {
            return;
        }

        try
        {
            pending.TrySetResult(ConnectorHotSwap.ExtractJson(app));
        }
        catch (Exception ex)
        {
            pending.TrySetException(ex);
        }
    }

    private async Task ListenAsync()
    {
        while (_started)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (HttpListenerException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }

            _ = Task.Run(() => Handle(context));
        }
    }

    private void Handle(HttpListenerContext context)
    {
        try
        {
            AddCors(context.Response);

            if (context.Request.HttpMethod == "OPTIONS")
            {
                context.Response.StatusCode = 204;
                context.Response.Close();
                return;
            }

            string path = context.Request.Url?.AbsolutePath.TrimEnd('/') ?? "";
            if (context.Request.HttpMethod == "GET" && (path == "/bom" || path == "/extract"))
            {
                WriteJson(context.Response, RequestExtract());
                return;
            }

            if (context.Request.HttpMethod == "GET" && path == "/last")
            {
                string? last = null;
                if (File.Exists(BomJson.OutputPath))
                {
                    last = File.ReadAllText(BomJson.OutputPath);
                }
                else
                {
                    last = BomJson.LastJson;
                }

                if (string.IsNullOrEmpty(last))
                {
                    WriteText(context.Response, 404, "no extract yet");
                    return;
                }

                WriteJson(context.Response, last);
                return;
            }

            if (context.Request.HttpMethod == "GET" && path == "/health")
            {
                WriteText(context.Response, 200, "ok");
                return;
            }

            WriteText(context.Response, 404, "not found");
        }
        catch (Exception ex)
        {
            try
            {
                WriteText(context.Response, 500, ex.Message);
            }
            catch (HttpListenerException)
            {
            }
        }
    }

    private string RequestExtract()
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_gate)
        {
            _pending = tcs;
        }

        ExternalEventRequest request = _externalEvent.Raise();
        if (request != ExternalEventRequest.Accepted)
        {
            throw new InvalidOperationException("Revit did not accept the extract request. Focus the Revit window and retry.");
        }

        if (!tcs.Task.Wait(TimeSpan.FromSeconds(90)))
        {
            throw new TimeoutException("Timed out waiting for Revit to extract the BOM.");
        }

        return tcs.Task.GetAwaiter().GetResult();
    }

    private static void AddCors(HttpListenerResponse response)
    {
        response.Headers["Access-Control-Allow-Origin"] = "*";
        response.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
        response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    }

    private static void WriteJson(HttpListenerResponse response, string json)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        response.StatusCode = 200;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentEncoding = Encoding.UTF8;
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.Close();
    }

    private static void WriteText(HttpListenerResponse response, int status, string text)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = status;
        response.ContentType = "text/plain; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.Close();
    }
}
