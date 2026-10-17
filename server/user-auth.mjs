import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { StateError, now } from './local-state.mjs';

const COOKIE = 'dkqkar_session';
const INVALID_CREDENTIALS = '用户名或密码错误';
const hash = token => createHash('sha256').update(token).digest('hex');
const validAccount = account => account && typeof account.id === 'string' && account.id.length > 0
  && typeof account.username === 'string' && account.username.trim().length > 0 && account.username.length <= 64
  && account.role === 'LOCAL_ADMIN' && typeof account.salt === 'string' && /^[a-f0-9]{32,128}$/i.test(account.salt)
  && typeof account.passwordHash === 'string' && /^[a-f0-9]{128}$/i.test(account.passwordHash);
const credentialVersion = account => hash(account.username + ':' + account.salt + ':' + account.passwordHash);
const publicUser = account => ({ id:account.id, name:account.displayName || '本机管理员', username:account.username,
  role:account.role, display_role:'本机管理员' });

export function createUserAuth(state, { enabled = true } = {}) {
  const attempts = new Map();
  async function readAccount() {
    const users = await state.read('auth-users.json', []);
    if (!Array.isArray(users) || users.length > 1 || users.length === 1 && !validAccount(users[0]))
      throw new StateError('本机账户文件无法验证，请保留数据目录并联系维护人员。', 503, 'AUTH_STATE_INVALID');
    return users[0] || null;
  }
  async function initialize() { if(enabled)await readAccount(); }
  function tokenFrom(req) {
    return String(req.headers.cookie || '').split(';').map(s => s.trim())
      .find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  }
  function validSession(session, account) {
    return account && session?.userId === account.id && session.credentialVersion === credentialVersion(account)
      && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now();
  }
  async function principal(req) {
    if (!enabled) return { id:'local-test', name:'本机测试', role:'admin', username:'local-test' };
    const account = await readAccount();
    if(!account)return null;
    const token = tokenFrom(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const sessions = await state.read('auth-sessions.json', []);
    return Array.isArray(sessions) && sessions.some(s => validSession(s,account) && s.tokenHash === hash(token)) ? publicUser(account) : null;
  }
  async function session(req) {
    const user = await principal(req);
    return { ok:true, authenticated:Boolean(user), setupRequired:enabled && !await readAccount(), user };
  }
  async function establish(account, res, remember) {
    const token = randomBytes(32).toString('hex'), seconds = remember ? 30 * 86400 : 12 * 3600;
    await state.mutate(async () => {
      const prior = await state.read('auth-sessions.json', []);
      const sessions = (Array.isArray(prior) ? prior.filter(s=>validSession(s,account)) : []).slice(-99);
      sessions.push({ tokenHash:hash(token), userId:account.id, role:account.role, credentialVersion:credentialVersion(account),
        createdAt:now(), expiresAt:Date.now() + seconds * 1000 });
      await state.write('auth-sessions.json', sessions);
    });
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${remember ? `; Max-Age=${seconds}` : ''}`);
    return { ok:true, authenticated:true, setupRequired:false, user:publicUser(account) };
  }
  return {
    initialize, principal, session,
    async require(req) { const user = await principal(req); if (!user) throw new StateError('请先登录。', 401, 'LOGIN_REQUIRED'); return user; },
    async setup(input) {
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const password = typeof input?.password === 'string' ? input.password : '';
      if(!/^[\p{L}\p{N}_.@-]{3,64}$/u.test(username) || password.length<8 || password.length>128 || !password.trim() || input?.passwordConfirmation!==password)
        throw new StateError('用户名须为3～64位；密码须为8～128位且两次输入一致。',400,'SETUP_INVALID');
      await state.mutate(async()=>{
        if(await readAccount())throw new StateError('本机账号已创建，请登录。',409,'SETUP_ALREADY_COMPLETE');
        const salt=randomBytes(32).toString('hex');
        const account={id:randomUUID(),username,role:'LOCAL_ADMIN',displayName:'本机管理员',display_role:'本机管理员',
          salt,passwordHash:scryptSync(password,salt,64).toString('hex'),createdAt:now()};
        await state.write('auth-users.json',[account]);
      });
      return {ok:true,authenticated:false,setupRequired:false,user:null};
    },
    async login(input, req, res) {
      const account = await readAccount();
      if(!account)throw new StateError('请先创建本机账号。',409,'SETUP_REQUIRED');
      const key = req.socket.remoteAddress || 'loopback', attempt = attempts.get(key);
      if (attempt && attempt.count >= 8 && Date.now() - attempt.at < 60000)
        throw new StateError(INVALID_CREDENTIALS, 429, 'LOGIN_RATE_LIMIT');
      const username = typeof input?.username === 'string' ? input.username.trim() : '';
      const password = typeof input?.password === 'string' && input.password.length <= 256 ? input.password : '';
      const supplied = scryptSync(password, account.salt, 64), expected = Buffer.from(account.passwordHash, 'hex');
      const passwordMatches = timingSafeEqual(expected, supplied);
      if (username !== account.username || !password || !passwordMatches) {
        attempts.set(key, { count:attempt && Date.now() - attempt.at < 60000 ? attempt.count + 1 : 1, at:Date.now() });
        throw new StateError(INVALID_CREDENTIALS, 401, 'INVALID_CREDENTIALS');
      }
      attempts.delete(key);
      return establish(account, res, input.remember === true);
    },
    async logout(req, res) {
      const account = await readAccount(),tokenHash = hash(tokenFrom(req));
      await state.mutate(async () => {
        const prior = await state.read('auth-sessions.json', []);
        await state.write('auth-sessions.json', (Array.isArray(prior) ? prior : []).filter(s => validSession(s,account) && s.tokenHash !== tokenHash));
      });
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return { ok:true, authenticated:false, setupRequired:!account, user:null };
    },
  };
}
