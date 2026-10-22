<#
.SYNOPSIS
    Copies changed application files from this machine to the StudioPractice
    production server, using WinSCP over SFTP. Only files whose modification
    time on this machine is newer than on the server are copied. No files
    are deleted on the server.

.DESCRIPTION
    Wraps WinSCP's command-line scripting interface (winscp.com) to run:

        synchronize remote <LocalPath> <RemotePath>

    which mirrors newer local files up to the remote server without ever
    prompting to overwrite (batch mode) and without deleting anything
    remotely.

    This copies the program (server/src, server/db, web, and the server
    package files). It does not copy the Postgres database. server/.env on
    the production machine is never uploaded.

    The production host is 164.160.89.250 (the gp-fnx box, SSH port 22),
    and the app lives in /opt/StudioPractice. After -All, the script runs
    npm install and restarts the studiopractice service so the new files
    are the ones being served. Pass -FilesOnly to skip that.

    SSH password: set SFTP_DEPLOY_PASSWORD in the environment, or in
    server/.env (gitignored). A repo-root .env is also read. The value is
    not printed. If it is unset, WinSCP prompts.

.PARAMETER LocalPath
    Local folder to copy from. If omitted, uses the value remembered from
    the last single-folder run (deploy/sync-config.json), or the repo root
    on first use.

.PARAMETER RemotePath
    Destination folder on the server. If omitted, uses the remembered value,
    or /opt/StudioPractice on first use.

.PARAMETER RemoteBase
    Remote application root used by -All. Defaults to /opt/StudioPractice.

.PARAMETER All
    Sync server/src, server/db, and web into the matching paths under
    RemoteBase, plus server/package.json and server/package-lock.json.
    Then install production dependencies and restart studiopractice.

.PARAMETER FilesOnly
    With -All, copy the files and do not run npm or restart the service.

.PARAMETER WhatIf
    Preview which files would be copied. Nothing is transferred, installed,
    or restarted.

.EXAMPLE
    .\deploy\sync-to-production.ps1 -All

.EXAMPLE
    .\deploy\sync-to-production.ps1 -All -WhatIf

.EXAMPLE
    .\deploy\sync-to-production.ps1 -All -FilesOnly

.EXAMPLE
    .\deploy\sync-to-production.ps1 -LocalPath "C:\Users\USER\Documents\TSP\web" -RemotePath "/opt/StudioPractice/web"
#>

[CmdletBinding()]
param(
    [string]$LocalPath,
    [string]$RemotePath,
    [string]$RemoteBase = "/opt/StudioPractice",
    [switch]$All,
    [switch]$FilesOnly,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$ConfigPath = Join-Path $PSScriptRoot "sync-config.json"
$RepoRoot = Split-Path -Parent $PSScriptRoot

# WinSCP filemask: "<include>|<exclude>". An empty include means everything
# except the listed items. .env is the production DATABASE_URL and must stay
# on the server.
$ExcludePatterns = @(
    ".git/"
    ".git/**"
    "node_modules/"
    "node_modules/**"
    "*/node_modules/"
    "*/node_modules/**"
    ".env"
    "tests/"
    "tests/**"
    "*/tests/"
    "*/tests/**"
    "cookies.txt"
    "signup.json"
    "ui_served.js"
) -join ";"
$ExcludeMask = "|$ExcludePatterns"

$SyncCriteria = "time"

$SyncAllTargets = @(
    "server/src",
    "server/db",
    "web"
)

$SyncAllRepoFiles = @(
    "server/package.json",
    "server/package-lock.json"
)

# --- Connection -------------------------------------------------------------
$HostName = "164.160.89.250"
$Port     = 22
$User     = "root"

$savedConfig = $null
if (Test-Path $ConfigPath) {
    try { $savedConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { $savedConfig = $null }
}

if ($All -and ($LocalPath -or $RemotePath)) {
    throw "Use either -All or -LocalPath/-RemotePath, not both."
}

if (-not $All) {
    if (-not $LocalPath) {
        $LocalPath = if ($savedConfig -and $savedConfig.LocalPath) { $savedConfig.LocalPath } else { $RepoRoot }
    }
    if (-not $RemotePath) {
        $RemotePath = if ($savedConfig -and $savedConfig.RemotePath) { $savedConfig.RemotePath } else { $RemoteBase }
    }
}

function Find-WinSCP {
    $candidate = Get-Command "winscp.com" -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Source }

    $commonPaths = @(
        "$Env:ProgramFiles\WinSCP\WinSCP.com",
        "${Env:ProgramFiles(x86)}\WinSCP\WinSCP.com",
        "$Env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path $p) { return $p }
    }

    throw "Could not find winscp.com. Install WinSCP (https://winscp.net/) or add it to PATH, then re-run this script."
}

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not (Test-Path $Path)) { return $null }
    foreach ($line in Get-Content $Path) {
        if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") {
            $value = $Matches[1].Trim()
            if (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            ) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if ($value) { return $value }
        }
    }
    return $null
}

function Get-SftpDeployPassword {
    if ($env:SFTP_DEPLOY_PASSWORD) {
        return $env:SFTP_DEPLOY_PASSWORD
    }
    foreach ($envFile in @(
        (Join-Path $RepoRoot "server\.env"),
        (Join-Path $RepoRoot ".env")
    )) {
        $value = Get-DotEnvValue -Path $envFile -Name "SFTP_DEPLOY_PASSWORD"
        if ($value) { return $value }
    }
    return $null
}

function Get-WinSCPOpenCommand {
    param([string]$Password)

    # Password goes in the session URL, percent-encoded. WinSCP's /password=
    # switch breaks when the password contains &.
    if ($Password) {
        $encoded = [Uri]::EscapeDataString($Password)
        return "open sftp://${User}:${encoded}@${HostName}:$Port/ -hostkey=acceptnew"
    }
    return "open sftp://$User@${HostName}:$Port/ -hostkey=acceptnew"
}

function Invoke-WinSCPProcess {
    param(
        [Parameter(Mandatory = $true)][string]$WinSCP,
        [Parameter(Mandatory = $true)][string]$ScriptFile,
        [Parameter(Mandatory = $true)][string]$LogFile
    )

    & $WinSCP /ini=nul /script=$ScriptFile /log=$LogFile 2>&1 | ForEach-Object { Write-Host $_ }
    if ($null -ne $LASTEXITCODE) { return $LASTEXITCODE }
    return 0
}

$DeploySftpPassword = Get-SftpDeployPassword
if ($DeploySftpPassword) {
    Write-Host "Using SFTP password from SFTP_DEPLOY_PASSWORD." -ForegroundColor DarkGray
}
else {
    Write-Host "SFTP_DEPLOY_PASSWORD is not set. WinSCP will prompt for the root password." -ForegroundColor DarkGray
}

function Invoke-WinSCPSync {
    param(
        [Parameter(Mandatory = $true)][string]$WinSCP,
        [Parameter(Mandatory = $true)][string]$LocalPath,
        [Parameter(Mandatory = $true)][string]$RemotePath,
        [switch]$WhatIf,
        [switch]$OpenSession
    )

    if (-not (Test-Path $LocalPath)) {
        throw "Local path not found: $LocalPath"
    }

    Write-Host "WinSCP:      $WinSCP"
    Write-Host "Local path:  $LocalPath"
    Write-Host "Remote path: $RemotePath"
    Write-Host "Target:      sftp://$User@${HostName}:$Port"
    Write-Host ""

    $previewSwitch = ""
    if ($WhatIf) {
        $previewSwitch = "-preview"
        Write-Host "Running in preview mode (-WhatIf): no files will actually be transferred." -ForegroundColor Yellow
    }

    $scriptFile = New-TemporaryFile
    $logFile = Join-Path $env:TEMP "winscp-sync-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

    $scriptLines = @(
        "option batch continue",
        "option confirm off"
    )
    if ($OpenSession) {
        $scriptLines += Get-WinSCPOpenCommand -Password $DeploySftpPassword
    }
    $scriptLines += @(
        "synchronize remote -criteria=$SyncCriteria -filemask=`"$ExcludeMask`" $previewSwitch `"$LocalPath`" `"$RemotePath`"",
        "exit"
    )
    Set-Content -Path $scriptFile -Value $scriptLines -Encoding ASCII

    try {
        $exitCode = Invoke-WinSCPProcess -WinSCP $WinSCP -ScriptFile $scriptFile -LogFile $logFile
    }
    finally {
        Remove-Item $scriptFile -ErrorAction SilentlyContinue
    }

    Write-Host ""
    if ($exitCode -eq 0) {
        Write-Host "Sync completed successfully." -ForegroundColor Green
    }
    else {
        Write-Host "Sync finished with exit code $exitCode. See log for details: $logFile" -ForegroundColor Red
    }
    Write-Host "Log file: $logFile"

    return @{
        ExitCode = $exitCode
        LogFile  = $logFile
    }
}

$winscp = Find-WinSCP

if ($All) {
    $allLabels = @($SyncAllTargets + $SyncAllRepoFiles)
    Write-Host "Syncing standard paths: $($allLabels -join ', ')" -ForegroundColor Cyan
    Write-Host "Repo root:   $RepoRoot"
    Write-Host "Remote base: $RemoteBase"
    Write-Host "Target:      sftp://$User@${HostName}:$Port"
    Write-Host ""

    $batchScriptFile = New-TemporaryFile
    $batchLogFile = Join-Path $env:TEMP "winscp-sync-all-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

    $previewSwitch = ""
    if ($WhatIf) {
        $previewSwitch = "-preview"
        Write-Host "Running in preview mode (-WhatIf): no files will actually be transferred." -ForegroundColor Yellow
        Write-Host ""
    }

    $remoteDirs = @(
        "$RemoteBase/server/src"
        "$RemoteBase/server/db"
        "$RemoteBase/web"
    ) -join " "

    $scriptLines = @(
        "option batch continue",
        "option confirm off",
        (Get-WinSCPOpenCommand -Password $DeploySftpPassword)
    )
    if (-not $WhatIf) {
        $scriptLines += "call mkdir -p $remoteDirs"
    }

    foreach ($folder in $SyncAllTargets) {
        $localFolder = Join-Path $RepoRoot $folder
        $remoteFolder = "$RemoteBase/$($folder -replace '\\','/')"

        if (-not (Test-Path $localFolder)) {
            throw "Local path not found: $localFolder"
        }

        Write-Host "Queued: $localFolder -> $remoteFolder"
        $scriptLines += "synchronize remote -criteria=$SyncCriteria -filemask=`"$ExcludeMask`" $previewSwitch `"$localFolder`" `"$remoteFolder`""
    }

    foreach ($file in $SyncAllRepoFiles) {
        $localFile = Join-Path $RepoRoot $file
        if (-not (Test-Path $localFile)) {
            throw "Local path not found: $localFile"
        }

        $remoteFile = "$RemoteBase/$($file -replace '\\','/')"
        if ($WhatIf) {
            Write-Host "Preview: would upload if newer: $localFile -> $remoteFile"
            continue
        }

        Write-Host "Queued: $localFile -> $remoteFile"
        $scriptLines += "put -neweronly `"$localFile`" `"$remoteFile`""
    }

    if (-not $WhatIf -and -not $FilesOnly) {
        # Prefer the side-by-side Node 22 install when it is present, so this
        # does not depend on /usr/bin/node still being the app runtime.
        $remoteAfter = "bash -lc ""set -euo pipefail; if [ -x /opt/node-v22/bin/npm ]; then export PATH=/opt/node-v22/bin:`$PATH; fi; cd $RemoteBase/server && npm install --omit=dev && systemctl restart studiopractice && systemctl is-active studiopractice"""
        Write-Host "Queued: npm install --omit=dev and systemctl restart studiopractice"
        $scriptLines += "call $remoteAfter"
    }
    elseif ($FilesOnly) {
        Write-Host "Files only: the running service will keep the previous process until it is restarted." -ForegroundColor Yellow
    }

    $scriptLines += "exit"
    Set-Content -Path $batchScriptFile -Value $scriptLines -Encoding ASCII

    try {
        $exitCode = Invoke-WinSCPProcess -WinSCP $winscp -ScriptFile $batchScriptFile -LogFile $batchLogFile
    }
    finally {
        Remove-Item $batchScriptFile -ErrorAction SilentlyContinue
    }

    Write-Host ""
    if ($exitCode -eq 0) {
        Write-Host "Sync completed successfully." -ForegroundColor Green
    }
    else {
        Write-Host "Sync finished with exit code $exitCode. See log for details: $batchLogFile" -ForegroundColor Red
    }
    Write-Host "Log file: $batchLogFile"
    exit $exitCode
}

@{ LocalPath = $LocalPath; RemotePath = $RemotePath } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding ASCII

$result = Invoke-WinSCPSync -WinSCP $winscp -LocalPath $LocalPath -RemotePath $RemotePath -WhatIf:$WhatIf -OpenSession
exit $result.ExitCode
