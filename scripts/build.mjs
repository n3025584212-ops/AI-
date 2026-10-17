import { mkdirSync, existsSync, readdirSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = path.join(root, 'tmp', 'build');
mkdirSync(temp, { recursive: true });
// Vite output shares its parent with immutable versioned deliveries. Remove
// only prior generated output, and never follow a directory link or touch competition.
const output = path.join(root, 'dist');
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || realpathSync(output).toLowerCase() !== output.toLowerCase()) throw new Error('Unexpected build output path.');
  const targets = readdirSync(output).filter(name => name !== 'competition').map(name => path.resolve(output, name));
  for (const target of targets) {
    if (path.dirname(target) !== output || lstatSync(target).isSymbolicLink()) throw new Error('Build cleanup target is outside generated output.');
    rmSync(target, { recursive: true, force: true });
  }
}
const child = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp },
});
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
