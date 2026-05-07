# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
# Start the server
node server.js
npm start
npm run start:web

# Launch with browser window (auto-installs deps first time)
# Double-click: Launch Video DL Web.cmd
# Or via PowerShell:
.\scripts\launch-web.ps1
.\scripts\launch-web.ps1 -OpenMode app   # Edge/Chrome app window

# Install dependencies
npm install
```

Server runs on `http://localhost:3010`.

## Architecture

Express server serving a local web app for downloading YouTube videos, tracking channels, and optionally uploading to Google Drive. Single-file server (`server.js`) wires together factory modules from `lib/`.

### Backend modules (`lib/`)

- **`server.js`** — Express on port 3010. Serves static files from `public/`, JSON API at `/api/*`, SSE at `/api/queue/stream`. On startup, background-refreshes all channel caches with concurrency pool via `channels.refreshAllChannels()`.
- **`downloader.js`** — yt-dlp wrapper. Auto-downloads yt-dlp and ffmpeg on first use. Quality presets (MP4: best/2160p/1440p/1080p/720p/480p, MP3: best/320k/192k/128k). Spawns yt-dlp as child process, parses progress lines for UI.
- **`channels.js`** — YouTube channel management. `fetchVideos()` runs yt-dlp `--flat-playlist --dump-json`, backfills titles with `--print`, and caches results with SHA1-hashed filenames. `refreshAllChannels()` uses a Promise.race concurrency pool (default 4 concurrent). Handles garbled CJK titles via oEmbed fallback.
- **`contentTracker.js`** — Video tracking state machine. Each video tracked in `content-tracker.json` with status flow: new → queued → downloaded → in_progress → completed (or skipped). Scoring engine (`analyzeVideo()`) computes 0-95 score with breakdown, confidence, and learning profile from historical patterns.
- **`llmAnalysis.js`** — DeepSeek (OpenAI-compatible `/chat/completions`) integration. Sends structured JSON prompt asking for `score`, `recommendation`, `reasons`, `next_action` etc. Configurable via `DEEPSEEK_API_KEY`, `DEEPSEEK_ANALYSIS_MODEL`, `LLM_BASE_URL` in `.env.local`.
- **`queue.js`** — Download queue with max 2 concurrent downloads. Persists to `data/queue.json`. SSE broadcast on each state change. Post-download Drive upload. Resets crashed processing jobs to pending on restart.
- **`library.js`** — Scans `downloads/video/` and `downloads/audio/` directories. Path traversal protection via prefix check.
- **`googleDrive.js`** — OAuth2 with PKCE. Scoped to `auth/drive` + `userinfo.email`. Resumable upload session for large files. Refresh token stored in `data/google-drive-auth.json`.
- **`localConfig.js`** — Reads `.env.local` (KEY=VALUE lines) and `data/local-config.json` for server-side secrets and settings.

### Frontend (`public/`)

Four single-page HTML files, each with embedded CSS and JS. No framework — vanilla JS, `feather-icons` from CDN, SSE for queue updates.

- **`index.html`** — Downloader. URL input, quality/mode, Drive folder selection/drag-toggle, SSE queue stream with job cards.
- **`channels.html`** — Inbox. Channel CRUD, video list with heuristic scoring (% badge), AI insight panel, decision presets (Watch now / Queue / Download / Ignore), preference learning.
- **`analysis.html`** — Dashboard. Stat cards, channel performance table, needs attention cards, recent activity timeline, AI config status. Batch AI analysis via event delegation.
- **`library.html`** — Library. Downloaded file list with search/filter, media player overlay, bulk delete.

### Data (`data/`)

- `channels.json` — `[{name, url}]`
- `content-tracker.json` — `{ records: { [key]: {...} }, preferences: { global, channels } }`
- `queue.json` — Download job array with status/percent/message
- `google-drive-auth.json` — `{ clientId, clientSecret, refreshToken, email }`
- `channel-video-cache/` — SHA1-hashed JSON files per channel with cached video lists

### Configuration (`.env.local`)

Server-side only (not exposed to browser):

```
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_ANALYSIS_MODEL=deepseek-v4-flash
LLM_BASE_URL=https://api.deepseek.com/v1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Key patterns

- Factory functions: every module exports `createXyz(options)` accepting an options object with `appRoot`/`dataDir`.
- Chinese UI labels throughout. Scoring/analysis text is Chinese.
- Template literal HTML with manual `esc()` escaping (`&<>"'`).
- API pattern: every endpoint wraps body in try/catch, returns `{ error: message }` on failure.
- Media files streamed via `/api/library/media?path=...` with `sendFile()`.
- `new Function()` for client-side JS syntax validation (node --check for extracted scripts).
