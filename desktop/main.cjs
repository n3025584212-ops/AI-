const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes, randomUUID } = require('node:crypto');
const { createWindowLifecycle } = require('./window-lifecycle.cjs');
const { createRendererRefresh } = require('./renderer-refresh.cjs');
const { ensureInstalledShortcuts } = require('./installed-shortcuts.cjs');
let rendererRefresh = null;

const packageMetadata = require('../package.json');
const TITLE = packageMetadata.productName || packageMetadata.build?.productName || 'QCDKR';
const { ensureLocalLlm, stopOwned: stopOwnedLlm, warmupLocalLlm } = require('./local-llm.cjs');
let mainWindow = null;
let mainLifecycle = null;
let backend = null;
let appOrigin = '';
let quitting = false;
let pdfBusy = false;
let sceneFullscreenExpected = false;

function ownURL(raw) {
  try { return new URL(raw).origin === appOrigin; } catch { return false; }
}
function externalURL(raw) {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
function downloadableURL(raw) {
  if (!ownURL(raw)) return false;
  const url = new URL(raw);
  return url.protocol === 'blob:' || /\.(?:glb|gltf|json|csv|xlsx|docx|pptx|pdf|png|jpe?g|webp|zip)$/i.test(url.pathname);
}
function openExternal(raw) {
  if (externalURL(raw)) void shell.openExternal(raw).catch(() => showError('打开链接失败', '请检查系统默认浏览器设置。'));
}
function showError(title, message) {
  if (mainLifecycle?.isAlive()) void dialog.showMessageBox(mainWindow, { type: 'error', title, message, buttons: ['知道了'] });
}
function trustedIPC(event) {
  return mainLifecycle?.isAlive() && event.sender === mainLifecycle.contents
    && event.senderFrame === mainLifecycle.contents.mainFrame && ownURL(event.senderFrame.url);
}
async function reportReady(window, lifecycle) {
  if (!lifecycle?.isAlive()) return false;
  let ready;
  try { ready = await lifecycle.contents.executeJavaScript('Boolean(document.getElementById("report-paper"))'); }
  catch (error) { if (!lifecycle.isAlive()) return false; throw error; }
  if (!lifecycle.isAlive()) return false;
  if (!ready) {
    try { await dialog.showMessageBox(window, { type: 'info', title: '打开报告中心', message: '请先进入“报告中心”，选择报告内容后再打印或保存 PDF。', buttons: ['知道了'] }); }
    catch (error) { if (!lifecycle.isAlive()) return false; throw error; }
  }
  return lifecycle.isAlive() && ready;
}
async function saveReportPdf() {
  if (pdfBusy) return { canceled: true };
  const printWindow = mainWindow;
  const lifecycle = mainLifecycle;
  pdfBusy = true;
  try {
    if (!(await reportReady(printWindow, lifecycle)) || !lifecycle.isAlive()) return { canceled: true };
    const selected = await dialog.showSaveDialog(printWindow, {
      title: '保存工艺分析报告', buttonLabel: '保存 PDF',
      defaultPath: path.join(app.getPath('documents'), 'DKQKAR_工艺分析报告.pdf'),
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (!lifecycle.isAlive() || selected.canceled || !selected.filePath) return { canceled: true };
    const filename = /\.pdf$/i.test(selected.filePath) ? selected.filePath : `${selected.filePath}.pdf`;
    const previousBackground = printWindow.getBackgroundColor();
    let bytes;
    try {
      // Chromium leaves page margins transparent; give the native print surface
      // a paper background instead of the dark workspace window's background.
      printWindow.setBackgroundColor('#ffffff');
      bytes = await lifecycle.contents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, displayHeaderFooter: false });
    } finally {
      if (!printWindow.isDestroyed()) printWindow.setBackgroundColor(previousBackground);
    }
    if (!lifecycle.isAlive()) return { canceled: true };
    await fs.writeFile(filename, bytes);
    return { canceled: false, filePath: filename };
  } catch {
    if (!lifecycle?.isAlive()) return { canceled: true };
    showError('PDF 保存失败', '请检查保存位置是否可写，然后重试。');
    return { canceled: false, error: 'PDF 保存失败' };
  } finally { pdfBusy = false; }
}
async function printReport() {
  const window = mainWindow;
  const lifecycle = mainLifecycle;
  if (!(await reportReady(window, lifecycle)) || !lifecycle.isAlive()) return { canceled: true };
  return new Promise(resolve => lifecycle.contents.print({ silent: false, printBackground: true }, (success, reason) => {
    if (!lifecycle.isAlive()) { resolve({ canceled: true }); return; }
    if (!success && !/cancel/i.test(reason || '')) showError('打印失败', '请检查打印机设置，也可以使用“另存报告为 PDF”。');
    resolve({ success, canceled: !success && /cancel/i.test(reason || '') });
  }));
}

function setMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '另存报告为 PDF…', accelerator: 'CmdOrCtrl+Shift+S', click: () => void saveReportPdf() },
      { label: '打印报告…', accelerator: 'CmdOrCtrl+P', click: () => void printReport() },
      { type: 'separator' },
      { label: '打开本地数据文件夹', click: () => void shell.openPath(path.join(app.getPath('userData'), 'data')) },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ] },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
    ] },
    { label: '视图', submenu: [
      { label: '刷新当前工作台', accelerator:'CmdOrCtrl+R', click:()=>rendererRefresh?.refreshWorkspace() }, { type: 'separator' },
      { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
      { type: 'separator' }, { label: '切换全屏', role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ type: 'separator' }, { label: '开发者工具', role: 'toggleDevTools' }] : []),
    ] },
    { label: '帮助', submenu: [{ label: '关于 '+TITLE, click: () => void dialog.showMessageBox(mainWindow, {
      type: 'info', title: '关于 '+TITLE, message: TITLE,
      detail: `版本 ${app.getVersion()}\n五机架工况分析、方案优化与三维可视化。\n当前模型状态与计算模式见预测工作台。`, buttons: ['关闭'],
    }) }] },
  ]));
}

async function downloadBytes(contents, url) {
  const limit = 256 * 1024 * 1024;
  if (url.startsWith('blob:')) {
    // Read the renderer-owned Blob immediately, before its object URL expires.
    const base64 = await contents.executeJavaScript(`(async () => {
      const response = await fetch(${JSON.stringify(url)});
      if (!response.ok) throw new Error('Export data is unavailable');
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > ${limit}) throw new Error('Export data is too large');
      const chunks = [];
      for (let offset = 0; offset < data.length; offset += 32768) chunks.push(String.fromCharCode(...data.subarray(offset, offset + 32768)));
      return btoa(chunks.join(''));
    })()`);
    return Buffer.from(base64, 'base64');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Export data is unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error('Export data is too large');
  return bytes;
}

function saveDownload(window, lifecycle, event, item) {
    const url = item.getURL();
    const suggested = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'DKQKAR_导出文件';
    event.preventDefault();
    if (!lifecycle.isAlive() || !ownURL(url)) return;
    const extension = path.extname(suggested).slice(1);
    // Native Node writes also work on Windows hosts that interrupt Chromium's
    // download file service. No renderer-supplied filesystem path is accepted.
    const data = downloadBytes(lifecycle.contents, url).then(bytes => ({ bytes }), error => ({ error }));
    void (async () => {
      let temporary;
      try {
        const selected = await dialog.showSaveDialog(window, {
          title: '保存导出文件', buttonLabel: '保存', defaultPath: path.join(app.getPath('downloads'), suggested),
          ...(extension ? { filters: [{ name: extension.toUpperCase() + ' 文件', extensions: [extension] }, { name: '所有文件', extensions: ['*'] }] } : {}),
        });
        if (!lifecycle.isAlive() || selected.canceled || !selected.filePath) return;
        const result = await data;
        if (!lifecycle.isAlive()) return;
        if (result.error) throw result.error;
        temporary = path.join(path.dirname(selected.filePath), `.${path.basename(selected.filePath)}.${process.pid}-${Date.now()}.tmp`);
        await fs.writeFile(temporary, result.bytes);
        if (!lifecycle.isAlive()) { await fs.unlink(temporary); return; }
        await fs.rename(temporary, selected.filePath);
      } catch (error) {
        if (temporary) await fs.unlink(temporary).catch(() => {});
        if (!lifecycle.isAlive()) return;
        console.error(`${TITLE} export failed: ${error.message}`);
        showError('导出未完成', '文件保存失败，请检查保存位置和剩余磁盘空间后重试。');
      }
    })();
}

async function createWindow() {
  const appPath = app.getAppPath();
  await fs.access(path.join(appPath, 'dist', 'index.html'));
  const { startServer } = await import(pathToFileURL(path.join(appPath, 'server', 'index.mjs')).href);
  // This credential stays in trusted main-process memory. It is never a URL,
  // command-line argument, preload API, file, or renderer-visible setting.
  const authToken = randomBytes(32).toString('hex');
  backend = await startServer({ port: 0, accessMode: 'desktop', authToken,
    dataDir: path.join(app.getPath('userData'), 'data'), distDir: path.join(appPath, 'dist'),
    modelBaseDir: app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(appPath, 'models') });
  appOrigin = `http://127.0.0.1:${backend.address().port}`;
  // Finish the real model startup before Chromium loads the renderer and 3D assets.
  // The worker keeps its existing 30-second deadline and failures stay explicit.
  const modelStartedAt = Date.now();
  const modelStatus = await backend.prepareModel();
  const modelStartup = { timestamp: new Date().toISOString(), version: app.getVersion(),
    elapsedMs: Date.now() - modelStartedAt, available: modelStatus.available,
    status: modelStatus.status, reason: modelStatus.reason, model_hash: modelStatus.model_hash };
  try {
    const logDirectory = path.join(app.getPath('userData'), 'logs');
    const logPath = path.join(logDirectory, 'model-startup.json');
    await fs.mkdir(logDirectory, { recursive: true });
    await fs.writeFile(logPath + '.tmp', JSON.stringify(modelStartup, null, 2) + '\n');
    await fs.rename(logPath + '.tmp', logPath);
  } catch { /* A diagnostics write cannot prevent the application opening. */ }
  if (!modelStatus.available) console.error(`DK-QKAR model startup: ${modelStatus.reason}`);
  void ensureLocalLlm({resourcesPath:process.resourcesPath,appPath,isPackaged:app.isPackaged,logDirectory:path.join(app.getPath('userData'),'logs')})
    .then(status => { if (status?.online) return warmupLocalLlm(); })
    .then(warmed => { if (warmed === false) console.error('Local AI warmup: model did not load in the background window'); })
    .catch(error=>console.error('Local AI startup:',error.message));
  mainWindow = new BrowserWindow({
    title: TITLE, width: 1280, height: 900, minWidth: 1000, minHeight: 720,
    backgroundColor: '#081421', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: {color:'#061725',symbolColor:'#a5cee6',height:30}, autoHideMenuBar:true,
    icon: path.join(appPath, 'dist', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      partition: 'persist:dkqkar-desktop',
    },
  });
  const window = mainWindow;
  const lifecycle = createWindowLifecycle(window, { origin: appOrigin, authToken,
    onDownload: (event, item) => saveDownload(window, lifecycle, event, item) });
  mainLifecycle = lifecycle;
  rendererRefresh = createRendererRefresh(lifecycle);
  const contents = lifecycle.contents;
  const cancelNavigation = { keepOnInvalidate: true, onCanceled: event => event.preventDefault() };
  for (const eventName of ['enter-full-screen', 'leave-full-screen']) {
    lifecycle.on(window, eventName, () => {
      // A focus-stealing window can kick the app out of OS fullscreen while
      // the renderer keeps the expanded view; sceneFullscreenExpected + the
      // focus handler below restore the requested state on the next focus.
      sceneFullscreenExpected = eventName === 'enter-full-screen';
      contents.send('dkqkar:scene-fullscreen-changed', eventName === 'enter-full-screen');
    });
  }
  lifecycle.on(window, 'focus', () => {
    // A foreign window can silently drop the OS fullscreen without the
    // renderer noticing (expanded view stuck under a titlebar). The next
    // time the operator returns to the app, restore the requested state.
    // Destroyed check must come first: focus can fire while the window tears
    // down during quit, and touching a destroyed object throws.
    if (window.isDestroyed() || !sceneFullscreenExpected || window.isFullScreen()) return;
    window.setFullScreen(true);
  });
  lifecycle.on(contents, 'page-title-updated', event => { event.preventDefault(); window.setTitle(TITLE); });
  lifecycle.on(contents, 'will-navigate', (event, legacyURL) => {
    const url = event.url || legacyURL;
    if (downloadableURL(url)) { event.preventDefault(); contents.downloadURL(url); return; }
    if (!ownURL(url)) { event.preventDefault(); openExternal(url); return; }
    if (new URL(url).pathname.startsWith('/api/')) event.preventDefault();
  }, false, cancelNavigation);
  lifecycle.on(contents, 'will-redirect', (event, legacyURL) => {
    const url = event.url || legacyURL;
    if (!ownURL(url)) event.preventDefault();
  }, false, cancelNavigation);
  lifecycle.on(contents, 'will-frame-navigate', event => {
    if (!event.isMainFrame || !ownURL(event.url)) event.preventDefault();
  }, false, cancelNavigation);
  lifecycle.on(contents, 'will-attach-webview', event => event.preventDefault(), false, cancelNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (!lifecycle.isAlive()) return { action: 'deny' };
    if (downloadableURL(url)) contents.downloadURL(url);
    else if (!ownURL(url)) openExternal(url);
    return { action: 'deny' };
  });
  lifecycle.on(window, 'ready-to-show', () => { window.show(); window.focus(); }, true);
  window.once('closed', () => {
    lifecycle.dispose();
    if (mainWindow === window) { mainWindow = null; mainLifecycle = null; }
    app.quit();
  });
  try { await window.loadURL(appOrigin); }
  catch (error) { if (lifecycle.isAlive()) throw error; }
}

function shutdown() {
  if (quitting) return;
  quitting = true;
  mainLifecycle?.invalidate();
  stopOwnedLlm();
  const server = backend;
  backend = null;
  if (!server) { app.exit(0); return; }
  server.closeResources?.();
  const deadline = setTimeout(() => { server.closeAllConnections?.(); app.exit(0); }, 1500);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); app.exit(0); });
  server.closeIdleConnections?.();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.dkqkar.studio');
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); shutdown(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    // Installation completion starts this EXE. Recover missing/old links for
    // the actual current user, including a redirected desktop or a D: install.
    // Shortcut failure is logged separately and cannot prevent the app opening.
    void ensureInstalledShortcuts({app,shell}).then(async result=>{
      if(result.status==='SKIPPED')return;
      const directory=path.join(app.getPath('userData'),'logs');await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(path.join(directory,'installed-shortcuts.json'),JSON.stringify(result,null,2));
    }).catch(async error=>{
      console.error('QCDKR shortcut check:',error.message);
      try{const directory=path.join(app.getPath('userData'),'logs');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'installed-shortcuts.json'),JSON.stringify({status:'FAILED',message:error.message},null,2));}catch{}
    });
    ipcMain.handle('dkqkar:refresh-workspace',event=>trustedIPC(event)?rendererRefresh?.refreshWorkspace():{error:'请求来源无效'});
    ipcMain.handle('dkqkar:reload-renderer',event=>trustedIPC(event)?rendererRefresh?.reloadRenderer():{error:'请求来源无效'});
    ipcMain.handle('dkqkar:save-report-pdf', event => trustedIPC(event) ? saveReportPdf() : { error: '请求来源无效' });
    ipcMain.handle('dkqkar:print-report', event => trustedIPC(event) ? printReport() : { error: '请求来源无效' });
    ipcMain.handle('dkqkar:scene-fullscreen', (event, expanded) => {
      if (!trustedIPC(event) || typeof expanded !== 'boolean' || !mainWindow || mainWindow.isDestroyed()) return { error: '请求来源无效' };
      mainWindow.setFullScreen(expanded);
      sceneFullscreenExpected = expanded;
      return { expanded };
    });
    Menu.setApplicationMenu(null);
    await createWindow();
  }).catch(error => {
    console.error(`${TITLE} desktop startup failed: ${error.code || error.name}: ${error.message}`);
    dialog.showErrorBox(TITLE+' 启动失败', '应用资源或本地数据目录未能打开。源码运行请先执行 npm run build；安装版请检查安装文件是否完整。');
    shutdown();
  });
}
