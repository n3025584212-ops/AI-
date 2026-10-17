const { contextBridge, ipcRenderer } = require('electron');

// Keep the renderer sandboxed; expose fixed, sender-validated desktop actions.
contextBridge.exposeInMainWorld('dkqkarDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  saveReportPdf: () => ipcRenderer.invoke('dkqkar:save-report-pdf'),
  printReport: () => ipcRenderer.invoke('dkqkar:print-report'),
  setSceneFullscreen: (expanded) => ipcRenderer.invoke('dkqkar:scene-fullscreen', expanded === true),
  onSceneFullscreenChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, expanded) => callback(expanded === true);
    ipcRenderer.on('dkqkar:scene-fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('dkqkar:scene-fullscreen-changed', listener);
  },
}));

// Fixed renderer-only refresh channels; never expose generic IPC or process control.
contextBridge.exposeInMainWorld('dkqkar',Object.freeze({
  refreshWorkspace:()=>ipcRenderer.invoke('dkqkar:refresh-workspace'),
  reloadRenderer:()=>ipcRenderer.invoke('dkqkar:reload-renderer'),
  onRefreshWorkspace:callback=>{
    if(typeof callback!=='function')return()=>{};
    const listener=()=>callback();
    ipcRenderer.on('dkqkar:refresh-workspace-request',listener);
    return()=>ipcRenderer.removeListener('dkqkar:refresh-workspace-request',listener);
  },
}));
