#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== Video DL — Termux Setup ==="

# Update packages
pkg update -y && pkg upgrade -y

# Install Node.js and ffmpeg
pkg install -y nodejs-lts ffmpeg

# Navigate to script directory
cd "$(dirname "$0")"

# Install Node dependencies
npm install

echo ""
echo "=== Setup complete ==="
echo ""
echo "Start the server:"
echo "  node server.js"
echo ""
echo "Then open http://localhost:3010 in Chrome on your phone."
echo ""
echo "To access from another device on the same network,"
echo "find your phone's IP and use http://IP:3010"
echo ""
echo "NOTE: Termux background processes may be killed by"
echo "Android battery optimization. Use 'termux-wake-lock'"
echo "to keep the server running:"
echo "  pkg install termux-api"
echo "  termux-wake-lock"
echo ""
