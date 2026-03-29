# Video DL

Local downloader project with three app paths:

- Web app served locally on `http://localhost:3000`
- Electron desktop app for feature-rich packaging
- Neutralino desktop app for much smaller Windows builds

## Install

```powershell
npm.cmd install
```

## Run the web app

```powershell
npm.cmd start:web
```

Or use the one-click local browser launcher:

```powershell
npm.cmd run launch:web
```

You can also double-click [Launch Video DL Web.cmd](C:\apps\video-dl\Launch Video DL Web.cmd).

Downloads are saved under `downloads/video` and `downloads/audio` in this project.

## Run the Electron desktop app

```powershell
npm.cmd start:desktop
```

## Build the Electron Windows app

```powershell
npm.cmd run pack:win
```

This creates a runnable Windows app folder at `dist-packager/Video DL Desktop-win32-x64/`.

## Run the lightweight Windows app

```powershell
npm.cmd run start:neutralino
```

## Build the lightweight Windows app

```powershell
npm.cmd run pack:win:lite
```

This writes the smaller package to `neutralino-lite/dist-lite/` and runs the local unblock helper for built artifacts on this PC.

If Windows still flags an older artifact you already downloaded or extracted, run:

```powershell
npm.cmd run unblock:lite
```

## Bootstrap behavior

- The first real download fetches `yt-dlp` automatically.
- The first video merge or MP3 conversion fetches `ffmpeg` automatically on Windows.

## Notes

- Supported sites depend on `yt-dlp`.
- The Electron app remains the more flexible desktop shell.
- The Neutralino app is the smaller/faster-starting Windows-focused build.


