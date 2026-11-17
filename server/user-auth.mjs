import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { StateError, now } from './local-state.mjs';

const COOKIE = 'dkqkar_session';
const INVALID_CREDENTIALS = '用户名或密码错误';
const hash = token => createHash('sha256').update(token).digest('hex');
const validAccount = account => account && typeof account.id === 'string' && account.id.length > 0
  && typeof account.username === 'string' && account.username.trim().length > 0 && account.username.length <= 64
  && account.role === 'LOCAL_ADMIN' && typeof account.salt === 'string' && /^[a-f0-9]{32,128}$/i.test(account.salt)
  && typeof account.passwordHash === 'string' && /^[a-f0-9]{128}$/i.test(account.passwordHash)
  && (account.binding == null || (typeof account.binding?.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(account.binding.fingerprint)));
const credentialVersion = account => hash(account.username + ':' + account.salt + ':' + account.passwordHash);
const publicUser = account => ({ id:account.id, name:account.displayName || '本机管理员', username:account.username,
  role:account.role, display_role:'本机管理员', bound:Boolean(account.binding), boundAt:account.binding?.boundAt || null });

const ACCOUNT_READ_DELAYS = [20, 40, 80];
const ACCOUNT_GRACE_MS = 30000;
const USERNAME_PATTERN = /^[\p{L}\p{N}_.@-]{3,64}$/u;

export function createUserAuth(state, { enabled = true } = {}) {
  const attempts = new Map();
  let lastGoodAccounts = null, lastGoodAt = 0;
  async function readAccountsOnce() {
    const users = await state.read('auth-users.json', []);
    // 2026-11-17：放开“只允许一个账号”的限制。老文件是 [account]，保持兼容；
    // 任何一条损坏都整体判为不可读，避免半坏数据被当成合法账号。
    if (!Array.isArray(users) || users.some(account => !validAccount(account)))
      throw new StateError('本机账户文件无法验证，请保留数据目录并联系维护人员。', 503, 'AUTH_STATE_INVALID');
    return users;
  }
  async function readAccounts() {
    let accounts = await readAccountsOnce();
    if (accounts.length) { lastGoodAccounts = accounts; lastGoodAt = Date.now(); return accounts; }
    // Windows 上重命名/杀软扫描的瞬间可能把账户文件读空。短暂重试，
    // 避免把一次瞬时读空误判成“尚未创建账号”——登录页会翻成创建账号卡。
    for (const delay of ACCOUNT_READ_DELAYS) {
      await new Promise(resolve => setTimeout(resolve, delay));
      accounts = await readAccountsOnce();
      if (accounts.length) { lastGoodAccounts = accounts; lastGoodAt = Date.now(); return accounts; }
    }
    if (lastGoodAccounts && Date.now() - lastGoodAt < ACCOUNT_GRACE_MS) return lastGoodAccounts;
    return [];
  }
  async function initialize() { if(enabled)await readAccounts(); }
  function tokenFrom(req) {
    return String(req.headers.cookie || '').split(';').map(s => s.trim())
      .find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  }
  function validSession(session, account) {
    return account && session?.userId === account.id && session.credentialVersion === credentialVersion(account)
      && (!account.binding || !session.fingerprint || session.fingerprint === account.binding.fingerprint)
      && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now();
  }
  async function principalWith(accounts, req) {
    if (!enabled) return { id:'local-test', name:'本机测试', role:'admin', username:'local-test' };
    if(!accounts?.length)return null;
    const token = tokenFrom(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const sessions = await state.read('auth-sessions.json', []);
    if (!Array.isArray(sessions)) return null;
    const matched = sessions.find(item => item.tokenHash === hash(token));
    if (!matched) return null;
    const account = accounts.find(item => item.id === matched.userId);
    return validSession(matched, account) ? publicUser(account) : null;
  }
  async function principal(req) { return principalWith(await readAccounts(), req); }
  async function session(req) {
    // 一次请求只读一次账户：principal 与 setupRequired 必须来自同一份快照，
    // 否则两次读取之间一旦读空，会出现 authenticated=true 与 setupRequired=true 并存。
    const accounts = enabled ? await readAccounts() : [];
    const user = await principalWith(accounts, req);
    return { ok:true, authenticated:Boolean(user), setupRequired:enabled && accounts.length === 0, user };
  }
  async function establish(account, res, remember, fingerprint = null) {
    const token = randomBytes(32).toString('hex'), seconds = remember ? 30 * 86400 : 12 * 3600;
    await state.mutate(async () => {
      const prior = await state.read('auth-sessions.json', []);
      // 2026-11-17：每次登录都新增一条，remember=30 天会越攒越多（云端曾积到 55 条）。
      // 只清理过期 + 每个账号最多保留最近 10 个会话，其它账号的会话原样保留。
      const live = Array.isArray(prior) ? prior.filter(item => Number.isFinite(item.expiresAt) && item.expiresAt > Date.now()) : [];
      const others = live.filter(item => item.userId !== account.id);
      const mine = live.filter(item => item.userId === account.id).slice(-9);
      const sessions = [...others, ...mine];
      sessions.push({ tokenHash:hash(token), userId:account.id, role:account.role, credentialVersion:credentialVersion(account),
        fingerprint, createdAt:now(), expiresAt:Date.now() + seconds * 1000 });
      await state.write('auth-sessions.json', sessions);
    });
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${remember ? `; Max-Age=${seconds}` : ''}`);
    return { ok:true, authenticated:true, setupRequired:false, user:publicUser(account) };
  }
  function newAccount(username, password) {
    const salt = randomBytes(32).toString('hex');
    return { id:randomUUID(), username, role:'LOCAL_ADMIN', displayName:'本机管理员', display_role:'本机管理员',
      salt, passwordHash:scryptSync(password, salt, 64).toString('hex'), createdAt:now() };
  }
  // 第一个成功登录的浏览器绑定该账号；之后只允许同一指纹登录。
  async function bindAccount(accountId, fingerprint) {
    return state.mutate(async () => {
      const accounts = await readAccounts();
      const account = accounts.find(item => item.id === accountId);
      if (!account) throw new StateError(INVALID_CREDENTIALS, 401, 'INVALID_CREDENTIALS');
      if (account.binding) {
        if (account.binding.fingerprint !== fingerprint)
          throw new StateError('该账号已绑定其他浏览器，不能在此设备登录。', 403, 'ACCOUNT_BOUND');
        return account;
      }
      account.binding = { fingerprint, boundAt: now() };
      account.lockedAt = account.binding.boundAt;
      await state.write('auth-users.json', accounts);
      return account;
    });
  }
  const HANDOUT_FILE = 'auth-handout.json';
  // 自动分发：登录页按浏览器指纹领一个未使用的账号；同一浏览器重复领取返回同一个。
  // 明文密码只存在 auth-handout.json（600），账号文件仍然只有 scrypt 哈希。
  async function handout(fingerprint) {
    const fp = typeof fingerprint === 'string' ? fingerprint.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(fp))
      throw new StateError('无法识别当前浏览器。', 400, 'FINGERPRINT_REQUIRED');
    return state.mutate(async () => {
      const accounts = await readAccounts();
      const book = await state.read(HANDOUT_FILE, {});
      const map = book && typeof book === 'object' && book.accounts && typeof book.accounts === 'object' ? book.accounts : {};
      const assigned = accounts.find(account => account.handout?.fingerprint === fp && typeof map[account.username] === 'string'
        && (!account.binding || account.binding.fingerprint === fp));
      if (assigned) return { ok: true, username: assigned.username, password: map[assigned.username], reused: true };
      const candidates = accounts.filter(account => typeof map[account.username] === 'string' && !account.binding && !account.handout?.fingerprint);
      if (!candidates.length) throw new StateError('分发账号已用完，请联系管理员。', 409, 'HANDOUT_EXHAUSTED');
      const picked = candidates[randomInt(candidates.length)];
      picked.handout = { fingerprint: fp, issuedAt: now() };
      await state.write('auth-users.json', accounts);
      return { ok: true, username: picked.username, password: map[picked.username], reused: false };
    });
  }
  return {
    initialize, principal, session, handout,
    async require(req) { const user = await principal(req); if (!user) throw new StateError('请先登录。', 401, 'LOGIN_REQUIRED'); return user; },
    async listAccounts() { return (await readAccounts()).map(publicUser); },
    async setup(input) {
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const password = typeof input?.password === 'string' ? input.password : '';
      if(!USERNAME_PATTERN.test(username) || password.length<8 || password.length>128 || !password.trim() || input?.passwordConfirmation!==password)
        throw new StateError('用户名须为3～64位；密码须为8～128位且两次输入一致。',400,'SETUP_INVALID');
      await state.mutate(async()=>{
        if((await readAccounts()).length)throw new StateError('本机账号已创建，请登录。',409,'SETUP_ALREADY_COMPLETE');
        await state.write('auth-users.json',[newAccount(username, password)]);
      });
      return {ok:true,authenticated:false,setupRequired:false,user:null};
    },
    // 已登录管理员新增账号；不覆盖现有账号。
    async addAccount(input) {
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const password = typeof input?.password === 'string' ? input.password : '';
      if(!USERNAME_PATTERN.test(username) || password.length<8 || password.length>128 || !password.trim())
        throw new StateError('用户名须为3～64位；密码须为8～128位。',400,'ACCOUNT_INVALID');
      let created = null;
      await state.mutate(async()=>{
        const accounts = await readAccounts();
        if (accounts.some(account => account.username.toLowerCase() === username.toLowerCase()))
          throw new StateError('用户名已存在。',409,'ACCOUNT_EXISTS');
        if (accounts.length >= 64) throw new StateError('本机账号最多 64 个。',409,'ACCOUNT_LIMIT');
        created = newAccount(username, password);
        await state.write('auth-users.json',[...accounts, created]);
      });
      return { ok:true, user:publicUser(created) };
    },
    async login(input, req, res) {
      const accounts = await readAccounts();
      if(!accounts.length)throw new StateError('请先创建本机账号。',409,'SETUP_REQUIRED');
      const key = req.socket.remoteAddress || 'loopback', attempt = attempts.get(key);
      if (attempt && attempt.count >= 8 && Date.now() - attempt.at < 60000)
        throw new StateError(INVALID_CREDENTIALS, 429, 'LOGIN_RATE_LIMIT');
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const password = typeof input?.password === 'string' && input.password.length <= 256 ? input.password : '';
      const fingerprint = typeof input?.fingerprint === 'string' ? input.fingerprint.trim().toLowerCase() : '';
      if (!/^[a-f0-9]{64}$/.test(fingerprint))
        throw new StateError('无法识别当前浏览器，请更换浏览器后重试。', 400, 'FINGERPRINT_REQUIRED');
      const account = accounts.find(item => item.username === username);
      // 用户名不存在也跑一次 scrypt，避免用响应时间探测账号是否存在。
      const reference = account || accounts[0];
      const supplied = scryptSync(password, reference.salt, 64), expected = Buffer.from(reference.passwordHash, 'hex');
      const passwordMatches = timingSafeEqual(expected, supplied);
      if (!account || !password || !passwordMatches) {
        attempts.set(key, { count:attempt && Date.now() - attempt.at < 60000 ? attempt.count + 1 : 1, at:Date.now() });
        throw new StateError(INVALID_CREDENTIALS, 401, 'INVALID_CREDENTIALS');
      }
      attempts.delete(key);
      const bound = await bindAccount(account.id, fingerprint);
      return establish(bound, res, input.remember === true, fingerprint);
    },
    async logout(req, res) {
      const accounts = await readAccounts(), tokenHash = hash(tokenFrom(req));
      await state.mutate(async () => {
        const prior = await state.read('auth-sessions.json', []);
        await state.write('auth-sessions.json', (Array.isArray(prior) ? prior : []).filter(item => item.tokenHash !== tokenHash));
      });
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return { ok:true, authenticated:false, setupRequired:!accounts.length, user:null };
    },
  };
}
