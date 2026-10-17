import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Builder skips its normal two-pass uninstaller flow for custom scripts.
// Restore that same Windows-only flow for our locked, offline template.
// This hook is process-local; node_modules and frozen application files stay untouched.
export function installOfflineNsisHook(root) {
  if (process.platform !== 'win32') throw new Error('This packaging entry requires Windows x64');
  const require = createRequire(path.join(root, 'package.json'));
  if (require('app-builder-lib/package.json').version !== '26.15.3') throw new Error('Offline NSIS adapter requires locked builder 26.15.3');
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
  const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
  const execute = promisify(execFile);
  NsisTarget.prototype.computeScriptAndSignUninstaller = async function(defines, commands, installerPath, sharedHeader, archs) {
    const filename = path.resolve(root, this.options.script || '');
    if (filename !== path.join(root, 'tmp/offline-nsis/installer.nsi')) throw new Error('Only the generated offline template is authorized');
    const template = await readFile(filename, 'utf8');
    const payloadBytes = String((await stat(defines.APP_64)).size);
    const unpackedBytes = Number(defines.APP_64_UNPACKED_SIZE) * 1024;
    if (!Number.isSafeInteger(unpackedBytes) || unpackedBytes < 1) throw new Error('Missing exact application disk requirement');
    const script = '!define OFFLINE_PAYLOAD_BYTES "' + payloadBytes + '"\n!define OFFLINE_UNPACKED_BYTES "' + unpackedBytes + '"\n' + template;
    const uninstaller = path.join(this.outDir, path.basename(installerPath, 'exe') + '__uninstaller.exe');
    // Bound ZIP extraction to the exact payload size before any old install is touched.
    defines.BUILD_UNINSTALLER = null;
    defines.UNINSTALLER_OUT_FILE = uninstaller;
    await this.executeMakensis(defines, commands, sharedHeader + await this.computeFinalScript(script, false, archs));
    await execute(installerPath, [], { windowsHide: true, env: {...process.env, __COMPAT_LAYER: 'RunAsInvoker'} });
    await this.packager.signIf(uninstaller);
    delete defines.BUILD_UNINSTALLER;
    defines.UNINSTALLER_OUT_FILE = uninstaller;
    return { script, isCustomScript: true };
  };
  return () => { NsisTarget.prototype.computeScriptAndSignUninstaller = original; };
}
