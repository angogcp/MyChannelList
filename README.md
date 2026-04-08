# Video DL

Version `1.0.21`

Local web app for downloading videos, tracking channel watch lists, choosing MP4/MP3 quality, and optionally uploading completed downloads to Google Drive.

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

You can also double-click [Launch Video DL Web.cmd](C:\apps\MyChannelList\Launch Video DL Web.cmd) or [Launch Video DL App.cmd](C:\apps\MyChannelList\Launch Video DL App.cmd).

## Current Features

- Single URL downloads for `MP4` video or `MP3` audio.
- Quality selection for both downloader and watch list flows.
- Watch List page for tracking channels and batch downloading selected videos.
- Download queue with `Clear finished` on both Downloader and Watch List pages.
- Google Drive connection, folder selection, optional upload after download, and optional local file cleanup after upload.
- Local Library page for browsing and deleting downloaded files.

## Data and downloads

- Downloads are saved under `downloads/video` and `downloads/audio`.
- Local app data is stored under `data/`.
- `yt-dlp` is fetched automatically on first use.
- `ffmpeg` is fetched automatically on first video merge or MP3 conversion on Windows.

## Notes

- Supported sites depend on `yt-dlp`.
- This project is now web-only and no longer includes the previous desktop packaging code.