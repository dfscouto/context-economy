#!/usr/bin/env node
/*
 * Local server for the dashboard — serves static files + skill toggle API.
 *   node scripts/dashboard-serve.cjs
 * Opens: http://127.0.0.1:3847/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { skillDir } = require('./lib/paths.cjs');
const { toggleSkill, canToggleSkill } = require('./lib/skill-toggle.cjs');
const { translateText } = require('./lib/translate.cjs');
const { listProjectOptions } = require('./lib/skill-project.cjs');

const PORT = Number(process.env.CONTEXT_ECONOMY_PORT || 3847);
const ROOT = path.join(skillDir(), 'dashboard');
const SCRIPTS = path.join(skillDir(), 'scripts');
const PKG = require(path.join(skillDir(), 'package.json'));
const API_FEATURES = ['toggle', 'project', 'refresh', 'translate', 'data'];

const ALL_PROJECTS = '__all__';

let projectDir = process.env.CONTEXT_ECONOMY_PROJECT || ALL_PROJECTS;

function isAllProjects(dir) {
  return !dir || dir === ALL_PROJECTS;
}

function resolveProjectDir() {
  if (isAllProjects(projectDir)) return null;
  if (projectDir && fs.existsSync(projectDir)) return projectDir;
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function refreshData(opts) {
  const env = { ...process.env };
  const dir = resolveProjectDir();
  env.CONTEXT_ECONOMY_PROJECT = dir || ALL_PROJECTS;
  const args = [path.join(SCRIPTS, 'dashboard.cjs')];
  if (opts && opts.bloatOnly) args.push('--bloat-only'); // skill toggle: skip the ~30s aggregate, regen only bloat
  execFileSync(process.execPath, args, {
    cwd: SCRIPTS,
    stdio: 'pipe',
    env,
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) reject(new Error('body too large')); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html' || ext === '.js') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers.Pragma = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    sendJson(res, 200, { ok: true, api: true, version: PKG.version, features: API_FEATURES });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/data') {
    try {
      const raw = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
      const m = raw.match(/window\.USAGE_DATA\s*=\s*(\{[\s\S]*\})\s*;/);
      if (!m) throw new Error('data.js malformed');
      sendJson(res, 200, { ok: true, data: JSON.parse(m[1]) });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/translate') {
    try {
      const q = url.searchParams.get('q') || '';
      const to = url.searchParams.get('to') || '';
      if (!q) throw new Error('q required');
      const result = await translateText(q, to);
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    sendJson(res, 200, { ok: true, current: resolveProjectDir(), options: listProjectOptions(12) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/project') {
    try {
      const raw = await readBody(req);
      const { dir } = JSON.parse(raw || '{}');
      if (dir == null || dir === '') throw new Error('select All or a project');
      if (isAllProjects(dir)) {
        projectDir = ALL_PROJECTS;
      } else {
        projectDir = path.resolve(String(dir).replace(/\//g, path.sep));
        if (!fs.existsSync(projectDir)) throw new Error('invalid project folder: ' + dir);
      }
      refreshData();
      sendJson(res, 200, { ok: true, dir: isAllProjects(projectDir) ? ALL_PROJECTS : projectDir, mode: isAllProjects(projectDir) ? 'all' : 'project' });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/refresh') {
    try {
      refreshData();
      let generatedAt = null;
      try {
        const raw = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
        const m = raw.match(/"generatedAt"\s*:\s*"([^"]+)"/);
        if (m) generatedAt = m[1];
      } catch { /* */ }
      sendJson(res, 200, { ok: true, generatedAt });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/toggle') {
    try {
      const raw = await readBody(req);
      const { folder, enable } = JSON.parse(raw || '{}');
      if (!folder) throw new Error('folder required');
      if (!canToggleSkill(folder)) throw new Error('skill not found');
      const result = toggleSkill(folder, !!enable);
      refreshData({ bloatOnly: true });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('context-economy dashboard v' + PKG.version + ' → http://127.0.0.1:' + PORT + '/');
  console.log('PID ' + process.pid + ' · APIs: ' + API_FEATURES.join(', '));
  const pd = resolveProjectDir();
  console.log('Ctrl+C to stop. If the port is taken by an old version, kill the old PID first.');
  if (pd) console.log('Project analyzed: ' + pd);
  try { refreshData(); } catch { /* data.js optional at boot */ }
});