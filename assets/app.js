/* ProChat - 本地直连版
 * 界面全部在 WebView 里，网络请求走原生层（无 CORS、可中断、可自定义请求头）
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------ native 兜底 */
  const HAS_NATIVE = typeof window.Native === 'object' && window.Native !== null;

  if (!HAS_NATIVE) {
    // 桌面浏览器预览用的假桥
    let mockTimer = null;
    const MOCK_UPDATE = /[?&]mockUpdate=1/.test(location.search);
    const mockBoard = [
      {
        id: 'demo2', name: 'ProChat 团队',
        content: '留言板已上线。遇到 bug 可以在这里留言；写清楚复现步骤、机型和 App 版本会更容易定位。不要发 API Key 或聊天隐私。',
        status: 'resolved', reply: '欢迎反馈，我们会尽量回复。',
        createdAt: Date.now() - 2 * 3600e3, updatedAt: Date.now() - 3600e3
      },
      {
        id: 'demo1', name: '小林',
        content: '深色模式下代码块很舒服。希望能加一个「检查更新」按钮。',
        status: 'open', reply: '',
        createdAt: Date.now() - 18 * 60e3, updatedAt: Date.now() - 18 * 60e3
      }
    ];
    const mem = {
      get: (k) => localStorage.getItem('pc:' + k) || '',
      set: (k, v) => localStorage.setItem('pc:' + k, v),
      del: (k) => localStorage.removeItem('pc:' + k)
    };
    window.Native = {
      platform: () => 'browser',
      appInfo: () => JSON.stringify({
        version: MOCK_UPDATE ? '1.1.1' : '1.2.2-preview',
        versionCode: MOCK_UPDATE ? 3 : 9999,
        sdk: 0, model: 'desktop', speech: false
      }),
      getStore: mem.get,
      setStore: mem.set,
      removeStore: mem.del,
      clearStore: () => Object.keys(localStorage).filter(k => k.startsWith('pc:')).forEach(k => localStorage.removeItem(k)),
      getSecret: (k) => mem.get('sec:' + k),
      setSecret: (k, v) => mem.set('sec:' + k, v),
      removeSecret: (k) => mem.del('sec:' + k),
      clearSecrets: () => Object.keys(localStorage).filter(k => k.indexOf('pc:sec:') === 0).forEach(k => localStorage.removeItem(k)),
      httpGet: (id, url) => {
        setTimeout(() => {
          try {
            const u = String(url || '');
            if (u.indexOf('/update.json') >= 0) {
              const data = MOCK_UPDATE
                ? { versionCode: 5, versionName: '1.2.1', notes: '新增：检查更新。\n新增：Bug 反馈 / 留言板。\n优化：网络请求和错误提示。', url: 'https://example.com/ProChat-1.2.1.apk' }
                : { versionCode: 9999, versionName: '1.2.2-preview', notes: '', url: '' };
              window.ProChatNative.onHttp(id, 200, JSON.stringify(data));
            } else if (u.indexOf('/api/feedback') >= 0) {
              window.ProChatNative.onHttp(id, 200, JSON.stringify({ ok: true, items: mockBoard.slice(), total: mockBoard.length }));
            } else {
              window.ProChatNative.onHttpError(id, '预览模式没有这个接口');
            }
          } catch (e) {
            window.ProChatNative.onHttpError(id, e.message);
          }
        }, 350);
      },
      httpPost: (id, url, body) => {
        setTimeout(() => {
          try {
            if (String(url || '').indexOf('/api/feedback') < 0) {
              window.ProChatNative.onHttpError(id, '预览模式没有这个接口');
              return;
            }
            const p = JSON.parse(body || '{}');
            if (p.website) {
              window.ProChatNative.onHttp(id, 201, JSON.stringify({ ok: true, item: null }));
              return;
            }
            const item = {
              id: 'p' + Date.now().toString(36),
              name: p.name || '匿名用户',
              content: p.content || '',
              status: 'open', reply: '',
              createdAt: Date.now(), updatedAt: Date.now()
            };
            mockBoard.unshift(item);
            window.ProChatNative.onHttp(id, 201, JSON.stringify({ ok: true, item }));
          } catch (e) {
            window.ProChatNative.onHttpError(id, e.message);
          }
        }, 450);
      },
      ask: (id, payload) => {
        try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
        const text = [
          '这是**预览模式**的假回复，用来检查界面效果。真机上会流式显示你自己模型返回的内容。',
          '',
          '### 支持的东西',
          '- Markdown、`行内代码`、列表',
          '- 代码块高亮框 + 一键复制',
          '',
          '```python',
          'def hi(name):',
          '    return f"你好，{name}！"',
          '```',
          '',
          '> 你问的是：' + (payload.messages && payload.messages.length ? String(payload.messages[payload.messages.length - 1].content).slice(0, 60) : '（空）'),
          '',
          '表格也能凑合看：',
          '',
          '| 项目 | 状态 |',
          '| --- | --- |',
          '| 流式输出 | ✅ |',
          '| 图片上传 | ✅ |',
          '| 语音输入 | ✅ |'
        ].join('\n');
        const reasoning = '先理解一下问题，然后组织答案……（这是 deepseek-reasoner 这类模型返回的思考过程）';
        let i = 0, j = 0, sent = 0, sentR = 0;
        const tick = () => {
          if (j < reasoning.length) {
            j += 4;
            window.ProChatNative.onReasoning(id, reasoning.slice(sentR, j));
            sentR = j;
          }
          i += 3;
          window.ProChatNative.onDelta(id, text.slice(sent, i));
          sent = i;
          if (i < text.length) {
            mockTimer = setTimeout(tick, 18);
          } else {
            window.ProChatNative.onDone(id, JSON.stringify({ prompt_tokens: 12, completion_tokens: 210 }));
          }
        };
        tick();
      },
      stop: () => { clearTimeout(mockTimer); },
      listModels: (id) => {
        setTimeout(() => window.ProChatNative.onModels(id,
          JSON.stringify(['deepseek-flash', 'deepseek-v4-pro', 'gpt-6.1-sol', 'qwen3.8-max'])), 500);
      },
      toast: (m) => toast(m),
      log: (m) => console.log('[js]', m),
      copy: (t) => { if (navigator.clipboard) navigator.clipboard.writeText(t); toast('已复制'); },
      share: () => toast('预览模式不能分享'),
      openUrl: (u) => window.open(u, '_blank'),
      setBackIntercept: () => {},
      setSystemBars: () => {},
      keepAwake: () => {},
      pickImage: () => toast('预览模式不能选图，真机可以'),
      saveAssetImage: () => toast('预览模式不能保存到相册，请截图；真机可以'),
      startVoice: () => toast('预览模式不能语音，真机可以'),
      stopVoice: () => {}
    };
  }

  /* ------------------------------------------------------------ 小工具 */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 2600);
  }
  window.onerror = function (msg, url, line) {
    try { Native.log('ERROR ' + msg + ' @' + line); } catch (e) {}
  };

  /* ------------------------------------------------------------ 存档 */
  const DB = {
    read(key, def) {
      try {
        const raw = Native.getStore(key);
        if (!raw) return def;
        const v = JSON.parse(raw);
        return v == null ? def : v;
      } catch (e) { return def; }
    },
    write(key, val) {
      try { Native.setStore(key, JSON.stringify(val)); } catch (e) {}
    }
  };

  const DEFAULT_SETTINGS = {
    theme: 'auto',
    systemPrompt: '',
    contextLimit: 20,
    temperature: 0.7,
    maxTokens: 0,
    voiceLang: 'zh-CN',
    voiceMode: 'api',
    voiceModel: '',
    voiceBase: '',
    activeId: '',
    autoUpdate: true,
    lastUpdateCheck: 0,
    skippedUpdate: 0,
    noticeVersion: '',
    apiBase: '',
    fbName: '',
    fbContact: ''
  };

  const S = {
    settings: Object.assign({}, DEFAULT_SETTINGS, DB.read('settings', {})),
    configs: DB.read('configs', []),
    convs: DB.read('convs', []),
    convId: DB.read('state', {}).convId || ''
  };

  function saveSettings() { DB.write('settings', S.settings); }
  function saveConfigs() { DB.write('configs', S.configs); }

  /* ------------------------------------------------------------ 后端地址 / HTTP */
  const DEFAULT_API_BASE = 'https://ai.h80b5c8fe.nyat.app:21398/prochat';
  const LEGACY_API_BASES = ['https://media-server.tail3fe30b.ts.net:10000/prochat'];

  // 旧版本默认地址迁移到固定的 SakuraFrp 地址；用户手动填写的地址保持不变。
  if (LEGACY_API_BASES.indexOf(String(S.settings.apiBase || '').trim()) >= 0) {
    S.settings.apiBase = '';
    saveSettings();
  }

  function apiBase() {
    const v = String(S.settings.apiBase || '').trim().replace(/\/+$/, '');
    return v || DEFAULT_API_BASE;
  }

  const httpWaiters = new Map();
  let httpSeq = 0;

  function nativeHttp(method, url, body) {
    return new Promise((resolve, reject) => {
      if (!Native || typeof Native.httpGet !== 'function') {
        reject(new Error('当前版本不支持网络请求'));
        return;
      }
      const id = 'h' + (++httpSeq).toString(36) + Date.now().toString(36);
      const timer = setTimeout(() => {
        if (!httpWaiters.has(id)) return;
        httpWaiters.delete(id);
        reject(new Error('请求超时，请检查网络或服务器地址'));
      }, 22000);
      httpWaiters.set(id, { resolve, reject, timer });
      try {
        if (method === 'POST') Native.httpPost(id, url, body || '');
        else Native.httpGet(id, url);
      } catch (e) {
        clearTimeout(timer);
        httpWaiters.delete(id);
        reject(e);
      }
    });
  }

  function settleHttp(id, status, body) {
    const w = httpWaiters.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    httpWaiters.delete(id);
    w.resolve({ status: Number(status) || 0, body: String(body == null ? '' : body) });
  }

  function failHttp(id, msg) {
    const w = httpWaiters.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    httpWaiters.delete(id);
    w.reject(new Error(msg || '网络请求失败'));
  }

  function nativeApi(url, opts) {
    opts = opts || {};
    return nativeHttp(opts.method || 'GET', url, opts.body).then((r) => {
      let data = null;
      try { data = JSON.parse(r.body || ''); } catch (e) { data = null; }
      if (r.status < 200 || r.status >= 300) {
        throw new Error((data && data.error) || ('服务器返回 HTTP ' + r.status));
      }
      if (!data) throw new Error('服务器返回格式不正确');
      return data;
    });
  }
  let saveConvTimer = null;
  function saveConvs() {
    clearTimeout(saveConvTimer);
    saveConvTimer = setTimeout(() => {
      DB.write('convs', S.convs);
      DB.write('state', { convId: S.convId });
    }, 250);
  }

  const cfgById = (id) => S.configs.filter(c => c.id === id)[0] || null;
  const activeConfig = () => cfgById(S.settings.activeId) || S.configs[0] || null;
  const currentConv = () => S.convs.filter(c => c.id === S.convId)[0] || null;

  /* ------------------------------------------------------------ 主题 */
  function applyTheme() {
    const pref = S.settings.theme || 'auto';
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = pref === 'dark' || (pref === 'auto' && sysDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '').trim()
      || (dark ? '#0B0E14' : '#F5F7FB');
    try { Native.setSystemBars(dark, bg); } catch (e) {}
    $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === pref));
  }

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => { if (S.settings.theme === 'auto') applyTheme(); });
  }

  /* ------------------------------------------------------------ 数学公式 */
  // KaTeX 打包在 assets/katex 里，完全离线；公式在 Markdown 之前先抽出来，
  // 避免 $...$ 里的 * _ \ 被当成 Markdown 语法。
  const mathCache = new Map();

  function looksLikeInlineMath(tex) {
    if (!tex || tex.length > 300) return false;
    if (/[\r\n]/.test(tex)) return false;
    if (/^\s|\s$/.test(tex)) return false;
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/.test(tex);
    if (cjk && !/\\[a-zA-Z]+/.test(tex)) return false;
    if (/^[\d\s.,%+\-*/=<>()]+$/.test(tex)) return false;
    if (/\s/.test(tex) && !/[\\^_{}=<>+\-*/]/.test(tex)) return false;
    return true;
  }

  function katexHtml(tex, display, raw) {
    const key = (display ? 'D' : 'I') + '\u0001' + tex;
    const hit = mathCache.get(key);
    if (hit) return hit;
    let html;
    try {
      if (!window.katex) throw new Error('katex missing');
      html = '<span class="' + (display ? 'math-display' : 'math-inline') + '">'
        + window.katex.renderToString(tex, {
            displayMode: display,
            throwOnError: true,
            strict: 'ignore',
            trust: false,
            output: 'htmlAndMathml'
          })
        + '</span>';
    } catch (e) {
      html = esc(raw);
    }
    if (mathCache.size > 400) mathCache.clear();
    mathCache.set(key, html);
    return html;
  }

  function protectMath(src) {
    const s = String(src == null ? '' : src);
    const items = [];
    let out = '';
    let i = 0;

    const push = (tex, display, raw) => {
      items.push({ html: katexHtml(tex, display, raw) });
      out += '\u0000M' + (items.length - 1) + '\u0000';
    };
    const escaped = (pos) => {
      let n = 0;
      for (let j = pos - 1; j >= 0 && s[j] === '\\'; j--) n++;
      return n % 2 === 1;
    };
    const findClose = (delim, from, allowNewline) => {
      for (let j = from; j < s.length; j++) {
        if (!allowNewline && (s[j] === '\n' || s[j] === '\r')) return -1;
        if (s.startsWith(delim, j) && !escaped(j)) return j;
      }
      return -1;
    };
    const lineStart = (pos) => {
      let j = pos - 1;
      while (j >= 0 && (s[j] === ' ' || s[j] === '\t')) j--;
      return j < 0 || s[j] === '\n';
    };

    while (i < s.length) {
      const ch = s[i];

      // 围栏代码块整段跳过
      if (s.startsWith('```', i) && lineStart(i)) {
        const end = s.indexOf('```', i + 3);
        const stop = end < 0 ? s.length : end + 3;
        out += s.slice(i, stop);
        i = stop;
        continue;
      }

      // 行内代码跳过
      if (ch === '`') {
        const end = s.indexOf('`', i + 1);
        if (end > i) {
          out += s.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }

      // 转义的美元符号按字面显示
      if (ch === '\\' && s[i + 1] === '$') {
        out += '$';
        i += 2;
        continue;
      }

      if (ch === '$') {
        if (s[i + 1] === '$') {
          const close = findClose('$$', i + 2, true);
          if (close > i + 2) {
            const tex = s.slice(i + 2, close).trim();
            if (tex && tex.length <= 5000) {
              push(tex, true, s.slice(i, close + 2));
              i = close + 2;
              continue;
            }
          }
        } else {
          const close = findClose('$', i + 1, false);
          if (close > i + 1) {
            const tex = s.slice(i + 1, close);
            const before = i > 0 ? s[i - 1] : '';
            const after = close + 1 < s.length ? s[close + 1] : '';
            if (looksLikeInlineMath(tex) && !/[A-Za-z0-9]/.test(before) && !/[0-9]/.test(after)) {
              push(tex, false, s.slice(i, close + 1));
              i = close + 1;
              continue;
            }
          }
        }
        out += ch;
        i++;
        continue;
      }

      if (ch === '\\' && s[i + 1] === '[') {
        const close = findClose('\\]', i + 2, true);
        if (close > i + 2) {
          const tex = s.slice(i + 2, close).trim();
          if (tex) {
            push(tex, true, s.slice(i, close + 2));
            i = close + 2;
            continue;
          }
        }
      }

      if (ch === '\\' && s[i + 1] === '(') {
        const close = findClose('\\)', i + 2, false);
        if (close > i + 2) {
          const tex = s.slice(i + 2, close);
          if (tex.trim()) {
            push(tex, false, s.slice(i, close + 2));
            i = close + 2;
            continue;
          }
        }
      }

      // 有些模型会直接输出 \begin{align}...\end{align}，不带 $ / \[ 包裹
      if (ch === '\\' && s.startsWith('\\begin{', i)) {
        const m = /^\\begin\{([A-Za-z*]+)\}/.exec(s.slice(i));
        if (m && /^(equation|align|aligned|gather|gathered|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array|split|multline)\*?$/.test(m[1])) {
          const endTag = '\\end{' + m[1] + '}';
          const close = s.indexOf(endTag, i + m[0].length);
          if (close > i) {
            const raw = s.slice(i, close + endTag.length);
            if (raw.length <= 5000) {
              push(raw, true, raw);
              i = close + endTag.length;
              continue;
            }
          }
        }
      }

      out += ch;
      i++;
    }

    return { text: out, items };
  }

  /* ------------------------------------------------------------ Markdown */
  function inlineMd(t) {
    const stash = [];
    let s = esc(t);
    s = s.replace(/`([^`\n]+)`/g, (m, c) => {
      stash.push(c);
      return '\u0000I' + (stash.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2">$2</a>');
    s = s.replace(/\u0000I(\d+)\u0000/g, (m, n) => '<code>' + stash[+n] + '</code>');
    return s;
  }

  function codeBlock(c) {
    const lang = (c.lang || '').replace(/[^\w+#.-]/g, '');
    return '<div class="codeblock"><div class="codehead"><span>' + (lang || 'code') + '</span>'
      + '<button class="cpy" data-code="' + encodeURIComponent(c.code) + '">复制</button></div>'
      + '<pre><code>' + esc(c.code) + '</code></pre></div>';
  }

  const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|\u0000C\d+\u0000|\|)/;

  function renderMarkdown(src) {
    if (!src) return '';
    const codes = [];
    const math = protectMath(String(src).replace(/\r\n?/g, '\n'));
    let s = math.text;

    s = s.replace(/^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (m, info, body) => {
      codes.push({ lang: (info || '').trim().split(/\s+/)[0], code: body.replace(/\n$/, '') });
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/^[ \t]*```([^\n`]*)\n([\s\S]*)$/m, (m, info, body) => {
      codes.push({ lang: (info || '').trim().split(/\s+/)[0], code: body.replace(/\n$/, '') });
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    const lines = s.split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }

      let m = line.match(/^\u0000C(\d+)\u0000\s*$/);
      if (m) { html += codeBlock(codes[+m[1]]); i++; continue; }

      m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        const lv = Math.min(6, m[1].length);
        html += '<h' + lv + '>' + inlineMd(m[2].trim()) + '</h' + lv + '>';
        i++; continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) { html += '<hr>'; i++; continue; }

      if (/^\s*&gt;\s?/.test(line) || /^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + inlineMd(buf.join('<br>')) + '</blockquote>';
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        html += '<ul>' + items.map(t => '<li>' + inlineMd(t) + '</li>').join('') + '</ul>';
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        }
        html += '<ol>' + items.map(t => '<li>' + inlineMd(t) + '</li>').join('') + '</ol>';
        continue;
      }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const head = line.split('|').map(x => x.trim()).filter((x, idx, arr) => !(idx === 0 && x === '') && !(idx === arr.length - 1 && x === ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) {
          rows.push(lines[i].split('|').map(x => x.trim()).filter((x, idx, arr) => !(idx === 0 && x === '') && !(idx === arr.length - 1 && x === '')));
          i++;
        }
        html += '<div class="tablewrap"><table><thead><tr>' + head.map(h => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>'
          + rows.map(r => '<tr>' + r.map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>').join('')
          + '</tbody></table></div>';
        continue;
      }

      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      html += '<p>' + buf.map(inlineMd).join('<br>') + '</p>';
    }
    return html.replace(/\u0000M(\d+)\u0000/g, (m, n) => math.items[+n].html);
  }

  function renderPlainMath(src) {
    if (!src) return '';
    const m = protectMath(src);
    return esc(m.text).replace(/\u0000M(\d+)\u0000/g, (x, n) => m.items[+n].html);
  }

  /* ------------------------------------------------------------ 渲染 */
  const messagesEl = $('#messages');
  const scrollEl = $('#scroll');

  function assistantInner(msg, streaming) {
    let h = '';
    if (msg.reasoning) {
      h += '<details class="reason"' + (streaming ? ' open' : '') + '><summary>思考过程</summary>'
        + '<div class="rmd">' + renderPlainMath(msg.reasoning) + '</div></details>';
    }
    if (msg.content) {
      h += '<div class="md">' + renderMarkdown(msg.content) + '</div>';
    } else if (streaming) {
      h += '<div class="thinking"><i></i><i></i><i></i></div>';
    }
    if (msg.err) {
      h += '<div class="errbox">' + esc(msg.err) + '</div>';
    }
    return h;
  }

  function metaHtml(msg, streaming) {
    const parts = [];
    if (msg.model) parts.push(msg.model);
    if (msg.ms) parts.push((msg.ms / 1000).toFixed(1) + 's');
    if (msg.tokens) parts.push(msg.tokens + ' tokens');
    if (msg.content) parts.push(msg.content.length + ' 字');
    let h = '<span>' + esc(parts.join(' · ')) + '</span>';
    if (!streaming) {
      h += '<span style="flex:1"></span>'
        + '<button class="mbtn" data-act="copy">复制</button>'
        + '<button class="mbtn" data-act="regen">重新生成</button>';
    }
    return h;
  }

  function messageHtml(msg, idx, streaming) {
    if (msg.role === 'user') {
      const imgs = (msg.images || []).map(u => '<img src="' + u + '" alt="">').join('');
      return '<div class="msg user" data-i="' + idx + '"><div class="bubble">'
        + (imgs ? '<div class="images">' + imgs + '</div>' : '')
        + (msg.content ? '<div class="md">' + renderMarkdown(msg.content) + '</div>' : '')
        + '</div></div>';
    }
    return '<div class="msg assistant" data-i="' + idx + '"><div class="wrap">'
      + '<div class="bubble">' + assistantInner(msg, streaming) + '</div>'
      + '<div class="meta">' + metaHtml(msg, streaming) + '</div>'
      + '</div></div>';
  }

  function renderConv(keepScroll) {
    const conv = currentConv();
    const atBottom = nearBottom();
    if (!conv || !conv.messages.length) {
      messagesEl.innerHTML = '';
      updateEmpty();
      return;
    }
    let html = '';
    conv.messages.forEach((m, i) => { html += messageHtml(m, i, false); });
    messagesEl.innerHTML = html;
    updateEmpty();
    if (!keepScroll && atBottom) scrollBottom(false);
  }

  function nearBottom() {
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140;
  }

  function scrollBottom(smooth) {
    scrollEl.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function updateEmpty() {
    const conv = currentConv();
    const has = conv && conv.messages.length;
    $('#empty').classList.toggle('hidden', !!has);
    $('#btnSetup').classList.toggle('hidden', S.configs.length > 0);
  }

  function updateHeader() {
    const conv = currentConv();
    const cfg = activeConfig();
    $('#convTitle').textContent = (conv && conv.title) || '新对话';
    $('#convModel').textContent = cfg
      ? (cfg.name || '未命名') + ' · ' + (cfg.model || '未选模型')
      : '未配置模型，点左下角设置';
    $('#cfgSummary').textContent = cfg ? (cfg.name + ' · ' + cfg.model) : '未配置模型';
    $('#hint').textContent = cfg
      ? ('温度 ' + S.settings.temperature + ' · 上下文 ' + S.settings.contextLimit + ' 条 · ' + cfg.model)
      : '还没有模型服务，去设置里加一个';
  }

  /* ------------------------------------------------------------ 发送 */
  let attachments = [];
  let streamingId = null;
  const live = {};

  function updateAttach() {
    const box = $('#attachBox');
    box.innerHTML = attachments.map((u, i) =>
      '<div class="att"><img src="' + u + '" alt=""><button data-rm="' + i + '">✕</button></div>'
    ).join('');
  }

  function updateSendState() {
    const busy = !!streamingId;
    $('#btnSend').classList.toggle('hidden', busy);
    $('#btnStop').classList.toggle('hidden', !busy);
    $('#btnSend').disabled = busy;
  }

  function buildPayload(cfg, conv) {
    const msgs = [];
    const sys = (S.settings.systemPrompt || '').trim();
    if (sys) msgs.push({ role: 'system', content: sys });
    const list = conv.messages.slice();
    if (list.length && list[list.length - 1].role === 'assistant' && !list[list.length - 1].content) list.pop();
    const limit = Math.max(2, Number(S.settings.contextLimit) || 20);
    let use = list.slice(-limit);
    while (use.length && use[0].role === 'assistant') use.shift();
    use.forEach(m => {
      if (m.role === 'user') {
        if (m.images && m.images.length) {
          const parts = [{ type: 'text', text: m.content || '看看这张图' }];
          m.images.forEach(u => parts.push({ type: 'image_url', image_url: { url: u } }));
          msgs.push({ role: 'user', content: parts });
        } else if (m.content) {
          msgs.push({ role: 'user', content: m.content });
        }
      } else if (m.role === 'assistant' && m.content) {
        msgs.push({ role: 'assistant', content: m.content });
      }
    });
    const payload = {
      baseUrl: cfg.baseUrl,
      apiKey: secretOf(cfg.id),
      model: cfg.model,
      stream: true,
      temperature: Number(S.settings.temperature),
      maxTokens: Number(S.settings.maxTokens) || 0,
      messages: msgs
    };
    if (cfg.headers && typeof cfg.headers === 'object') payload.headers = cfg.headers;
    return payload;
  }

  function secretOf(id) {
    try { return Native.getSecret('key:' + id) || ''; } catch (e) { return ''; }
  }

  function isLocalUrl(u) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u || '');
  }

  function startRequest(conv, cfg) {
    conv.messages.push({ role: 'assistant', content: '', reasoning: '', ts: Date.now(), model: cfg.model });
    const msg = conv.messages[conv.messages.length - 1];
    renderConv();
    scrollBottom(false);

    const rid = 'r' + uid();
    streamingId = rid;
    live[rid] = { conv: conv, msg: msg, el: messagesEl.lastElementChild, started: Date.now(), firstAt: 0, lastPaint: 0, timer: 0 };
    updateSendState();
    try { Native.keepAwake(true); } catch (e) {}
    try {
      Native.ask(rid, JSON.stringify(buildPayload(cfg, conv)));
    } catch (e) {
      window.ProChatNative.onError(rid, '调用失败：' + e.message);
    }
  }

  function send() {
    if (streamingId) return;
    const text = $('#ta').value.trim();
    if (!text && !attachments.length) return;
    const cfg = activeConfig();
    if (!cfg) { toast('先添加一个模型服务'); openSettings(); return; }
    if (!cfg.model) { toast('还没填模型名'); openSettings(); return; }
    if (!cfg.baseUrl) { toast('还没填接口地址'); openSettings(); return; }
    if (!secretOf(cfg.id) && !isLocalUrl(cfg.baseUrl)) {
      toast('这个服务还没填 API Key');
      openSettings();
      return;
    }

    const conv = ensureConv();
    conv.messages.push({
      role: 'user',
      content: text,
      images: attachments.length ? attachments.slice() : undefined,
      ts: Date.now()
    });
    if (!conv.title || conv.title === '新对话') {
      conv.title = (text || '图片对话').slice(0, 22).replace(/\s+/g, ' ');
    }
    conv.updatedAt = Date.now();
    attachments = [];
    updateAttach();
    $('#ta').value = '';
    autoGrow();
    updateHeader();
    saveConvs();
    startRequest(conv, cfg);
  }

  function regenerate() {
    if (streamingId) return;
    const conv = currentConv();
    const cfg = activeConfig();
    if (!conv || !cfg) return;
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') {
      conv.messages.pop();
    }
    if (!conv.messages.length) return;
    saveConvs();
    startRequest(conv, cfg);
  }

  function ensureConv() {
    let conv = currentConv();
    if (!conv) {
      conv = { id: uid(), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      S.convs.unshift(conv);
      S.convId = conv.id;
      saveConvs();
      renderDrawer();
    }
    return conv;
  }

  /* ------------------------------------------------------------ 原生回调 */
  window.ProChatNative = {
    onDelta(id, t) {
      const L = live[id];
      if (!L) return;
      if (!L.firstAt) L.firstAt = Date.now();
      L.msg.content += t;
      paintLive(L);
    },
    onReasoning(id, t) {
      const L = live[id];
      if (!L) return;
      if (!L.firstAt) L.firstAt = Date.now();
      L.msg.reasoning += t;
      paintLive(L);
    },
    onDone(id, usage) {
      const L = live[id];
      finishLive(id, null, usage);
      if (L) saveConvs();
    },
    onError(id, msg) {
      finishLive(id, msg || '未知错误');
    },
    onModels(id, list) {
      setFetchBusy(false);
      let arr = [];
      try { arr = typeof list === 'string' ? JSON.parse(list) : list; } catch (e) { arr = []; }
      if (!arr || !arr.length) { toast('这个服务没有返回模型列表，可以直接手填模型名'); return; }
      openModelSheet(arr, true);
      toast('拉到 ' + arr.length + ' 个模型');
    },
    onModelsError(id, msg) {
      setFetchBusy(false);
      toast('拉取失败：' + msg);
    },
    onHttp(id, status, body) {
      settleHttp(id, status, body);
    },
    onHttpError(id, msg) {
      failHttp(id, msg);
    },
    onImage(dataUrl) {
      if (attachments.length >= 4) { toast('最多 4 张图'); return; }
      attachments.push(dataUrl);
      updateAttach();
      autoGrow();
    },
    onToast(msg) { toast(msg); },
    onVoiceStart() {
      voiceOn = true;
      $('#btnMic').classList.add('rec');
      toast('正在录音，再按一次结束');
    },
    onVoice(text, isFinal) {
      const ta = $('#ta');
      if (!voiceBase) voiceBase = ta.value;
      ta.value = voiceBase + text;
      autoGrow();
      if (isFinal) {
        voiceOn = false;
        $('#btnMic').classList.remove('rec');
        voiceBase = '';
      }
    },
    onVoiceEnd() {
      voiceOn = false;
      $('#btnMic').classList.remove('rec');
      voiceBase = '';
    },
    onVoiceError(msg) {
      voiceOn = false;
      $('#btnMic').classList.remove('rec');
      voiceBase = '';
      toast(msg);
    },
    onBack() { closeTop(); }
  };

  function paintLive(L) {
    const now = Date.now();
    if (now - L.lastPaint < 70) {
      if (!L.timer) {
        L.timer = setTimeout(() => { L.timer = 0; paintLive(L); }, 80);
      }
      return;
    }
    L.lastPaint = now;
    if (!L.el || !L.el.isConnected) return;
    const sticky = nearBottom();
    const bubble = L.el.querySelector('.bubble');
    if (bubble) bubble.innerHTML = assistantInner(L.msg, true);
    if (sticky) scrollBottom(false);
  }

  function finishLive(id, err, usage) {
    const L = live[id];
    if (!L) return;
    delete live[id];
    if (L.timer) { clearTimeout(L.timer); L.timer = 0; }
    if (streamingId === id) streamingId = null;
    L.msg.ms = Date.now() - L.started;
    if (usage) {
      try {
        const u = typeof usage === 'string' ? JSON.parse(usage) : usage;
        if (u && (u.total_tokens || u.completion_tokens)) L.msg.tokens = u.total_tokens || u.completion_tokens;
      } catch (e) {}
    }
    if (err) L.msg.err = err;
    if (!L.msg.content && !err) L.msg.content = '（模型没有返回内容）';
    L.msg.ts = Date.now();
    updateSendState();
    updateHeader();
    try { Native.keepAwake(false); } catch (e) {}
    if (currentConv() === L.conv) renderConv();
    saveConvs();
    if (err) toast(err.length > 80 ? err.slice(0, 80) + '…' : err);
  }

  /* ------------------------------------------------------------ 输入区 */
  const ta = $('#ta');

  function autoGrow() {
    ta.style.height = 'auto';
    ta.style.height = Math.min(132, Math.max(30, ta.scrollHeight)) + 'px';
  }

  ta.addEventListener('input', autoGrow);
  ta.addEventListener('focus', () => setTimeout(() => scrollBottom(false), 220));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault();
      send();
    }
  });

  $('#btnSend').addEventListener('click', send);
  $('#btnStop').addEventListener('click', () => {
    if (!streamingId) return;
    try { Native.stop(streamingId); } catch (e) {}
    const L = live[streamingId];
    if (L) { L.msg.content += ''; }
    if (L) finishLive(streamingId, null, null);
  });
  $('#btnImage').addEventListener('click', () => { try { Native.pickImage(); } catch (e) {} });

  let voiceBase = '';
  let voiceOn = false;

  function savedVoiceKey() {
    try { return Native.getSecret('voiceKey') || ''; } catch (e) { return ''; }
  }

  function hostOfUrl(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function voiceOptions() {
    const mode = S.settings.voiceMode === 'system' ? 'system' : 'api';
    const lang = S.settings.voiceLang || 'zh-CN';
    if (mode === 'system') return { mode: mode, lang: lang };

    const cfg = activeConfig();
    const customBase = String(S.settings.voiceBase || '').trim();
    const base = String(customBase || (cfg && cfg.baseUrl) || '')
      .trim().replace(/\/+$/, '');
    const defaultModel = /siliconflow\.cn/i.test(base) ? 'FunAudioLLM/SenseVoiceSmall' : 'whisper-1';
    const model = String(S.settings.voiceModel || defaultModel).trim();
    const sameService = !customBase || (!!cfg && hostOfUrl(cfg.baseUrl) === hostOfUrl(base));
    const apiKey = savedVoiceKey() || (sameService && cfg ? secretOf(cfg.id) : '');
    if (!base) {
      toast('先到设置 → 语音输入里填转写接口');
      openSettings();
      return null;
    }
    if (!model) {
      toast('先填语音转写模型');
      openSettings();
      return null;
    }
    if (!apiKey && !isLocalUrl(base)) {
      toast(sameService ? '语音转写还没填 API Key' : '换用其他转写服务时，要单独填转写 Key');
      openSettings();
      return null;
    }
    return {
      mode: mode,
      baseUrl: base,
      apiKey: apiKey,
      model: model,
      lang: lang,
      headers: sameService && cfg && cfg.headers ? cfg.headers : null
    };
  }

  $('#btnMic').addEventListener('click', () => {
    if (voiceOn) {
      voiceOn = false;
      $('#btnMic').classList.remove('rec');
      voiceBase = '';
      try { Native.stopVoice(); } catch (e) {}
      return;
    }
    const opts = voiceOptions();
    if (!opts) return;
    voiceOn = true;
    voiceBase = ta.value;
    $('#btnMic').classList.add('rec');
    try {
      Native.startVoice(JSON.stringify(opts));
    } catch (e) {
      voiceOn = false;
      $('#btnMic').classList.remove('rec');
      toast('语音启动失败');
    }
    setTimeout(() => { voiceOn = false; $('#btnMic').classList.remove('rec'); }, 120000);
  });

  // 屏幕左右边缘向内滑动：关闭当前面板 / 返回上一页。
  // 系统手势导航本身也会触发返回，这里主要兼容三键导航和网页版。
  (function setupEdgeSwipeBack() {
    const EDGE = 24;
    const DIST = 70;
    const SLOP = 50;
    let startX = 0, startY = 0, edge = 0, tracking = false;

    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const w = window.innerWidth;
      if (t.clientX <= EDGE) edge = -1;
      else if (t.clientX >= w - EDGE) edge = 1;
      else { edge = 0; tracking = false; return; }
      const target = e.target;
      if (target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]')) {
        edge = 0;
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > SLOP) { tracking = false; return; }
      if ((edge < 0 && dx > DIST) || (edge > 0 && dx < -DIST)) {
        tracking = false;
        edge = 0;
        closeTop();
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      tracking = false;
      edge = 0;
    }, { passive: true });
  })();

  $('#attachBox').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]');
    if (!b) return;
    attachments.splice(Number(b.dataset.rm), 1);
    updateAttach();
    autoGrow();
  });

  /* ------------------------------------------------------------ 消息区交互 */
  messagesEl.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      try { Native.openUrl(link.getAttribute('href')); } catch (er) {}
      return;
    }
    const cpy = e.target.closest('.cpy');
    if (cpy) {
      const code = decodeURIComponent(cpy.dataset.code || '');
      try { Native.copy(code); } catch (er) {}
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      const msgEl = act.closest('.msg');
      const conv = currentConv();
      if (!msgEl || !conv) return;
      const i = Number(msgEl.dataset.i);
      if (act.dataset.act === 'copy') {
        try { Native.copy(conv.messages[i].content || ''); } catch (er) {}
      } else if (act.dataset.act === 'regen') {
        if (i === conv.messages.length - 1) regenerate();
        else toast('只能重新生成最后一条回复');
      }
    }
  });

  /* ------------------------------------------------------------ 抽屉 */
  function openDrawer() {
    renderDrawer();
    $('#drawer').classList.add('on');
    $('#scrim').classList.add('on');
    updateBackIntercept();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('on');
    $('#scrim').classList.remove('on');
    updateBackIntercept();
  }

  $('#btnMenu').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#btnNew').addEventListener('click', newChat);
  $('#btnNewChat').addEventListener('click', () => { newChat(); closeDrawer(); });

  function newChat() {
    const conv = currentConv();
    if (conv && !conv.messages.length) { closeDrawer(); return; }
    const c = { id: uid(), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    S.convs.unshift(c);
    S.convId = c.id;
    saveConvs();
    renderConv();
    renderDrawer();
    updateHeader();
    closeDrawer();
  }

  function renderDrawer() {
    const box = $('#convList');
    if (!S.convs.length) {
      box.innerHTML = '<div class="emptyconv">还没有对话</div>';
    } else {
      box.innerHTML = S.convs.map(c => {
        const on = c.id === S.convId ? ' on' : '';
        return '<div class="convitem' + on + '" data-id="' + c.id + '">'
          + '<div class="ct">' + esc(c.title || '新对话') + '</div>'
          + '<div class="cx" data-del="' + c.id + '">✕</div></div>';
      }).join('');
    }
    $('#cfgSummary').textContent = activeConfig()
      ? (activeConfig().name + ' · ' + activeConfig().model)
      : '未配置模型';
  }

  $('#convList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      const conv = S.convs.filter(c => c.id === id)[0];
      if (!conv) return;
      askConfirm('删除「' + (conv.title || '新对话') + '」这个对话？').then((ok) => {
        if (!ok) return;
        S.convs = S.convs.filter(c => c.id !== id);
        if (S.convId === id) S.convId = S.convs.length ? S.convs[0].id : '';
        saveConvs();
        renderDrawer();
        renderConv();
        updateHeader();
      });
      return;
    }
    const item = e.target.closest('.convitem');
    if (!item) return;
    S.convId = item.dataset.id;
    saveConvs();
    renderConv();
    renderDrawer();
    updateHeader();
    closeDrawer();
  });

  /* ------------------------------------------------------------ 确认弹窗 */
  let confirmResolve = null;
  function askConfirm(text) {
    $('#confirmText').textContent = text;
    $('#confirmBox').classList.add('on');
    $('#confirmScrim').classList.add('on');
    updateBackIntercept();
    return new Promise((res) => { confirmResolve = res; });
  }
  function closeConfirm(val) {
    const r = confirmResolve;
    confirmResolve = null;
    $('#confirmBox').classList.remove('on');
    $('#confirmScrim').classList.remove('on');
    updateBackIntercept();
    if (r) r(val);
  }
  $('#confirmOk').addEventListener('click', () => closeConfirm(true));
  $('#confirmCancel').addEventListener('click', () => closeConfirm(false));
  $('#confirmScrim').addEventListener('click', () => closeConfirm(false));

  /* ------------------------------------------------------------ 面板通用 */
  function updateBackIntercept() {
    const open = $('#drawer').classList.contains('on')
      || $('#settingsPanel').classList.contains('on')
      || $('#cfgPanel').classList.contains('on')
      || $('#boardPanel').classList.contains('on')
      || $('#donatePanel').classList.contains('on')
      || $('#modelSheet').classList.contains('on')
      || $('#confirmBox').classList.contains('on')
      || $('#noticeBox').classList.contains('on')
      || $('#updateBox').classList.contains('on');
    try { Native.setBackIntercept(open); } catch (e) {}
  }

  function closeTop() {
    if ($('#noticeBox').classList.contains('on')) { closeNotice(true); return; }
    if ($('#updateBox').classList.contains('on')) {
      if (!pendingUpdate || !pendingUpdate.force) closeUpdate(true);
      return;
    }
    if ($('#confirmBox').classList.contains('on')) { closeConfirm(false); return; }
    if ($('#modelSheet').classList.contains('on')) { closeModelSheet(); return; }
    if ($('#boardPanel').classList.contains('on')) { closeBoard(); return; }
    if ($('#donatePanel').classList.contains('on')) { closeDonate(); return; }
    if ($('#cfgPanel').classList.contains('on')) { $('#cfgPanel').classList.remove('on'); updateBackIntercept(); return; }
    if ($('#settingsPanel').classList.contains('on')) { $('#settingsPanel').classList.remove('on'); updateBackIntercept(); return; }
    if ($('#drawer').classList.contains('on')) { closeDrawer(); }
  }

  /* ------------------------------------------------------------ 设置 */
  function openSettings() {
    fillSettings();
    renderConfigs();
    $('#settingsPanel').classList.add('on');
    updateBackIntercept();
    closeDrawer();
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnSettings2').addEventListener('click', openSettings);
  $('#btnSetup').addEventListener('click', () => { openSettings(); openCfgEditor(null); });
  $('#btnSetBack').addEventListener('click', () => {
    $('#settingsPanel').classList.remove('on');
    updateBackIntercept();
  });

  /* ------------------------------------------------------------ 打赏 */
  function openDonate() {
    $('#donatePanel').classList.add('on');
    updateBackIntercept();
  }

  function closeDonate() {
    $('#donatePanel').classList.remove('on');
    updateBackIntercept();
  }

  function saveDonateQr() {
    if (Native && typeof Native.saveAssetImage === 'function') {
      try {
        Native.saveAssetImage('donate-wechat.jpg', 'ProChat-donate');
      } catch (e) {
        toast('保存失败');
      }
    } else {
      toast('请截图保存收款码');
    }
  }

  $('#btnDonate').addEventListener('click', openDonate);
  $('#btnDonateBack').addEventListener('click', closeDonate);
  $('#btnSaveDonate').addEventListener('click', saveDonateQr);

  /* ------------------------------------------------------------ 检查更新 */
  let updateChecking = false;
  let pendingUpdate = null;

  // 当前版本更新公告。升级后第一次打开显示一次；设置里也可以手动重看。
  const RELEASE_NOTICES = {
    '1.2.5': {
      title: 'ProChat 1.2.5 更新公告',
      date: '2026-10-26',
      notes: [
        '• 语音输入默认改为接口转写，不再依赖谷歌语音服务。',
        '• 支持硅基流动 SenseVoice、OpenAI Whisper 等兼容接口。',
        '• 屏幕左右边缘向内滑动，可以返回上一页。',
        '• 1.2.4 的更新公告、打赏和图片上传保持不变。'
      ].join('\n')
    },
    '1.2.4': {
      title: 'ProChat 1.2.4 更新公告',
      date: '2026-10-26',
      notes: [
        '• 新增更新公告弹窗：升级后第一次打开会显示本次更新内容。',
        '• 修复部分手机点语音键后闪退的问题。',
        '• 语音输入改为调用系统语音识别界面，识别完成后自动填入输入框。',
        '• 打赏支持、检查更新和图片上传保持不变。'
      ].join('\n')
    }
  };

  function appInfoSafe() {
    try { return JSON.parse(Native.appInfo()) || {}; } catch (e) { return {}; }
  }

  function cmpVersion(a, b) {
    const pa = String(a || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    const pb = String(b || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function fmtWhen(ts) {
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function refreshUpdateStatus() {
    const info = appInfoSafe();
    const last = Number(S.settings.lastUpdateCheck) || 0;
    let s = '当前版本 ' + (info.version || '?');
    if (info.versionCode) s += ' (' + info.versionCode + ')';
    s += S.settings.autoUpdate === false ? ' · 自动检查已关闭' : ' · 自动检查已开启';
    if (last) s += ' · 上次检查 ' + fmtWhen(last);
    $('#updateStatus').textContent = s;
  }

  function notesText(notes) {
    if (Array.isArray(notes)) return notes.map(x => String(x == null ? '' : x)).join('\n').trim();
    return String(notes == null ? '' : notes).trim();
  }

  function noticeFor(info) {
    return RELEASE_NOTICES[String((info && info.version) || '')] || null;
  }

  function showNotice(force) {
    const info = appInfoSafe();
    const ver = String(info.version || '');
    const notice = noticeFor(info);
    if (!notice) {
      if (force) toast('当前版本暂无更新公告');
      return;
    }
    $('#noticeTitle').textContent = notice.title || ('ProChat ' + ver + ' 更新公告');
    $('#noticeSub').textContent = '当前版本 ' + ver + (notice.date ? ' · ' + notice.date : '');
    $('#noticeNotes').textContent = notice.notes || '';
    $('#noticeBox').classList.add('on');
    $('#noticeScrim').classList.add('on');
    updateBackIntercept();
  }

  function closeNotice(seen) {
    const wasOpen = $('#noticeBox').classList.contains('on');
    $('#noticeBox').classList.remove('on');
    $('#noticeScrim').classList.remove('on');
    if (seen) {
      const ver = String((appInfoSafe().version) || '');
      if (ver) {
        S.settings.noticeVersion = ver;
        saveSettings();
      }
    }
    if (wasOpen) updateBackIntercept();
  }

  function maybeShowNotice() {
    if ($('#noticeBox').classList.contains('on') || $('#updateBox').classList.contains('on')) return;
    const info = appInfoSafe();
    const ver = String(info.version || '');
    if (!ver || S.settings.noticeVersion === ver) return;
    if (!noticeFor(info)) return;
    showNotice(false);
  }

  function showUpdate(data, info) {
    closeNotice(true);
    pendingUpdate = data;
    const name = data.versionName || ('版本 ' + (data.versionCode || ''));
    $('#updTitle').textContent = '发现新版本 ' + name;
    $('#updSub').textContent = '当前 ' + ((info && info.version) || '?') + ' → 最新 ' + name
      + (data.publishedAt ? ' · ' + String(data.publishedAt).slice(0, 10) : '');
    $('#updNotes').textContent = notesText(data.notes) || '这次更新没有写说明。';
    $('#btnUpdateLater').classList.toggle('hidden', !!data.force);
    $('#updateBox').classList.add('on');
    $('#updateScrim').classList.add('on');
    updateBackIntercept();
  }

  function closeUpdate(later) {
    if (later && pendingUpdate && pendingUpdate.force) return;
    $('#updateBox').classList.remove('on');
    $('#updateScrim').classList.remove('on');
    if (later && pendingUpdate && Number(pendingUpdate.versionCode)) {
      S.settings.skippedUpdate = Number(pendingUpdate.versionCode);
      saveSettings();
    }
    pendingUpdate = null;
    updateBackIntercept();
  }

  function openUpdateDownload() {
    if (!pendingUpdate) return;
    let url = String(pendingUpdate.url || '').trim();
    if (!url) { toast('更新清单里没有下载地址'); return; }
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, apiBase() + '/update.json').toString(); } catch (e) {
        toast('下载地址无效');
        return;
      }
    }
    try {
      Native.openUrl(url);
      closeUpdate(false);
    } catch (e) {
      toast('打不开下载链接');
    }
  }

  function checkUpdate(silent) {
    if (updateChecking) return Promise.resolve();
    updateChecking = true;
    const info = appInfoSafe();
    S.settings.lastUpdateCheck = Date.now();
    saveSettings();
    refreshUpdateStatus();
    const btn = $('#btnCheckUpdate');
    if (btn) { btn.disabled = true; btn.textContent = '检查中…'; }
    if (!silent) toast('正在检查更新…');

    return nativeApi(apiBase() + '/update.json').then((data) => {
      updateChecking = false;
      if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
      const mCode = Number(data.versionCode) || 0;
      const curCode = Number(info.versionCode) || 0;
      const newer = (mCode && curCode) ? (mCode > curCode) : (cmpVersion(data.versionName, info.version) > 0);
      if (!newer) {
        if (!silent) toast('已是最新版本');
        return;
      }
      if (silent && Number(S.settings.skippedUpdate) === mCode) return;
      showUpdate(data, info);
    }).catch((e) => {
      updateChecking = false;
      if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
      refreshUpdateStatus();
      if (!silent) toast('检查更新失败：' + e.message);
    });
  }

  function maybeAutoCheck() {
    if (S.settings.autoUpdate === false) return;
    const last = Number(S.settings.lastUpdateCheck) || 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    checkUpdate(true);
  }

  /* ------------------------------------------------------------ 留言板 */
  let boardLoading = false;
  let boardSeq = 0;
  let feedbackSending = false;

  function openBoard() {
    $('#boardPanel').classList.add('on');
    updateBackIntercept();
    loadBoard();
  }

  function closeBoard() {
    setFeedbackForm(false);
    $('#boardPanel').classList.remove('on');
    updateBackIntercept();
  }

  function setFeedbackForm(show) {
    $('#fbForm').classList.toggle('hidden', !show);
    $('#btnNewFeedback').classList.toggle('hidden', show);
    if (show) {
      $('#fbName').value = S.settings.fbName || '';
      $('#fbContact').value = S.settings.fbContact || '';
      $('#fbContent').value = '';
      $('#fbWebsite').value = '';
      updateFbCount();
      setTimeout(() => { try { $('#fbContent').focus(); } catch (e) {} }, 60);
    }
  }

  function updateFbCount() {
    const n = $('#fbContent').value.length;
    $('#fbCount').textContent = n + ' / 2000';
  }

  function loadBoard(force) {
    if (boardLoading && !force) return;
    boardLoading = true;
    const seq = ++boardSeq;
    const box = $('#boardList');
    box.innerHTML = '<div class="boardempty">加载中…</div>';
    nativeApi(apiBase() + '/api/feedback?limit=50').then((data) => {
      boardLoading = false;
      if (seq !== boardSeq) return;
      renderBoard(data.items || []);
    }).catch((e) => {
      boardLoading = false;
      if (seq !== boardSeq) return;
      box.innerHTML = '<div class="boardempty">加载失败：' + esc(e.message)
        + '<br><button class="ghostbtn tiny" id="btnBoardRetry">重试</button></div>';
      const b = $('#btnBoardRetry');
      if (b) b.onclick = loadBoard;
    });
  }

  function renderBoard(items) {
    const box = $('#boardList');
    if (!items.length) {
      box.innerHTML = '<div class="boardempty">还没有留言，来写第一条吧。</div>';
      return;
    }
    box.innerHTML = items.map((it) => {
      const resolved = it.status === 'resolved';
      return '<div class="boarditem">'
        + '<div class="bm-head"><span class="bm-name">' + esc(it.name || '匿名用户') + '</span>'
        + '<span class="bm-time">' + esc(fmtWhen(it.createdAt)) + '</span>'
        + '<span class="bm-status' + (resolved ? ' resolved' : '') + '">' + (resolved ? '已解决' : '待处理') + '</span></div>'
        + '<div class="bm-content">' + esc(it.content) + '</div>'
        + (it.reply ? '<div class="bm-reply"><b>开发者回复</b>' + esc(it.reply) + '</div>' : '')
        + '</div>';
    }).join('');
  }

  function submitFeedback() {
    if (feedbackSending) return;
    const content = $('#fbContent').value.trim();
    if (content.length < 2) { toast('写点什么再提交吧'); return; }
    if (content.length > 2000) { toast('留言最多 2000 字'); return; }
    const name = $('#fbName').value.trim();
    const contact = $('#fbContact').value.trim();
    const info = appInfoSafe();
    const payload = {
      name: name,
      contact: contact,
      content: content,
      website: $('#fbWebsite').value,
      app: {
        version: info.version || '',
        versionCode: info.versionCode || 0,
        sdk: info.sdk || 0,
        model: info.model || ''
      }
    };
    feedbackSending = true;
    const btn = $('#btnSubmitFeedback');
    btn.disabled = true;
    btn.textContent = '发布中…';
    nativeApi(apiBase() + '/api/feedback', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).then(() => {
      S.settings.fbName = name;
      S.settings.fbContact = contact;
      saveSettings();
      feedbackSending = false;
      btn.disabled = false;
      btn.textContent = '发布留言';
      $('#fbContent').value = '';
      updateFbCount();
      setFeedbackForm(false);
      toast('留言已发布');
      loadBoard(true);
    }).catch((e) => {
      feedbackSending = false;
      btn.disabled = false;
      btn.textContent = '发布留言';
      toast('发布失败：' + e.message);
    });
  }

  $('#btnCheckUpdate').addEventListener('click', () => checkUpdate(false));
  $('#btnShowNotice').addEventListener('click', () => showNotice(true));
  $('#btnNoticeOk').addEventListener('click', () => closeNotice(true));
  $('#noticeScrim').addEventListener('click', () => closeNotice(true));
  $('#btnOpenBoard').addEventListener('click', openBoard);
  $('#btnBoardBack').addEventListener('click', closeBoard);
  $('#btnRefreshBoard').addEventListener('click', loadBoard);
  $('#btnNewFeedback').addEventListener('click', () => setFeedbackForm(true));
  $('#btnCancelFeedback').addEventListener('click', () => setFeedbackForm(false));
  $('#btnSubmitFeedback').addEventListener('click', submitFeedback);
  $('#fbContent').addEventListener('input', updateFbCount);
  $('#btnUpdateLater').addEventListener('click', () => closeUpdate(true));
  $('#btnUpdateNow').addEventListener('click', openUpdateDownload);
  $('#updateScrim').addEventListener('click', () => {
    if (!pendingUpdate || !pendingUpdate.force) closeUpdate(true);
  });
  $('#setAutoUpdate').addEventListener('change', (e) => {
    S.settings.autoUpdate = !!e.target.checked;
    saveSettings();
    refreshUpdateStatus();
  });
  $('#btnSaveApiBase').addEventListener('click', () => {
    let v = $('#setApiBase').value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) { toast('地址要以 http:// 或 https:// 开头'); return; }
    if (v === DEFAULT_API_BASE) v = '';
    S.settings.apiBase = v;
    saveSettings();
    refreshUpdateStatus();
    toast('服务地址已保存');
  });

  function fillSettings() {
    $('#setSys').value = S.settings.systemPrompt || '';
    $('#setCtx').value = S.settings.contextLimit;
    $('#setMax').value = S.settings.maxTokens || '';
    $('#setTemp').value = S.settings.temperature;
    $('#tempVal').textContent = Number(S.settings.temperature).toFixed(1);
    $('#setLang').value = S.settings.voiceLang || 'zh-CN';
    $('#setVoiceMode').value = S.settings.voiceMode === 'system' ? 'system' : 'api';
    $('#setVoiceModel').value = S.settings.voiceModel || '';
    $('#setVoiceBase').value = S.settings.voiceBase || '';
    $('#setVoiceKey').value = '';
    $('#setVoiceKey').placeholder = savedVoiceKey()
      ? '已保存，留空继续使用' : '同服务可留空，否则请填转写 Key';
    toggleVoiceApiBox();
    $('#setAutoUpdate').checked = S.settings.autoUpdate !== false;
    $('#setApiBase').value = S.settings.apiBase || DEFAULT_API_BASE;
    $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.settings.theme));
    const info = appInfoSafe();
    $('#aboutText').textContent = 'ProChat ' + (info.version || '?') + ' · ' + (info.model || '')
      + ' · 语音：' + (S.settings.voiceMode === 'system' ? '系统识别' : '接口转写');
    refreshUpdateStatus();
  }

  function toggleVoiceApiBox() {
    const sys = S.settings.voiceMode === 'system';
    $('#voiceApiBox').classList.toggle('hidden', sys);
  }

  $('#setVoiceMode').addEventListener('change', (e) => {
    S.settings.voiceMode = e.target.value === 'system' ? 'system' : 'api';
    saveSettings();
    toggleVoiceApiBox();
  });
  $('#setVoiceModel').addEventListener('input', (e) => {
    S.settings.voiceModel = e.target.value.trim();
    saveSettings();
  });
  $('#setVoiceBase').addEventListener('input', (e) => {
    S.settings.voiceBase = e.target.value.trim();
    saveSettings();
  });
  $('#setVoiceKey').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    try {
      Native.setSecret('voiceKey', v);
      e.target.value = '';
      e.target.placeholder = '已保存，留空继续使用';
      toast('语音转写 Key 已保存');
    } catch (err) {
      toast('保存失败');
    }
  });
  $('#btnVoicePreset').addEventListener('click', () => {
    S.settings.voiceMode = 'api';
    S.settings.voiceBase = 'https://api.siliconflow.cn/v1';
    S.settings.voiceModel = 'FunAudioLLM/SenseVoiceSmall';
    saveSettings();
    $('#setVoiceMode').value = 'api';
    $('#setVoiceBase').value = S.settings.voiceBase;
    $('#setVoiceModel').value = S.settings.voiceModel;
    toggleVoiceApiBox();
    toast('已填入硅基流动示例；如果当前不是硅基流动，请在下面单独填转写 Key');
  });

  $('#setSys').addEventListener('input', (e) => { S.settings.systemPrompt = e.target.value; saveSettings(); });
  $('#setCtx').addEventListener('change', (e) => {
    let v = parseInt(e.target.value, 10);
    if (!v || v < 2) v = 2;
    if (v > 80) v = 80;
    e.target.value = v;
    S.settings.contextLimit = v;
    saveSettings();
    updateHeader();
  });
  $('#setMax').addEventListener('change', (e) => {
    let v = parseInt(e.target.value, 10);
    if (!v || v < 0) v = 0;
    S.settings.maxTokens = v;
    saveSettings();
  });
  $('#setTemp').addEventListener('input', (e) => {
    S.settings.temperature = Number(e.target.value);
    $('#tempVal').textContent = Number(S.settings.temperature).toFixed(1);
  });
  $('#setTemp').addEventListener('change', () => { saveSettings(); updateHeader(); });
  $('#setLang').addEventListener('change', (e) => {
    S.settings.voiceLang = e.target.value;
    saveSettings();
  });
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    S.settings.theme = b.dataset.v;
    saveSettings();
    applyTheme();
  });

  $('#btnShareConv').addEventListener('click', () => {
    const conv = currentConv();
    if (!conv || !conv.messages.length) { toast('还没有对话'); return; }
    let md = '# ' + (conv.title || '对话') + '\n\n';
    conv.messages.forEach(m => {
      md += (m.role === 'user' ? '**我：** ' : '**AI：** ') + (m.content || '') + '\n\n';
    });
    try { Native.share(md); } catch (e) { toast('分享失败'); }
  });

  $('#btnClearConvs').addEventListener('click', () => {
    askConfirm('清空所有对话？这个操作不能撤销。').then((ok) => {
      if (!ok) return;
      S.convs = [];
      S.convId = '';
      DB.write('convs', []);
      renderConv();
      renderDrawer();
      updateHeader();
      toast('已清空对话');
    });
  });

  $('#btnWipe').addEventListener('click', () => {
    askConfirm('清除全部数据？包括所有 API Key、模型配置和对话记录。').then((ok) => {
      if (!ok) return;
      S.convs = [];
      S.configs = [];
      S.convId = '';
      S.settings = Object.assign({}, DEFAULT_SETTINGS);
      DB.write('convs', []);
      DB.write('configs', []);
      DB.write('settings', S.settings);
      DB.write('state', {});
      try { Native.clearStore(); } catch (e) {}
      try { Native.clearSecrets(); } catch (e) {}
      renderConv();
      renderConfigs();
      renderDrawer();
      updateHeader();
      updateEmpty();
      toast('已全部清除');
    });
  });

  /* ------------------------------------------------------------ 服务配置 */
  // 2026-10 核对：地址与模型名可能随厂商调整，以「从账号拉取」的结果为准
  const PRESETS = [
    {
      n: 'DeepSeek',
      base: 'https://api.deepseek.com',
      m: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      buyUrl: 'https://platform.deepseek.com/top_up',
      note: '官方直连 · 按 token 计费'
    },
    {
      n: 'Kimi',
      base: 'https://api.moonshot.cn/v1',
      m: 'kimi-k3.1-pro',
      models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
      keyUrl: 'https://platform.kimi.com/console/api-keys',
      buyUrl: 'https://platform.kimi.com/console/pay',
      note: '月之暗面官方 · 1M 上下文'
    },
    {
      n: '智谱 GLM',
      base: 'https://open.bigmodel.cn/api/paas/v4',
      m: 'glm-5.3',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5', 'glm-4.6'],
      keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      buyUrl: 'https://bigmodel.cn/finance-center',
      note: '智谱官方 · 中文与编程'
    },
    {
      n: '通义千问',
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      m: 'qwen3.8-max',
      models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-omni-flash'],
      keyUrl: 'https://bailian.console.aliyun.com/model/settings/api-key',
      buyUrl: 'https://bailian.console.aliyun.com/',
      note: '阿里云百炼 · 各地域 Key 独立'
    },
    {
      n: '硅基流动',
      base: 'https://api.siliconflow.cn/v1',
      m: 'deepseek-ai/DeepSeek-V4.1-Flash',
      models: ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek-ai/DeepSeek-V4-Pro', 'zai-org/GLM-5.3', 'moonshotai/Kimi-K2.7-Code', 'Qwen/Qwen3.8-27B'],
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      buyUrl: 'https://cloud.siliconflow.cn/me/bills',
      note: '聚合平台 · 一个 Key 调多家'
    },
    {
      n: 'OpenRouter',
      base: 'https://openrouter.ai/api/v1',
      m: 'openai/gpt-6.1-sol',
      models: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'google/gemini-4-argon', 'deepseek/deepseek-v4.1-flash', 'moonshotai/kimi-k3.1-pro', 'z-ai/glm-5.3', 'qwen/qwen3.8-max', 'x-ai/grok-4.7'],
      keyUrl: 'https://openrouter.ai/keys',
      buyUrl: 'https://openrouter.ai/credits',
      note: '聚合平台 · 需外网与美元余额'
    },
    {
      n: 'Groq',
      base: 'https://api.groq.com/openai/v1',
      m: 'openai/gpt-oss-120b',
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b'],
      keyUrl: 'https://console.groq.com/keys',
      buyUrl: 'https://console.groq.com/settings/billing',
      note: '极速推理 · 有免费额度'
    },
    {
      n: 'OpenAI',
      base: 'https://api.openai.com/v1',
      m: 'gpt-6.1-sol',
      models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.2', 'gpt-5-mini'],
      keyUrl: 'https://platform.openai.com/api-keys',
      buyUrl: 'https://platform.openai.com/settings/organization/billing/overview',
      note: '官方直连 · 需外网'
    },
    { n: '自定义', base: '', m: '', models: [] }
  ];

  function renderConfigs() {
    const box = $('#cfgList');
    if (!S.configs.length) {
      box.innerHTML = '<p class="note" style="margin:0 0 4px">还没添加。点下面添加一个你自己的模型服务。</p>';
    } else {
      const act = activeConfig();
      box.innerHTML = S.configs.map(c => {
        const on = act && act.id === c.id ? ' on' : '';
        const initial = (c.name || '?').slice(0, 1).toUpperCase();
        return '<div class="cfgcard' + on + '" data-id="' + c.id + '">'
          + '<div class="cico">' + esc(initial) + '</div>'
          + '<div class="cinfo"><div class="cname">' + esc(c.name || '未命名') + '</div>'
          + '<div class="cmeta">' + esc((c.model || '未选模型') + ' · ' + (c.baseUrl || '')) + '</div></div>'
          + '<div class="cradio"></div>'
          + '<div class="cedit" data-edit="' + c.id + '">编辑</div>'
          + '</div>';
      }).join('');
    }
  }

  $('#cfgList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openCfgEditor(ed.dataset.edit); return; }
    const card = e.target.closest('.cfgcard');
    if (!card) return;
    S.settings.activeId = card.dataset.id;
    saveSettings();
    renderConfigs();
    updateHeader();
    toast('已切换到 ' + (cfgById(card.dataset.id) || {}).name);
  });

  $('#btnAddCfg').addEventListener('click', () => openCfgEditor(null));
  $('#btnCfgBack').addEventListener('click', () => {
    $('#cfgPanel').classList.remove('on');
    updateBackIntercept();
  });

  let editingId = null;
  let editingBase = '';
  let presetIndex = -1;
  const fetchState = { busy: false, from: 'form' };
  const FETCH_LABEL = { form: '从账号拉取完整列表', sheet: '从账号拉取' };

  function normBase(u) {
    return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  function presetOfBase(base) {
    const b = normBase(base);
    if (!b) return -1;
    for (let i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].base && normBase(PRESETS[i].base) === b) return i;
    }
    return -1;
  }

  function highlightModelChips() {
    const cur = $('#cfgModel').value.trim();
    $$('#pvModels .mchip').forEach(x => x.classList.toggle('on', x.dataset.m === cur));
  }

  function renderPresetInfo(p) {
    const box = $('#presetInfo');
    if (!p || !p.base) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('#pvName').textContent = p.n;
    $('#pvNote').textContent = p.note || '';
    $('#pvKey').classList.toggle('hidden', !p.keyUrl);
    $('#pvBuy').classList.toggle('hidden', !p.buyUrl);
    $('#pvKey').dataset.url = p.keyUrl || '';
    $('#pvBuy').dataset.url = p.buyUrl || '';
    const ms = p.models || [];
    $('#pvMWrap').classList.toggle('hidden', !ms.length);
    $('#pvModels').innerHTML = ms.map(m =>
      '<button class="mchip" data-m="' + esc(m) + '">' + esc(m) + '</button>').join('');
    highlightModelChips();
  }

  function openLink(url) {
    if (!url) return;
    try { Native.openUrl(url); } catch (e) { toast('打不开这个链接'); }
  }

  function openCfgEditor(id) {
    editingId = id || null;
    const c = id ? cfgById(id) : null;
    editingBase = c ? (c.baseUrl || '') : '';
    $('#cfgPanelTitle').textContent = c ? '编辑服务' : '添加模型服务';
    $('#cfgName').value = c ? (c.name || '') : '';
    $('#cfgBase').value = c ? (c.baseUrl || '') : '';
    $('#cfgModel').value = c ? (c.model || '') : '';
    $('#cfgHeaders').value = c && c.headers ? JSON.stringify(c.headers, null, 2) : '';
    $('#cfgKey').value = '';
    $('#cfgKey').placeholder = c ? '已保存，留空则不修改' : 'sk-...';
    $('#cfgKey').type = 'password';
    $('#btnEye').textContent = '显示';
    $('#btnCfgDelete').classList.toggle('hidden', !c);
    presetIndex = c ? presetOfBase(c.baseUrl) : -1;
    const preset = presetIndex >= 0 ? PRESETS[presetIndex] : null;
    $('#cfgModel').placeholder = preset ? preset.m : 'deepseek-flash';
    const box = $('#presets');
    box.innerHTML = PRESETS.map((p, i) =>
      '<button class="preset" data-p="' + i + '">' + esc(p.n) + '</button>').join('');
    $$('#presets .preset').forEach((x, i) => x.classList.toggle('on', i === presetIndex));
    renderPresetInfo(preset);
    $('#cfgPanel').classList.add('on');
    updateBackIntercept();
  }

  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const idx = Number(b.dataset.p);
    const prev = presetIndex >= 0 ? PRESETS[presetIndex] : null;
    const p = PRESETS[idx];
    presetIndex = idx;
    $$('#presets .preset').forEach(x => x.classList.toggle('on', x === b));
    const nameEl = $('#cfgName');
    const oldName = nameEl.value.trim();
    if (!oldName || (prev && oldName === prev.n)) nameEl.value = p.base ? p.n : '';
    $('#cfgBase').value = p.base;
    $('#cfgModel').value = p.m;
    $('#cfgModel').placeholder = p.m || '模型名';
    renderPresetInfo(p);
  });

  $('#presetInfo').addEventListener('click', (e) => {
    const chip = e.target.closest('.mchip');
    if (chip) {
      $('#cfgModel').value = chip.dataset.m;
      highlightModelChips();
      return;
    }
    const link = e.target.closest('[data-url]');
    if (link) openLink(link.dataset.url);
  });

  $('#cfgModel').addEventListener('input', highlightModelChips);

  $('#btnEye').addEventListener('click', () => {
    const inp = $('#cfgKey');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('#btnEye').textContent = show ? '隐藏' : '显示';
  });

  function setFetchBusy(busy) {
    fetchState.busy = busy;
    ['form', 'sheet'].forEach((from) => {
      const el = $(from === 'form' ? '#btnFetch' : '#btnSheetFetch');
      if (!el) return;
      el.textContent = busy ? '拉取中…' : FETCH_LABEL[from];
      el.disabled = busy;
    });
  }

  function doFetch(from) {
    if (fetchState.busy) return;
    const base = $('#cfgBase').value.trim();
    if (!base) { toast('先填接口地址'); return; }
    const key = $('#cfgKey').value.trim() || (editingId ? secretOf(editingId) : '');
    const payload = { baseUrl: base, apiKey: key };
    const htxt = $('#cfgHeaders').value.trim();
    if (htxt) {
      try { payload.headers = JSON.parse(htxt); } catch (e) { toast('请求头不是合法 JSON'); return; }
    }
    fetchState.from = from || 'form';
    setFetchBusy(true);
    try { Native.listModels('m' + uid(), JSON.stringify(payload)); } catch (e) {
      setFetchBusy(false);
      toast('调用失败');
    }
  }

  $('#btnFetch').addEventListener('click', () => doFetch('form'));
  $('#btnSheetFetch').addEventListener('click', () => doFetch('sheet'));

  $('#btnCfgSave').addEventListener('click', () => {
    const name = $('#cfgName').value.trim();
    let base = $('#cfgBase').value.trim();
    const model = $('#cfgModel').value.trim();
    const key = $('#cfgKey').value.trim();
    if (!base) { toast('填一下接口地址'); return; }
    if (!model) { toast('填一下模型名'); return; }
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    if (editingId && !key && base !== editingBase && !isLocalUrl(base)) {
      toast('换了接口地址，请重新填这个服务的 API Key');
      $('#cfgKey').focus();
      return;
    }
    let headers = null;
    const htxt = $('#cfgHeaders').value.trim();
    if (htxt) {
      try {
        headers = JSON.parse(htxt);
        if (typeof headers !== 'object' || Array.isArray(headers)) throw new Error('bad');
      } catch (e) { toast('请求头要写成 JSON 对象'); return; }
    }
    let cfg = editingId ? cfgById(editingId) : null;
    if (!cfg) {
      cfg = { id: uid() };
      S.configs.push(cfg);
    }
    cfg.name = name || (base.replace(/^https?:\/\//, '').split('/')[0]);
    cfg.baseUrl = base;
    cfg.model = model;
    cfg.headers = headers;
    if (key) {
      try { Native.setSecret('key:' + cfg.id, key); } catch (e) {}
    }
    S.settings.activeId = cfg.id;
    saveConfigs();
    saveSettings();
    renderConfigs();
    updateHeader();
    updateEmpty();
    $('#cfgPanel').classList.remove('on');
    updateBackIntercept();
    toast('已保存并启用');
  });

  $('#btnCfgDelete').addEventListener('click', () => {
    if (!editingId) return;
    const id = editingId;
    askConfirm('删除这个服务？对应的 API Key 也会一起删掉。').then((ok) => {
      if (!ok) return;
      S.configs = S.configs.filter(c => c.id !== id);
      try { Native.removeSecret('key:' + id); } catch (e) {}
      if (S.settings.activeId === id) {
        S.settings.activeId = S.configs.length ? S.configs[0].id : '';
      }
      saveConfigs();
      saveSettings();
      renderConfigs();
      updateHeader();
      updateEmpty();
      $('#cfgPanel').classList.remove('on');
      updateBackIntercept();
    });
  });

  /* ------------------------------------------------------------ 模型选择 */
  let modelOptions = [];

  function openModelSheet(list, fetched) {
    modelOptions = list || [];
    const cur = $('#cfgModel').value.trim();
    $('#sheetHint').textContent = fetched
      ? '来自当前账号，共 ' + modelOptions.length + ' 个'
      : '内置常用模型，仅供快速选择；点右上角可从账号拉取完整列表';
    $('#modelList').innerHTML = modelOptions.map((m, i) =>
      '<div class="modelitem' + (m === cur ? ' on' : '') + '" data-m="' + i + '">' + esc(m) + '</div>').join('');
    $('#modelSheet').classList.add('on');
    $('#sheetScrim').classList.add('on');
    updateBackIntercept();
  }

  function closeModelSheet() {
    $('#modelSheet').classList.remove('on');
    $('#sheetScrim').classList.remove('on');
    updateBackIntercept();
  }

  $('#btnPickModel').addEventListener('click', () => {
    const preset = presetIndex >= 0 ? PRESETS[presetIndex] : null;
    const list = preset && preset.models ? preset.models.slice() : [];
    if (!list.length) { doFetch('sheet'); return; }
    openModelSheet(list, false);
  });

  $('#btnSheetClose').addEventListener('click', closeModelSheet);
  $('#sheetScrim').addEventListener('click', closeModelSheet);
  $('#modelList').addEventListener('click', (e) => {
    const it = e.target.closest('[data-m]');
    if (!it) return;
    $('#cfgModel').value = modelOptions[Number(it.dataset.m)];
    highlightModelChips();
    closeModelSheet();
  });

  /* ------------------------------------------------------------ 空状态 */
  const SUGGESTIONS = [
    '用三句话解释一下量子纠缠',
    '帮我写一段 Python，批量重命名文件',
    '把这段话改得更正式：',
    '冰箱里只有鸡蛋和西红柿，做什么吃？'
  ];

  function renderEmpty() {
    $('#chips').innerHTML = SUGGESTIONS.map(s =>
      '<button class="chip" data-s="' + esc(s) + '">' + esc(s) + '</button>').join('');
  }

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    ta.value = b.dataset.s;
    autoGrow();
    send();
  });

  /* ------------------------------------------------------------ 启动 */
  function init() {
    if (!S.convs.length) {
      const c = { id: uid(), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      S.convs.push(c);
      S.convId = c.id;
    }
    if (!currentConv()) S.convId = S.convs[0].id;

    // 上次被中断/杀进程时留下的空回复，清掉
    S.convs.forEach(c => {
      while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant'
        && !c.messages[c.messages.length - 1].content
        && !c.messages[c.messages.length - 1].reasoning) {
        c.messages.pop();
      }
    });

    if (!S.settings.activeId && S.configs.length) S.settings.activeId = S.configs[0].id;

    applyTheme();
    renderEmpty();
    renderConv();
    renderDrawer();
    updateHeader();
    updateAttach();
    updateSendState();
    updateBackIntercept();

    if (!S.configs.length) setTimeout(() => toast('先在设置里添加你自己的模型服务'), 700);
    setTimeout(maybeShowNotice, 1100);
    setTimeout(maybeAutoCheck, 1800);
  }

  init();
})();
