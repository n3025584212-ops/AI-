import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const OFFLINE_PAYLOAD_NAME = 'QCDKR_Competition_Resources.7z';

export function offlinePayloadHashScript() {
  return `param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference='Stop'
$taskStream=$null
$taskHasher=$null
try {
  $taskStream=[IO.File]::OpenRead($Payload)
  $taskHasher=New-Object System.Security.Cryptography.SHA512Cng
  [Console]::Write([BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-',''))
  exit 0
} catch {
  [Console]::Error.WriteLine('Offline payload verification failed.')
  exit 1
} finally {
  if($null -ne $taskStream){$taskStream.Dispose()}
  if($null -ne $taskHasher){$taskHasher.Dispose()}
}
`;
}

// Shared by the production installer and the isolated native installer tests.
export function offlineSafetyMacros() {
  return `!include "FileFunc.nsh"
!ifndef BUILD_UNINSTALLER
Var offlinePayloadSource
Var offlinePayloadPath
!endif

!macro checkOfflinePayload
  InitPluginsDir
  File "/oname=$PLUGINSDIR\\hash-offline-payload.ps1" "\${OFFLINE_HASH_SCRIPT}"
  File "/oname=$PLUGINSDIR\\resolve-offline-payload.ps1" "\${OFFLINE_RESOLVE_SCRIPT}"
  StrCpy $R6 "$WINDIR\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"
  IfFileExists "$R6" +2
    StrCpy $R6 "$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"
  \${GetParameters} $R9
  \${GetOptions} $R9 "--offline-source=" $offlinePayloadSource
  StrCmp $offlinePayloadSource "" 0 offline_resolve_source
  IfFileExists "$EXEDIR\\${OFFLINE_PAYLOAD_NAME}" 0 offline_select_source
  StrCpy $offlinePayloadSource "$EXEDIR\\${OFFLINE_PAYLOAD_NAME}"
  Goto offline_resolve_source

  offline_select_source:
  IfSilent offline_missing_source
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "未在安装器旁找到配套资源。$\\r$\\n$\\r$\\n请选择 ${OFFLINE_PAYLOAD_NAME}，也可选择收到的完整程序 ZIP（无需先解压）。$\\r$\\n$\\r$\\n如果正在压缩包内启动，请选择原来的程序 ZIP。安装过程无需联网；原安装尚未卸载。" /SD IDCANCEL IDCANCEL offline_missing_source
  nsDialogs::SelectFileDialog open "" "离线资源或完整程序包 (*.7z;*.zip)|*.7z;*.zip|所有文件 (*.*)|*.*"
  Pop $offlinePayloadSource
  StrCmp $offlinePayloadSource "" offline_missing_source

  offline_resolve_source:
  DetailPrint "正在读取离线资源包，请稍候…"
  # This is owned temporary output, never the user's selected resource file.
  Delete "$PLUGINSDIR\\resolved-payload\\${OFFLINE_PAYLOAD_NAME}"
  Delete "$PLUGINSDIR\\offline-payload-path.txt"
  nsExec::ExecToStack '"$R6" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\resolve-offline-payload.ps1" -Source "$offlinePayloadSource" -Destination "$PLUGINSDIR\\resolved-payload" -Result "$PLUGINSDIR\\offline-payload-path.txt" -ExpectedBytes \${OFFLINE_PAYLOAD_BYTES} -InstallDirectory "$INSTDIR" -UnpackedBytes \${OFFLINE_UNPACKED_BYTES}'
  Pop $R7
  Pop $R8
  StrCmp $R7 "0" 0 offline_source_error
  ClearErrors
  FileOpen $R9 "$PLUGINSDIR\\offline-payload-path.txt" r
  IfErrors offline_source_error
  FileSeek $R9 2 SET
  FileReadUTF16LE $R9 $offlinePayloadPath
  FileClose $R9
  IfErrors offline_source_error
  IfFileExists "$offlinePayloadPath" 0 offline_source_error
  DetailPrint "正在校验离线资源包，请稍候…"
  nsExec::ExecToStack '"$R6" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\hash-offline-payload.ps1" -Payload "$offlinePayloadPath"'
  Pop $R7
  Pop $R8
  StrCmp $R7 "0" 0 offline_source_error
  StrCmp $R8 "\${APP_64_HASH}" 0 offline_source_error
  DetailPrint "资源包校验通过，正在安装…"
  Goto offline_payload_ready

  offline_source_error:
  IfSilent offline_invalid_source
  MessageBox MB_RETRYCANCEL|MB_ICONSTOP "离线资源无法读取或与此安装器不匹配。请确认收到的是完整程序包，并检查文件可读性、临时磁盘空间及 Windows PowerShell。$\\r$\\n$\\r$\\n点击重试可重新选择配套的 .7z 或完整程序 ZIP。原安装尚未卸载。" /SD IDCANCEL IDRETRY offline_select_source
  offline_invalid_source:
  SetErrorLevel 3
  Quit

  offline_missing_source:
  SetErrorLevel 2
  Quit
  offline_payload_ready:
!macroend

!macro requireOfflineFile FILE
  IfFileExists "\${FILE}" +4
    MessageBox MB_OK|MB_ICONSTOP "安装文件不完整：\${FILE}。请检查磁盘空间并重新安装。" /SD IDOK
    SetErrorLevel 4
    Quit
!macroend

!macro verifyOfflineInstallation
  !insertmacro requireOfflineFile "$INSTDIR\\QCDKR.exe"
  !insertmacro requireOfflineFile "$INSTDIR\\resources\\app.asar"
  !insertmacro requireOfflineFile "$INSTDIR\\resources\\model-runtime\\python.exe"
  !insertmacro requireOfflineFile "$INSTDIR\\resources\\model-runtime\\python312.dll"
  !insertmacro requireOfflineFile "$INSTDIR\\resources\\models\\s5-dkqkar.pkl"
  !insertmacro requireOfflineFile "$INSTDIR\\resources\\app.asar.unpacked\\server\\model_runtime.py"
!macroend

!macro writeOfflineShortcut LINK TARGET
  ClearErrors
  CreateShortCut "\${LINK}" "\${TARGET}" "" "\${TARGET}" 0 "" "" "\${APP_DESCRIPTION}"
  IfErrors 0 +4
    MessageBox MB_OK|MB_ICONSTOP "无法创建快捷方式：\${LINK}。程序已安装到 $INSTDIR，请检查桌面或开始菜单的写入权限。" /SD IDOK
    SetErrorLevel 5
    Quit
  WinShell::SetLnkAUMI "\${LINK}" "\${APP_ID}"
  !insertmacro requireOfflineFile "\${LINK}"
!macroend
`;
}

// Adapt only the locked builder's installation layer, keeping app identity/data.
export async function prepareOfflineNsis(root, { sevenZipPath } = {}) {
  const templates = path.join(root, 'node_modules/app-builder-lib/templates/nsis');
  const out = path.join(root, 'tmp/offline-nsis');
  mkdirSync(out, { recursive: true });
  const read = name => readFileSync(path.join(templates, name), 'utf8');
  const nsisPath = name => path.join(out, name);
  function replaceOnce(source, before, after) {
    if (source.split(before).length !== 2) throw new Error('Unexpected locked NSIS template: ' + before);
    return source.replace(before, after);
  }
  writeFileSync(nsisPath('offline-safety.nsh'), offlineSafetyMacros());
  // The legacy StdUtils SHA-512 implementation is very slow on multi-GB files.
  // Use the built-in Windows CNG provider; retain the builder's exact SHA-512.
  writeFileSync(nsisPath('hash-offline-payload.ps1'), offlinePayloadHashScript());
  writeFileSync(nsisPath('resolve-offline-payload.ps1'), readFileSync(path.join(root, 'scripts/resolve-offline-payload.ps1')));
  // Extract the verified archive directly onto the installation drive.

  // This avoids a second full application copy in the system temporary folder.
  const require = createRequire(path.join(root, 'package.json'));
  const archiver = sevenZipPath || await require('app-builder-lib/out/toolsets/7zip').getPath7za();
  writeFileSync(nsisPath('offline-7za.exe'), readFileSync(archiver));
  const extraction = `!macro extractUsing7za FILE
  File "/oname=$PLUGINSDIR\\offline-7za.exe" "\${OFFLINE_7ZA_EXEC}"
  DetailPrint "正在解压离线资源，请稍候…"
  nsExec::ExecToStack '"$PLUGINSDIR\\offline-7za.exe" x "\${FILE}" -o"$OUTDIR" -y -bso0 -bsp0'
  Pop $R7
  Pop $R8
  StrCmp $R7 "0" offline_extraction_complete
  MessageBox MB_OK|MB_ICONSTOP "离线资源解压失败。请检查安装目录的空间、写入权限及文件占用，然后重新安装。" /SD IDOK
  SetErrorLevel 4
  Quit
  offline_extraction_complete:
!macroend
`;
  writeFileSync(nsisPath('offline-extraction.nsh'), extraction);
  let functions = read('include/installer.nsh');
  const start = functions.indexOf('!macro installApplicationFiles');
  const end = functions.indexOf('!macro registryAddInstallInfo');
  if (start < 0 || end <= start) throw new Error('Unexpected installer function boundaries');
  const offlineInstall = `!macro installApplicationFiles
  !insertmacro extractUsing7za "$offlinePayloadPath"
  !insertmacro verifyOfflineInstallation
  File "/oname=\${UNINSTALL_FILENAME}" "\${UNINSTALLER_OUT_FILE}"
!macroend

!macro repairOfflineShortcuts
  \${if} $installMode == "all"
    SetShellVarContext all
  \${else}
    SetShellVarContext current
  \${endif}
  # Re-resolve paths after the old uninstaller has finished. It can remove a
  # shortcut directory; Known Folders may also point to a redirected desktop.
  StrCpy $newDesktopLink "$DESKTOP\\\${SHORTCUT_NAME}.lnk"
  !ifdef MENU_FILENAME
    StrCpy $newStartMenuLink "$SMPROGRAMS\\\${MENU_FILENAME}\\\${SHORTCUT_NAME}.lnk"
  !else
    StrCpy $newStartMenuLink "$SMPROGRAMS\\\${SHORTCUT_NAME}.lnk"
  !endif
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    CreateDirectory "$SMPROGRAMS"
    !insertmacro cleanupOldMenuDirectory
    !insertmacro createMenuDirectory
    !insertmacro writeOfflineShortcut "$newStartMenuLink" "$appExe"
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    \${ifNot} \${isNoDesktopShortcut}
      Delete "$INSTDIR\\desktop-shortcut.disabled"
      CreateDirectory "$DESKTOP"
      !insertmacro writeOfflineShortcut "$newDesktopLink" "$appExe"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    \${else}
      # Preserve the explicit installer opt-out across the app's first launch.
      ClearErrors
      FileOpen $R9 "$INSTDIR\\desktop-shortcut.disabled" w
      IfErrors 0 +4
        MessageBox MB_OK|MB_ICONSTOP "无法保存快捷方式设置，请检查安装目录写入权限。" /SD IDOK
        SetErrorLevel 5
        Quit
      FileWrite $R9 "no-desktop-shortcut"
      FileClose $R9
    \${endif}
  !endif
!macroend

`;
  // No download path or unverified --package-file override is allowed.
  functions = `!include "${nsisPath('offline-extraction.nsh')}"\n\n` + offlineInstall + functions.slice(end);
  if (/webPackage|downloadApplicationFiles|APP_PACKAGE_URL|inetc::/.test(functions)) throw new Error('Network installer path must be absent');
  writeFileSync(nsisPath('offline-functions.nsh'), functions);
  let section = read('installSection.nsh');
  section = replaceOnce(section, '!include installer.nsh', `!include "${nsisPath('offline-functions.nsh')}"`);
  // Progress page is already visible. Check once BEFORE touching the old install.
  section = replaceOnce(section, 'StrCpy $appExe', 'SetDetailsPrint textonly\n!insertmacro checkOfflinePayload\n\nStrCpy $appExe');
  section = replaceOnce(section, '!insertmacro addStartMenuLink $keepShortcuts\n!insertmacro addDesktopLink $keepShortcuts', '!insertmacro repairOfflineShortcuts');
  writeFileSync(nsisPath('offline-section.nsh'), section);
  let installer = read('installer.nsi');
  installer = replaceOnce(installer, '!include "installSection.nsh"', `!include "${nsisPath('offline-section.nsh')}"`);
  // Macros must be defined before the section; .onInit performs no full hash.
  installer = replaceOnce(installer, 'Function .onInit', `!define OFFLINE_HASH_SCRIPT "${nsisPath('hash-offline-payload.ps1')}"\n!define OFFLINE_RESOLVE_SCRIPT "${nsisPath('resolve-offline-payload.ps1')}"\n!define OFFLINE_7ZA_EXEC "${nsisPath('offline-7za.exe')}"\n!include "${nsisPath('offline-safety.nsh')}"\n\nFunction .onInit`);
  writeFileSync(nsisPath('installer.nsi'), installer);
  return nsisPath('installer.nsi');
}
