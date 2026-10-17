import { access, readFile, writeFile, mkdir, rename, mkdtemp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = filename => access(filename).then(() => true, () => false);

function confined(root, candidate) {
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Electron install path is outside its project workspace.');
  return absolute;
}

function run(executable, args, { cwd, env, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', outputBytes = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    for (const [stream, which] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 1024 * 1024) { child.kill(); return; }
      if (which === 'stdout') stdout += bytes.toString(); else stderr += bytes.toString();
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Electron installer timed out.'));
      else if (outputBytes > 1024 * 1024) reject(new Error('Electron installer produced too much output.'));
      else if (code !== 0) reject(new Error(stderr.trim() || stdout.trim() || `Electron process exited ${code}.`));
      else resolve(stdout.trim());
    });
  });
}

export async function verifyElectronArchive(filename, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Missing official Electron archive checksum.');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  const actual = digest.digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error('Official Electron archive SHA256 mismatch.');
  return actual;
}

async function actualVersion(executable, env, root) {
  const result = await run(executable, ['-p', 'process.versions.electron'], {
    cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20000,
  });
  return result;
}

/** Ensure the packaged dependency and the actual Windows x64 executable match. */
export async function ensureElectron({ root = projectRoot, log = console.log } = {}) {
  root = path.resolve(root);
  if (process.platform !== 'win32') throw new Error('This delivery helper currently supports Windows x64 only.');
  const moduleRoot = confined(root, path.join(root, 'node_modules', 'electron'));
  const metadata = JSON.parse(await readFile(path.join(moduleRoot, 'package.json'), 'utf8'));
  const version = metadata.version;
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('A stable pinned Electron version is required.');
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (project.devDependencies?.electron !== version) throw new Error('The installed Electron package must match the exact pinned project version.');
  const temp = confined(root, path.join(root, 'tmp', 'electron-runtime'));
  await mkdir(temp, { recursive: true });
  const env = { ...process.env, TEMP: temp, TMP: temp, ELECTRON_INSTALL_ARCH: 'x64', ELECTRON_INSTALL_PLATFORM: 'win32' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME',
    'electron_use_remote_checksums', 'npm_config_electron_use_remote_checksums', 'npm_config_arch', 'npm_config_platform']) delete env[key];
  const electronDist = confined(root, path.join(moduleRoot, 'dist'));
  const executable = path.join(electronDist, 'electron.exe');
  async function installed() {
    if (!await exists(executable)) return false;
    try {
      if ((await readFile(path.join(electronDist, 'version'), 'utf8')).trim().replace(/^v/, '') !== version) return false;
      return await actualVersion(executable, env, root) === version;
    } catch { return false; }
  }
  if (await installed()) {
    log(`Verified installed Electron ${version}.`);
    return { version, executable, electronDist, method: 'verified-installed' };
  }

  let normalFailure = null;
  log(`Installing Electron ${version} from its pinned package.`);
  try {
    await run(process.execPath, [path.join(moduleRoot, 'install.js')], { cwd: root, env });
    if (!await installed()) throw new Error('Electron installer did not produce the expected executable version.');
    log(`Verified Electron ${version} after its normal installer.`);
    return { version, executable, electronDist, method: 'electron-installer' };
  } catch (error) {
    normalFailure = error.message;
    log('Electron installer failed; checking the official GitHub archive with PowerShell.');
  }

  const artifact = `electron-v${version}-win32-x64.zip`;
  const checksums = JSON.parse(await readFile(path.join(moduleRoot, 'checksums.json'), 'utf8'));
  const expected = checksums[artifact];
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Pinned Electron package lacks the official Windows archive checksum.');
  const archive = confined(root, path.join(temp, artifact));
  const stage = confined(root, await mkdtemp(path.join(temp, 'verified-dist-')));
  const script = confined(root, path.join(temp, 'install-official.ps1'));
  await writeFile(script, `param([string]$Url,[string]$Archive,[string]$Destination,[string]$Expected)\n$ErrorActionPreference='Stop'\nImport-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Management\\Microsoft.PowerShell.Management.psd1')\nImport-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')\nImport-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Archive\\Microsoft.PowerShell.Archive.psd1')\nif (-not (Test-Path -LiteralPath $Archive)) { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Archive -TimeoutSec 180 }\n$Actual=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()\nif ($Actual -ne $Expected) { throw 'Official Electron archive SHA256 mismatch' }\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n`, 'utf8');
  // Invalid cached bytes are retained with a different name for diagnosis.
  if (await exists(archive)) {
    try { await verifyElectronArchive(archive, expected); }
    catch { await rename(archive, confined(root, `${archive}.invalid-${randomUUID()}`)); }
  }
  await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Url', `https://github.com/electron/electron/releases/download/v${version}/${artifact}`,
      '-Archive', archive, '-Destination', stage, '-Expected', expected], { cwd: root, env, timeout: 240000 });
  const archiveSha256 = await verifyElectronArchive(archive, expected);
  if ((await readFile(path.join(stage, 'version'), 'utf8')).trim().replace(/^v/, '') !== version
    || await actualVersion(path.join(stage, 'electron.exe'), env, root) !== version) {
    throw new Error('Official Electron archive contains an unexpected executable version.');
  }
  // All moved directories have been resolved under root. Preserve any prior
  // partial distribution so failure cannot silently destroy the previous files.
  let previous;
  if (await exists(electronDist)) {
    previous = confined(root, path.join(temp, `previous-dist-${randomUUID()}`));
    await rename(electronDist, previous);
  }
  try { await rename(stage, electronDist); }
  catch (error) { if (previous) await rename(previous, electronDist); throw error; }
  await writeFile(path.join(moduleRoot, 'path.txt'), 'electron.exe', 'utf8');
  if (!await installed()) throw new Error('Electron executable verification failed after installation.');
  await writeFile(path.join(temp, 'installation-result.json'), JSON.stringify({ version, method: 'official-powershell', archiveSha256, normalFailure }, null, 2) + '\n');
  log(`Verified official Electron ${version} archive and executable.`);
  return { version, executable, electronDist, method: 'official-powershell', archiveSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureElectron().catch(error => { console.error(error.message); process.exitCode = 1; });
}
