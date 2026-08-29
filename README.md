# token-viewer

Minimalist live token viewer for coding agents — big bold numbers, smooth animation, tokens/time graph.

**Supports:** Opencode (`.local/share/opencode/opencode.db`), Codex (`codex-config/state_5.sqlite`), Claude Code (`~/.claude/projects/**/*.jsonl`), and extensible for others (Cursor, Windsurf, Aider).

## Run

```bash
node server.js
# → http://127.0.0.1:8787
```

Or:

```bash
./start.sh
```

## Features
- Daily / Weekly / Session / All time
- Input-only mode (default daily input)
- Gnomon / Williwaw / Instrument Sans fonts
- Smooth tween (easeOutCubic 480-950ms) @ 60fps
- Background tokens/time line graph (10 min window)
- Multi-agent combined or per-agent view
- Zero deps (Node 22+ `node:sqlite`)

## API
- `GET /api/live` — combined + per-agent stats
- `GET /api/agents` — availability
- `GET /api/health` — DB checks

