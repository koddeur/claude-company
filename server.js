// Claude Company : lit les transcripts Claude Code (lecture seule) et diffuse l'état des agents en SSE.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const live = require('./live');

const PORT = Number(process.env.PORT) || 4747;
const HOST = process.env.HOST || '127.0.0.1';
// Hors loopback (accès mobile sur le réseau local), toute requête exige un jeton.
const LOCAL_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const TOKEN = LOCAL_ONLY ? null : (process.env.CLAUDE_COMPANY_TOKEN || crypto.randomBytes(16).toString('hex'));

function authorized(req, url) {
  if (!TOKEN) return true;
  const given = url.searchParams.get('token') || (req.headers.cookie || '').match(/(?:^|;\s*)cc_token=([a-f0-9]+)/)?.[1] || '';
  const a = Buffer.from(given), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `http://${i.address}:${PORT}/?token=${TOKEN}`);
}
const ROOT = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const WINDOW_MS = (Number(process.env.WINDOW_MIN) || 120) * 60_000; // fraîcheur max des fichiers déposés par la statusline
const TAIL_BYTES = 512 * 1024;
const SCAN_MS = 1500;
const SUB_ACTIVE_MS = 5 * 60_000;
const PUBLIC = path.join(__dirname, 'public');
// Écrit par la statusline (voir README) : contexte exact + quota de l'abonnement.
const BRIDGE = process.env.CLAUDE_COMPANY_STATUS_DIR || path.join(os.homedir(), '.claude', 'claude-company', 'status');

const ZONES = {
  code: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  library: ['Read', 'Grep', 'Glob', 'LS', 'ToolSearch', 'Skill'],
  servers: ['Bash', 'BashOutput', 'KillShell', 'KillBash', 'Monitor'],
  web: ['WebSearch', 'WebFetch'],
  meeting: ['Agent', 'Task', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'SendMessage'],
};
const WAITING_TOOLS = new Set(['AskUserQuestion']);

function zoneOf(tool) {
  if (!tool) return null;
  if (tool.startsWith('mcp__')) return 'web';
  for (const [z, list] of Object.entries(ZONES)) if (list.includes(tool)) return z;
  return 'library';
}

const cut = (s, n = 60) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Libellé court et sans contenu sensible : jamais la commande shell brute, ni le contenu des fichiers.
function labelOf(name, input = {}) {
  if (name.startsWith('mcp__')) return cut(name.split('__').slice(1).join(' · '));
  switch (name) {
    case 'Bash': return cut(input.description || 'commande shell');
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return input.file_path ? path.basename(input.file_path) : name;
    case 'Grep': case 'Glob': return cut(`« ${input.pattern || ''} »`, 40);
    case 'WebSearch': return cut(input.query);
    case 'WebFetch': try { return new URL(input.url).hostname; } catch { return 'page web'; }
    case 'Agent': case 'Task': return cut(input.description || input.subagent_type || 'sous-agent');
    case 'Skill': return cut(input.skill);
    case 'TodoWrite': return 'met à jour sa todo';
    default: return name;
  }
}

const cache = new Map(); // file -> { mtimeMs, size, agent }

async function listFiles() {
  const out = [];
  let dirs;
  try { dirs = await fsp.readdir(ROOT, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path.join(ROOT, d.name);
    let entries;
    try { entries = await fsp.readdir(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ file: path.join(pdir, e.name), projDir: d.name, parent: null });
      else if (e.isDirectory() && e.name !== 'memory') {
        const sub = path.join(pdir, e.name, 'subagents');
        let subs;
        try { subs = await fsp.readdir(sub); } catch { continue; }
        for (const s of subs) if (s.endsWith('.jsonl')) out.push({ file: path.join(sub, s), projDir: d.name, parent: e.name });
      }
    }
  }
  return out;
}

async function readTail(file, size) {
  const fh = await fsp.open(file, 'r');
  try {
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // ligne partielle
    return lines;
  } finally { await fh.close(); }
}

async function customTitle(file) {
  const p = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'custom-title.json');
  try {
    const j = JSON.parse(await fsp.readFile(p, 'utf8'));
    return typeof j === 'string' ? j : j.title || j.customTitle || null;
  } catch { return null; }
}

function analyze(lines, meta) {
  const pending = new Map();
  const log = [];
  let title = null, cwd = null, branch = null, model = null, firstTs = null, lastTs = null;
  let lastKind = null, toolCount = 0, todos = null, lastZone = null, agentName = null, ctxTokens = null;

  for (const line of lines) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const ts = d.timestamp ? Date.parse(d.timestamp) : null;
    if (ts) { firstTs ??= ts; lastTs = ts; }
    if (d.aiTitle) title = d.aiTitle;
    if (d.cwd && !cwd) cwd = d.cwd; // cwd de départ : un `cd` en cours de session ne renomme pas l'agent
    if (d.gitBranch) branch = d.gitBranch;
    if (d.agentType || d.subagentType) agentName = d.agentType || d.subagentType;

    if (d.type === 'system' && d.subtype === 'turn_duration') { lastKind = 'end'; continue; }
    const m = d.message;
    if (!m || (d.type !== 'assistant' && d.type !== 'user')) continue;

    if (d.type === 'assistant') {
      if (m.model && !m.model.startsWith('<')) model = m.model;
      const u = m.usage;
      if (u && !!d.isSidechain === !!meta.parent) ctxTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const blocks = Array.isArray(m.content) ? m.content : [];
      let usedTool = false;
      for (const b of blocks) {
        if (b?.type !== 'tool_use') continue;
        usedTool = true;
        toolCount++;
        const label = labelOf(b.name, b.input || {});
        pending.set(b.id, { name: b.name, label, ts });
        lastZone = zoneOf(b.name);
        log.push({ ts, tool: b.name, label });
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          todos = b.input.todos.map(t => ({ text: cut(t.activeForm && t.status === 'in_progress' ? t.activeForm : t.content, 80), status: t.status }));
        }
      }
      if (usedTool) lastKind = 'tool';
      else if (m.stop_reason === 'end_turn') lastKind = 'end';
      else if (blocks.some(b => b?.type === 'text' || b?.type === 'thinking')) lastKind = lastKind === 'end' ? 'end' : 'think';
    } else {
      const c = m.content;
      if (Array.isArray(c) && c.some(b => b?.type === 'tool_result')) {
        for (const b of c) if (b?.type === 'tool_result') pending.delete(b.tool_use_id);
        lastKind = 'result';
      } else if (!d.isMeta) {
        lastKind = 'prompt';
      }
    }
  }

  const now = Date.now();
  const age = now - (lastTs || meta.mtimeMs);
  const open = [...pending.values()];
  const current = open[open.length - 1] || null;

  let state, zone, activity;
  if (current && WAITING_TOOLS.has(current.name)) {
    state = 'waiting'; zone = 'cafe'; activity = 'te pose une question';
  } else if (lastKind === 'end' || (!current && age > 5 * 60_000)) {
    state = age > 15 * 60_000 ? 'idle' : 'waiting';
    zone = 'cafe';
    activity = state === 'idle' ? 'en pause' : 'attend ta réponse';
  } else if (current) {
    zone = zoneOf(current.name);
    const toolAge = now - (current.ts || now);
    state = toolAge > 90_000 && current.name !== 'Bash' && current.name !== 'Agent' && current.name !== 'Task' ? 'blocked' : 'working';
    activity = state === 'blocked' ? `bloqué ? ${current.label}` : current.label;
  } else {
    state = 'thinking'; zone = lastZone || 'meeting'; activity = 'réfléchit…';
  }

  const projectName = cwd ? path.basename(cwd) : meta.projDir.replace(/^-Users-[^-]+-?/, '').split('-').pop() || '~';
  return {
    id: path.basename(meta.file, '.jsonl'),
    parentId: meta.parent,
    isSub: !!meta.parent,
    name: meta.parent ? (agentName || 'sous-agent') : projectName,
    project: projectName,
    title: title || meta.customTitle || null,
    branch, model,
    state, zone, activity,
    tool: current?.name || null,
    pendingTool: !!current,
    toolCount,
    todos,
    startedAt: firstTs,
    lastAt: lastTs || meta.mtimeMs,
    log: log.slice(-8).reverse(),
    context: contextOf(ctxTokens, model, meta.bridge),
  };
}

function contextOf(tokens, model, bridge) {
  const cw = bridge?.context_window;
  const size = cw?.context_window_size || (tokens > 200_000 || /\[1m\]/i.test(model || '') ? 1_000_000 : 200_000);
  const used = cw?.used_percentage ?? (cw?.remaining_percentage != null ? 100 - cw.remaining_percentage : null);
  if (tokens == null && used == null) return null;
  return {
    tokens: tokens ?? Math.round((used / 100) * size),
    size,
    pct: Math.round(used ?? (tokens / size) * 100),
    exact: !!cw, // false : taille de fenêtre estimée
  };
}

async function readBridge() {
  const out = new Map();
  let files;
  try { files = await fsp.readdir(BRIDGE); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const st = await fsp.stat(path.join(BRIDGE, f));
      if (Date.now() - st.mtimeMs > WINDOW_MS) continue;
      const j = JSON.parse(await fsp.readFile(path.join(BRIDGE, f), 'utf8'));
      if (j.session_id) out.set(j.session_id, { ...j, mtimeMs: st.mtimeMs });
    } catch { /* fichier en cours d'écriture */ }
  }
  return out;
}

function quotaOf(bridge) {
  let best = null;
  for (const b of bridge.values()) if (b.rate_limits && (!best || b.mtimeMs > best.mtimeMs)) best = b;
  if (!best) return null;
  const win = w => w && { pct: Math.round(w.used_percentage ?? 0), resetsAt: w.resets_at ? (w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at) : null };
  return { fiveHour: win(best.rate_limits.five_hour), sevenDay: win(best.rate_limits.seven_day), at: best.mtimeMs };
}

async function scan(bridge, liveMap) {
  const now = Date.now();
  const files = await listFiles();
  const seen = new Set();
  const agents = [];
  for (const f of files) {
    let st;
    try { st = await fsp.stat(f.file); } catch { continue; }
    // seuls les projets actifs : session encore ouverte (sous-agent : parent ouvert et actif < 5 min)
    const open = liveMap.has(f.parent || path.basename(f.file, '.jsonl'));
    if (!open || (f.parent && now - st.mtimeMs > SUB_ACTIVE_MS)) continue;
    seen.add(f.file);
    const c = cache.get(f.file);
    let lines = c?.lines;
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      try { lines = await readTail(f.file, st.size); } catch { continue; }
      const ct = c?.customTitle !== undefined ? c.customTitle : await customTitle(f.file);
      cache.set(f.file, { mtimeMs: st.mtimeMs, size: st.size, lines, customTitle: ct });
    }
    const entry = cache.get(f.file);
    // ré-analyse à chaque passe : les états dépendent du temps écoulé
    agents.push(analyze(entry.lines, { ...f, mtimeMs: st.mtimeMs, customTitle: entry.customTitle, bridge: f.parent ? null : bridge.get(path.basename(f.file, '.jsonl')) }));
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);

  // taille de fenêtre connue (statusline) → appliquée aux sessions estimées du même modèle
  const sizeByModel = new Map(agents.filter(a => a.context?.exact && a.model).map(a => [a.model, a.context.size]));
  for (const a of agents) {
    const size = a.context && !a.context.exact && sizeByModel.get(a.model);
    if (size) { a.context.size = size; a.context.pct = Math.round((a.context.tokens / size) * 100); }
  }

  // session ouverte sans encore aucun message : pas de transcript, mais bien présente au bureau
  const known = new Set(agents.map(a => a.id));
  for (const [id, l] of liveMap) {
    if (known.has(id)) continue;
    const name = l.cwd ? path.basename(l.cwd) : '~';
    agents.push({
      id, parentId: null, isSub: false, name, project: name, title: null, branch: null, model: null,
      state: 'waiting', zone: 'cafe', activity: 'session ouverte, pas encore de message',
      tool: null, pendingTool: false, toolCount: 0, todos: null,
      startedAt: l.startedAt, lastAt: l.startedAt || now, log: [], context: null,
    });
  }

  // état déclaré par Claude Code + app hôte (pour « Ouvrir la fenêtre »)
  for (const a of agents) {
    const l = liveMap.get(a.isSub ? a.parentId : a.id);
    // nom = dossier de départ de la session (le transcript n'est lu qu'en partie sur les longues sessions)
    if (l?.cwd && !a.isSub) a.name = a.project = path.basename(l.cwd);
    if (!a.isSub) live.mergeStatus(a, l);
    a.live = l ? { status: l.status, app: l.host.app, how: l.host.app === 'Terminal' && l.host.tty ? 'tab' : l.host.appPath ? 'app' : null } : null;
  }

  const byId = new Map(agents.map(a => [a.id, a]));
  for (const a of agents) if (a.isSub && byId.has(a.parentId)) a.parentName = byId.get(a.parentId).name;
  return agents.sort((a, b) => b.lastAt - a.lastAt);
}

let snapshot = { agents: [], quota: null, at: Date.now() };
let liveMap = new Map();
const clients = new Set();

async function tick() {
  try {
    const bridge = await readBridge();
    liveMap = await live.readLive();
    snapshot = { agents: await scan(bridge, liveMap), quota: quotaOf(bridge), at: Date.now() };
    const msg = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of clients) res.write(msg);
  } catch (e) { console.error('scan:', e.message); }
  setTimeout(tick, SCAN_MS);
}

// Seule action du site sur le Mac : passer une fenêtre au premier plan.
// Réservée au navigateur du Mac lui-même (loopback + Origin locale : un autre site ne peut pas la déclencher).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function handleFocus(req, res) {
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const origins = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
  if (req.method !== 'POST') return json(405, { ok: false });
  if (!LOOPBACK.has(req.socket.remoteAddress) || !origins.includes(req.headers.origin)) return json(403, { ok: false, error: 'local uniquement' });
  if (!String(req.headers['content-type']).startsWith('application/json')) return json(415, { ok: false });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
  req.on('end', async () => {
    let id;
    try { id = JSON.parse(body).id; } catch { return json(400, { ok: false }); }
    const a = snapshot.agents.find(x => x.id === id);
    const l = a && liveMap.get(a.isSub ? a.parentId : a.id);
    if (!l) return json(404, { ok: false, error: 'session fermée' });
    json(200, await live.focus(l));
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (!authorized(req, url)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Jeton manquant ou invalide.'); }
  if (TOKEN && url.searchParams.has('token')) {
    // jeton déplacé dans un cookie, puis retiré de l'URL (historique, captures d'écran)
    url.searchParams.delete('token');
    res.writeHead(302, { 'Set-Cookie': `cc_token=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, Location: url.pathname + url.search });
    return res.end();
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/focus') return handleFocus(req, res);
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(snapshot));
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  if (TOKEN) {
    console.log('Claude Company, accès réseau local (protégé par jeton). Sur ton téléphone, même Wi-Fi :');
    for (const u of lanUrls()) console.log(`  ${u}`);
  } else console.log(`Claude Company → http://${HOST}:${PORT}  (démo : /?demo)`);
  console.log(`Lecture de ${ROOT} (sessions ouvertes uniquement)`);
  tick();
});
