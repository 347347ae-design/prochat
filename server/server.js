'use strict';

/*
 * ProChat 更新清单 + Bug 留言板后端
 * 无第三方依赖，Node 16+ 即可运行。
 * 生产环境由 nginx 反向代理到 127.0.0.1:8788，路径 /prochat/。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_PATH = path.join(DATA_DIR, 'feedback.json');
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 16 * 1024;
const MAX_ITEMS = 20000;
const PUBLIC_LIMIT = 50;
const REPORT_TTL = 60 * 60 * 1000;

let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  config = {};
}

const TOKEN = String(process.env.ADMIN_TOKEN || config.adminToken || '').trim();
if (TOKEN.length < 24) {
  console.error('缺少管理口令：请在 config.json 里设置 adminToken（至少 24 位），或设置 ADMIN_TOKEN 环境变量。');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Token',
  'Access-Control-Max-Age': '86400'
};

function baseHeaders(extra) {
  return Object.assign({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }, extra || {});
}

function sendBuffer(res, status, buf, type, extra) {
  const headers = baseHeaders(Object.assign({ 'Content-Type': type || 'application/octet-stream' }, extra || {}));
  if (!headers['Content-Length']) headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

function sendText(res, status, text, type, extra) {
  sendBuffer(res, status, Buffer.from(String(text), 'utf8'), type || 'text/plain; charset=utf-8', extra);
}

function sendJson(res, status, obj, extra) {
  sendText(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
}

function apiJson(res, status, obj) {
  sendJson(res, status, obj, CORS);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function loadDb() {
  const empty = { version: 1, nextId: 1, items: [] };
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    if (!raw.trim()) throw new Error('empty');
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.items)) throw new Error('bad data');
    o.version = 1;
    o.nextId = Math.max(1, Number(o.nextId) || 1);
    return o;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { fs.renameSync(DATA_PATH, DATA_PATH + '.corrupt-' + Date.now()); } catch (ignored) {}
    }
    return empty;
  }
}

let db = loadDb();

function saveDb() {
  if (db.items.length > MAX_ITEMS) db.items = db.items.slice(db.items.length - MAX_ITEMS);
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  try { fs.copyFileSync(DATA_PATH, DATA_PATH + '.bak'); } catch (ignored) {}
  fs.renameSync(tmp, DATA_PATH);
  try { fs.chmodSync(DATA_PATH, 0o600); } catch (ignored) {}
}

function clean(v, max, oneLine) {
  let s = String(v == null ? '' : v)
    .replace(/\u0000/g, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (oneLine) s = s.replace(/\s+/g, ' ');
  if (!oneLine) s = s.replace(/\n{3,}/g, '\n\n');
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

function publicItem(it) {
  return {
    id: it.id,
    name: it.name || '匿名用户',
    content: it.content,
    status: it.status === 'resolved' ? 'resolved' : 'open',
    reply: it.reply || '',
    createdAt: it.createdAt,
    updatedAt: it.updatedAt || it.createdAt
  };
}

function adminItem(it) {
  return {
    id: it.id,
    name: it.name || '匿名用户',
    content: it.content,
    status: it.status === 'hidden' ? 'hidden' : (it.status === 'resolved' ? 'resolved' : 'open'),
    reply: it.reply || '',
    contact: it.contact || '',
    app: it.app || {},
    ipHash: it.ipHash || '',
    createdAt: it.createdAt,
    updatedAt: it.updatedAt || it.createdAt
  };
}

function visible(it) {
  return it.status !== 'hidden';
}

function ipOf(req) {
  let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  ip = String(ip).split(',')[0].trim();
  return ip || 'unknown';
}

function ipHash(ip) {
  return crypto.createHash('sha256').update(ip + '|' + TOKEN).digest('hex').slice(0, 16);
}

// 简单的内存限流；进程重启后清空，足够应对留言板体量。
const rate = new Map();
const globalRate = [];

function allowRate(ip) {
  const now = Date.now();
  while (globalRate.length && now - globalRate[0] > REPORT_TTL) globalRate.shift();
  if (globalRate.length >= 120) return { ok: false, error: '留言板今天太忙了，请过一会儿再来' };

  let arr = rate.get(ip) || [];
  arr = arr.filter(t => now - t < REPORT_TTL);
  if (arr.length && now - arr[arr.length - 1] < 15000) {
    return { ok: false, error: '发得太快了，请等十几秒再试' };
  }
  if (arr.length >= 8) return { ok: false, error: '一小时内的留言有点多，请稍后再来' };

  arr.push(now);
  rate.set(ip, arr);
  globalRate.push(now);

  if (rate.size > 3000) {
    for (const [k, v] of rate) {
      if (!v.some(t => now - t < REPORT_TTL)) rate.delete(k);
    }
  }
  return { ok: true };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(httpError(413, '内容太长了'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', err => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function adminTokenOk(req, url) {
  const t = String(url.searchParams.get('token') || req.headers['x-admin-token'] || '').trim();
  if (!t || t.length !== TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN));
  } catch (e) {
    return false;
  }
}

function requireAdmin(req, url) {
  if (!adminTokenOk(req, url)) throw httpError(401, '管理口令不正确');
}

function readUpdateFile() {
  const file = path.join(PUBLIC_DIR, 'update.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeUpdateFile(obj) {
  const file = path.join(PUBLIC_DIR, 'update.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o644); } catch (ignored) {}
}

function serveFile(res, file, type, downloadName, headOnly) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: '文件不存在' }, CORS);
      return;
    }
    const extra = {};
    if (downloadName) extra['Content-Disposition'] = 'attachment; filename="' + downloadName + '"';
    if (headOnly) {
      res.writeHead(200, baseHeaders(Object.assign({
        'Content-Type': type || 'application/octet-stream',
        'Content-Length': buf.length
      }, extra)));
      res.end();
      return;
    }
    sendBuffer(res, 200, buf, type, extra);
  });
}

async function handleApi(req, res, url, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, baseHeaders(CORS));
    res.end();
    return true;
  }

  if (pathname === '/health' && req.method === 'GET') {
    apiJson(res, 200, {
      ok: true,
      service: 'prochat-feedback',
      time: Date.now(),
      visible: db.items.filter(visible).length,
      total: db.items.length
    });
    return true;
  }

  if (pathname === '/update.json' && req.method === 'GET') {
    const data = readUpdateFile();
    if (!data) {
      apiJson(res, 500, { ok: false, error: '更新清单还没配置' });
    } else {
      apiJson(res, 200, data);
    }
    return true;
  }

  if (pathname === '/api/feedback' && req.method === 'GET') {
    const limitParam = parseInt(url.searchParams.get('limit'), 10);
    const limit = Math.min(100, Math.max(1, limitParam || PUBLIC_LIMIT));
    const items = db.items
      .filter(visible)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(publicItem);
    apiJson(res, 200, { ok: true, items, total: db.items.filter(visible).length });
    return true;
  }

  if (pathname === '/api/feedback' && req.method === 'POST') {
    const raw = await readBody(req, MAX_BODY);
    let p;
    try {
      p = JSON.parse(raw || '{}');
    } catch (e) {
      throw httpError(400, '留言格式不正确');
    }
    if (!p || typeof p !== 'object') throw httpError(400, '留言格式不正确');

    // 机器人陷阱：正常用户看不到这个字段
    if (clean(p.website, 200, true)) {
      apiJson(res, 201, { ok: true, item: null });
      return true;
    }

    if (String(p.content == null ? '' : p.content).length > 2000) throw httpError(400, '留言最多 2000 字');
    if (String(p.contact == null ? '' : p.contact).length > 120) throw httpError(400, '联系方式太长了');
    if (String(p.name == null ? '' : p.name).length > 40) throw httpError(400, '昵称太长了');

    const content = clean(p.content, 2000, false);
    if (content.length < 2) throw httpError(400, '写点什么再提交吧');

    const name = clean(p.name, 20, true) || '匿名用户';
    const contact = clean(p.contact, 120, true);
    const appIn = (p.app && typeof p.app === 'object') ? p.app : {};
    const app = {
      version: clean(appIn.version, 40, true),
      versionCode: Math.max(0, parseInt(appIn.versionCode, 10) || 0),
      sdk: Math.max(0, parseInt(appIn.sdk, 10) || 0),
      model: clean(appIn.model, 80, true)
    };

    const ip = ipOf(req);
    const limited = allowRate(ip);
    if (!limited.ok) {
      apiJson(res, 429, { ok: false, error: limited.error });
      return true;
    }

    const hash = ipHash(ip);
    const now = Date.now();
    const duplicate = db.items.some(it =>
      it.ipHash === hash && it.content === content && now - it.createdAt < 10 * 60 * 1000);
    if (duplicate) {
      apiJson(res, 409, { ok: false, error: '这条留言刚刚已经提交过了' });
      return true;
    }

    const item = {
      id: crypto.randomBytes(4).toString('hex'),
      name,
      contact,
      content,
      status: 'open',
      reply: '',
      createdAt: now,
      updatedAt: now,
      app,
      ipHash: hash
    };
    db.items.push(item);
    saveDb();
    apiJson(res, 201, { ok: true, item: publicItem(item) });
    return true;
  }

  const publicOne = pathname.match(/^\/api\/feedback\/([a-f0-9]{6,16})$/);
  if (publicOne && req.method === 'GET') {
    const it = db.items.find(x => x.id === publicOne[1] && visible(x));
    if (!it) throw httpError(404, '留言不存在');
    apiJson(res, 200, { ok: true, item: publicItem(it) });
    return true;
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    serveFile(res, path.join(ROOT, 'admin.html'), 'text/html; charset=utf-8');
    return true;
  }

  if (pathname === '/admin/api/list' && req.method === 'GET') {
    requireAdmin(req, url);
    const filter = url.searchParams.get('status') || 'all';
    let items = db.items.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (filter !== 'all') items = items.filter(x => (x.status || 'open') === filter);
    apiJson(res, 200, {
      ok: true,
      items: items.map(adminItem),
      total: db.items.length,
      counts: {
        open: db.items.filter(x => (x.status || 'open') === 'open').length,
        resolved: db.items.filter(x => x.status === 'resolved').length,
        hidden: db.items.filter(x => x.status === 'hidden').length
      }
    });
    return true;
  }

  if (pathname === '/admin/api/update' && req.method === 'GET') {
    requireAdmin(req, url);
    const data = readUpdateFile();
    apiJson(res, 200, { ok: true, update: data });
    return true;
  }

  if (pathname === '/admin/api/update' && req.method === 'POST') {
    requireAdmin(req, url);
    const raw = await readBody(req, MAX_BODY);
    let p;
    try { p = JSON.parse(raw || '{}'); } catch (e) { throw httpError(400, '更新清单格式不正确'); }
    const versionCode = parseInt(p.versionCode, 10);
    const versionName = clean(p.versionName, 40, true);
    const notes = clean(p.notes, 4000, false);
    const downloadUrl = clean(p.url, 500, true);
    if (!versionCode || versionCode < 1 || versionCode > 999999999) throw httpError(400, 'versionCode 要是正整数');
    if (!versionName) throw httpError(400, '版本号不能为空');
    if (!/^https?:\/\//i.test(downloadUrl)) throw httpError(400, '下载地址要以 http:// 或 https:// 开头');
    const obj = {
      versionCode,
      versionName,
      notes,
      url: downloadUrl,
      force: !!p.force,
      publishedAt: new Date().toISOString()
    };
    writeUpdateFile(obj);
    apiJson(res, 200, { ok: true, update: obj });
    return true;
  }

  const adminOne = pathname.match(/^\/admin\/api\/feedback\/([a-f0-9]{6,16})$/);
  if (adminOne) {
    requireAdmin(req, url);
    const id = adminOne[1];
    const idx = db.items.findIndex(x => x.id === id);
    if (idx < 0) throw httpError(404, '留言不存在');

    if (req.method === 'POST') {
      const raw = await readBody(req, MAX_BODY);
      let p;
      try { p = JSON.parse(raw || '{}'); } catch (e) { throw httpError(400, '格式不正确'); }
      const it = db.items[idx];
      if (p.status != null) {
        if (!['open', 'resolved', 'hidden'].includes(p.status)) throw httpError(400, '状态不正确');
        it.status = p.status;
      }
      if (p.reply != null) it.reply = clean(p.reply, 2000, false);
      it.updatedAt = Date.now();
      saveDb();
      apiJson(res, 200, { ok: true, item: adminItem(it) });
      return true;
    }

    if (req.method === 'DELETE') {
      db.items.splice(idx, 1);
      saveDb();
      apiJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'bad request' }, CORS);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'bad path' }, CORS);
    return;
  }

  // 同时兼容 nginx 去掉 /prochat 前缀和直接访问
  if (pathname === '/prochat' || pathname.indexOf('/prochat/') === 0) {
    pathname = pathname.slice('/prochat'.length) || '/';
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, baseHeaders(CORS));
    res.end();
    return;
  }

  if (pathname === '/' || pathname === '/board' || pathname === '/board/') {
    serveFile(res, path.join(ROOT, 'board.html'), 'text/html; charset=utf-8');
    return;
  }

  const apk = pathname.match(/^\/(ProChat-[A-Za-z0-9._-]+\.apk)$/);
  if (apk && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = path.basename(apk[1]);
    serveFile(res, path.join(PUBLIC_DIR, name), 'application/vnd.android.package-archive', name, req.method === 'HEAD');
    return;
  }

  if (await handleApi(req, res, url, pathname)) return;

  sendJson(res, 404, { ok: false, error: 'not found' }, CORS);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) console.error(req.method, req.url, err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: status >= 500 ? '服务器开小差了' : err.message }, CORS);
    } else {
      try { res.end(); } catch (ignored) {}
    }
  });
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (ignored) {}
});

server.listen(PORT, HOST, () => {
  console.log('prochat-feedback listening on http://' + HOST + ':' + PORT);
  console.log('data:', DATA_PATH, 'items:', db.items.length);
});
