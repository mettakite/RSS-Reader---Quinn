#!/bin/bash
# RSS Reader — one-time setup script
# Run this once in Terminal to make the reader auto-start on login

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/com.rssreader.server.plist"

echo "Installing RSS Reader auto-start..."
echo "Folder: $SCRIPT_DIR"

# Create LaunchAgents dir if needed
mkdir -p "$HOME/Library/LaunchAgents"

# Write plist with correct dynamic paths
cat > "$PLIST_DEST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.rssreader.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>-m</string>
        <string>http.server</string>
        <string>8080</string>
        <string>--bind</string>
        <string>127.0.0.1</string>
        <string>--directory</string>
        <string>$SCRIPT_DIR</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/rss-reader.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/rss-reader-error.log</string>

    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
</dict>
</plist>
PLIST

echo "✓ Written plist with correct paths to $PLIST_DEST"

# Unload old version if running, then reload
launchctl unload "$PLIST_DEST" 2>/dev/null
launchctl load "$PLIST_DEST"
echo "✓ Service loaded"

# Give it a moment to start
sleep 2

# Check if it's actually running
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/index.html | grep -q "200"; then
    echo ""
    echo "✅ Success! RSS Reader is live at http://127.0.0.1:8080"
    echo "   Bookmark that in Chrome — it auto-starts on every login."
else
    echo ""
    echo "⚠ Server may not have started. Check logs:"
    echo "   cat ~/Library/Logs/rss-reader-error.log"
fi
