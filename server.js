#!/usr/bin/env node
// Live Opencode Token Viewer — localhost server (now multi-agent: opencode + codex + claude + others)
// Polls multiple DBs/jsonl and serves index.html + JSON API at /api/live

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.OPENCODE_DB || path.join(os.homedir(), ".local/share/opencode/opencode.db");
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));

// try node:sqlite (zero-deps, Node 22+)
let DatabaseSync = null;
try {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite");
  DatabaseSync = sqlite.DatabaseSync;
} catch {
  console.warn("[token-viewer] node:sqlite not available, falling back to sqlite3 CLI");
}

// ---------- helpers ----------
function todayCutMs(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function weekCutMs(){ return Date.now() - 7*24*60*60*1000; }

function safeSum(o){ return (o.sum_input||0)+(o.sum_output||0)+(o.sum_cache_read||0)+(o.sum_cache_write||0)+(o.sum_reasoning||0); }

// ---------- opencode ----------
function getOpencodeData(){
  try{
    if(!DatabaseSync) throw new Error("no sqlite");
    const db = new DatabaseSync(DB_PATH, { readOnly:true, allowBareInt:true });
    const row = db.prepare(`SELECT id, title, directory, project_id, model, agent, cost,
      tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning,
      time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT 1`).get();
    if(!row){ db.close(); return null; }
    const stats = db.prepare(`SELECT count(*) as sessions, sum(tokens_input) as sum_input, sum(tokens_output) as sum_output, sum(tokens_cache_read) as sum_cache_read, sum(tokens_cache_write) as sum_cache_write, sum(tokens_reasoning) as sum_reasoning, sum(cost) as sum_cost FROM session`).get();
    const weekCut = weekCutMs();
    const weekly = db.prepare(`SELECT count(*) as sessions, sum(tokens_input) as sum_input, sum(tokens_output) as sum_output, sum(tokens_cache_read) as sum_cache_read, sum(tokens_cache_write) as sum_cache_write, sum(tokens_reasoning) as sum_reasoning, sum(cost) as sum_cost FROM session WHERE time_updated >= ?`).get(weekCut);
    const dayCut = todayCutMs();
    const daily = db.prepare(`SELECT count(*) as sessions, sum(tokens_input) as sum_input, sum(tokens_output) as sum_output, sum(tokens_cache_read) as sum_cache_read, sum(tokens_cache_write) as sum_cache_write, sum(tokens_reasoning) as sum_reasoning, sum(cost) as sum_cost FROM session WHERE time_updated >= ?`).get(dayCut);
    db.close();
    const total = (row.tokens_input||0)+(row.tokens_output||0)+(row.tokens_cache_read||0)+(row.tokens_cache_write||0)+(row.tokens_reasoning||0);
    const globalTotal = safeSum(stats);
    const weeklyTotal = safeSum(weekly);
    const dailyTotal = safeSum(daily);
    return {
      session:{ id:row.id, title:row.title, directory:row.directory, project_id:row.project_id, model:row.model, agent:row.agent, cost:row.cost, tokens_input:row.tokens_input||0, tokens_output:row.tokens_output||0, tokens_cache_read:row.tokens_cache_read||0, tokens_cache_write:row.tokens_cache_write||0, tokens_reasoning:row.tokens_reasoning||0, total, time_created:row.time_created, time_updated:row.time_updated },
      stats:{ sessions:stats.sessions||0, total_tokens:globalTotal, sum_input:stats.sum_input||0, sum_output:stats.sum_output||0, sum_cache_read:stats.sum_cache_read||0, sum_cost:stats.sum_cost||0 },
      weekly:{ sessions:weekly.sessions||0, total_tokens:weeklyTotal, sum_input:weekly.sum_input||0, sum_output:weekly.sum_output||0, sum_cache_read:weekly.sum_cache_read||0, sum_cost:weekly.sum_cost||0, since:weekCut },
      daily:{ sessions:daily.sessions||0, total_tokens:dailyTotal, sum_input:daily.sum_input||0, sum_output:daily.sum_output||0, sum_cache_read:daily.sum_cache_read||0, sum_cost:daily.sum_cost||0, since:dayCut },
      _source:"opencode", _db:DB_PATH,
    };
  }catch(e){
    return { error:String(e.message||e), _source:"opencode" };
  }
}

// ---------- codex ----------
const CODEX_DB_CANDIDATES = [
  path.join(os.homedir(), "Downloads/CODING/codex-config/state_5.sqlite"),
  path.join(os.homedir(), ".codex/state_5.sqlite"),
  path.join(os.homedir(), ".codex", "state_5.sqlite"),
  path.join(os.homedir(), "Library/Application Support/com.openai.codex/state_5.sqlite"),
];
function resolveCodexDb(){
  for(const p of CODEX_DB_CANDIDATES){ try{ if(fs.existsSync(p)) return p; }catch{} }
  // also try symlink target
  try{ const link=fs.readlinkSync(path.join(os.homedir(), ".codex")); const cand=path.join(link,"state_5.sqlite"); if(fs.existsSync(cand)) return cand; }catch{}
  return null;
}
let codexDbPathCache = null;
function getCodexDbPath(){
  if(codexDbPathCache && fs.existsSync(codexDbPathCache)) return codexDbPathCache;
  codexDbPathCache = resolveCodexDb();
  return codexDbPathCache;
}
let codexCache=null, codexCacheExp=0;
function getCodexData(){
  const now=Date.now();
  if(codexCache && now < codexCacheExp) return codexCache;
  try{
    const dbPath = getCodexDbPath();
    if(!dbPath || !DatabaseSync) {
      const empty = { stats:{sessions:0,total_tokens:0,sum_input:0,sum_output:0,sum_cost:0}, daily:{sessions:0,total_tokens:0,sum_input:0,sum_cost:0,since:todayCutMs()}, weekly:{sessions:0,total_tokens:0,sum_input:0,sum_cost:0,since:weekCutMs()}, _source:"codex", _db:dbPath, _missing:true };
      codexCache=empty; codexCacheExp=now+3000; return empty;
    }
    const db = new DatabaseSync(dbPath, { readOnly:true });
    // threads table has tokens_used, updated_at (unix seconds)
    const stats = db.prepare(`SELECT count(*) as sessions, sum(tokens_used) as sum_total FROM threads`).get();
    const daySec = Math.floor(todayCutMs()/1000);
    const weekSec = Math.floor(weekCutMs()/1000);
    const daily = db.prepare(`SELECT count(*) as sessions, sum(tokens_used) as sum_total FROM threads WHERE updated_at >= ?`).get(daySec);
    const weekly = db.prepare(`SELECT count(*) as sessions, sum(tokens_used) as sum_total FROM threads WHERE updated_at >= ?`).get(weekSec);
    db.close();
    const data = {
      stats:{ sessions:stats.sessions||0, total_tokens:stats.sum_total||0, sum_input:stats.sum_total||0, sum_output:0, sum_cache_read:0, sum_cost:0 },
      daily:{ sessions:daily.sessions||0, total_tokens:daily.sum_total||0, sum_input:daily.sum_total||0, sum_output:0, sum_cache_read:0, sum_cost:0, since:todayCutMs() },
      weekly:{ sessions:weekly.sessions||0, total_tokens:weekly.sum_total||0, sum_input:weekly.sum_total||0, sum_output:0, sum_cache_read:0, sum_cost:0, since:weekCutMs() },
      _source:"codex", _db:dbPath,
    };
    codexCache=data; codexCacheExp=now+2000; return data;
  }catch(e){
    const err={ error:String(e.message||e), _source:"codex" };
    codexCache=err; codexCacheExp=now+5000; return err;
  }
}

// ---------- claude code ----------
let claudeCache=null, claudeCacheExp=0;
function getClaudeData(){
  const now=Date.now();
  if(claudeCache && now < claudeCacheExp) return claudeCache;
  try{
    const projectsDir = path.join(os.homedir(), ".claude/projects");
    if(!fs.existsSync(projectsDir)){
      const empty={ stats:{sessions:0,total_tokens:0,sum_input:0,sum_output:0,sum_cost:0}, daily:{sessions:0,total_tokens:0,sum_input:0,since:todayCutMs()}, weekly:{sessions:0,total_tokens:0,sum_input:0,since:weekCutMs()}, _source:"claude", _missing:true };
      claudeCache=empty; claudeCacheExp=now+5000; return empty;
    }
    const dayCut = todayCutMs();
    const weekCut = weekCutMs();
    let totalInput=0, totalOutput=0, totalCacheRead=0, dailyInput=0, dailyOutput=0, weeklyInput=0, weeklyOutput=0;
    let sessionsSet=new Set();
    let dailySessions=new Set();
    let weeklySessions=new Set();
    // walk projects dir
    const entries = fs.readdirSync(projectsDir, { withFileTypes:true });
    for(const ent of entries){
      if(!ent.isDirectory()) continue;
      const dir = path.join(projectsDir, ent.name);
      let files=[];
      try{ files=fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl")); }catch{ continue; }
      for(const file of files){
        const fp = path.join(dir, file);
        let content;
        try{ content=fs.readFileSync(fp, "utf8"); }catch{ continue; }
        // quick check to avoid parsing if no usage
        if(!content.includes("input_tokens")) continue;
        const lines=content.split("\n");
        for(const line of lines){
          if(!line || !line.includes("input_tokens")) continue;
          try{
            const obj=JSON.parse(line);
            // usage is under message.usage or directly usage?
            let usage = obj.message?.usage || obj.usage || null;
            if(!usage) continue;
            const inTok = usage.input_tokens || 0;
            const outTok = usage.output_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
            // timestamp: top-level timestamp (ISO) or message timestamp
            let tsStr = obj.timestamp || obj.message?.timestamp || null;
            let tsMs = 0;
            if(tsStr){
              if(typeof tsStr==="string" && tsStr.includes("T")) tsMs = new Date(tsStr).getTime();
              else if(typeof tsStr==="number") tsMs = tsStr < 1e12 ? tsStr*1000 : tsStr;
            }
            // if no timestamp, count as all-time only (fallback)
            totalInput+=inTok; totalOutput+=outTok; totalCacheRead+=cacheRead;
            if(obj.sessionId) sessionsSet.add(obj.sessionId);
            else if(obj.session_id) sessionsSet.add(obj.session_id);
            if(tsMs){
              if(tsMs >= dayCut){ dailyInput+=inTok; dailyOutput+=outTok; if(obj.sessionId) dailySessions.add(obj.sessionId); }
              if(tsMs >= weekCut){ weeklyInput+=inTok; weeklyOutput+=outTok; if(obj.sessionId) weeklySessions.add(obj.sessionId); }
            }
          }catch{}
        }
      }
    }
    // also count sessions from directory names as fallback if jsonl parsing missed
    // sessions are unique sessionId values
    const totalSessions = sessionsSet.size || 0;
    const data={
      stats:{ sessions:totalSessions, total_tokens:totalInput+totalOutput, sum_input:totalInput, sum_output:totalOutput, sum_cache_read:totalCacheRead, sum_cost:0 },
      daily:{ sessions:dailySessions.size||0, total_tokens:dailyInput+dailyOutput, sum_input:dailyInput, sum_output:dailyOutput, sum_cache_read:0, sum_cost:0, since:dayCut },
      weekly:{ sessions:weeklySessions.size||0, total_tokens:weeklyInput+weeklyOutput, sum_input:weeklyInput, sum_output:weeklyOutput, sum_cache_read:0, sum_cost:0, since:weekCut },
      _source:"claude",
    };
    claudeCache=data; claudeCacheExp=now+4000; return data;
  }catch(e){
    const err={ error:String(e.message||e), _source:"claude" };
    claudeCache=err; claudeCacheExp=now+5000; return err;
  }
}

// ---------- other agents (generic) ----------
function getOtherAgentsData(){
  // Detect cursor, windsurf, aider, etc. For now return zeros with availability flags.
  const candidates = [
    { id:"cursor", name:"Cursor", path:path.join(os.homedir(), ".cursor") },
    { id:"windsurf", name:"Windsurf", path:path.join(os.homedir(), ".codeium/windsurf") },
    { id:"aider", name:"Aider", path:path.join(os.homedir(), ".aider") },
    { id:"continue", name:"Continue", path:path.join(os.homedir(), ".continue") },
  ];
  const detected = candidates.map(c=> ({ ...c, exists: fs.existsSync(c.path) }));
  return { detected, note:"add parser for these when needed" };
}

function getCombinedData(op, co, cl){
  const sum = (a,b,c)=> (a||0)+(b||0)+(c||0);
  return {
    stats:{ sessions:sum(op?.stats?.sessions, co?.stats?.sessions, cl?.stats?.sessions), total_tokens:sum(op?.stats?.total_tokens, co?.stats?.total_tokens, cl?.stats?.total_tokens), sum_input:sum(op?.stats?.sum_input, co?.stats?.sum_input, cl?.stats?.sum_input), sum_output:sum(op?.stats?.sum_output, co?.stats?.sum_output, cl?.stats?.sum_output) },
    daily:{ sessions:sum(op?.daily?.sessions, co?.daily?.sessions, cl?.daily?.sessions), total_tokens:sum(op?.daily?.total_tokens, co?.daily?.total_tokens, cl?.daily?.total_tokens), sum_input:sum(op?.daily?.sum_input, co?.daily?.sum_input, cl?.daily?.sum_input), sum_output:sum(op?.daily?.sum_output, co?.daily?.sum_output, cl?.daily?.sum_output), since:todayCutMs() },
    weekly:{ sessions:sum(op?.weekly?.sessions, co?.weekly?.sessions, cl?.weekly?.sessions), total_tokens:sum(op?.weekly?.total_tokens, co?.weekly?.total_tokens, cl?.weekly?.total_tokens), sum_input:sum(op?.weekly?.sum_input, co?.weekly?.sum_input, cl?.weekly?.sum_input), sum_output:sum(op?.weekly?.sum_output, co?.weekly?.sum_output, cl?.weekly?.sum_output), since:weekCutMs() },
  };
}

function getLiveData(){
  const op = getOpencodeData();
  if(op?.error) {
    // fallback to cli if sqlite failed
    try{
      const sql=`SELECT json_object('id', id, 'title', title, 'directory', directory, 'model', model, 'agent', agent, 'cost', cost, 'tokens_input', tokens_input, 'tokens_output', tokens_output, 'tokens_cache_read', tokens_cache_read, 'tokens_cache_write', tokens_cache_write, 'tokens_reasoning', tokens_reasoning, 'time_updated', time_updated) FROM session ORDER BY time_updated DESC LIMIT 1;`;
      const out=execFileSync("sqlite3",[DB_PATH, sql],{encoding:"utf8", timeout:2000}).trim();
      if(out){ const row=JSON.parse(out); const total=(row.tokens_input||0)+(row.tokens_output||0)+(row.tokens_cache_read||0)+(row.tokens_cache_write||0)+(row.tokens_reasoning||0); return { session:{...row,total}, stats:null, daily:null, weekly:null, _source:"opencode-cli" }; }
    }catch{}
  }
  const co = getCodexData();
  const cl = getClaudeData();
  const combined = getCombinedData(op, co, cl);
  const others = getOtherAgentsData();
  return { opencode:op, codex:co, claude:cl, combined, others };
}

// ---------- static serving ----------
function serveFile(res, filePath, contentType){
  try{ const data=fs.readFileSync(filePath); res.writeHead(200,{"Content-Type":contentType,"Cache-Control":"no-store"}); res.end(data); }catch{ res.writeHead(404,{"Content-Type":"text/plain"}); res.end("not found"); }
}
const mime={ ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".otf":"font/otf",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf" };

const server=http.createServer((req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS"){ res.writeHead(204); return res.end(); }
  const parsedUrl=new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname=parsedUrl.pathname||"/";
  if(pathname==="/api/live" || pathname==="/api/tokens"){
    const data=getLiveData();
    if(!data){ res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"}); return res.end(JSON.stringify({error:"no data", db:DB_PATH})); }
    data.now=Date.now(); data.db=DB_PATH;
    // keep backward compat: top-level session/stats/daily/weekly = opencode (for old clients)
    if(data.opencode && !data.opencode.error){
      data.session=data.opencode.session;
      data.stats=data.opencode.stats;
      data.daily=data.opencode.daily;
      data.weekly=data.opencode.weekly;
    }
    res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store, no-cache, must-revalidate"});
    return res.end(JSON.stringify(data));
  }
  if(pathname==="/api/agents"){
    const d=getLiveData();
    res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
    return res.end(JSON.stringify({ opencode:!!d.opencode && !d.opencode.error, codex:!!d.codex && !d.codex.error && !d.codex._missing, claude:!!d.claude && !d.claude.error && !d.claude._missing, combined:d.combined, others:d.others, now:Date.now() }));
  }
  if(pathname==="/api/sessions"){
    try{
      if(!DatabaseSync) throw new Error("node:sqlite required");
      const db=new DatabaseSync(DB_PATH,{readOnly:true});
      const rows=db.prepare(`SELECT id, title, directory, model, cost, tokens_input, tokens_output, tokens_cache_read, time_updated FROM session ORDER BY time_updated DESC LIMIT 20`).all();
      db.close();
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      return res.end(JSON.stringify({sessions:rows}));
    }catch(e){ res.writeHead(500,{"Content-Type":"application/json"}); return res.end(JSON.stringify({error:String(e.message)})); }
  }
  if(pathname==="/api/health"){
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:true, db:DB_PATH, exists:fs.existsSync(DB_PATH), port:PORT, agents:getLiveData().others?.detected||[] }));
  }
  let file=pathname==="/" ? "/index.html" : pathname;
  file=path.normalize(file).replace(/^\/+/,"");
  const full=path.join(ROOT,file);
  if(!full.startsWith(ROOT)){ res.writeHead(403); return res.end("forbidden"); }
  if(fs.existsSync(full) && fs.statSync(full).isFile()){
    const ext=path.extname(full).toLowerCase();
    return serveFile(res, full, mime[ext]||"application/octet-stream");
  }
  if(pathname==="/" || !path.extname(pathname)) return serveFile(res, path.join(ROOT,"index.html"), mime[".html"]);
  res.writeHead(404,{"Content-Type":"text/plain"}); res.end("not found");
});

server.listen(PORT,HOST, ()=>{
  const u=`http://${HOST}:${PORT}`;
  console.log(`\n  ● opencode token viewer (multi-agent)`);
  console.log(`  → ${u}`);
  console.log(`  → opencode DB: ${DB_PATH} ${fs.existsSync(DB_PATH)?"✓":"✗"}`);
  const cx=getCodexDbPath(); console.log(`  → codex DB: ${cx||"not found"} ${cx&&fs.existsSync(cx)?"✓":"✗"}`);
  console.log(`  → claude: ~/.claude/projects ${fs.existsSync(path.join(os.homedir(),".claude/projects"))?"✓":"✗"}`);
  console.log(`  → polling ~250ms + agents cached 2-4s\n`);
  try{ if(!process.env.OPENCODE_DISABLE_AUTO_OPEN){ const opener=process.platform==="darwin"?"open":process.platform==="win32"?"start":"xdg-open"; try{ spawn(opener,[u],{detached:true, stdio:"ignore"}).unref(); }catch{} } }catch{}
});
process.on("SIGINT", ()=>{ console.log("\n shutting down"); server.close(()=>process.exit(0)); });
process.on("SIGTERM", ()=> server.close(()=>process.exit(0)));
