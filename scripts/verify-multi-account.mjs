// 多账号（第二步）自检：不启动服务，直接驱动 createUserAuth + 账号分流 state。
import assert from 'node:assert/strict';
import { createUserAuth } from '../server/user-auth.mjs';
import { createUserScopedState, scopeId, scopedEnabled } from '../server/user-scope.mjs';

function makeState() {
  const store = new Map();
  const readers = [];
  return {
    readers,
    async read(name, fallback) { readers.push(name); return store.has(name) ? structuredClone(store.get(name)) : structuredClone(fallback); },
    async write(name, value) { store.set(name, structuredClone(value)); },
    mutate(fn) { return fn(); },
    store,
  };
}

const state = makeState();
const auth = createUserAuth(state);
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; } });
const reqWith = cookie => ({ headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } });

// 1) 空库时要求先建账号
assert.equal((await auth.session(reqWith(''))).setupRequired, true);

// 2) 建第一个账号
await auth.setup({ username: 'rollcraft', password: 'Bengineer@2026', passwordConfirmation: 'Bengineer@2026' });
const firstRes = res();
const first = await auth.login({ username: 'rollcraft', password: 'Bengineer@2026' }, reqWith(''), firstRes);
assert.equal(first.user.username, 'rollcraft');
const firstCookie = String(firstRes.headers['Set-Cookie']).split(';')[0];

// 3) 管理员新增第二个账号；重名被拒
const added = await auth.addAccount({ username: 'operator', password: 'Operator@2026' });
assert.equal(added.user.username, 'operator');
await assert.rejects(() => auth.addAccount({ username: 'ROLLCRAFT', password: 'Whatever@2026' }), /用户名已存在/);

// 4) 两个账号各自登录，会话互不覆盖
const secondRes = res();
const second = await auth.login({ username: 'operator', password: 'Operator@2026' }, reqWith(''), secondRes);
assert.equal(second.user.username, 'operator');
const secondCookie = String(secondRes.headers['Set-Cookie']).split(';')[0];
assert.equal((await auth.session(reqWith(firstCookie))).user.username, 'rollcraft', '账号1 会话仍有效');
assert.equal((await auth.session(reqWith(secondCookie))).user.username, 'operator', '账号2 会话独立');

// 5) 错误密码被拒
await assert.rejects(() => auth.login({ username: 'operator', password: 'wrong-password' }, reqWith(''), res()), /用户名或密码错误/);

// 6) 账号隔离的 state：两个账号写到不同目录，共享文件仍在根
const scoped = createUserScopedState(state, { baseDir: 'C:/data/web', actorId: 'rollcraft', env: { QCDKR_SCOPED_STATE: '1' } });
await scoped.write('ai-copilot-sessions.json', [{ id: 'only-rollcraft' }]);
assert.ok(state.store.has(`users/${scopeId('rollcraft')}/ai-copilot-sessions.json`), '会话应写到该账号目录');
await scoped.write('auth-users.json', [{ id: 'x' }]);
assert.ok(state.store.has('auth-users.json'), '账号文件仍留在根目录');
assert.equal(scopedEnabled({}), false, '默认关闭：生产行为不变');

console.log('multi-account 校验通过：6 组断言（建号/新增/双会话/错密码/分目录/默认关闭）');
