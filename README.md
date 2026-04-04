# Video DL

Local web app for downloading videos, tracking channels, and optionally uploading completed downloads to Google Drive.

## Install

```powershell
npm.cmd install
```

## Run

Start the local web server:

```powershell
npm.cmd run start:web
```

Open it in your browser:

```text
http://localhost:3010
```

## Launchers

Open the web app in your default browser:

```powershell
npm.cmd run launch:web
```

Open the web app in an app-style Edge/Chrome window:

```powershell
npm.cmd run launch:app
```

You can also double-click [Launch Video DL Web.cmd](C:\apps\video-dl\Launch Video DL Web.cmd) or [Launch Video DL App.cmd](C:\apps\video-dl\Launch Video DL App.cmd).

## Data and downloads

- Downloads are saved under `downloads/video` and `downloads/audio`.
- Local app data is stored under `data/`.
- `yt-dlp` is fetched automatically on first use.
- `ffmpeg` is fetched automatically on first video merge or MP3 conversion on Windows.

## Notes

- Supported sites depend on `yt-dlp`.
- This branch is web-only and does not include the previous desktop packaging code.