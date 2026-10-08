#!/bin/bash
set -euo pipefail

OPEN_MODE="${1:-browser}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT=3010
URL="http://localhost:$PORT"
LOG_DIR="${TMPDIR:-/tmp/}VideoDLWeb"
STDOUT_LOG="$LOG_DIR/web.stdout.log"
STDERR_LOG="$LOG_DIR/web.stderr.log"
NPM_LOG="$LOG_DIR/npm-install.log"

mkdir -p "$LOG_DIR"

cd "$ROOT_DIR"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not found in PATH."
  echo "Please install Node.js from https://nodejs.org or via Homebrew ('brew install node')."
  exit 1
fi

# 2. Ensure dependencies
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing npm dependencies for the first run..."
  rm -f "$NPM_LOG"
  if ! npm install --no-fund --no-audit > "$NPM_LOG" 2>&1; then
    echo "Failed to install dependencies automatically."
    cat "$NPM_LOG"
    exit 1
  fi
fi

# 3. Stop existing process on port 3010 if any
EXISTING_PID=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo "Stopping existing process on port $PORT (PID: $EXISTING_PID)..."
  kill -9 $EXISTING_PID 2>/dev/null || true
  sleep 1
fi

# 4. Start the server
rm -f "$STDOUT_LOG" "$STDERR_LOG"
echo "Starting Video DL server on port $PORT..."
PORT=$PORT nohup node server.js > "$STDOUT_LOG" 2> "$STDERR_LOG" &
SERVER_PID=$!

# 5. Wait for server readiness
echo "Waiting for server to become ready at $URL..."
READY=false
for _ in $(seq 1 40); do
  if curl -sf -m 1 "$URL/api/app-info" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 0.5
done

if [ "$READY" != "true" ]; then
  echo "Error: Server failed to start within 20 seconds."
  echo "--- stdout ---"
  cat "$STDOUT_LOG" 2>/dev/null || true
  echo "--- stderr ---"
  cat "$STDERR_LOG" 2>/dev/null || true
  exit 1
fi

echo "Video DL server is running (PID: $SERVER_PID)."

# 6. Open browser / app window
open_app_mode() {
  local target_url="$1"
  local profile_dir="${TMPDIR:-/tmp/}VideoDLWebAppProfile"
  mkdir -p "$profile_dir"

  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args "--app=$target_url" "--new-window" "--user-data-dir=$profile_dir"
    return 0
  fi

  if [ -d "/Applications/Microsoft Edge.app" ]; then
    open -na "Microsoft Edge" --args "--app=$target_url" "--new-window" "--user-data-dir=$profile_dir"
    return 0
  fi

  if [ -d "/Applications/Brave Browser.app" ]; then
    open -na "Brave Browser" --args "--app=$target_url" "--new-window" "--user-data-dir=$profile_dir"
    return 0
  fi

  # Fallback to default browser
  open "$target_url"
}

case "$OPEN_MODE" in
  app)
    echo "Opening in app window..."
    open_app_mode "$URL"
    ;;
  browser)
    echo "Opening in default browser: $URL"
    open "$URL"
    ;;
  none)
    echo "Server ready at $URL (browser launch skipped)."
    ;;
  *)
    echo "Unknown mode '$OPEN_MODE', opening in default browser..."
    open "$URL"
    ;;
esac
