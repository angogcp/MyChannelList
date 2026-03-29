param()

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

if(-not $ready) {
  $stdout = if(Test-Path $stdoutLog) { Get-Content $stdoutLog -Tail 60 | Out-String } else { '' }
  $stderr = if(Test-Path $stderrLog) { Get-Content $stderrLog -Tail 60 | Out-String } else { '' }
  throw ("Web app did not start on $url.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr")
}

try {
  Start-Process $url | Out-Null
  Write-Output "Opened $url"
} catch {
  Write-Output "Local web app is ready at $url"
}
