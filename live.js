// Sessions Claude Code vivantes (~/.claude/sessions/*.json) : état déclaré, app hôte, mise au premier plan.
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DIR = process.env.CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');

const run = (cmd, args) => new Promise(resolve =>
  execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim())));

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// pid → { app, appPath, tty } ; mis en cache tant que le pid vit
const hosts = new Map();

async function hostOf(pid) {
  if (hosts.has(pid)) return hosts.get(pid);
  const tty = await run('ps', ['-o', 'tty=', '-p', String(pid)]);
  let p = pid, appPath = null;
  for (let i = 0; i < 10 && p > 1; i++) {
    const line = await run('ps', ['-o', 'ppid=,comm=', '-p', String(p)]);
    if (!line) break;
    const [, ppid, comm] = line.match(/^\s*(\d+)\s+(.*)$/) || [];
    // i = 0 : le binaire claude lui-même (sous Claude Desktop il vit dans un « claude.app » interne)
    const m = i > 0 && comm && comm.match(/^(.*?\.app)\//);
    if (m) { appPath = m[1]; break; }
    p = Number(ppid);
  }
  const host = {
    app: appPath ? path.basename(appPath, '.app') : null,
    appPath,
    tty: tty && /^ttys\d+$/.test(tty) ? tty : null,
  };
  hosts.set(pid, host);
  return host;
}

// sessionId → { pid, status, entrypoint, host }
async function readLive() {
  const out = new Map();
  let files;
  try { files = await fsp.readdir(DIR); } catch { return out; }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue; // ignore les .key
    try {
      const j = JSON.parse(await fsp.readFile(path.join(DIR, f), 'utf8'));
      if (!j.sessionId || !Number.isInteger(j.pid) || !alive(j.pid)) continue;
      out.set(j.sessionId, { pid: j.pid, status: j.status || null, entrypoint: j.entrypoint || null, cwd: j.cwd || null, startedAt: j.startedAt || null, host: await hostOf(j.pid) });
    } catch { /* fichier en cours d'écriture */ }
  }
  for (const pid of hosts.keys()) if (![...out.values()].some(s => s.pid === pid)) hosts.delete(pid);
  return out;
}

// L'état déclaré par Claude Code prime sur la déduction faite depuis le transcript.
function mergeStatus(agent, live) {
  if (!live) return;
  if (live.status === 'busy') {
    if (agent.state === 'waiting' || agent.state === 'idle') {
      agent.state = 'thinking'; agent.activity = 'réfléchit…';
      if (agent.zone === 'cafe') agent.zone = 'meeting';
    }
  } else if (live.status === 'idle' || live.status === 'shell') {
    if (agent.pendingTool) {
      // outil lancé mais session au repos : elle attend une permission
      agent.state = 'blocked';
      agent.activity = `attend ta permission · ${agent.activity.replace(/^bloqué \? /, '')}`;
    } else if (agent.state === 'working' || agent.state === 'thinking') {
      agent.state = 'waiting'; agent.zone = 'cafe'; agent.activity = 'attend ta réponse';
    }
  }
}

const TERMINAL_SCRIPT = `on run argv
  set target to "/dev/" & item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected of t to true
          set index of w to 1
          activate
          return "tab"
        end if
      end repeat
    end repeat
  end tell
  return "none"
end run`;

// Passe au premier plan la fenêtre de la session (onglet exact pour Terminal.app, sinon l'app).
async function focus(live) {
  const { host } = live;
  if (host.app === 'Terminal' && host.tty) {
    const r = await run('osascript', ['-e', TERMINAL_SCRIPT, host.tty]);
    if (r === 'tab') return { ok: true, how: 'tab', app: host.app };
  }
  if (host.appPath) {
    const r = await run('open', ['-a', host.appPath]);
    if (r !== null) return { ok: true, how: 'app', app: host.app };
  }
  return { ok: false, app: host.app };
}

module.exports = { readLive, mergeStatus, focus };
