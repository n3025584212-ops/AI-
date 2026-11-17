/* QCDKR 开场 / 厂房加载层控制器
   叙事：接收访问请求 → 运行时校验 → 工作台挂载 → 厂房场景载入 → 预测模型校验 → 校验通过 → WELCOME。
   进度由真实就绪信号驱动（DOM / app-shell / __qcdkr3d / model status），
   同时作为 3D 厂房与预测模型的加载缓冲；完成后整层淡出进入控制台。
   不使用任何实体标识。开关：?boot=0 关闭；?boot=hold 定格。 */
(function () {
  var boot = document.getElementById('boot');
  if (!boot) return;

  var qs = new URLSearchParams(location.search);
  if (qs.get('boot') === '0') { boot.remove(); return; }
  var hold = qs.get('boot') === 'hold';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 2026-11-18：开屏画面每次访问都完整播放，不再为“已登录”折叠成裸进度条；
  // boot 仍作为厂房与模型的缓冲层，进度改由真实装配百分比驱动。
  if (sessionStorage.getItem('obSkipNext') === '1') { sessionStorage.removeItem('obSkipNext'); boot.remove(); return; }
  var AUTHED = null; // null=还没问过服务端，false=确认未登录
  fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { AUTHED = !!(j && j.authenticated); if (j && j.setupRequired) enableSetup(); })
    .catch(function () {});

  var el = {
    steps: document.getElementById('ob-steps'),
    num: document.getElementById('ob-num'),
    msg: document.getElementById('ob-msg'),
    ring: document.getElementById('ob-ring'),
    pct: document.getElementById('ob-pct'),
    vtitle: document.getElementById('ob-vtitle'),
    vsub: document.getElementById('ob-vsub'),
    status: document.getElementById('ob-status'),
    welcome: document.getElementById('ob-welcome')
  };

  var state = { runtime: false, app: false, scene: false, model: false };
  var TARGET = { runtime: 16, app: 44, scene: 70, model: 92 };
  var MIN_AT = { runtime: 400, app: 1500, scene: 2600, model: 3800 };
  var target = 0, shown = 0, done = false, startedAt = performance.now();
  var appAt = 0, checkingModel = false, timer = 0;
  var awaitingLogin = false, loginShown = false;
  var loginEl = document.getElementById('ob-login-form');
  var loginForm = document.getElementById('ob-login-form');
  var loginUser = document.getElementById('ob-user');
  var loginPass = document.getElementById('ob-pass');
  var loginPass2 = document.getElementById('ob-pass2');
  var loginPass2Field = document.getElementById('ob-pass2-field');
  var loginTitle = document.getElementById('ob-login-title');
  var loginSub = document.getElementById('ob-login-sub');
  var loginBtn = document.getElementById('ob-login-btn');
  var loginErr = document.getElementById('ob-login-err');
  var setupMode = false;
  var MIN = 5200;
  var CAP = 10000;

  // 2026-11-17：首次部署（还没有账户）不再让人用写死的 rollcraft 登录，
  // 直接在开屏登录卡里创建自定义账号；创建成功后自动登录并进入工作台。
  function enableSetup() {
    if (setupMode) return;
    setupMode = true;
    if (loginTitle) loginTitle.textContent = '创建本机账户';
    if (loginSub) loginSub.textContent = 'FIRST-RUN SETUP · LOCAL';
    if (loginPass2Field) loginPass2Field.style.display = 'flex';
    if (loginUser) { loginUser.value = ''; loginUser.placeholder = '自定义用户名'; }
    if (loginPass) { loginPass.value = ''; loginPass.placeholder = '设置密码（至少 8 位）'; }
    if (loginBtn) loginBtn.textContent = '创建并进入';
    if (el.status) status('首次部署：请创建本机管理员账号。');
  }
  function disableSetup() {
    setupMode = false;
    if (loginTitle) loginTitle.textContent = '操作员登录';
    if (loginSub) loginSub.textContent = 'OPERATOR SIGN-IN · LOCAL';
    if (loginPass2Field) loginPass2Field.style.display = 'none';
    if (loginUser) loginUser.placeholder = '';
    if (loginPass) loginPass.placeholder = '';
    if (loginBtn) loginBtn.textContent = '登 录';
  }

  function view(title, sub) {
    if (el.vtitle) el.vtitle.textContent = title;
    if (el.vsub) el.vsub.textContent = sub;
  }
  function status(text) {
    if (el.status) el.status.textContent = text;
    if (el.msg) el.msg.textContent = text;
  }
  function paint() {
    var v = Math.max(0, Math.min(100, Math.round(shown)));
    boot.style.setProperty('--p', v);
    if (el.num) el.num.textContent = v;
    if (el.pct) el.pct.textContent = v;
    if (el.ring) el.ring.style.setProperty('--rp', v);
  }
  function tick() {
    var d = target - shown;
    if (Math.abs(d) < 0.2) shown = target;
    else shown += d * 0.09;
    paint();
    if (done && shown >= 99.9) { clearInterval(timer); timer = 0; }
  }
  function aim(v) {
    target = Math.max(target, v);
    if (!timer) timer = setInterval(tick, 70);
  }

  function step(key) {
    if (state[key]) return;
    state[key] = true;
    var li = el.steps && el.steps.querySelector('li[data-k="' + key + '"]');
    if (li) {
      li.classList.add('on');
      var b = li.querySelector('b');
      if (b) b.textContent = '已就绪';
    }
    aim(TARGET[key]);
    if (key === 'runtime') { view('读取本地运行时', 'LOCAL RUNTIME CHECK'); status('正在校验本地运行时…'); }
    if (key === 'app') { view('载入工作台', 'MOUNTING WORKSPACE'); status('正在载入工作台…'); }
    if (key === 'scene') { boot.classList.add('scene-ready'); view('载入厂房场景', 'LOADING FACTORY SCENE'); status('正在载入厂房数字孪生场景…'); }
    if (key === 'model') { view('校验预测模型', 'VERIFYING MODEL'); status('正在校验预测模型…'); }
  }
  function allReady() { return state.runtime && state.app && state.scene && state.model; }

  function checkModel() {
    if (state.model || checkingModel) return;
    checkingModel = true;
    fetch('/api/model/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.available === true) step('model'); })
      .catch(function () {})
      .then(function () { checkingModel = false; });
  }

  function finish(reason) {
    if (done) return;
    done = true;
    window.__obDebug = { reason: reason || 'unknown', at: Math.round(performance.now() - startedAt) };
    ['runtime', 'app', 'scene', 'model'].forEach(function (k) {
      if (!state[k]) return;
      var li = el.steps && el.steps.querySelector('li[data-k="' + k + '"]');
      if (li) {
        li.classList.add('on');
        var b = li.querySelector('b');
        if (b) b.textContent = '已就绪';
      }
    });
    shown = 100; target = 100;
    if (timer) { clearInterval(timer); timer = 0; }
    paint();
    view('读取完毕 · 校验通过', 'VERIFIED · ACCESS GRANTED');
    status('读取完毕 · 校验通过，正在进入工作台…');
    setTimeout(function () {
      boot.classList.add('is-out');
      setTimeout(function () { if (boot.parentNode) boot.remove(); }, 820);
    }, reduce ? 260 : 1150);
  }

  function markAllReady() {
    ['runtime', 'app', 'scene', 'model'].forEach(function (k) {
      var li = el.steps && el.steps.querySelector('li[data-k="' + k + '"]');
      if (li) {
        li.classList.add('on');
        var b = li.querySelector('b');
        if (b) b.textContent = '已就绪';
      }
    });
  }


  var handoffStarted = false;
  function requestHandout() {
    if (handoffStarted || setupMode) return;
    handoffStarted = true;
    try {
      var fp = deviceFingerprint();
      fetch('/api/auth/handout?fingerprint=' + encodeURIComponent(fp), { cache: 'no-store', credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || !x.j || !x.j.username) return;
          if (loginUser && !loginUser.value) {
            loginUser.value = x.j.username;
            if (loginPass) loginPass.value = x.j.password || '';
            if (loginSub) loginSub.textContent = '已自动分配 · 点击登录';
            status('已自动分配账号 ' + x.j.username + '，点击登录。');
          }
        }).catch(function () { handoffStarted = false; });
    } catch (e) { handoffStarted = false; }
  }
  function enterLogin() {
    if (loginShown || done) return;
    loginShown = true;
    awaitingLogin = true;
    markAllReady();
    shown = 100; target = 100;
    if (timer) { clearInterval(timer); timer = 0; }
    paint();
    view('等待登录', 'AWAITING SIGN-IN');
    status('校验通过，请使用本地账户登录。');
    boot.classList.add('login-stage');
    if (!setupMode) requestHandout();
    setTimeout(function () {
      if (loginPass) { try { loginPass.focus(); loginPass.select(); } catch (e) {} }
    }, 450);
  }

  // 登录阶段曾把进度拉到 100%；登录成功后要回到真实装配进度，否则会停在 100% 却还在加载。
  function resumeProgress() {
    if (timer) { clearInterval(timer); timer = 0; }
    shown = TARGET.app;
    target = TARGET.app;
    paint();
    if (!done) timer = setInterval(tick, 70);
  }

  function loginError(msg) {
    if (loginErr) {
      loginErr.textContent = msg;
      loginErr.classList.add('show');
    }
    if (loginEl) {
      loginEl.classList.remove('shake');
      void loginEl.offsetWidth;
      loginEl.classList.add('shake');
    }
  }


  // 与 src/browserFingerprint.js 完全一致：boot 与 React 登录必须绑定同一个指纹。
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
const hex = bytes => Array.from(bytes).map(value => value.toString(16).padStart(2, '0')).join('');

function sha256HexSync(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  const output = new Uint8Array(32);
  const outView = new DataView(output.buffer);
  state.forEach((value, index) => outView.setUint32(index * 4, value));
  return hex(output);
}

  function fpCanvas() {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 60;
      var ctx = canvas.getContext('2d');
      if (!ctx) return 'no-canvas';
      ctx.textBaseline = 'top';
      ctx.font = '14px "Arial"';
      ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 240, 60);
      ctx.fillStyle = '#069'; ctx.fillText('QCDKR·冷轧·fingerprint', 4, 8);
      ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('QCDKR·冷轧·fingerprint', 6, 22);
      return canvas.toDataURL().slice(-160);
    } catch (e) { return 'canvas-error'; }
  }
  function fpWebgl() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'no-webgl';
      var debug = gl.getExtension('WEBGL_debug_renderer_info');
      return [gl.getParameter(gl.VENDOR), gl.getParameter(gl.RENDERER),
        debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : '',
        debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : ''].map(function (v) { return String(v == null ? '' : v); }).join('~');
    } catch (e) { return 'webgl-error'; }
  }
  function deviceFingerprint() {
    var nav = navigator || {}, s = screen || {}, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var signals = [nav.userAgent, nav.language, (nav.languages || []).join(','), nav.platform,
      nav.hardwareConcurrency, nav.deviceMemory, s.width, s.height, s.colorDepth, s.pixelDepth,
      tz, fpCanvas(), fpWebgl()];
    return sha256HexSync(signals.map(function (v) { return String(v == null ? '' : v); }).join('|'));
  }

  if (loginForm) {
    loginForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (done) return;
      var username = loginUser ? loginUser.value.replace(/^\s+|\s+$/g, '') : '';
      var password = loginPass ? loginPass.value : '';
      if (!username || !password) { loginError('请输入用户名和密码'); return; }
      if (setupMode) {
        if (password.length < 8) { loginError('密码至少 8 位'); return; }
        if (!loginPass2 || loginPass2.value !== password) { loginError('两次输入的密码不一致'); return; }
      }
      if (loginErr) { loginErr.classList.remove('show'); loginErr.textContent = ''; }
      if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = setupMode ? '创建中…' : '验证中…'; }
      var created = setupMode
        ? fetch('/api/auth/setup', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password, passwordConfirmation: loginPass2 ? loginPass2.value : '' })
          }).then(function (r) {
            if (r.status === 409) { disableSetup(); loginError('本机已有账户，请直接登录。'); return false; }
            if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (j) { loginError(j.message || '创建账户失败，请重试。'); return false; }); }
            return true;
          })
        : Promise.resolve(true);
      created.then(function (ok) {
        if (!ok) { if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = setupMode ? '创建并进入' : '登 录'; } return; }
        return fetch('/api/auth/login', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password, remember: true, fingerprint: deviceFingerprint() })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var msg = j.code === 'ACCOUNT_BOUND' ? '该账号已绑定其他浏览器，不能在此设备登录。'
              : j.code === 'FINGERPRINT_REQUIRED' ? '无法识别当前浏览器，请换用 Chrome / Edge 重试。'
              : setupMode ? '账户已创建，但自动登录失败；请用刚才的密码登录。' : '用户名或密码错误，请重新输入。';
            loginError(msg);
            if (setupMode) disableSetup();
            if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '登 录'; }
            return;
          }
          if (loginBtn) loginBtn.textContent = '已验证';
          status('登录成功，正在载入厂房与预测模型…');
          boot.classList.remove('login-stage');
          awaitingLogin = false;
          AUTHED = true;
          resumeProgress();
          try { window.dispatchEvent(new Event('dkqkar-session-changed')); } catch (e) {}
          setTimeout(probe, 180);
          });
        });
      }).catch(function () {
        loginError('本地登录服务暂不可用，请稍后重试。');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = setupMode ? '创建并进入' : '登 录'; }
      });
    });
  }

  function probe() {
    if (done || awaitingLogin) return;
    var now = performance.now() - startedAt;

    if (!state.runtime && document.readyState !== 'loading' && now >= MIN_AT.runtime) step('runtime');
    if (state.runtime && !state.app && document.querySelector('.app-shell') && now >= MIN_AT.app) { step('app'); appAt = now; }
    // 2026-11-18：进度条跟着三维装配的真实百分比走（44% → 66%），
    // 不再长时间卡在 44% 让人以为页面死了。
    var st3d = window.__qcdkr3dStatus;
    if (state.app && !state.scene && st3d && typeof st3d.percent === 'number') {
      var p3d = Math.max(0, Math.min(100, st3d.percent));
      aim(TARGET.app + p3d / 100 * (TARGET.scene - TARGET.app - 6));
      if (st3d.message) status(st3d.message + ' ' + Math.round(p3d) + '%');
    }
    var api3d = window.__qcdkr3d;
    var sc3d = api3d && api3d.scene;
    var factoryReady = false;
    if (sc3d) {
      factoryReady = sc3d.children.some(function (c) {
        return /Factory_Blender_Assets|Factory_Hall_Blender|DKQKAR_5Stand_Web|Factory_Plant_Extension|EngineerB|Mill_Detail_Pass/.test(c.name || '');
      });
    }
    if (state.app && !state.scene && api3d && document.querySelector('#root canvas') && factoryReady && now >= MIN_AT.scene) step('scene');
    // 兜底只在 45s 后才把 scene 标成就绪；云端 2C 装配厂房要 20s+，
    // 原来 15s 就放行会把工作台自己的“装配 Blender 厂房…”加载页露出来。
    if (state.app && !state.scene && appAt && now - appAt > 45000) step('scene');
    // 三维装配报错时不再干等：提前交给工作台自己的重试界面
    if (state.app && !state.scene && st3d && st3d.phase === 'error' && appAt && now - appAt > 6000) step('scene');
    if (state.scene && !state.model && now >= MIN_AT.model) checkModel();
    if (state.scene && !state.model && now > MIN + 2600) step('model');

    if (AUTHED === false && now > MIN) return enterLogin(); // 开屏动画播完再落到登录/首次创建框
    if (allReady() && now > MIN) return AUTHED === false ? enterLogin() : finish('authed');
    // 已登录/会话待确认时，boot 只当厂房缓冲层：等 scene+model 真正就绪再进。
    // 以前这里只要 .app-shell 出现就 finish，云端于是先露出工作台的“读取设备模型…”加载页。
    if (now > 60000) return AUTHED === false ? enterLogin() : finish('slow');
    setTimeout(probe, 180);
  }

  function skip(e) {
    if (done || awaitingLogin || AUTHED) return;
    if (e && e.isTrusted === false) return;
    if (performance.now() - startedAt < 320) return;
    if (e) e.preventDefault();
    enterLogin();
  }

  if (hold) {
    shown = 68; target = 68; paint();
    ['runtime', 'app', 'scene'].forEach(function (k) {
      state[k] = true;
      var li = el.steps && el.steps.querySelector('li[data-k="' + k + '"]');
      if (li) {
        li.classList.add('on');
        var b = li.querySelector('b');
        if (b) b.textContent = '已就绪';
      }
    });
    view('校验预测模型', 'VERIFYING MODEL');
    status('正在校验预测模型…');
    return;
  }

  if (qs.get('boot') === 'login') { setTimeout(enterLogin, 400); return; }

  document.addEventListener('pointerdown', skip, true);
  document.addEventListener('keydown', skip, true);
  setTimeout(probe, 80);
})();
