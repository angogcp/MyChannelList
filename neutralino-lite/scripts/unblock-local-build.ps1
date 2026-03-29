param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$distDir = Join-Path $PSScriptRoot '..\dist-lite'
if(-not (Test-Path $distDir)) {
  Write-Output 'dist-lite folder not found. Nothing to unblock.'
  exit 0
}

$targets = Get-ChildItem -LiteralPath $distDir -Recurse -File -Include *.zip,*.exe,*.cmd,*.neu -ErrorAction SilentlyContinue
$processed = 0

foreach($target in $targets) {
  try {
    Unblock-File -LiteralPath $target.FullName -ErrorAction Stop
    $processed += 1
  } catch {
    if(-not $_.Exception.Message.Contains('does not have an alternate data stream')) {
      Write-Warning ("Could not unblock {0}: {1}" -f $target.FullName, $_.Exception.Message)
    }
  }
}

Write-Output ("Processed {0} build files for local unblocking." -f $processed)
