import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, LockKeyhole, LogOut, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { friendlyCloudError, type AuthSession } from '../lib/firebase';
import { SETTINGS } from '../config';
import '../auth.css';

/** 账号页将登录、注册和邮件找回放在同一处，访客数据不自动上传。 */
export default function AccountPanel({ session, onNotice }: { session: AuthSession; onNotice: (message: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(session.user?.displayName ?? '');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  useEffect(() => { setName(session.user?.displayName ?? ''); setPassword(''); setMessage(''); }, [session.user?.uid]);

  /** 所有操作等待真实服务返回；失败时保留表单并用无敏感信息的提示说明。 */
  async function act(operation: () => Promise<void>, success: string) {
    setBusy(true); setMessage(''); setIsError(false);
    try {
      await operation();
      setPassword(''); setMessage(success); onNotice(success);
    } catch (error) { setMessage(friendlyCloudError(error)); setIsError(true); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'signup') await act(() => session.signUp(email, password, name, remember), '账号已创建，请到邮箱完成验证。');
    else if (mode === 'reset') await act(() => session.resetPassword(email), '如果该邮箱已注册，你将收到重置密码邮件。也请查看垃圾邮件。');
    else await act(() => session.signIn(email, password, remember), '已登录你的个人空间。');
  }

  return <section className="account-layout is-minimal" aria-label="我的账号">
    <div className="account-form-panel">
      <div className="account-heading"><h2>{session.user ? (session.user.emailVerified ? '我的账号' : '验证邮箱') : mode === 'signup' ? '创建账号' : mode === 'reset' ? '找回密码' : '登录片刻'}</h2></div>
      <p className="account-copy">日记仅你可见</p>
      {!session.ready ? <p className="account-copy" role="status">正在确认账号…</p> : session.user ? <>
        <p className="account-email"><Mail size={15} />{session.user.email}</p>
        <div className={`account-verification ${session.user.emailVerified ? 'is-verified' : ''}`}>
          <ShieldCheck size={18} /><div><strong>{session.user.emailVerified ? '已验证 · 云端同步' : '打开邮箱中的验证链接，再回来确认。'}</strong></div>
        </div>
        {!session.user.emailVerified && <div className="account-actions"><button className="account-primary" disabled={busy} onClick={() => act(session.reloadVerification, '邮箱已验证，可以同步记录了。')}><RefreshCw size={15} />我已完成验证</button><button className="account-text-button" disabled={busy} onClick={() => act(session.sendVerification, '验证邮件已发送，请查看邮箱及垃圾邮件。')}>重新发送</button></div>}
        {/* 昵称和密码管理折叠收纳，日常只显示必要账号状态。 */}
        <details className="account-settings"><summary>账号设置<ChevronDown size={16} aria-hidden="true" /></summary><div className="account-settings-body">
          <form className="account-form" onSubmit={(event) => { event.preventDefault(); void act(() => session.updateName(name), '昵称已更新。'); }}>
            <label htmlFor="profile-name">昵称</label><div className="account-inline"><input id="profile-name" autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} maxLength={SETTINGS.maxDisplayNameLength} required disabled={busy} /><button className="account-secondary" type="submit" disabled={busy}>保存</button></div>
          </form>
          <button className="account-text-button" disabled={busy} onClick={() => act(() => session.resetPassword(session.user?.email ?? ''), '密码重置邮件已发送，请查看邮箱。')}><LockKeyhole size={15} />修改密码</button>
        </div></details>
        <div className="account-actions"><button className="account-secondary" disabled={busy} onClick={() => act(session.signOut, '已退出账号，个人记录已从当前页面清除。')}><LogOut size={15} />退出登录</button></div>
      </> : <>
        {!session.available && <div className="account-unavailable" role="status">云同步尚未连接，访客记录只保留在本次页面。</div>}
        <div className="account-tabs" role="tablist" aria-label="账号操作">
          <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} onClick={() => { setMode('signin'); setMessage(''); }}>登录</button>
          <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => { setMode('signup'); setMessage(''); }}>注册</button>
        </div>
        <form className="account-form" onSubmit={submit}>
          {mode === 'signup' && <><label htmlFor="account-name">昵称</label><input id="account-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" placeholder="怎么称呼你" required maxLength={SETTINGS.maxDisplayNameLength} disabled={busy} /></>}
          <label htmlFor="account-email">邮箱</label><input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required maxLength={SETTINGS.maxEmailLength} disabled={busy} />
          {mode !== 'reset' && <><label htmlFor="account-password">密码</label><input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? `至少 ${SETTINGS.minPasswordLength} 位` : '输入密码'} minLength={mode === 'signup' ? SETTINGS.minPasswordLength : undefined} maxLength={SETTINGS.maxPasswordLength} required disabled={busy} /><label className="account-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} /><span>在我的设备保持登录</span></label></>}
          <button className="account-primary account-submit" type="submit" disabled={busy || !session.available}>{busy ? '正在处理…' : mode === 'signup' ? '创建账号' : mode === 'reset' ? '发送重置邮件' : '登录'}<ArrowRight size={16} /></button>
          <button type="button" className="account-text-button account-reset-link" disabled={busy} onClick={() => { setMode(mode === 'reset' ? 'signin' : 'reset'); setMessage(''); }}>{mode === 'reset' ? '返回登录' : '忘记密码？'}</button>
        </form>
      </>}
      {message && <p className={`account-message ${isError ? 'is-error' : ''}`} role={isError ? 'alert' : 'status'}>{message}</p>}
    </div>
  </section>;
}