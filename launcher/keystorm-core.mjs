#!/usr/bin/env node
/**
 * KEYSTORM launcher core.
 *
 * Checks GitHub for a newer build of the game, downloads + builds it into a
 * staging folder (the installed copy keeps working if anything fails), then
 * serves the built game on 127.0.0.1 so the desktop launcher can open it.
 *
 * Progress is written to <root>/status.json for the splash window to display.
 *
 * Usage:
 *   node keystorm-core.mjs --root <installDir> [--install-only] [--no-update]
 *                          [--parent-pid <pid>] [--port <n>]
 *
 * No dependencies beyond Node.js itself (>= 20.19) and the system `tar`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const DEFAULT_CONFIG = {
  repo: 'madema-art/typing_game',
  /** Empty = follow the repository's default branch. */
  branch: '',
  port: 47615,
  checkForUpdates: true,
};

// ------------------------------------------------------------------ args & paths

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error('Usage: node keystorm-core.mjs --root <installDir> [--install-only] [--no-update]');
  process.exit(2);
}
const ROOT = path.resolve(args.root);
const GAME = path.join(ROOT, 'game');
const NEXT = path.join(ROOT, 'game.next');
const OLD = path.join(ROOT, 'game.old');
const STATE_FILE = path.join(ROOT, 'state.json');
const STATUS_FILE = path.join(ROOT, 'status.json');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'core.log');
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

// ------------------------------------------------------------------ logging & status

fs.mkdirSync(LOG_DIR, { recursive: true });
try {
  if (fs.statSync(LOG_FILE).size > 1_000_000) fs.rmSync(LOG_FILE);
} catch {
  /* no log yet */
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
}

let lastStatus = {};
/** Write the status file atomically so the splash never reads half a file. */
function status(stage, message, extra = {}) {
  lastStatus = { stage, message, detail: '', progress: null, ...extra, time: Date.now() };
  const tmp = `${STATUS_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(lastStatus));
    fs.renameSync(tmp, STATUS_FILE);
  } catch (e) {
    log('status write failed', e.message);
  }
  if (!args.quiet) {
    const pct = typeof extra.progress === 'number' ? ` ${Math.round(extra.progress * 100)}%` : '';
    console.log(`[${stage}] ${message}${extra.detail ? ' — ' + extra.detail : ''}${pct}`);
  }
  log(`[${stage}]`, message, extra.detail ?? '');
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Remove a directory, retrying briefly (antivirus or indexers can hold files open on Windows). */
async function rmrf(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === 4) throw e;
      await sleep(400 * (i + 1));
    }
  }
}

async function renameRetry(from, to) {
  for (let i = 0; i < 8; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      if (i === 7) throw e;
      await sleep(300 * (i + 1));
    }
  }
}

/** Run a command; output goes to the log. Resolves with the exit code. */
function run(cmd, cmdArgs, cwd, { shell = false, timeoutMs = 15 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    log('$', cmd, cmdArgs.join(' '), `(in ${cwd})`);
    const child = spawn(cmd, cmdArgs, { cwd, shell, windowsHide: true, env: { ...process.env, CI: '1' } });
    const sink = (d) => log(String(d).trimEnd());
    child.stdout?.on('data', sink);
    child.stderr?.on('data', sink);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

function githubHeaders(accept) {
  const h = { 'User-Agent': 'keystorm-launcher', Accept: accept };
  const token = process.env.KEYSTORM_GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchText(url, accept, timeoutMs = 8000) {
  const res = await fetch(url, { headers: githubHeaders(accept), signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) throw new Error('the repository was not found on GitHub (if it is private, set KEYSTORM_GITHUB_TOKEN)');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub refused the request (rate limit or access) — try again in a few minutes');
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  return res.text();
}

// ------------------------------------------------------------------ update logic

async function resolveBranch(cfg) {
  if (cfg.branch) return cfg.branch;
  const info = JSON.parse(await fetchText(`https://api.github.com/repos/${cfg.repo}`, 'application/vnd.github+json'));
  if (!info.default_branch) throw new Error('Repository has no default branch');
  return info.default_branch;
}

async function latestCommit(cfg) {
  const branch = await resolveBranch(cfg);
  const sha = (
    await fetchText(`https://api.github.com/repos/${cfg.repo}/commits/${encodeURIComponent(branch)}`, 'application/vnd.github.sha')
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Unexpected commit id from GitHub: ${sha.slice(0, 60)}`);
  return { branch, sha };
}

async function download(cfg, sha, dest) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/tarball/${sha}`, {
    headers: githubHeaders('application/vnd.github+json'),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastReport = 0;
  const counter = new TransformStream({
    transform(chunk, ctl) {
      got += chunk.byteLength;
      const now = Date.now();
      if (now - lastReport > 150) {
        lastReport = now;
        const mb = (got / 1048576).toFixed(1);
        status('downloading', 'Downloading update', {
          detail: total ? `${mb} of ${(total / 1048576).toFixed(1)} MB` : `${mb} MB`,
          progress: total ? got / total : null,
        });
      }
      ctl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(dest));
}

async function extract(archive, dest) {
  await fsp.mkdir(dest, { recursive: true });
  // On Windows use the bundled bsdtar explicitly: Git's GNU tar misreads "C:\" paths.
  const tar = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const code = await run(tar, ['-xzf', archive, '-C', dest, '--strip-components=1'], ROOT);
  if (code !== 0) throw new Error('Could not unpack the update (tar failed)');
}

function fileHash(file) {
  try {
    const buf = fs.readFileSync(file);
    let h = 2166136261;
    for (const b of buf) h = Math.imul(h ^ b, 16777619) >>> 0;
    return `${buf.length}:${h.toString(16)}`;
  } catch {
    return null;
  }
}

async function npmInstall(dir) {
  status('installing', 'Installing components', { detail: 'npm ci (first run takes a minute)' });
  const npm = IS_WIN ? 'npm.cmd' : 'npm';
  const code = await run(npm, ['ci', '--no-audit', '--no-fund', '--loglevel=error'], dir, { shell: IS_WIN });
  if (code !== 0) throw new Error('npm ci failed — see logs/core.log');
}

async function build(dir, sha) {
  status('building', 'Building the game', { detail: 'Optimising graphics and audio code' });
  const vite = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
  const code = await run(process.execPath, [vite, 'build', '--logLevel', 'warn'], dir);
  if (code !== 0 || !fs.existsSync(path.join(dir, 'dist', 'index.html'))) throw new Error('Build failed — see logs/core.log');
  fs.writeFileSync(path.join(dir, 'dist', '.keystorm-build'), sha || 'local');
}

/** Copy updated launcher files from the new game version into <root>/launcher. */
function refreshLauncherFiles() {
  const src = path.join(GAME, 'launcher');
  const dst = path.join(ROOT, 'launcher');
  if (!fs.existsSync(src) || path.resolve(src) === path.resolve(dst)) return { changedSource: false };
  fs.mkdirSync(dst, { recursive: true });
  let changedSource = false;
  const copyTree = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(b, { recursive: true });
        copyTree(a, b);
      } else if (fileHash(a) !== fileHash(b)) {
        try {
          fs.copyFileSync(a, b);
          if (entry.name === 'KeystormLauncher.cs' || entry.name === 'keystorm.ico') changedSource = true;
          log('launcher file updated:', path.relative(ROOT, b));
        } catch (e) {
          log('could not update launcher file', b, e.message);
        }
      }
    }
  };
  copyTree(src, dst);
  return { changedSource };
}

/** Recompile KEYSTORM.exe after a launcher source change (Windows only, best effort). */
async function recompileLauncher() {
  if (!IS_WIN) return;
  const script = path.join(ROOT, 'launcher', 'Install-Keystorm.ps1');
  if (!fs.existsSync(script)) return;
  status('updating', 'Updating the launcher');
  const code = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-CompileOnly', '-InstallDir', ROOT], ROOT, {
    timeoutMs: 120_000,
  });
  log('launcher recompile exit code', code);
}

async function prepare(cfg) {
  const state = readJSON(STATE_FILE, {});
  const installed = fs.existsSync(path.join(GAME, 'package.json'));
  let latest = null;
  let offlineReason = '';

  if (cfg.checkForUpdates && !args['no-update']) {
    status('checking', 'Checking for updates', { detail: cfg.repo });
    try {
      latest = await latestCommit(cfg);
      log('latest', latest.branch, latest.sha, 'installed', state.sha ?? 'none');
    } catch (e) {
      offlineReason =
        e.name === 'TimeoutError' ? 'GitHub did not respond' : e.cause?.code === 'ENOTFOUND' || e.message === 'fetch failed' ? 'no internet connection' : e.message;
      log('update check failed:', e.message);
    }
  }

  const needsUpdate = latest && (latest.sha !== state.sha || !installed);
  if (!installed && !latest) {
    throw new Error(`Can't download KEYSTORM: ${offlineReason || 'update checks are disabled in launcher.config.json'}.`);
  }

  if (needsUpdate) {
    const short = latest.sha.slice(0, 7);
    status('downloading', installed ? 'Update found' : 'Downloading KEYSTORM', { detail: `${latest.branch} @ ${short}` });
    await rmrf(NEXT);
    const archive = path.join(ROOT, 'download.tar.gz');
    try {
      await download(cfg, latest.sha, archive);
      status('unpacking', 'Unpacking', { detail: short });
      await extract(archive, NEXT);
    } finally {
      await fsp.rm(archive, { force: true });
    }

    // Reuse installed packages when the lockfile hasn't changed (makes most updates take seconds).
    const sameLock = installed && fileHash(path.join(GAME, 'package-lock.json')) === fileHash(path.join(NEXT, 'package-lock.json'));
    if (sameLock && fs.existsSync(path.join(GAME, 'node_modules'))) {
      await renameRetry(path.join(GAME, 'node_modules'), path.join(NEXT, 'node_modules'));
    } else {
      await npmInstall(NEXT);
    }
    try {
      await build(NEXT, latest.sha);
    } catch (e) {
      // Give packages back to the installed copy so it keeps working.
      if (sameLock && fs.existsSync(path.join(NEXT, 'node_modules')) && !fs.existsSync(path.join(GAME, 'node_modules'))) {
        await renameRetry(path.join(NEXT, 'node_modules'), path.join(GAME, 'node_modules')).catch(() => {});
      }
      throw e;
    }

    status('installing', 'Installing update', { detail: short });
    await rmrf(OLD);
    if (fs.existsSync(GAME)) await renameRetry(GAME, OLD);
    await renameRetry(NEXT, GAME);
    rmrf(OLD).catch((e) => log('could not remove old version:', e.message));
    writeJSON(STATE_FILE, { sha: latest.sha, branch: latest.branch, repo: cfg.repo, updatedAt: new Date().toISOString() });

    const { changedSource } = refreshLauncherFiles();
    if (changedSource) await recompileLauncher();
    return { sha: latest.sha, updated: installed, offlineReason: '' };
  }

  // No update needed (or no network): make sure the installed copy is built.
  const sha = state.sha || 'local';
  const marker = path.join(GAME, 'dist', '.keystorm-build');
  const built = fs.existsSync(path.join(GAME, 'dist', 'index.html')) && readText(marker) === sha;
  if (!built) {
    if (!fs.existsSync(path.join(GAME, 'node_modules', 'vite'))) await npmInstall(GAME);
    await build(GAME, sha);
  }
  return { sha, updated: false, offlineReason };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ static server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__keystorm`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.app === 'keystorm' ? j : null;
  } catch {
    return null;
  }
}

function serve(port, sha) {
  const dist = path.join(GAME, 'dist');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__keystorm') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ app: 'keystorm', sha, pid: process.pid }));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dist, '.' + path.posix.normalize(rel));
    if (!file.startsWith(dist + path.sep) && file !== dist) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const hashed = rel.startsWith('/assets/');
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Exit when the launcher that started us goes away, so no server is left behind. */
function watchParent() {
  const ppid = Number(args['parent-pid']);
  if (!ppid) return;
  setInterval(() => {
    try {
      process.kill(ppid, 0);
    } catch {
      log('launcher exited; stopping server');
      process.exit(0);
    }
  }, 3000).unref();
}

// ------------------------------------------------------------------ main

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || major === 21 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
    throw new Error(`Node.js ${process.versions.node} is too old. Please install Node.js 22 LTS from nodejs.org.`);
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const cfg = { ...DEFAULT_CONFIG, ...readJSON(path.join(ROOT, 'launcher.config.json'), {}) };
  if (args.port) cfg.port = Number(args.port);
  log('---- start', `node ${process.versions.node}`, `root ${ROOT}`, `self ${SELF_DIR}`);
  watchParent();

  if (!args['install-only']) {
    // Already running (e.g. the game window is open)? Just hand back the URL.
    const existing = await probe(cfg.port);
    if (existing) {
      status('ready', 'KEYSTORM is already running', { url: `http://127.0.0.1:${cfg.port}/`, reused: true });
      return;
    }
  }

  const result = await prepare(cfg);
  const version = result.sha === 'local' ? 'local build' : result.sha.slice(0, 7);

  if (args['install-only']) {
    status('done', 'KEYSTORM is installed', { detail: version });
    return;
  }

  status('starting', 'Starting', { detail: version });
  let server;
  try {
    server = await serve(cfg.port, result.sha);
  } catch (e) {
    if (e.code === 'EADDRINUSE' && (await probe(cfg.port))) {
      status('ready', 'KEYSTORM is already running', { url: `http://127.0.0.1:${cfg.port}/`, reused: true });
      return;
    }
    throw new Error(e.code === 'EADDRINUSE' ? `Port ${cfg.port} is used by another program. Change "port" in launcher.config.json.` : e.message);
  }
  const url = `http://127.0.0.1:${cfg.port}/`;
  status('ready', result.updated ? 'Updated — launching' : 'Launching', {
    url,
    version,
    updated: result.updated,
    detail: result.offlineReason ? `Offline — playing installed version ${version}` : result.updated ? `Now on ${version}` : `Up to date · ${version}`,
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (e) => {
  log('ERROR', e.stack || e.message);
  await rmrf(NEXT).catch(() => {});
  status('error', 'Launch failed', { detail: e.message, error: e.message });
  process.exitCode = 1;
});
