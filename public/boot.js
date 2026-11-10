/* QCDKR 启动页控制器（复刻 _run/2159-启动页.mp4）
   满屏启动层：厂房底图 + 左上品牌 + 左下大标语 + 右侧「系统装载确认」卡。
   卡内四行装载项按真实就绪信号点亮（传递中 → 已就绪），
   进度线里的填充物就是 /assets/boot-loop.mp4 本身（mp4 画面即进度条）。
   装载完成 → 整层淡出，最后一页 = React 渲染的登录页。
   就绪信号：runtime / data(#root 有子节点) / scene(底图解码 + 登录页已渲染) / login(密码框可用)
   最短 3.0s，兜底 22s，点击/按键跳过。 */
(function () {
  var boot = document.getElementById('boot');
  if (!boot) return;
  var qs = new URLSearchParams(location.search);
  if (qs.get('boot') === '0') { boot.remove(); return; }
  var hold = qs.get('boot') === 'hold';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var num = document.getElementById('boot-num'),
      msg = document.getElementById('boot-msg'),
      code = document.getElementById('boot-code'),
      vid = document.getElementById('boot-video'),
      track = document.getElementById('boot-track');

  var t0 = performance.now();
  var MIN = reduce ? 900 : 3000;
  var MIN_AT = { runtime: 420, data: 980, scene: 1560, login: 2180 };
  var CAP = 22000;
  var state = { runtime: false, data: false, scene: false, login: false };
  var done = false, left = false, aligned = false;

  var PCT = { runtime: 14, data: 38, scene: 68, login: 94 };
  var MSG = {
    runtime: '运行时校验通过 → 挂载工作台',
    data: '工作台已挂载 → 载入厂房场景',
    scene: '厂房场景资源就绪 → 打开登录',
    login: '装载完成，正在进入登录'
  };

  var factory = new Image();
  var factoryOk = false;
  factory.onload = function () { factoryOk = true; };
  factory.onerror = function () { factoryOk = true; };
  factory.src = '/assets/factory-preview.png';

  var dur = 1.533, pendingSeek = null;
  if (vid) {
    vid.addEventListener('loadedmetadata', function () {
      if (vid.duration && isFinite(vid.duration)) dur = vid.duration;
      if (pendingSeek !== null) { seek(pendingSeek); pendingSeek = null; }
    });
    vid.addEventListener('error', function () {
      if (track) track.classList.add('fallback');
      vid.style.display = 'none';
    });
  }

  function seek(p) {
    if (!vid) return;
    var t = Math.max(0, Math.min(dur - 0.034, (p / 100) * dur));
    if (vid.readyState < 1) { pendingSeek = p; return; }
    try { if (Math.abs(vid.currentTime - t) > 0.02) vid.currentTime = t; } catch (e) {}
  }

  function align() {
    if (aligned) return;
    aligned = true;
    boot.classList.add('aligned');
  }

  function setProgress(p) {
    boot.style.setProperty('--p', p);
    if (num) num.textContent = p;
    seek(p);
  }

  function step(key) {
    if (state[key]) return;
    state[key] = true;
    var li = boot.querySelector('li[data-k="' + key + '"]');
    if (li) {
      li.classList.add('on');
      var b = li.querySelector('b');
      if (b) b.textContent = '已就绪';
    }
    if (MSG[key] && msg) msg.textContent = MSG[key];
    setProgress(PCT[key]);
  }

  function removeAll() {
    if (left) return;
    left = true; done = true;
    document.removeEventListener('click', skip, true);
    document.removeEventListener('keydown', skip, true);
    var b = document.getElementById('boot'); if (b) b.remove();
    window.__qcdkrBootDone = true;
  }

  function inWorkspace() {
    return !!(document.querySelector('.app-shell') || document.querySelector('.sidebar') || document.querySelector('.topbar'));
  }

  function loginReady() {
    return !!(document.querySelector('input[type=password]') || document.querySelector('.login-screen'));
  }

  function probe() {
    if (done) return;
    var now = performance.now() - t0;
    var root = document.getElementById('root');
    var hasLogin = !!document.querySelector('.login-screen');

    if (inWorkspace() && now > 1200) return removeAll();

    align();
    if (!state.runtime && document.readyState !== 'loading' && now >= MIN_AT.runtime) step('runtime');
    if (state.runtime && !state.data && root && root.childElementCount > 0 && now >= MIN_AT.data) step('data');
    if (state.data && !state.scene && factoryOk && hasLogin && now >= MIN_AT.scene) step('scene');
    if (state.scene && !state.login && loginReady() && now >= MIN_AT.login) step('login');
    if (state.runtime && state.data && state.scene && state.login && now >= MIN) return finish(false);
    if (now > CAP) return finish(true);
    setTimeout(probe, 120);
  }

  function finish(forced) {
    if (done) return;
    done = true;
    ['runtime', 'data', 'scene', 'login'].forEach(function (k) {
      var li = boot.querySelector('li[data-k="' + k + '"]');
      if (li) {
        li.classList.add('on');
        var b = li.querySelector('b');
        if (b) b.textContent = '已就绪';
      }
    });
    align();
    setProgress(100);
    if (msg) msg.textContent = '装载完成';
    setTimeout(function () {
      boot.classList.add('is-out');
      setTimeout(function () { if (boot.parentNode) boot.remove(); }, 620);
      window.__qcdkrBootDone = true;
    }, reduce ? 120 : 620);
  }

  function skip(e) {
    if (left) return;
    if (performance.now() - t0 < 180) return;
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (done) { removeAll(); return; }
    finish(true);
  }

  // 进入工作台（.login-screen 消失）后把启动层撤掉
  setInterval(function () {
    if (left) return;
    if (inWorkspace()) {
      var b = document.getElementById('boot'); if (b) b.remove();
      left = true; done = true; window.__qcdkrBootDone = true;
    }
  }, 400);

  if (!hold) {
    document.addEventListener('click', skip, true);
    document.addEventListener('keydown', skip, true);
    setTimeout(probe, 100);
  } else {
    align();
    ['runtime', 'data', 'scene', 'login'].forEach(function (k, i) {
      setTimeout(function () { step(k); }, 420 + i * 260);
    });
    setTimeout(function () { setProgress(100); if (msg) msg.textContent = '装载完成'; }, 2200);
  }

  setTimeout(function () {
    if (code) code.textContent = 'BOOT 0x' + (0x2A + Math.floor(Math.random() * 6)).toString(16).toUpperCase();
  }, 900);
})();
