# token-viewer — live telemetry for code agents

<p align="center">
  <img src="https://token-viewer-elg.pages.dev/demo.mp4" width="100%" alt="demo" />
  <br>
  <em>One big number. No dashboard bloat.</em>
</p>

<p align="center">
  <a href="https://token-viewer-elg.pages.dev"><b>Live landing → token-viewer-elg.pages.dev</b></a> ·
  <a href="https://github.com/Parithosh-Varma/token-viewer"><b>GitHub</b></a> ·
  <code>http://127.0.0.1:8787</code>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-22%2B-black?style=flat-square">
  <img alt="deps" src="https://img.shields.io/badge/deps-zero-black?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-black?style=flat-square">
  <img alt="agents" src="https://img.shields.io/badge/agents-opencode%20%E2%80%A2%20codex%20%E2%80%A2%20claude-black?style=flat-square">
</p>

---

### Your agents spend tokens. Now you can see it — live.

`token-viewer` is a tiny localhost instrument that tails your local DBs and shows **daily input tokens** as a single, huge, bold number with a pointy sparkline behind it. No cloud. No API key. No bloat. Just `node server.js`.

It’s built for people who live in `opencode`, `codex --exec`, and `claude` all day and want to know — *how much did today actually cost me before I hit a limit?*

**[ → Open the Cloudflare landing](https://token-viewer-elg.pages.dev) · 5,759,642 daily input · smooth 60fps · dark/light**

---

### What you get

- **One number that matters** — daily **input-only** (not the 89M “total” that’s 93% cheap cache re-reads). Weekly / Session / All time in one click.
- **Smooth, not jumpy** — number tweens `easeOutCubic` 480–950ms at 60fps; sparkline glides with it. Poll 220ms, feels like realtime.
- **Pointy sparkline as bg** — last 10 min, subtle blue area, no sharp Bezier wobble, redraws every frame. You see bursts, not just totals.
- **Input-only by default** — because output is tiny (172k) and cache is cheap. Toggle if you want total.
- **Multi-agent, auto-detected** — `opencode` (`~/.local/share/opencode/opencode.db` 22G), `codex` (`state_5.sqlite` 58M), `claude` (`~/.claude/projects/**/*.jsonl`). Missing? It just shows 0 — other users see their own numbers. No config.
- **Zero deps** — `node:sqlite` on Node 22+, no `npm install`.
- **Minimal, bold** — Gnomon + Instrument Sans + Geist Mono, `clamp(56px,17vw,220px)`, tab `daily` `weekly` `session` `all`, dark/light toggle that remembers.

### Why not just `opencode stats`?

`opencode stats` is great for a summary. `token-viewer` is for **while you work** — leave it on a second monitor, fullscreen (`F`), and watch the number roll as your agent thinks. The `88,887 tokens/min` tape at the top is ambient awareness, not a report you have to run.

|  | `opencode stats` | `token-viewer` |
|---|---|---|
| When | after | **live** |
| What | table | **one big number** |
| Input vs cache | total | **input-only** + sparkline |
| Agents | opencode only | **opencode + codex + claude → combined** |

---

### 30s install

```bash
git clone https://github.com/Parithosh-Varma/token-viewer
cd token-viewer
node server.js
# → http://127.0.0.1:8787
```

Or one-liner:

```bash
./start.sh
# kills stale :8787, starts, opens browser
```

**Requirements:** Node 22+ (for `node:sqlite`). No other deps. Works on macOS / Linux. DBs are read-only — never writes.

### Use it

- **Time range:** `daily` (since 00:00) · `weekly` (last 7d) · `session` (current opencode session) · `all` (lifetime)
- **Agent:** auto-combined daily `6,996,187` = `opencode 5,759,642 + codex 1,279,049` (claude 0 on this machine, but others see theirs)
- **Copy:** `copy` button → `5,759,642` to clipboard
- **Fullscreen:** `⛶` or press `F`
- **Theme:** `◐` dark ↔ light (remembers)

### API (for your own tiles)

```bash
curl http://127.0.0.1:8787/api/live | jq
# { opencode:{ daily:{sum_input, total_tokens}, weekly, stats, session }, codex:{...}, claude:{...}, combined:{...} }

curl http://127.0.0.1:8787/api/agents
# { opencode:true, codex:true, claude:true, combined:{daily:{...}} }

curl http://127.0.0.1:8787/api/health
```

### How it works

```
opencode.db (sqlite, WAL) ──┐
codex state_5.sqlite ───────┼─→ server.js (node:http + node:sqlite, 2-4s cache for codex/claude) ──→ index.html (220ms poll → 60fps tween + canvas sparkline)
claude jsonl ───────────────┘
```

Reads are `readOnly` and never block your agents. Claude parsing scans `~/.claude/projects/**/*.jsonl` for `usage.input_tokens` + `timestamp` and sums by day/week.

### Cloudflare landing

This repo’s `landing/` is a static Pages deploy — same design system (Ink #050507, accent #00ff88, Gnomon display) as the viewer, with the live demo video.

Deploy yours:

```bash
npx wrangler pages deploy ./landing --project-name token-viewer
```

Live: **https://token-viewer-elg.pages.dev** · video: `landing/demo.mp4` (8.6M, autoplay muted loop)

### Extending to other agents

Add a new store in `server.js:140` `getOtherAgentsData()` — check `~/.cursor`, `~/.codeium/windsurf`, etc. If you add a parser, open a PR. The viewer will show it as a new chip without config.

---

<p align="center">
  <em>Built as a studio instrument — one risk: <b>signal green #00ff88</b> as hero on ink. No template, no bloat.</em><br>
  <a href="https://github.com/Parithosh-Varma/token-viewer">Star it</a> · <a href="https://token-viewer-elg.pages.dev">Landing</a> · <a href="http://127.0.0.1:8787">Localhost</a>
</p>
