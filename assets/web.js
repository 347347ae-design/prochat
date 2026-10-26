/* ProChat Web —— 浏览器 / PWA 用的原生桥实现
 *
 * 安卓版里网络请求走 Java 原生层（无 CORS、可中断）。网页版没有原生层，
 * 这里用 fetch + ReadableStream 直接复刻同样的接口，让 app.js 一行都不用改。
 *
 * 生效条件：http(s) 打开、且页面里没有原生注入的 Native。
 * 设计预览（tools/preview-frame.html）请加 ?mock=1，仍走 app.js 里的假数据。
 */
(function () {
  'use strict';

  if (window.Native) return;                                   // 原生壳优先
  if (!/^https?:$/.test(location.protocol)) return;            // file:// 不开真桥
  if (/(?:^|[?&])mock=1(?:&|$)/.test(location.search)) return; // 设计预览

  var P = 'pc:';
  var VERSION = '1.2.5';
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;

  /* ------------------------------------------------------------ 提示 */
  function say(msg) {
    try {
      if (window.ProChatNative && window.ProChatNative.onToast) {
        window.ProChatNative.onToast(msg);
        return;
      }
    } catch (e) {}
    console.log('[ProChat]', msg);
  }

  /* ------------------------------------------------------------ 存储 */
  // 网页版没有 Keystore，密钥只能放在 localStorage。设置页会提示这一点。
  function lsGet(k) {
    try { return localStorage.getItem(P + k) || ''; } catch (e) { return ''; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(P + k, v); return true; } catch (e) { return false; }
  }
  function lsDel(k) {
    try { localStorage.removeItem(P + k); } catch (e) {}
  }

  // localStorage 只有 5MB 左右，带图对话很容易撑爆。
  // 存不下时逐级瘦身：先清旧对话的图片，再砍掉最早的对话。
  function shrink(json, level) {
    var arr;
    try { arr = JSON.parse(json); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    var changed = false;
    if (level === 1) {
      for (var i = 0; i < arr.length; i++) {
        var conv = arr[i];
        if (!conv || !Array.isArray(conv.messages)) continue;
        var newest = i === 0;
        for (var j = 0; j < conv.messages.length; j++) {
          var m = conv.messages[j];
          if (m && m.images && m.images.length && !(newest && j >= conv.messages.length - 8)) {
            delete m.images;
            changed = true;
          }
        }
      }
    } else {
      if (arr.length > 20) { arr = arr.slice(0, 20); changed = true; }
      for (var k = 0; k < arr.length; k++) {
        var c2 = arr[k];
        if (!c2 || !Array.isArray(c2.messages)) continue;
        if (c2.messages.length > 200) { c2.messages = c2.messages.slice(-200); changed = true; }
        for (var n = 0; n < c2.messages.length; n++) {
          if (c2.messages[n] && c2.messages[n].images) { delete c2.messages[n].images; changed = true; }
        }
      }
    }
    return changed ? JSON.stringify(arr) : null;
  }

  function setStore(k, v) {
    if (lsSet(k, v)) return;
    if (k === 'convs') {
      var s1 = shrink(v, 1);
      if (s1 && lsSet(k, s1)) { say('浏览器存储空间不足，已清理旧对话里的图片'); return; }
      var s2 = shrink(v, 2);
      if (s2 && lsSet(k, s2)) { say('存储空间不足，已清理最早的对话记录'); return; }
    }
    say('浏览器存储空间不足，这次没有保存成功');
  }

  /* ------------------------------------------------------------ 端点与报错 */
  // 和 ChatClient.endpoint 保持一致
  function endpoint(base, path) {
    var b = String(base == null ? '' : base).trim();
    while (b.slice(-1) === '/') b = b.slice(0, -1);
    ['/chat/completions', '/completions', '/models', '/audio/transcriptions'].forEach(function (suf) {
      if (b.slice(-suf.length) === suf) b = b.slice(0, -suf.length);
    });
    return b + '/' + path;
  }

  function prettyError(raw) {
    var t = String(raw || '').trim();
    if (!t) return '没有返回内容';
    try {
      var o = JSON.parse(t);
      var e = o.error;
      if (e && typeof e === 'object' && e.message) return String(e.message);
      if (typeof e === 'string') return e;
      if (o.message) return String(o.message);
      if (o.detail) return String(o.detail);
    } catch (err) {}
    if (t.charAt(0) === '<') return '服务器返回了网页而不是数据，接口地址可能不对';
    return t.length > 300 ? t.slice(0, 300) + '…' : t;
  }

  function corsHint(err) {
    var m = String((err && err.message) || err || '');
    if (/Failed to fetch|Load failed|NetworkError|Network request failed/i.test(m)) {
      return '连不上接口。可能是网络不通，也可能是这个服务不允许网页跨域调用（CORS）';
    }
    return m || '请求失败';
  }

  function authHeaders(apiKey, extra) {
    var h = { 'Accept': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (k) {
        var v = extra[k];
        if (k && v != null && String(v) !== '') h[k] = String(v);
      });
    }
    return h;
  }

  /* ------------------------------------------------------------ 对话流 */
  var streams = {};

  function emitDelta(id, text) {
    if (!text) return;
    try { window.ProChatNative.onDelta(id, text); } catch (e) {}
  }
  function emitReasoning(id, text) {
    if (!text) return;
    try { window.ProChatNative.onReasoning(id, text); } catch (e) {}
  }
  function emitDone(id, usage) {
    try { window.ProChatNative.onDone(id, JSON.stringify(usage || {})); } catch (e) {}
  }
  function emitError(id, msg) {
    try { window.ProChatNative.onError(id, msg); } catch (e) {}
  }

  function pickDelta(j, id) {
    var ch = j.choices;
    if (!ch || !ch.length) return;
    var c = ch[0];
    var d = c.delta || c.message || {};
    if (d.reasoning_content) emitReasoning(id, d.reasoning_content);
    else if (d.reasoning) emitReasoning(id, d.reasoning);
    if (typeof d.content === 'string') emitDelta(id, d.content);
    else if (d.content && d.content.length) {
      // 少数服务返回分段数组
      for (var i = 0; i < d.content.length; i++) {
        if (d.content[i] && d.content[i].type === 'text') emitDelta(id, d.content[i].text || '');
      }
    }
  }

  function consumeLine(id, line, box) {
    var s = line.replace(/\r$/, '');
    if (!s || s.charAt(0) === ':') return;
    if (s.indexOf('data:') !== 0) return;
    var data = s.slice(5).trim();
    if (!data || data === '[DONE]') return;
    var j;
    try { j = JSON.parse(data); } catch (e) { return; }
    if (j.error) { throw new Error(prettyError(JSON.stringify(j))); }
    if (j.usage) box.usage = j.usage;
    pickDelta(j, id);
  }

  async function readSse(id, res, box) {
    var reader = res.body.getReader();
    var dec = new TextDecoder('utf-8');
    var buf = '';
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      var idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        consumeLine(id, line, box);
      }
    }
    buf += dec.decode();
    if (buf.trim()) consumeLine(id, buf, box);
  }

  function readFull(id, text, box) {
    var t = String(text || '').trim();
    if (!t) throw new Error('服务器返回了空响应');
    var o;
    try { o = JSON.parse(t); } catch (e) { throw new Error(prettyError(t)); }
    if (o.error) throw new Error(prettyError(JSON.stringify(o)));
    if (o.usage) box.usage = o.usage;
    pickDelta(o, id);
    if (!box.usage && o.usage) box.usage = o.usage;
  }

  function ask(id, payloadJson) {
    var p;
    try { p = JSON.parse(payloadJson); } catch (e) { p = {}; }

    var body = { model: p.model, messages: p.messages || [], stream: true };
    if (p.temperature != null && p.temperature !== '') body.temperature = Number(p.temperature);
    if (Number(p.maxTokens) > 0) body.max_tokens = Number(p.maxTokens);

    var ctrl = new AbortController();
    streams[id] = ctrl;

    var headers = authHeaders(p.apiKey, p.headers);
    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'text/event-stream';

    var box = { usage: null };

    fetch(endpoint(p.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit'
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ' · ' + prettyError(t));
        });
      }
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.body && ct.indexOf('event-stream') >= 0) return readSse(id, res, box);
      if (res.body && ct.indexOf('json') < 0) return readSse(id, res, box);
      return res.text().then(function (t) { readFull(id, t, box); });
    }).then(function () {
      emitDone(id, box.usage);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return; // 用户主动停止，不算错误
      emitError(id, corsHint(err));
    }).finally(function () {
      delete streams[id];
    });
  }

  function stop() {
    Object.keys(streams).forEach(function (id) {
      try { streams[id].abort(); } catch (e) {}
      delete streams[id];
    });
  }

  function listModels(id, payloadJson) {
    var p;
    try { p = JSON.parse(payloadJson); } catch (e) { p = {}; }
    var headers = authHeaders(p.apiKey, p.headers);
    fetch(endpoint(p.baseUrl, 'models'), {
      method: 'GET', headers: headers, mode: 'cors', cache: 'no-store', credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + prettyError(t));
        var o = JSON.parse(t);
        var arr = (o.data || o.models || o || []);
        var names = [];
        for (var i = 0; i < arr.length; i++) {
          var n = arr[i] && (arr[i].id || arr[i].name || arr[i]);
          if (n) names.push(String(n));
        }
        window.ProChatNative.onModels(id, JSON.stringify(names));
      });
    }).catch(function (err) {
      try { window.ProChatNative.onModelsError(id, corsHint(err)); } catch (e) {}
    });
  }

  /* ------------------------------------------------------------ 普通 HTTP */
  function doHttp(id, url, method, body) {
    var opt = { method: method, mode: 'cors', cache: 'no-store', credentials: 'omit' };
    if (method === 'POST') {
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = body || '';
    }
    fetch(url, opt).then(function (res) {
      return res.text().then(function (t) {
        try { window.ProChatNative.onHttp(id, res.status, t); } catch (e) {}
      });
    }).catch(function (err) {
      try { window.ProChatNative.onHttpError(id, corsHint(err)); } catch (e) {}
    });
  }

  /* ------------------------------------------------------------ 图片 */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1280;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w > max || h > max) {
            var s = Math.min(max / w, max / h);
            w = Math.round(w * s);
            h = Math.round(h * s);
          }
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这张图片读不出来'));
      };
      img.src = url;
    });
  }

  function pickImage() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      document.body.removeChild(input);
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { say('图片太大了，换一张小一点的'); return; }
      compressImage(f).then(function (dataUrl) {
        try { window.ProChatNative.onImage(dataUrl); } catch (e) {}
      }).catch(function (e) {
        say(e && e.message ? e.message : '图片处理失败');
      });
    });
    input.click();
  }

  function saveAssetImage(asset, downloadName) {
    var url = asset;
    if (IS_IOS) {
      window.open(url, '_blank');
      say('在新页面里长按图片即可保存到相册');
      return;
    }
    fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = (downloadName || 'image') + '.jpg';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 2000);
    }).catch(function () {
      say('保存失败，可以长按图片保存');
    });
  }

  /* ------------------------------------------------------------ 复制 / 分享 */
  function copy(text) {
    var t = String(text == null ? '' : text);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(t).then(function () {
        say('已复制');
      }).catch(function () { legacyCopy(t); });
      return;
    }
    legacyCopy(t);
  }

  function legacyCopy(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, t.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
      say('已复制');
    } catch (e) {
      say('复制失败，请长按选择文字');
    }
  }

  function share(text) {
    var t = String(text == null ? '' : text);
    if (navigator.share) {
      navigator.share({ text: t }).catch(function () {});
      return;
    }
    copy(t);
  }

  /* ------------------------------------------------------------ 语音 */
  var rec = null;      // 当前录音会话
  var speech = null;   // Web Speech 会话

  function pickMime() {
    var list = [
      'audio/webm;codecs=opus', 'audio/webm',
      'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function extOf(mime) {
    if (/mp4|aac|m4a/.test(mime)) return 'm4a';
    if (/ogg/.test(mime)) return 'ogg';
    if (/wav/.test(mime)) return 'wav';
    return 'webm';
  }

  function langCode(locale) {
    var v = String(locale || '').trim().toLowerCase();
    if (!v || v === 'auto') return '';
    if (v.indexOf('zh') === 0) return 'zh';
    if (v.indexOf('en') === 0) return 'en';
    if (v.indexOf('ja') === 0) return 'ja';
    if (v.indexOf('ko') === 0) return 'ko';
    if (v.indexOf('yue') === 0) return 'yue';
    return v.split(/[-_]/)[0];
  }

  function startVoice(optsJson) {
    var o;
    try { o = JSON.parse(optsJson); } catch (e) { o = {}; }

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (o.mode === 'system' && SR) { startSpeech(o, SR); return; }
    startRecord(o);
  }

  function startSpeech(o, SR) {
    try {
      speech = new SR();
      speech.lang = o.lang && o.lang !== 'auto' ? o.lang : 'zh-CN';
      speech.continuous = false;
      speech.interimResults = true;
      var finalText = '';
      speech.onresult = function (e) {
        var text = '';
        for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        if (e.results[e.results.length - 1].isFinal) {
          finalText = text;
          try { window.ProChatNative.onVoice(text, true); } catch (er) {}
        }
      };
      speech.onerror = function (e) {
        var m = e && e.error === 'not-allowed' ? '没有麦克风权限' :
          (e && e.error === 'no-speech' ? '没听到声音，再说一次' : '系统语音识别失败');
        try { window.ProChatNative.onVoiceError(m); } catch (er) {}
        speech = null;
      };
      speech.onend = function () {
        if (!finalText) { try { window.ProChatNative.onVoiceEnd(); } catch (er) {} }
        else { try { window.ProChatNative.onVoiceEnd(); } catch (er) {} }
        speech = null;
      };
      speech.start();
      try { window.ProChatNative.onVoiceStart(); } catch (er) {}
    } catch (e) {
      speech = null;
      try { window.ProChatNative.onVoiceError('这个浏览器不支持系统语音识别'); } catch (er) {}
    }
  }

  function stopSpeech() {
    if (!speech) return;
    try { speech.stop(); } catch (e) {}
    speech = null;
  }

  function startRecord(o) {
    if (rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      try { window.ProChatNative.onVoiceError('这个浏览器不支持录音，请用输入法自带的麦克风'); } catch (e) {}
      return;
    }
    if (!window.MediaRecorder) {
      try { window.ProChatNative.onVoiceError('这个浏览器不支持录音，请用输入法自带的麦克风'); } catch (e) {}
      return;
    }

    var mime = pickMime();
    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      var mr;
      try {
        mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        mr = new MediaRecorder(stream);
      }
      var chunks = [];
      var ctx = null;
      // Safari 需要在用户手势里创建 AudioContext，否则解码会被挂起
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      } catch (e) { ctx = null; }

      mr.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      mr.onstop = function () {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        var type = mr.mimeType || mime || 'audio/webm';
        var blob = new Blob(chunks, { type: type });
        var started = rec ? rec.started : Date.now();
        rec = null;
        if (blob.size < 2000 || Date.now() - started < 400) {
          try { window.ProChatNative.onVoiceError('录音太短，请按住说完一句再结束'); } catch (e) {}
          if (ctx) { try { ctx.close(); } catch (e) {} }
          return;
        }
        try { window.ProChatNative.onVoiceEnd(); } catch (e) {}
        say('正在识别…');
        transcribe(blob, type, o, ctx);
      };

      rec = { mr: mr, stream: stream, started: Date.now(), ctx: ctx };
      mr.start(250);
      try { window.ProChatNative.onVoiceStart(); } catch (e) {}

      // 60 秒自动结束，和安卓版一致
      rec.timer = setTimeout(function () { stopVoice(); }, 60000);
    }).catch(function (err) {
      rec = null;
      var m = '麦克风打不开';
      if (err && err.name === 'NotAllowedError') m = '没有麦克风权限，请到浏览器设置里允许';
      else if (err && err.name === 'NotFoundError') m = '没有找到麦克风';
      else if (err && err.name === 'SecurityError' || !window.isSecureContext) m = '需要用 https 打开才能录音';
      try { window.ProChatNative.onVoiceError(m); } catch (e) {}
    });
  }

  function stopVoice() {
    stopSpeech();
    if (!rec) return;
    clearTimeout(rec.timer);
    try { if (rec.mr.state !== 'inactive') rec.mr.stop(); } catch (e) {}
  }

  function cancelVoice() {
    stopSpeech();
    if (!rec) return;
    clearTimeout(rec.timer);
    try { if (rec.mr.state !== 'inactive') rec.mr.stop(); } catch (e) {}
    rec = null;
  }

  // 把任意音频解码成 16k 单声道 WAV：所有转写接口都认这个格式
  function toWav(blob, ctx) {
    return blob.arrayBuffer().then(function (buf) {
      if (!ctx) throw new Error('no-ctx');
      return new Promise(function (resolve, reject) {
        var p = ctx.decodeAudioData(buf, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }).then(function (audio) {
      var srcRate = audio.sampleRate;
      var chs = audio.numberOfChannels;
      var src = audio.getChannelData(0);
      if (chs > 1) {
        var b = audio.getChannelData(1);
        var mixed = new Float32Array(src.length);
        for (var i = 0; i < src.length; i++) mixed[i] = (src[i] + b[i]) / 2;
        src = mixed;
      }
      var dstRate = 16000;
      var ratio = srcRate / dstRate;
      var len = Math.max(1, Math.floor(src.length / ratio));
      var out = new Int16Array(len);
      for (var n = 0; n < len; n++) {
        var pos = n * ratio;
        var i0 = Math.floor(pos);
        var i1 = Math.min(i0 + 1, src.length - 1);
        var frac = pos - i0;
        var v = src[i0] * (1 - frac) + src[i1] * frac;
        v = Math.max(-1, Math.min(1, v));
        out[n] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      return encodeWav(out, dstRate);
    });
  }

  function encodeWav(pcm, rate) {
    var dataLen = pcm.length * 2;
    var buf = new ArrayBuffer(44 + dataLen);
    var v = new DataView(buf);
    function str(off, s) {
      for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    }
    str(0, 'RIFF');
    v.setUint32(4, 36 + dataLen, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, dataLen, true);
    var off = 44;
    for (var i = 0; i < pcm.length; i++, off += 2) v.setInt16(off, pcm[i], true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  function transcribe(blob, type, o, ctx) {
    var prep;
    if (ctx) {
      prep = toWav(blob, ctx).catch(function () {
        // 解码失败就原样上传，至少还有机会成功
        return blob;
      });
    } else {
      prep = Promise.resolve(blob);
    }

    prep.then(function (audio) {
      var isWav = audio.type === 'audio/wav';
      var ext = isWav ? 'wav' : extOf(type);

      var fd = new FormData();
      fd.append('model', o.model || 'whisper-1');
      var lc = langCode(o.lang);
      if (lc) fd.append('language', lc);
      fd.append('file', audio, 'voice.' + ext);

      var headers = {};
      if (o.apiKey) headers['Authorization'] = 'Bearer ' + o.apiKey;
      if (o.headers && typeof o.headers === 'object') {
        Object.keys(o.headers).forEach(function (k) {
          if (o.headers[k]) headers[k] = String(o.headers[k]);
        });
      }

      return fetch(endpoint(o.baseUrl, 'audio/transcriptions'), {
        method: 'POST', headers: headers, body: fd,
        mode: 'cors', cache: 'no-store', credentials: 'omit'
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ' · ' + prettyError(t));
        });
      }
      return res.text();
    }).then(function (text) {
      var out = parseText(text);
      if (!out) throw new Error('没有识别到文字，再说一次');
      try { window.ProChatNative.onVoice(out, true); } catch (e) {}
    }).catch(function (err) {
      try { window.ProChatNative.onVoiceError(corsHint(err)); } catch (e) {}
    }).finally(function () {
      if (ctx) { try { ctx.close(); } catch (e) {} }
    });
  }

  function parseText(raw) {
    var t = String(raw || '').trim();
    if (!t) return '';
    try {
      var o = JSON.parse(t);
      var s = o.text || (o.data && o.data.text) || o.result || '';
      if (s) return String(s).trim();
      return '';
    } catch (e) {}
    return t.charAt(0) === '{' || t.charAt(0) === '[' ? '' : t;
  }

  /* ------------------------------------------------------------ 返回拦截 */
  // 网页版把「打开浮层」映射成一条 history 记录，
  // 这样浏览器 / 系统的返回手势等于关闭浮层，和安卓版行为一致。
  var panelOpen = false;
  var backHooked = false;

  function pushPanelState() {
    if (history.state && history.state.pcPanel) return;
    try { history.pushState({ pcPanel: 1 }, ''); } catch (e) {}
  }

  function setBackIntercept(open) {
    panelOpen = !!open;
    if (!panelOpen) return;
    pushPanelState();
    if (backHooked) return;
    backHooked = true;
    window.addEventListener('popstate', function () {
      if (!panelOpen) return;                  // 没有浮层，让浏览器正常返回
      try {
        if (window.ProChatNative && window.ProChatNative.onBack) window.ProChatNative.onBack();
      } catch (e) {}
      // onBack 会同步回调 setBackIntercept；还有浮层就补一条记录，让下次返回继续关
      if (panelOpen) pushPanelState();
    });
  }

  /* ------------------------------------------------------------ 系统栏 / 屏幕 */
  function setSystemBars(dark, bg) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', bg || (dark ? '#0B0E14' : '#F5F7FB'));
  }

  var wakeLock = null;
  function keepAwake(on) {
    if (!navigator.wakeLock) return;
    if (on) {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
      }).catch(function () {});
    } else if (wakeLock) {
      try { wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }

  /* ------------------------------------------------------------ 键盘 / 视口 */
  function setupViewport() {
    var vv = window.visualViewport;
    var root = document.documentElement;
    var lastH = 0;

    function apply() {
      var h = vv ? vv.height : window.innerHeight;
      if (!h || Math.abs(h - lastH) < 1) return;
      lastH = h;
      root.style.setProperty('--app-h', Math.round(h) + 'px');

      // 可视高度明显小于窗口高度，说明键盘弹出来了
      var kb = h < window.innerHeight - 120;
      var app = document.getElementById('app');
      if (app) app.classList.toggle('kb-open', kb);

      var ta = document.getElementById('ta');
      if (document.activeElement === ta) {
        setTimeout(function () {
          var sc = document.getElementById('scroll');
          if (sc) sc.scrollTop = sc.scrollHeight;
        }, 50);
      }
    }

    if (vv) {
      vv.addEventListener('resize', apply);
      vv.addEventListener('scroll', apply);
    }
    window.addEventListener('orientationchange', function () {
      setTimeout(apply, 120);
    });
    apply();

    // iOS 独立模式下键盘收起时偶尔会留下空白，补一次重算
    document.addEventListener('focusout', function () { setTimeout(apply, 80); });
  }

  /* ------------------------------------------------------------ 对外接口 */
  window.Native = {
    platform: function () { return 'web'; },
    appInfo: function () {
      return JSON.stringify({
        version: VERSION,
        versionCode: 99999,
        sdk: 0,
        model: IS_IOS ? 'iOS' : 'Web',
        speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        standalone: STANDALONE
      });
    },

    getStore: lsGet,
    setStore: setStore,
    removeStore: lsDel,
    clearStore: function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(P) === 0) localStorage.removeItem(k);
        });
      } catch (e) {}
    },

    getSecret: function (k) { return lsGet('sec:' + k); },
    setSecret: function (k, v) { lsSet('sec:' + k, v); },
    removeSecret: function (k) { lsDel('sec:' + k); },
    clearSecrets: function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(P + 'sec:') === 0) localStorage.removeItem(k);
        });
      } catch (e) {}
    },

    httpGet: function (id, url) { doHttp(id, url, 'GET'); },
    httpPost: function (id, url, body) { doHttp(id, url, 'POST', body); },

    ask: ask,
    stop: stop,
    listModels: listModels,

    toast: say,
    log: function (m) { console.log('[js]', m); },
    copy: copy,
    share: share,
    openUrl: function (u) {
      try { window.open(u, '_blank', 'noopener'); } catch (e) { location.href = u; }
    },
    setBackIntercept: setBackIntercept,
    setSystemBars: setSystemBars,
    keepAwake: keepAwake,

    pickImage: pickImage,
    saveAssetImage: saveAssetImage,

    startVoice: startVoice,
    stopVoice: stopVoice
  };

  // app.js 会在浮层开关时反复调用 setBackIntercept，状态记在闭包里即可

  setupViewport();
})();
