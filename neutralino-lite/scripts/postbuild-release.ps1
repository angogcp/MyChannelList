param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$config = Get-Content (Join-Path $PSScriptRoot '..\neutralino.config.json') -Raw | ConvertFrom-Json
$version = [string]$config.version
$distDir = Join-Path $PSScriptRoot '..\dist-lite'
$src = Join-Path $distDir 'video-dl-lite-release.zip'
$dst = Join-Path $distDir ("video-dl-lite-$version-release.zip")

if(Test-Path $dst) {
  Remove-Item $dst -Force
}

if(Test-Path $src) {
  Move-Item $src $dst -Force
}
