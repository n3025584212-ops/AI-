// 账号隔离存储骨架的自检（不碰真实数据，全部在临时目录里跑）。
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { createUserScopedState, migrateUserFiles, scopeId, userDir, scopedEnabled } from '../server/user-scope.mjs';

const tmp = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'verify-scope-'));
const reads = new Map();
const state = {
  async read(name, fallback) { return reads.has(name) ? reads.get(name) : structuredClone(fallback); },
  async write(name, value) { reads.set(name, value); },
  mutate(fn) { return fn(); },
};

// 1) 目录名稳定、可读、可区分
assert.equal(scopeId('rollcraft'), scopeId('rollcraft'));
assert.notEqual(scopeId('rollcraft'), scopeId('operator'));
assert.match(scopeId('Zhang San/01'), /^zhang-san-01-[0-9a-f]{8}$/);

// 2) 默认关闭：完全保持原行为（同一个 state 对象返回）
assert.equal(scopedEnabled({}), false);
assert.equal(createUserScopedState(state, { baseDir: tmp, actorId: 'rollcraft', env: {} }), state);

// 3) 打开后：用户文件进 users/<id>/，共享文件留在根目录
const opened = createUserScopedState(state, { baseDir: tmp, actorId: 'rollcraft', env: { QCDKR_SCOPED_STATE: '1' } });
await opened.write('ai-copilot-sessions.json', [{ id: 's1' }]);
await opened.write('auth-users.json', [{ id: 'u1' }]);
const userPath = `users/${scopeId('rollcraft')}/ai-copilot-sessions.json`;
assert.deepEqual(reads.get(userPath), [{ id: 's1' }], '用户文件应写到 users/<id>/ 下');
assert.deepEqual(reads.get('auth-users.json'), [{ id: 'u1' }], '共享文件应留在根目录');
assert.deepEqual(await opened.read('ai-copilot-sessions.json', []), [{ id: 's1' }]);

// 4) 迁移：把根目录里的用户文件复制进账号目录，重复执行不再搬
const base = path.join(tmp, 'migrate');
await mkdir(base, { recursive: true });
await writeFile(path.join(base, 'ai-copilot-sessions.json'), '[{"id":"old"}]');
await writeFile(path.join(base, 'auth-users.json'), '[{"id":"acc"}]');
const dry = await migrateUserFiles(base, 'rollcraft', { dryRun: true });
assert.deepEqual(dry.moved, ['ai-copilot-sessions.json'], '演练应只列出用户文件');
const first = await migrateUserFiles(base, 'rollcraft');
assert.deepEqual(first.moved, ['ai-copilot-sessions.json']);
assert.deepEqual(JSON.parse(await readFile(path.join(userDir(base, 'rollcraft'), 'ai-copilot-sessions.json'), 'utf8')), [{ id: 'old' }]);
const second = await migrateUserFiles(base, 'rollcraft');
assert.deepEqual(second.moved, [], '第二次迁移不应重复搬');
assert.ok(await readFile(path.join(userDir(base, 'rollcraft'), '.migrated'), 'utf8'), '应写迁移标记');
const other = await migrateUserFiles(base, 'other');
assert.deepEqual(other.moved, ['ai-copilot-sessions.json'], '另一个账号迁到自己的目录');
assert.notEqual(userDir(base, 'other'), userDir(base, 'rollcraft'), '两个账号目录不同');

await rm(tmp, { recursive: true, force: true });
console.log('user-scope 校验通过：4 组断言（目录名/默认关闭/分目录读写/幂等迁移）');
