// Local HTTP server exposing UVC camera controls to a browser app.
// Designed to be reachable from both http://localhost:47808/ (when serving the
// page itself) and from a static GitHub-Pages-hosted page (CORS + Private
// Network Access).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UvcCamera, CONTROLS } from './uvc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 47808;
const WEB_ROOT = path.join(__dirname, 'web');

const cam = new UvcCamera();

// ── helpers ───────────────────────────────────────────────────────────────

function setCors(res) {
  // Permissive — the server only listens on localhost, so origin doesn't really
  // matter from a security standpoint for a personal tool. We need both regular
  // CORS and Private Network Access for HTTPS pages (GitHub Pages) to reach us.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function json(res, status, body) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

async function serveStatic(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  // Block traversal
  const filePath = path.normalize(path.join(WEB_ROOT, url));
  if (!filePath.startsWith(WEB_ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    setCors(res);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); res.end('Not Found'); }
    else { res.writeHead(500); res.end(String(e.message)); }
  }
}

// ── routes ────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
  // Health: lightweight ping, also reports whether camera is reachable.
  if (url === '/api/health' && req.method === 'GET') {
    let cameraOk = false, error = null;
    try {
      if (!cam.isOpen()) cam.open();
      // Touch one cheap control to confirm transport works.
      await cam.getValue('ae_mode');
      cameraOk = true;
    } catch (e) { error = e.message; }
    return json(res, 200, { ok: true, camera: cameraOk, error });
  }

  // List all controls with metadata.
  if (url === '/api/controls' && req.method === 'GET') {
    try {
      if (!cam.isOpen()) cam.open();
      const all = await cam.listAll();
      return json(res, 200, all);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // Set a control: POST /api/controls/<name>  body: { value }
  const setMatch = url.match(/^\/api\/controls\/([a-z_]+)$/);
  if (setMatch && req.method === 'POST') {
    const name = setMatch[1];
    if (!CONTROLS[name]) return json(res, 404, { error: `unknown control "${name}"` });
    try {
      const body = await readBody(req);
      if (typeof body.value !== 'number') return json(res, 400, { error: '"value" must be a number' });
      if (!cam.isOpen()) cam.open();
      const applied = await cam.setValue(name, body.value);
      return json(res, 200, { name, value: applied });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // Reset every control to its UVC-reported default (GET_DEF).
  // Order matters: unlock auto-controlled controls first so writes to their
  // dependents (exposure, wb_temp) actually take effect, then restore the
  // locks last.
  if (url === '/api/reset' && req.method === 'POST') {
    try {
      if (!cam.isOpen()) cam.open();
      const all = await cam.listAll();
      const LOCK_LAST = new Set(['ae_mode', 'wb_auto']);

      // Phase 1: unlock so dependent writes are accepted.
      try { await cam.setValue('ae_mode', 1); } catch {}
      try { await cam.setValue('wb_auto', 0); } catch {}

      // Phase 2: write defaults for every control that reports one.
      const skipped = [];
      for (const c of all) {
        if (LOCK_LAST.has(c.name)) continue;
        if (c.default == null) { skipped.push(c.name); continue; }
        try { await cam.setValue(c.name, c.default); }
        catch (e) { skipped.push(`${c.name} (${e.message})`); }
      }

      // Phase 3: restore the locks themselves to their defaults.
      for (const name of LOCK_LAST) {
        const c = all.find(x => x.name === name);
        if (c && c.default != null) {
          try { await cam.setValue(name, c.default); }
          catch (e) { skipped.push(`${name} (${e.message})`); }
        }
      }
      return json(res, 200, { reset: true, skipped });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // Convenience: switch AE mode in one call.
  if (url === '/api/mode' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (!cam.isOpen()) cam.open();
      if (body.mode === 'manual') {
        await cam.setValue('ae_mode', 1);
      } else if (body.mode === 'auto') {
        await cam.setValue('ae_mode', 8);
        await cam.setValue('wb_auto', 1);
      } else {
        return json(res, 400, { error: 'mode must be "manual" or "auto"' });
      }
      return json(res, 200, { mode: body.mode });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 404, { error: 'not found' });
}

// ── server ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Spectrometer server listening on http://localhost:${PORT}`);
  console.log(`  Web UI:        http://localhost:${PORT}/`);
  console.log(`  Health check:  http://localhost:${PORT}/api/health`);
  console.log(`  Controls API:  http://localhost:${PORT}/api/controls`);
});

// Clean shutdown so the camera handle is released.
function shutdown() {
  console.log('\nShutting down…');
  cam.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
