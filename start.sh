#!/bin/sh
# Double-click on macOS (rename to .command) or run: sh start.sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "YT Downloader needs Node.js. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
exec node server.js