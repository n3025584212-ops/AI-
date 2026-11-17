// 登录竞态回归：账户文件瞬时读空不得把登录页翻成“创建账号”。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUserAuth } from '../server/user-auth.mjs';

const salt = 'a'.repeat(64);
const passwordHash = 'b'.repeat(128);
const account = { id: 'acct-1', username: 'rollcraft', role: 'LOCAL_ADMIN', salt, passwordHash };
const credentialVersion = createHash('sha256').update(`${account.username}:${salt}:${passwordHash}`).digest('hex');
const token = 'c'.repeat(64);
const sessions = [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: account.id, credentialVersion, expiresAt: Date.now() + 60000 }];

function harness({ emptyReads = 0 } = {}) {
  const state = {
    emptyReads,
    async read(name) {
      if (name === 'auth-users.json') {
        if (this.emptyReads > 0) { this.emptyReads -= 1; return []; }
        return [account];
      }
      if (name === 'auth-sessions.json') return sessions;
      return [];
    },
    async write() {},
    mutate(fn) { return fn(); },
  };
  return { state, auth: createUserAuth(state) };
}

const request = { headers: { cookie: `dkqkar_session=${token}` } };

// 1) 首次读空一次：重试后应识别账号，且 authenticated 与 setupRequired 一致。
{
  const { auth } = harness({ emptyReads: 1 });
  const session = await auth.session(request);
  assert.equal(session.setupRequired, false, 'transient empty must not flip setupRequired');
  assert.equal(session.authenticated, true, 'valid session must survive transient empty');
}

// 2) 读空超过重试窗口：30 秒宽限内沿用上一次成功读取。
{
  const { state, auth } = harness();
  await auth.session(request);
  state.emptyReads = 99;
  const session = await auth.session(request);
  assert.equal(session.setupRequired, false, 'grace window must keep last known account');
  assert.equal(session.authenticated, true);
}

// 3) 真的没有账号：仍然进入创建账号。
{
  const { auth } = harness({ emptyReads: 99 });
  const session = await auth.session({ headers: {} });
  assert.equal(session.setupRequired, true, 'missing account still requires setup');
  assert.equal(session.authenticated, false);
}

// 4) session 只读一次账户：读函数被调用次数应为 1（没有瞬时失败时）。
{
  const { state, auth } = harness();
  let reads = 0;
  const original = state.read.bind(state);
  state.read = (name, fallback) => { if (name === 'auth-users.json') reads += 1; return original(name, fallback); };
  await auth.session(request);
  assert.equal(reads, 1, 'session must read account exactly once');
}

console.log(JSON.stringify({ ok: true, cases: 4 }, null, 2));
