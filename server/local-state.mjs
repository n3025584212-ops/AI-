import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export class StateError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.name = 'StateError'; this.status = status; this.code = code; }
}
export const now = () => new Date().toISOString();
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digestSafe = value => JSON.parse(JSON.stringify(value));
export function createLocalState(dataDir) {
  let queue = Promise.resolve();
  return {
    async read(name, fallback, { signal } = {}) {
      signal?.throwIfAborted();
      try { const bytes = await readFile(path.join(dataDir, name), { encoding:'utf8', signal }); signal?.throwIfAborted(); return JSON.parse(bytes); }
      catch (error) { if (signal?.aborted) throw signal.reason; if (error.code === 'ENOENT') return structuredClone(fallback); throw new StateError('本地记录读取失败。', 500, 'STATE_READ'); }
    },
    async write(name, value) {
      // Preserve the existing writer entry; cancellable callers pass optional I/O options.
      const { signal } = arguments[2] || {};
      signal?.throwIfAborted();
      const filename = path.join(dataDir, name), temporary = `${filename}.${randomUUID()}.tmp`;
      let committed = false;
      try {
        await mkdir(path.dirname(filename), { recursive: true });
        signal?.throwIfAborted();
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, signal });
        for (let attempt = 0; ; attempt++) {
          signal?.throwIfAborted();
          try { await rename(temporary, filename); committed = true; break; }
          catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error; await delay(20 * (attempt + 1), undefined, { signal }); }
        }
      } finally {
        if (!committed) await rm(temporary, { force:true });
      }
    },
    // The slot follows the actual task's cleanup, never a timeout race.
    mutate(fn, { signal } = {}) {
      const result = queue.then(() => { signal?.throwIfAborted(); return fn(); });
      queue = result.catch(() => {}); return result;
    },
  };
}
