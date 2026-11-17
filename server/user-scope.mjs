// 按账号隔离存储的骨架（第一步：只铺路，默认不改变任何现有行为）。
//
// 背景：现在整个产品是单机单账号（server/user-auth.mjs 明确只允许 1 个账户），
// 所有状态都写在 .runtime-data/web 下同名文件里，谁打开网页看到的都是同一份。
// 要支持“每人各看各的”，第一步先把「按账号分目录」的读写层做出来并把老数据迁进去，
// 但默认开关关闭（QCDKR_SCOPED_STATE 未设置）时，读写路径与现在完全一致。
//
// 约定：
//   - 共享文件（账号、会话、活动日志、事件中心）永远留在根目录，不按账号分。
//   - 用户文件（AI 会话、经验、已存工况、任务、证据、分析记录…）走 users/<id>/。
//   - <id> 用账号 id 的稳定散列，避免用户名里的特殊字符污染路径。
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, stat, writeFile, readFile } from 'node:fs/promises';

/** 永远共享的文件/前缀：账号本身、登录会话、全局日志与事件。 */
export const SHARED_FILES = Object.freeze([
  'auth-users.json',
  'auth-sessions.json',
  'activity-log.json',
  'ai-incidents.json',
  'evidence-key.json',
  'last-backup.json',
  'prediction-service-state.json',
  'settings.json',       // 模型/LLM 配置属于服务端，不分账号
]);

const isShared = name => SHARED_FILES.some(shared => name === shared || name.startsWith(`${shared}.`)) || name.startsWith('settings.');

/** 账号目录名：sanitize + 短散列，稳定且可读。 */
export function scopeId(actorId) {
  const raw = String(actorId ?? '').trim().toLowerCase();
  if (!raw) return 'anonymous';
  const safe = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'user';
  return `${safe}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

export const userDir = (baseDir, actorId) => path.join(baseDir, 'users', scopeId(actorId));

/** 开关：QCDKR_SCOPED_STATE=1 时启用按账号分目录；默认关闭，行为与改造前一致。 */
export const scopedEnabled = (env = process.env) => String(env.QCDKR_SCOPED_STATE || '') === '1';

/**
 * 把一个 state（read/write/mutate）包成“用户文件走用户目录、共享文件走根目录”。
 * 关闭开关时原样返回，调用方无需关心。
 */
export function createUserScopedState(state, { baseDir, actorId, env = process.env } = {}) {
  if (!scopedEnabled(env) || !actorId) return state;
  const id = scopeId(actorId);
  // 只改文件名，读写仍走同一个 state（底层按 dataDir 解析相对路径），
  // 这样和锁、原子写、单测桩的行为完全一致。
  const route = name => (isShared(name) ? name : path.posix.join('users', id, name.split(String.fromCharCode(92)).join('/')));
  return {
    read: (name, fallback, options) => state.read(route(name), fallback, options),
    write: (name, value, options) => state.write(route(name), value, options),
    mutate: (fn, options) => state.mutate(fn, options),
    scope: { actorId, id, dir: userDir(baseDir, actorId) },
  };
}

/**
 * 把根目录下的用户文件迁进 users/<id>/。幂等：目标已存在就跳过；迁移后写 .migrated 标记。
 * 不删除源文件，出问题可直接回退。
 */
export async function migrateUserFiles(baseDir, actorId, { dryRun = false } = {}) {
  const dir = userDir(baseDir, actorId);
  const names = await listUserFiles(baseDir);
  const moved = [], skipped = [];
  if (!dryRun) await mkdir(dir, { recursive: true });
  for (const name of names) {
    const source = path.join(baseDir, name), target = path.join(dir, name);
    try { await stat(target); skipped.push(name); continue; } catch { /* 目标不存在才迁 */ }
    try { await stat(source); } catch { continue; }
    if (!dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    moved.push(name);
  }
  if (!dryRun) {
    await writeFile(path.join(dir, '.migrated'), JSON.stringify({ at: new Date().toISOString(), actorId: scopeId(actorId), moved, skipped }, null, 2));
  }
  return { dir, moved, skipped, dryRun };
}

async function listUserFiles(baseDir) {
  const { readdir } = await import('node:fs/promises');
  let entries = [];
  try { entries = await readdir(baseDir, { withFileTypes: true }); } catch { return []; }
  const names = [];
  for (const entry of entries) {
    if (entry.name === 'users' || entry.name === 'communication') continue;
    if (entry.isDirectory()) { names.push(`${entry.name}/state.json`); continue; }
    if (!entry.name.endsWith('.json') || entry.name.includes('.bak-') || entry.name.endsWith('.tmp')) continue;
    if (isShared(entry.name)) continue;
    names.push(entry.name);
  }
  return names;
}

// ── 请求级账号上下文 ────────────────────────────────────────────────
// 服务在启动时只构造一次，无法按账号重新构造；这里用 AsyncLocalStorage 把
// 「当前请求的账号」放进异步上下文，state 代理每次读写时按它分流。
// 定时任务等无请求上下文的调用拿到 null → 走根目录（共享），保持原行为。
import { AsyncLocalStorage } from 'node:async_hooks';
const actorStorage = new AsyncLocalStorage();

/** 在已解析出 actor 之后调用；影响当前请求后续所有的 state 读写。 */
export const setRequestActor = actorId => actorStorage.enterWith({ actorId: actorId ?? null });
export const currentActorId = () => actorStorage.getStore()?.actorId ?? null;

/** 按「当前请求账号」自动分流的 state 代理；开关关闭时原样返回。 */
export function createActorAwareState(state, { env = process.env } = {}) {
  if (!scopedEnabled(env)) return state;
  const route = name => {
    const actorId = currentActorId();
    if (!actorId || isShared(name)) return name;
    return path.posix.join('users', scopeId(actorId), name.split(String.fromCharCode(92)).join('/'));
  };
  return {
    read: (name, fallback, options) => state.read(route(name), fallback, options),
    write: (name, value, options) => state.write(route(name), value, options),
    mutate: (fn, options) => state.mutate(fn, options),
  };
}
