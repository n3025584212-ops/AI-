const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
// Electron treats .asar paths as virtual directories; check the archive file
// through its unpatched filesystem instead of resolving an empty ASAR entry.
let archiveFs=fs;
try {archiveFs=require('original-fs').promises;} catch { /* Node test runtime. */ }

async function knownShortcutFolders() {
  const command = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @{desktop=[Environment]::GetFolderPath("DesktopDirectory");programs=[Environment]::GetFolderPath("Programs")} | ConvertTo-Json -Compress';
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const {stdout} = await execute(powershell, ['-NoProfile','-NonInteractive','-Command',command], {windowsHide:true,timeout:10000,encoding:'utf8'});
  const folders = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!folders.desktop || !folders.programs || !path.isAbsolute(folders.desktop) || !path.isAbsolute(folders.programs)) throw new Error('Windows快捷方式目录不可用。');
  return folders;
}

async function ensureInstalledShortcuts({app,shell,platform=process.platform,executable=process.execPath,foldersForUser=knownShortcutFolders,desktopEnabled}) {
  if (platform !== 'win32' || !app.isPackaged) return {status:'SKIPPED'};
  const target = path.resolve(executable);
  if (path.basename(target).toLowerCase() !== 'qcdkr.exe') throw new Error('快捷方式目标不是安装版QCDKR.exe。');
  await fs.access(target);
  await archiveFs.access(path.join(path.dirname(target),'resources','app.asar'));
  if(desktopEnabled===undefined){
    try{await archiveFs.access(path.join(path.dirname(target),'desktop-shortcut.disabled'));desktopEnabled=false;}
    catch(error){if(error.code!=='ENOENT')throw error;desktopEnabled=true;}
  }
  const folders = await foldersForUser(),links=[];
  for (const folder of [...(desktopEnabled?[folders.desktop]:[]),folders.programs]) {
    await fs.mkdir(folder,{recursive:true});
    const linkPath = path.join(folder,'QCDKR.lnk');
    let previous=null,exists=false;
    try {await fs.access(linkPath);exists=true;try{previous=shell.readShortcutLink(linkPath);}catch{/* Broken link needs repair. */}}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if (previous && path.resolve(previous.target).toLowerCase()===target.toLowerCase() && !(previous.args || '')) {
      links.push({path:linkPath,target,status:'VERIFIED'});continue;
    }
    if (exists) await fs.copyFile(linkPath,linkPath+'.backup-'+require('node:crypto').randomUUID());
    const details={target,args:'',cwd:path.dirname(target),icon:target,iconIndex:0,appUserModelId:'com.dkqkar.studio',
      description:'AI大模型与量子机器学习协同驱动的冷轧轧制力预测云平台'};
    if (!shell.writeShortcutLink(linkPath,exists?'replace':'create',details)) throw new Error('无法写入快捷方式：'+linkPath);
    const verified=shell.readShortcutLink(linkPath);
    if(path.resolve(verified.target).toLowerCase()!==target.toLowerCase() || (verified.args || ''))throw new Error('快捷方式目标核验失败：'+linkPath);
    links.push({path:linkPath,target,status:'REPAIRED'});
  }
  return {status:'READY',links};
}
module.exports={ensureInstalledShortcuts,knownShortcutFolders};
