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
  if (sessionStorage.getItem('obSkipNext') === '1') { sessionStorage.removeItem('obSkipNext'); boot.remove(); return; }
  var AUTHED = null; // null=还没问过服务端，false=确认未登录
  fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { AUTHED = !!(j && j.authenticated); })
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
  var loginBtn = document.getElementById('ob-login-btn');
  var loginErr = document.getElementById('ob-login-err');
  var MIN = 5200;
  var CAP = 10000;

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
    if (key === 'scene') { view('载入厂房场景', 'LOADING FACTORY SCENE'); status('正在载入厂房数字孪生场景…'); }
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
    setTimeout(function () {
      if (loginPass) { try { loginPass.focus(); loginPass.select(); } catch (e) {} }
    }, 450);
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

  if (loginForm) {
    loginForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (done) return;
      var username = loginUser ? loginUser.value.replace(/^\s+|\s+$/g, '') : '';
      var password = loginPass ? loginPass.value : '';
      if (!username || !password) { loginError('请输入用户名和密码'); return; }
      if (loginErr) { loginErr.classList.remove('show'); loginErr.textContent = ''; }
      if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '验证中…'; }
      fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password, remember: true })
      }).then(function (r) {
        if (!r.ok) {
          loginError('用户名或密码错误，请重新输入。');
          if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '登 录'; }
          return;
        }
        if (loginBtn) loginBtn.textContent = '已验证';
        status('登录成功，正在进入工作台…');
        sessionStorage.setItem('obSkipNext', '1');
        setTimeout(function () { location.reload(); }, 320);
      }).catch(function () {
        loginError('本地登录服务暂不可用，请稍后重试。');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = '登 录'; }
      });
    });
  }

  function probe() {
    if (done || awaitingLogin) return;
    var now = performance.now() - startedAt;

    if (!state.runtime && document.readyState !== 'loading' && now >= MIN_AT.runtime) step('runtime');
    if (state.runtime && !state.app && document.querySelector('.app-shell') && now >= MIN_AT.app) { step('app'); appAt = now; }
    var api3d = window.__qcdkr3d;
    var sc3d = api3d && api3d.scene;
    var factoryReady = false;
    if (sc3d) {
      factoryReady = sc3d.children.some(function (c) {
        return /Factory_Blender_Assets|Factory_Hall_Blender|DKQKAR_5Stand_Web|Factory_Plant_Extension|EngineerB|Mill_Detail_Pass/.test(c.name || '');
      });
    }
    if (state.app && !state.scene && api3d && document.querySelector('#root canvas') && factoryReady && now >= MIN_AT.scene) step('scene');
    if (state.app && !state.scene && appAt && now - appAt > 15000) step('scene');
    if (state.scene && !state.model && now >= MIN_AT.model) checkModel();
    if (state.scene && !state.model && now > MIN + 2600) step('model');

    if (AUTHED === false && now > MIN) return enterLogin(); // 确认未登录就直接进登录页，不等厂房/模型（原来卡在 16% 等满 10 秒）
    if (allReady() && now > MIN) return AUTHED ? finish('authed') : enterLogin();
    if (AUTHED && now > MIN && document.querySelector('.app-shell')) return finish('authed');
    if (now > CAP) return enterLogin();
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
