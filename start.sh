#!/bin/zsh
# opencode token viewer — start
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8787}"
echo "→ starting opencode token viewer on http://127.0.0.1:$PORT"
echo "→ DB: ~/.local/share/opencode/opencode.db"
# kill previous if any
lsof -ti :$PORT | xargs kill -9 2>/dev/null
sleep 0.3
cd "$DIR" && nohup node server.js > .viewer.log 2>&1 &
sleep 1
cat .viewer.log
echo ""
echo "✓ open http://127.0.0.1:$PORT"
open "http://127.0.0.1:$PORT" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT" 2>/dev/null
