param(
  [string]$Action = '',
  [string]$PayloadBase64 = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JsonResult {
  param([Parameter(Mandatory=$true)]$Data)
  $Data | ConvertTo-Json -Compress -Depth 8
}
function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return ([Convert]::ToBase64String($Bytes).TrimEnd('=') -replace '\+', '-' -replace '/', '_')
}

function Get-BaseDirectories {
  $runtimeRoot = Join-Path $env:TEMP 'VideoDLLite'
  $stateRoot = Join-Path $env:LOCALAPPDATA 'VideoDLLite'
  [pscustomobject]@{
    Root = $runtimeRoot
    Bin = Join-Path $runtimeRoot 'bin'
    Downloads = Join-Path $runtimeRoot 'downloads'
    YtDlp = Join-Path (Join-Path $runtimeRoot 'bin') 'yt-dlp.exe'
    Ffmpeg = Join-Path (Join-Path $runtimeRoot 'bin') 'ffmpeg.exe'
    State = $stateRoot
    DriveAuth = Join-Path $stateRoot 'google-drive-auth.json'
  }
}

function Ensure-Directories {
  param($Paths)
  New-Item -ItemType Directory -Force -Path $Paths.Bin | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Paths.Downloads 'video') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Paths.Downloads 'audio') | Out-Null
  try {
    New-Item -ItemType Directory -Force -Path $Paths.State | Out-Null
  } catch {
    $fallbackState = Join-Path $Paths.Root 'state'
    New-Item -ItemType Directory -Force -Path $fallbackState | Out-Null
    $Paths.State = $fallbackState
    $Paths.DriveAuth = Join-Path $fallbackState 'google-drive-auth.json'
  }
}

function Download-File {
  param([string]$Url, [string]$Destination)
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Ensure-YtDlp {
  param($Paths)
  if(Test-Path $Paths.YtDlp) { return }
  Download-File 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' $Paths.YtDlp
}

function Find-FileRecursive {
  param([string]$Root, [string]$Name)
  $found = Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object { $_.Name -ieq $Name } | Select-Object -First 1
  if($null -eq $found) { return '' }
  return $found.FullName
}
function Ensure-Ffmpeg {
  param($Paths)
  if(Test-Path $Paths.Ffmpeg) { return }
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
  $zipPath = Join-Path $tempRoot 'ffmpeg.zip'
  $extractRoot = Join-Path $tempRoot 'unzipped'
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  try {
    Download-File 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $ffmpegSource = Find-FileRecursive $extractRoot 'ffmpeg.exe'
    if([string]::IsNullOrWhiteSpace($ffmpegSource)) { throw 'ffmpeg.exe was not found in the downloaded archive.' }
    Copy-Item -LiteralPath $ffmpegSource -Destination $Paths.Ffmpeg -Force
  } finally {
    if(Test-Path $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

function Load-DriveAuth {
  param($Paths)
  if(-not (Test-Path $Paths.DriveAuth)) { return $null }
  return (Get-Content $Paths.DriveAuth -Raw | ConvertFrom-Json)
}

function Save-DriveAuth {
  param($Paths, $Data)
  $json = $Data | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Paths.DriveAuth, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Clear-DriveAuth {
  param($Paths)
  if(Test-Path $Paths.DriveAuth) {
    Remove-Item $Paths.DriveAuth -Force
  }
}

function Get-DriveStatus {
  param($Paths)
  $auth = Load-DriveAuth $Paths
  Write-JsonResult @{
    ok = $true
    connected = ($null -ne $auth -and -not [string]::IsNullOrWhiteSpace([string]$auth.refreshToken) -and -not [string]::IsNullOrWhiteSpace([string]$auth.clientId))
    email = if($null -eq $auth) { '' } else { [string]$auth.email }
    clientId = if($null -eq $auth) { '' } else { [string]$auth.clientId }
  }
}
function Get-DriveAccessToken {
  param($Paths)
  $auth = Load-DriveAuth $Paths
  if($null -eq $auth) { throw 'Google Drive is not connected yet.' }
  if([string]::IsNullOrWhiteSpace([string]$auth.clientId) -or [string]::IsNullOrWhiteSpace([string]$auth.refreshToken)) {
    throw 'Google Drive credentials are incomplete. Reconnect the account.'
  }

  $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id = [string]$auth.clientId
    refresh_token = [string]$auth.refreshToken
    grant_type = 'refresh_token'
  }

  if([string]::IsNullOrWhiteSpace([string]$tokenResponse.access_token)) {
    throw 'Google Drive access token request did not return an access token.'
  }

  return [string]$tokenResponse.access_token
}

function Get-DriveUserInfo {
  param([string]$AccessToken)
  try {
    return Invoke-RestMethod -Method Get -Uri 'https://www.googleapis.com/oauth2/v2/userinfo' -Headers @{ Authorization = "Bearer $AccessToken" }
  } catch {
    return $null
  }
}

function Start-DriveAuth {
  param($Paths, $Payload)
  $clientId = [string]$Payload.clientId
  if([string]::IsNullOrWhiteSpace($clientId)) { throw 'A Google OAuth client ID is required.' }

  $listener = $null
  try {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $codeVerifier = ConvertTo-Base64Url $bytes
    $challengeBytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($codeVerifier))
    $codeChallenge = ConvertTo-Base64Url $challengeBytes
    $state = [Guid]::NewGuid().ToString('N')

    $port = Get-Random -Minimum 49152 -Maximum 65535
    $redirectUri = "http://127.0.0.1:$port/"
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add($redirectUri)
    $listener.Start()
    $scope = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email'
    $query = @(
      'response_type=code',
      ('client_id=' + [Uri]::EscapeDataString($clientId)),
      ('redirect_uri=' + [Uri]::EscapeDataString($redirectUri)),
      ('scope=' + [Uri]::EscapeDataString($scope)),
      ('code_challenge=' + [Uri]::EscapeDataString($codeChallenge)),
      'code_challenge_method=S256',
      'access_type=offline',
      'prompt=consent',
      ('state=' + [Uri]::EscapeDataString($state))
    ) -join '&'
    $authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + $query

    Start-Process $authUrl | Out-Null
    $pending = $listener.BeginGetContext($null, $null)
    if(-not $pending.AsyncWaitHandle.WaitOne(180000)) {
      throw 'Google Drive sign-in timed out after waiting 3 minutes for the browser callback.'
    }

    $context = $listener.EndGetContext($pending)
    $request = $context.Request
    $response = $context.Response

    $html = '<html><body style="font-family:Segoe UI, sans-serif;padding:24px;"><h2>Video DL Lite</h2><p>Google Drive sign-in is complete. You can close this window and return to the app.</p></body></html>'
    $buffer = [Text.Encoding]::UTF8.GetBytes($html)
    $response.ContentType = 'text/html; charset=utf-8'
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()

    $code = $request.QueryString['code']
    $returnedState = $request.QueryString['state']
    $error = $request.QueryString['error']

    if(-not [string]::IsNullOrWhiteSpace($error)) {
      throw "Google Drive sign-in failed: $error"
    }
    if($returnedState -ne $state) {
      throw 'Google Drive sign-in returned an unexpected state value.'
    }
    if([string]::IsNullOrWhiteSpace($code)) {
      throw 'Google Drive sign-in did not return an authorization code.'
    }

    $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
      client_id = $clientId
      code = $code
      code_verifier = $codeVerifier
      grant_type = 'authorization_code'
      redirect_uri = $redirectUri
    }
    $refreshToken = [string]$tokenResponse.refresh_token
    if([string]::IsNullOrWhiteSpace($refreshToken)) {
      throw 'Google Drive did not return a refresh token. Remove this app from your Google account permissions and connect again.'
    }

    $accessToken = [string]$tokenResponse.access_token
    $userInfo = if([string]::IsNullOrWhiteSpace($accessToken)) { $null } else { Get-DriveUserInfo $accessToken }

    Save-DriveAuth $Paths ([pscustomobject]@{
      clientId = $clientId
      refreshToken = $refreshToken
      email = if($null -eq $userInfo) { '' } else { [string]$userInfo.email }
      connectedAt = (Get-Date).ToString('o')
    })

    Write-JsonResult @{
      ok = $true
      connected = $true
      email = if($null -eq $userInfo) { '' } else { [string]$userInfo.email }
      clientId = $clientId
    }
  } finally {
    if($null -ne $listener -and $listener.IsListening) {
      $listener.Stop()
      $listener.Close()
    }
  }
}

function Disconnect-Drive {
  param($Paths)
  Clear-DriveAuth $Paths
  Write-JsonResult @{ ok = $true; connected = $false }
}

function Get-DriveFolders {
  param($Paths)
  $accessToken = Get-DriveAccessToken $Paths
  $query = [Uri]::EscapeDataString("mimeType='application/vnd.google-apps.folder' and trashed=false")
  $uri = "https://www.googleapis.com/drive/v3/files?pageSize=100&orderBy=name_natural&fields=files(id,name)&q=$query&supportsAllDrives=true&includeItemsFromAllDrives=true"
  $response = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "Bearer $accessToken" }
  $folders = @([pscustomobject]@{ id = 'root'; name = 'My Drive (Root)' })
  foreach($folder in @($response.files)) {
    $folders += [pscustomobject]@{ id = [string]$folder.id; name = [string]$folder.name }
  }
  Write-JsonResult @{ ok = $true; folders = $folders }
}

function Get-FileMimeType {
  param([string]$Path)
  $extension = [IO.Path]::GetExtension($Path)
  if($null -eq $extension) { $extension = '' }
  switch($extension.ToLowerInvariant()) {
    '.mp3' { return 'audio/mpeg' }
    '.mp4' { return 'video/mp4' }
    '.m4a' { return 'audio/mp4' }
    '.webm' { return 'video/webm' }
    '.mkv' { return 'video/x-matroska' }
    default { return 'application/octet-stream' }
  }
}
function New-MultipartBody {
  param([string]$Boundary, [string]$MetadataJson, [byte[]]$FileBytes, [string]$MimeType)
  $newline = "`r`n"
  $stream = New-Object IO.MemoryStream
  $writer = New-Object IO.StreamWriter($stream, [Text.Encoding]::UTF8, 1024, $true)
  try {
    $writer.Write("--$Boundary$newline")
    $writer.Write("Content-Type: application/json; charset=UTF-8$newline$newline")
    $writer.Write($MetadataJson)
    $writer.Write($newline)
    $writer.Write("--$Boundary$newline")
    $writer.Write("Content-Type: $MimeType$newline$newline")
    $writer.Flush()
    $stream.Write($FileBytes, 0, $FileBytes.Length)
    $writer.Write($newline)
    $writer.Write("--$Boundary--$newline")
    $writer.Flush()
    return $stream.ToArray()
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

function Upload-DriveFile {
  param($Paths, $Payload)
  $filePath = [string]$Payload.filePath
  $folderId = [string]$Payload.folderId
  if([string]::IsNullOrWhiteSpace($filePath)) { throw 'A local file path is required for Google Drive upload.' }
  if(-not (Test-Path $filePath)) { throw 'The local file to upload was not found.' }
  if([string]::IsNullOrWhiteSpace($folderId)) { throw 'A Google Drive folder must be selected before uploading.' }

  $accessToken = Get-DriveAccessToken $Paths
  $fileName = [IO.Path]::GetFileName($filePath)
  $mimeType = Get-FileMimeType $filePath
  $metadataJson = (@{ name = $fileName; parents = @($folderId) } | ConvertTo-Json -Compress)
  $boundary = 'vdl-' + [Guid]::NewGuid().ToString('N')
  $body = New-MultipartBody -Boundary $boundary -MetadataJson $metadataJson -FileBytes ([IO.File]::ReadAllBytes($filePath)) -MimeType $mimeType

  $response = Invoke-RestMethod -Method Post -Uri 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink,parents' -Headers @{ Authorization = "Bearer $accessToken" } -ContentType "multipart/related; boundary=$boundary" -Body $body

  Write-JsonResult @{
    ok = $true
    id = [string]$response.id
    name = [string]$response.name
    webViewLink = [string]$response.webViewLink
    webContentLink = [string]$response.webContentLink
  }
}

function Get-Health {
  param($Paths)
  $driveAuth = Load-DriveAuth $Paths
  Write-JsonResult @{
    ok = $true
    ytDlpInstalled = (Test-Path $Paths.YtDlp)
    ffmpegAvailable = (Test-Path $Paths.Ffmpeg)
    downloadsDir = $Paths.Downloads
    driveConnected = ($null -ne $driveAuth -and -not [string]::IsNullOrWhiteSpace([string]$driveAuth.refreshToken))
  }
}
function Get-DestinationFromLog {
  param([string[]]$Lines)
  foreach($line in $Lines) {
    if($line -match '\[download\] Destination: (.+)$') { return $Matches[1] }
    if($line -match '\[Merger\] Merging formats into "(.+)"$') { return $Matches[1] }
    if($line -match '\[ExtractAudio\] Destination: (.+)$') { return $Matches[1] }
    if($line -match '\[download\] (.+) has already been downloaded$') { return $Matches[1] }
    if($line -match '\[ExtractAudio\] Not converting audio (.+); file is already in target format') { return $Matches[1] }
  }
  return ''
}

function Start-Download {
  param($Paths, $Payload)
  $url = [string]$Payload.url
  $mode = if([string]::IsNullOrWhiteSpace([string]$Payload.mode)) { 'video' } else { [string]$Payload.mode }
  $customName = [string]$Payload.customName
  $targetRoot = [string]$Payload.targetRoot
  if([string]::IsNullOrWhiteSpace($url)) { throw 'A video URL is required.' }
  if($mode -ne 'video' -and $mode -ne 'mp3') { throw 'Mode must be either video or mp3.' }
  Ensure-YtDlp $Paths
  Ensure-Ffmpeg $Paths
  $outputBaseDir = if([string]::IsNullOrWhiteSpace($targetRoot)) { $Paths.Downloads } else { $targetRoot }
  $outputSubdir = if($mode -eq 'mp3') { 'audio' } else { 'video' }
  $outputDir = Join-Path $outputBaseDir $outputSubdir
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $safeName = $customName.Trim()
  if([string]::IsNullOrWhiteSpace($safeName)) { $safeName = '%(title)s' }
  $outputTemplate = Join-Path $outputDir ($safeName + '.%(ext)s')
  $arguments = @('--no-playlist','--restrict-filenames','--windows-filenames','--newline','--progress','--ffmpeg-location',$Paths.Ffmpeg)
  if($mode -eq 'mp3') { $arguments += @('-x','--audio-format','mp3','--audio-quality','0') }
  else { $arguments += @('-f','bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b','--merge-output-format','mp4') }
  $arguments += @('-o',$outputTemplate,$url)
  $stdoutPath = Join-Path $Paths.Root 'current-download.stdout.log'
  $stderrPath = Join-Path $Paths.Root 'current-download.stderr.log'
  if(Test-Path $stdoutPath) { Remove-Item $stdoutPath -Force }
  if(Test-Path $stderrPath) { Remove-Item $stderrPath -Force }

  [Environment]::SetEnvironmentVariable('Path', $env:Path, 'Process')
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  $process = Start-Process -FilePath $Paths.YtDlp -ArgumentList $arguments -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -Wait
  $exitCode = $process.ExitCode
  $stdoutLines = if(Test-Path $stdoutPath) { @(Get-Content $stdoutPath) } else { @() }
  $stderrLines = if(Test-Path $stderrPath) { @(Get-Content $stderrPath) } else { @() }
  $lines = @($stdoutLines + $stderrLines)
  $log = ($lines -join "`n").Trim()
  $destination = Get-DestinationFromLog $lines
  if($exitCode -ne 0 -and ([string]::IsNullOrWhiteSpace($destination) -or -not (Test-Path $destination))) {
    throw ($(if([string]::IsNullOrWhiteSpace($log)) { 'yt-dlp exited with an error.' } else { $log }))
  }

  Write-JsonResult @{
    ok = $true
    mode = $mode
    message = if($mode -eq 'mp3') { 'Audio download completed.' } else { 'Video download completed.' }
    filePath = $destination
    log = $log
  }
}
function Invoke-VideoDlCommand {
  param([string]$Action, [string]$PayloadBase64 = '')
  $paths = Get-BaseDirectories
  Ensure-Directories $paths
  $payload = [pscustomobject]@{}
  if(-not [string]::IsNullOrWhiteSpace($PayloadBase64)) {
    $payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
    if(-not [string]::IsNullOrWhiteSpace($payloadJson)) { $payload = $payloadJson | ConvertFrom-Json }
  }

  try {
    switch($Action) {
      'health' { Get-Health $paths; break }
      'download' { Start-Download $paths $payload; break }
      'drive-status' { Get-DriveStatus $paths; break }
      'drive-connect' { Start-DriveAuth $paths $payload; break }
      'drive-disconnect' { Disconnect-Drive $paths; break }
      'drive-list-folders' { Get-DriveFolders $paths; break }
      'drive-upload' { Upload-DriveFile $paths $payload; break }
      default { throw "Unknown action: $Action" }
    }
  } catch {
    Write-JsonResult @{ ok = $false; error = $_.Exception.Message }
    exit 1
  }
}

if(-not [string]::IsNullOrWhiteSpace($Action)) {
  Invoke-VideoDlCommand -Action $Action -PayloadBase64 $PayloadBase64
}


