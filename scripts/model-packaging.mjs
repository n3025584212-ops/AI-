import { checkRuntime } from './check-runtime.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { caseToModelValues } from '../server/model-service.mjs';

export function ensureModelRuntime({root}) {
  checkRuntime(root);
  return JSON.parse(readFileSync(path.join(root,'model-runtime/runtime-manifest.json'),'utf8'));
}

function inventory(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) return [];
    const filename = path.join(current, entry.name);
    return entry.isDirectory() ? inventory(root, filename) : [[path.relative(root, filename).replaceAll('\\', '/'), statSync(filename).size]];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Verify the actual packaged runtime and model, after Electron Builder has copied them. */
export function verifyPackagedModelRuntime({ root, resourcesPath = path.join(root, 'release', 'win-unpacked', 'resources'), compareInventory = true }) {
  const runtime = path.join(resourcesPath, 'model-runtime');
  const modelBase = path.join(resourcesPath, 'models');
  const worker = path.join(resourcesPath, 'app.asar.unpacked', 'server', 'model_runtime.py');
  const config = JSON.parse(readFileSync(path.join(modelBase, 'model-config.json'), 'utf8'));
  const sample = JSON.parse(readFileSync(path.resolve(modelBase, config.examplePath), 'utf8'));
  const expected = JSON.parse(readFileSync(path.join(modelBase, 'example-source-row.json'), 'utf8')).model_prediction;
  const files = inventory(runtime);
  if (compareInventory) assert.deepEqual(files, inventory(path.join(root, 'model-runtime')), 'Packaged Python files differ from the verified build runtime.');
  assert.ok(Number.isFinite(expected), 'Packaged reference prediction is missing.');
  const started = Date.now();
  const result = spawnSync(path.join(runtime, 'python.exe'), ['-I', '-X', 'utf8', '-u', worker,
    '--model', path.resolve(modelBase, config.modelPath), '--metadata', path.resolve(modelBase, config.metadataPath), '--expected-sha256', config.expectedSha256], {
    cwd: resourcesPath, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
    input: JSON.stringify({ id: 'packaged-model-check', action: 'predict', rows: [caseToModelValues(sample)] }) + '\n',
  });
  const elapsedMs = Date.now() - started;
  const diagnosticPath = path.join(root, 'tmp', 'model-verification-last.json');
  const diagnostic = { checkedAt: new Date().toISOString(), resourcesPath, runtime, worker, timeoutMs: 60000,
    elapsedMs, exitCode: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdout: result.stdout || '', stderr: result.stderr || '' };
  mkdirSync(path.dirname(diagnosticPath), { recursive: true });
  writeFileSync(diagnosticPath + '.tmp', JSON.stringify(diagnostic, null, 2) + '\n');
  renameSync(diagnosticPath + '.tmp', diagnosticPath);
  if (result.error || result.status !== 0) throw new Error(`Packaged model startup failed after ${elapsedMs} ms: ${result.error?.message || result.stderr || result.stdout || result.status}. Full stdout/stderr: ${diagnosticPath}`);
  const messages = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const ready = messages.find(message => message.type === 'ready');
  const prediction = messages.find(message => message.id === 'packaged-model-check');
  assert.equal(ready?.model?.model_hash, config.expectedSha256, 'Packaged worker did not confirm the configured model.');
  assert.equal(prediction?.ok, true, 'Packaged worker did not return a prediction.');
  assert.ok(Math.abs(prediction.values[0] - expected) < 0.000001, 'Packaged prediction differs from the frozen reference.');
  const summary = { verificationElapsedMs: elapsedMs, diagnosticPath, runtime_files: files.length, status: 'READY', model_hash: ready.model.model_hash, prediction: prediction.values[0], expected, dependencies: ready.model.runtime_dependencies };
  console.log('Packaged model verified', JSON.stringify(summary));
  return summary;
}