# Opens a generated picture in Paint.
#
# A browser page is not allowed to start mspaint. This listens on localhost,
# writes the png it is given, and opens that file. Bind is loopback only.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File server/scripts/paint-bridge.ps1

$prefix = "http://127.0.0.1:17341/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Error "Paint bridge could not listen on $prefix. $_"
  exit 1
}

Write-Output "Paint bridge listening on $prefix"

function Send-Bridge($ctx, $code, $body) {
  $origin = $ctx.Request.Headers["Origin"]
  if ($origin -and ($origin -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?$')) {
    $ctx.Response.Headers["Access-Control-Allow-Origin"] = $origin
    $ctx.Response.Headers["Vary"] = "Origin"
  }
  $ctx.Response.Headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
  $ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type"
  $ctx.Response.Headers["Access-Control-Allow-Private-Network"] = "true"
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$body)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = "application/json"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Open-InPaint($dataUrl) {
  $marker = "data:image/png;base64,"
  if (-not $dataUrl.StartsWith($marker)) { throw "png required" }
  $bytes = [Convert]::FromBase64String($dataUrl.Substring($marker.Length))
  if ($bytes.Length -lt 24 -or $bytes.Length -gt 15MB) { throw "size" }
  if ($bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x4E -or $bytes[3] -ne 0x47) {
    throw "not png"
  }
  $path = Join-Path $env:TEMP ("studiopractice-" + [guid]::NewGuid().ToString("n") + ".png")
  [IO.File]::WriteAllBytes($path, $bytes)
  # Windows 11 Paint is an app-execution alias, not System32\mspaint.exe.
  Start-Process -FilePath "mspaint.exe" -ArgumentList $path
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  try {
    if ($req.HttpMethod -eq "OPTIONS") {
      Send-Bridge $ctx 204 ""
      continue
    }
    $origin = $req.Headers["Origin"]
    if ($origin -and $origin -notmatch '^https?://(localhost|127\.0\.0\.1)(:\d+)?$') {
      Send-Bridge $ctx 403 '{"ok":false}'
      continue
    }
    if ($req.HttpMethod -ne "POST" -or $req.Url.AbsolutePath -ne "/paint") {
      Send-Bridge $ctx 404 '{"ok":false}'
      continue
    }
    $reader = [IO.StreamReader]::new($req.InputStream, [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    $image = [string](($text | ConvertFrom-Json).image)
    Open-InPaint $image
    Send-Bridge $ctx 200 '{"ok":true}'
  } catch {
    Write-Output ("paint bridge: " + $_.Exception.Message)
    try { Send-Bridge $ctx 400 '{"ok":false}' } catch { try { $ctx.Response.Close() } catch {} }
  }
}
