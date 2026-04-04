param(
  [ValidateSet('browser','app','none')]
  [string]$OpenMode = 'browser'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$port = 3010
$url = "http://localhost:$port"
$logDir = Join-Path $env:TEMP 'VideoDLWeb'
$stdoutLog = Join-Path $logDir 'web.stdout.log'
$stderrLog = Join-Path $logDir 'web.stderr.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($null -ne $existing) {
  try {
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 700
  } catch {
    # Continue and retry startup.
  }
}

if(Test-Path $stdoutLog) { try { Remove-Item $stdoutLog -Force -ErrorAction Stop } catch {} }
if(Test-Path $stderrLog) { try { Remove-Item $stderrLog -Force -ErrorAction Stop } catch {} }

$command = 'set PORT={0}&& cd /d "{1}" && node server.js 1>> "{2}" 2>> "{3}"' -f $port, $root, $stdoutLog, $stderrLog
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $command -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds(20)
$ready = $false

do {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    if($response.StatusCode -ge 200) {
      $ready = $true
      break
    }
  } catch {
    # Wait for the local server to come up.
  }
} while((Get-Date) -lt $deadline)

function Open-AppWindow {
  param([Parameter(Mandatory=$true)][string]$Url)

  $profileDir = Join-Path $env:TEMP 'VideoDLWebAppProfile'
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

  $candidates = @(
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )

  foreach($candidate in $candidates) {
    if(Test-Path $candidate) {
      Start-Process -FilePath $candidate -ArgumentList @("--app=$Url", '--new-window', "--user-data-dir=$profileDir") | Out-Null
      return $true
    }
  }

  try {
    $edge = Get-Command msedge.exe -ErrorAction Stop
    if($null -ne $edge -and -not [string]::IsNullOrWhiteSpace($edge.Source)) {
      Start-Process -FilePath $edge.Source -ArgumentList @("--app=$Url", '--new-window', "--user-data-dir=$profileDir") | Out-Null
      return $true
    }
  } catch {}

  try {
    $chrome = Get-Command chrome.exe -ErrorAction Stop
    if($null -ne $chrome -and -not [string]::IsNullOrWhiteSpace($chrome.Source)) {
      Start-Process -FilePath $chrome.Source -ArgumentList @("--app=$Url", '--new-window', "--user-data-dir=$profileDir") | Out-Null
      return $true
    }
  } catch {}

  return $false
}
if(-not $ready) {
  $stdout = if(Test-Path $stdoutLog) { Get-Content $stdoutLog -Tail 60 | Out-String } else { '' }
  $stderr = if(Test-Path $stderrLog) { Get-Content $stderrLog -Tail 60 | Out-String } else { '' }
  throw ("Web app did not start on $url.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr")
}

switch($OpenMode) {
  'none' {
    Write-Output "Local web app is ready at $url"
    break
  }
  'app' {
    if(Open-AppWindow -Url $url) {
      Write-Output "Opened desktop-style app window at $url"
    } else {
      Start-Process $url | Out-Null
      Write-Output "Opened browser window at $url"
    }
    break
  }
  default {
    try {
      Start-Process $url | Out-Null
      Write-Output "Opened $url"
    } catch {
      Write-Output "Local web app is ready at $url"
    }
    break
  }
}

