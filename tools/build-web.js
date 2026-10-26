// 把 assets/ 组装成可直接部署的网页版目录：server/public/app/
// 用法：node tools/build-web.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'assets');
const out = path.join(root, 'server', 'public', 'app');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

// tools/ 是开发辅助，不进产物
const SKIP = new Set([]);

rmrf(out);
fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  const a = path.join(src, entry.name);
  const b = path.join(out, entry.name);
  if (entry.isDirectory()) copyDir(a, b);
  else fs.copyFileSync(a, b);
}

let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
})(out);

const version = (fs.readFileSync(path.join(src, 'app.js'), 'utf8')
  .match(/RELEASE_NOTICES\s*=\s*\{\s*'([\d.]+)'/) || [])[1] || '?';

console.log('网页版已生成：' + out);
console.log('文件 ' + files + ' 个，共 ' + (bytes / 1024).toFixed(0) + ' KB，版本 ' + version);
