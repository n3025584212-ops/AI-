// 把根目录下的“用户文件”迁进 users/<账号>/（第一步只铺路，默认开关关闭时服务不读这些副本）。
// 用法：
//   node scripts/migrate-user-state.mjs --actor rollcraft --dry-run   # 只演练，列出会搬哪些
//   node scripts/migrate-user-state.mjs --actor rollcraft             # 真搬（复制，不删源）
//   node scripts/migrate-user-state.mjs --actor rollcraft --data-dir .runtime-data/web
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateUserFiles, scopeId, userDir } from '../server/user-scope.mjs';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const actor = value('--actor');
const dryRun = args.includes('--dry-run');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(root, value('--data-dir') || path.join('.runtime-data', 'web'));

if (!actor) {
  console.error('缺少 --actor <账号>。示例：node scripts/migrate-user-state.mjs --actor rollcraft --dry-run');
  process.exit(2);
}

// 账号目录必须按账号 id 分（运行时 actor.id 就是它），用户名只是给人看的别名。
// 传用户名时自动换算成 id，避免迁到 users/<username-x>/ 之后运行时读不到。
import { readFile } from 'node:fs/promises';
let actorId = actor;
try {
  const users = JSON.parse(await readFile(path.join(dataDir, 'auth-users.json'), 'utf8'));
  const matched = Array.isArray(users) ? users.find(item => item.username === actor || item.id === actor) : null;
  if (matched) actorId = matched.id;
} catch { /* 没有账号文件时按传入值处理 */ }
const result = await migrateUserFiles(dataDir, actorId, { dryRun });
console.log(`账号 ${actor}（id ${actorId}）→ ${scopeId(actorId)}`);
console.log(`目录 ${userDir(dataDir, actorId)}`);
console.log(`模式 ${dryRun ? '演练（不写盘）' : '正式迁移（复制，源文件保留）'}`);
console.log(`会迁 ${result.moved.length} 个文件，已存在跳过 ${result.skipped.length} 个`);
for (const name of result.moved.slice(0, 30)) console.log('  +', name);
if (result.moved.length > 30) console.log(`  … 其余 ${result.moved.length - 30} 个`);
if (!dryRun) console.log('完成。QCDKR_SCOPED_STATE 未开启时，服务仍然读写根目录，行为不变。');
