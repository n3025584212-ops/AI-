export const LOGIN_EMPTY_INPUT = '请输入用户名和密码';
export const INVALID_CREDENTIALS = '用户名或密码错误';
export const LOGIN_SERVICE_UNAVAILABLE = '本地登录服务暂不可用，请稍后重试。';

export class LoginRequestError extends Error {
  constructor(message, code) { super(message); this.name = 'LoginRequestError'; this.code = code; }
}
export function loginCredentials(username, password) {
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password.trim())
    throw new LoginRequestError(LOGIN_EMPTY_INPUT, 'EMPTY_INPUT');
  return { username:username.trim(), password };
}
const serviceError = () => new LoginRequestError(LOGIN_SERVICE_UNAVAILABLE, 'LOGIN_SERVICE_UNAVAILABLE');
const validUser = user => user && typeof user.username === 'string' && user.username.length > 0
  && user.role === 'LOCAL_ADMIN' && user.display_role === '本机管理员';

export async function authRequest(route, body, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (!['session','login','logout','setup'].includes(route)) throw serviceError();
    const response = await fetchImpl('/api/auth/' + route, {
      method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}),
    });
    const type = response.headers.get('content-type') || '';
    const text = await response.text();
    if (!/application\/(?:json|[\w.+-]+\+json)(?:\s*;|\s*$)/i.test(type) || !text.trim()) throw serviceError();
    let result;
    try { result = JSON.parse(text); } catch { throw serviceError(); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw serviceError();
    if (!response.ok) {
      if (route === 'login' && ['ACCOUNT_BOUND','FINGERPRINT_REQUIRED'].includes(result.code))
        throw new LoginRequestError(result.error || result.message || INVALID_CREDENTIALS, result.code);
      if (route === 'login' && [401,429].includes(response.status))
        throw new LoginRequestError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
      if (['SETUP_INVALID','SETUP_ALREADY_COMPLETE','SETUP_REQUIRED','AUTH_STATE_INVALID'].includes(result.code))
        throw new LoginRequestError(result.error || result.message || LOGIN_SERVICE_UNAVAILABLE,result.code);
      throw serviceError();
    }
    if (route === 'login' && (result.ok !== true || !validUser(result.user))) throw serviceError();
    if (route === 'session' && (typeof result.authenticated !== 'boolean' || result.authenticated && !validUser(result.user))) throw serviceError();
    if (route === 'logout' && result.authenticated !== false) throw serviceError();
    if (route === 'setup' && (result.ok !== true || result.authenticated !== false || result.setupRequired !== false)) throw serviceError();
    return result;
  } catch(error) {
    if (error instanceof LoginRequestError) throw error;
    throw serviceError();
  }
}
