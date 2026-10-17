import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Box, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound, Loader2 } from 'lucide-react';
import { APP_VERSION } from './version.js';
import { PRODUCT_NAME } from './productBrand.js';
import { authRequest, loginCredentials } from './loginTransport.js';
import { installWorkspaceRefresh } from './workspaceRecovery.js';
import { LOGIN_DEFAULTS } from './loginDefaults.js';
import './login.css';

const loginErrorText = error => error?.code === 'INVALID_CREDENTIALS'
  ? '用户名或密码错误，请重新输入。'
  : error?.code === 'EMPTY_INPUT' ? '请输入用户名和密码'
  : ['SETUP_INVALID','SETUP_ALREADY_COMPLETE','SETUP_REQUIRED','AUTH_STATE_INVALID'].includes(error?.code) ? error.message
  : '本地服务暂未就绪，请稍后重试。';

export default function LoginGate({ children }) {
  const [session, setSession] = useState(null), [loading, setLoading] = useState(true);
  const [username, setUsername] = useState(LOGIN_DEFAULTS.username), [password, setPassword] = useState(LOGIN_DEFAULTS.password);
  const [remember, setRemember] = useState(false), [visible, setVisible] = useState(false);
  const [passwordConfirmation,setPasswordConfirmation]=useState(''),[notice,setNotice]=useState('');
  const setupRequired=session?.setupRequired===true;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestVersion = useRef(0), submitting = useRef(false);
  const clearFields = () => { setUsername(''); setPassword(''); setPasswordConfirmation(''); setVisible(false); };
  const restoreLoginFields = () => { setUsername(LOGIN_DEFAULTS.username); setPassword(LOGIN_DEFAULTS.password); setVisible(false); };
  const refresh = async () => {
    submitting.current = false; setBusy(false);
    restoreLoginFields();
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const result = await authRequest('session');
      if (version !== requestVersion.current) return;
      if (!result.authenticated) restoreLoginFields();
      setSession(result);
    } catch (err) {
      if (version === requestVersion.current) { restoreLoginFields(); setSession(null); setError(loginErrorText(err)); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  };
  useEffect(() => {
    refresh();
    const expired = () => {
      ++requestVersion.current; submitting.current = false;
      restoreLoginFields(); setBusy(false); setLoading(false);
      setSession({ authenticated:false }); setError('登录已失效，请重新登录。');
    };
    window.addEventListener('dkqkar-session-expired', expired);
    return () => { ++requestVersion.current; window.removeEventListener('dkqkar-session-expired', expired); };
  }, []);
  useEffect(() => session?.authenticated ? undefined : installWorkspaceRefresh(refresh), [session?.authenticated]);
  const logout = async () => {
    const version = ++requestVersion.current;
    clearFields(); setError('');
    try {
      await authRequest('logout', {});
      if (version === requestVersion.current) { restoreLoginFields(); setSession({ authenticated:false }); }
    } catch (err) {
      if (version === requestVersion.current) { restoreLoginFields(); setSession(null); setError(loginErrorText(err)); }
    }
  };
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || loading) return;
    let credentials;
    try { credentials = loginCredentials(username, password); }
    catch (err) { setError(loginErrorText(err)); return; }
    const version = ++requestVersion.current;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await authRequest(setupRequired?'setup':'login', { ...credentials, ...(setupRequired?{passwordConfirmation}:{remember}) });
      if (version !== requestVersion.current) return;
      if(setupRequired){setPassword('');setPasswordConfirmation('');setVisible(false);setSession(result);setNotice('本机账号已创建，请输入密码登录。');return;}
      clearFields(); setSession(result);
    } catch (err) { if (version === requestVersion.current) setError(loginErrorText(err)); }
    finally {
      if (version === requestVersion.current) { submitting.current = false; setBusy(false); }
    }
  }
  if (session?.authenticated) return children({ user:session.user, onLogout:logout });
  return <main className="login-screen">
    <div className="login-scene" aria-hidden="true" />
    <header className="login-brand"><span className="login-brand-icon"><Box size={37}/></span><div><strong>{PRODUCT_NAME}</strong><span>冷轧 S5 轧制力智能预测系统</span><small>COLD ROLLING · PROCESS INTELLIGENCE</small></div><p>量子核预测 · 工业AI · 数字孪生</p></header>
    <section className="login-layout"><div className="login-intro"><span className="login-eyebrow">FROM DATA TO INSIGHT</span><h1>从数据到洞察<br/>让冷轧生产更智能</h1><p>聚焦 S5 轧制力，洞察工况变化。</p><div className="login-capabilities"><span>S5轧制力预测</span><span>五机架数字孪生</span><span>DK AI智能辅助</span></div></div>
    <form className="login-card" onSubmit={submit} aria-label={setupRequired?'创建本机账号':'账户登录'} noValidate>
      <span className="login-card-emblem"><ShieldCheck size={26}/></span><h2>{loading ? '正在连接本机服务' : setupRequired?'创建本机账号':'欢迎登录'}</h2><p>{setupRequired?'首次使用，请设置本机用户名和密码。软件不提供默认密码。':PRODUCT_NAME}</p>
      <label className="login-field"><UserRound size={17}/><input autoComplete="username" aria-label="用户名" placeholder="请输入用户名" value={username} onChange={e=>setUsername(e.target.value)} maxLength={64} required disabled={loading||busy}/></label>
      <label className="login-field"><LockKeyhole size={17}/><input type={visible?'text':'password'} autoComplete={setupRequired?'new-password':'current-password'} aria-label="密码" placeholder={setupRequired?'设置密码（至少8位）':'请输入密码'} maxLength={setupRequired?128:256} value={password} onChange={e=>setPassword(e.target.value)} required disabled={loading||busy}/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></label>
      {setupRequired&&<label className="login-field"><LockKeyhole size={17}/><input type="password" autoComplete="new-password" aria-label="确认密码" placeholder="再次输入密码" maxLength={128} value={passwordConfirmation} onChange={e=>setPasswordConfirmation(e.target.value)} required disabled={loading||busy}/></label>}
      {!setupRequired&&<div className="login-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>保持登录状态</label><span>本地账户</span></div>}
      {notice&&!error&&<p role="status">{notice}</p>}
      {error&&<div className="login-error" role="alert">{error}{!session&&<button type="button" onClick={refresh}>重新连接</button>}</div>}
      <button className="login-submit" type="submit" disabled={loading||busy||!session}>{loading||busy?<><Loader2 size={18} className="spin"/><span>{loading?'正在连接…':'正在验证…'}</span></>:<>{setupRequired?'创建本机账号':'登　录'}<ArrowRight size={18}/></>}</button>
      <div className="login-local"><ShieldCheck size={14}/><span>本地账户 · 本机验证</span></div>
    </form></section><footer className="login-footer"><span>{APP_VERSION} · {PRODUCT_NAME}</span><span>本地预测 · 工况分析 · 辅助决策</span></footer>
  </main>;
}
