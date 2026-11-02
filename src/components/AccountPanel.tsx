import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, LoaderCircle, LockKeyhole, LogOut, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { friendlyCloudError, type AuthSession } from '../lib/firebase';
import { AUTH_FORM_SETTINGS as FORM, authErrorField, authModeFromParam, safeAccountReturnTo, validateAuthForm, type AuthField, type AuthFieldErrors, type AuthFormMode, type AuthFormValues } from '../lib/auth-form';
import '../auth.css';

interface AccountPanelProps {
  session: AuthSession;
  onNotice: (message: string) => void;
  returnTo?: string;
  authReason?: string;
}
type BusyAction = AuthFormMode | 'verify' | 'resend' | 'signout' | 'name' | 'password-reset';
type Feedback = { text: string; error: boolean } | null;
const EMPTY_VALUES: AuthFormValues = { email: '', password: '', confirmPassword: '', name: '' };
const FIELD_IDS: Record<AuthField, string> = { email: 'account-email', password: 'account-password', confirmPassword: 'account-confirm-password', name: 'account-name' };

/** 密码开关保留真正的label与自动填充，不阻断粘贴和密码管理器。 */
function PasswordField({ field, label, value, error, visible, disabled, signup, onChange, onBlur, onToggle }: {
  field: 'password' | 'confirmPassword'; label: string; value: string; error?: string; visible: boolean; disabled: boolean; signup: boolean;
  onChange: (value: string) => void; onBlur: () => void; onToggle: () => void;
}) {
  const id = FIELD_IDS[field];
  const hint = field === 'password' && signup ? id + '-hint' : undefined;
  const describedBy = [hint, error ? id + '-error' : undefined].filter(Boolean).join(' ') || undefined;
  return <div className="account-field">
    <label htmlFor={id}>{label}</label>
    <div className="account-password-wrap">
      <input id={id} name={field} type={visible ? 'text' : 'password'} value={value} required
        minLength={FORM.minPasswordLength} maxLength={FORM.maxPasswordLength}
        autoComplete={signup ? 'new-password' : 'current-password'} autoCapitalize="off" spellCheck={false}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy} disabled={disabled}
        onChange={event => onChange(event.target.value)} onBlur={onBlur} />
      <button type="button" className="account-password-toggle" disabled={disabled} aria-controls={id} aria-pressed={visible}
        aria-label={(visible ? '隐藏' : '显示') + label} onClick={onToggle}>
        {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
    {hint && <p className="account-field-hint" id={hint}>至少 {FORM.minPasswordLength} 位</p>}
    {error && <p className="account-field-error" id={id + '-error'} role="alert">{error}</p>}
  </div>;
}

/** 登录只改变账号状态；返回记录需主动点击，绝不替用户提交页面里的草稿。 */
export default function AccountPanel({ session, returnTo, authReason }: AccountPanelProps) {
  const [params, setParams] = useSearchParams();
  const requestedMode = authModeFromParam(params.get('mode'));
  const destination = safeAccountReturnTo(returnTo ?? params.get('returnTo'));
  const [mode, setMode] = useState<AuthFormMode>(requestedMode);
  const [values, setValues] = useState<AuthFormValues>({ ...EMPTY_VALUES, name: session.user?.displayName ?? '' });
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [visible, setVisible] = useState({ password: false, confirmPassword: false });
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [verificationUntil, setVerificationUntil] = useState(0);
  const [resetUntil, setResetUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const currentOwner = useRef(session.user?.uid ?? null);
  currentOwner.current = session.user?.uid ?? null;
  const verifyRemaining = Math.max(0, Math.ceil((verificationUntil - now) / 1000));
  const resetRemaining = Math.max(0, Math.ceil((resetUntil - now) / 1000));
  const disabled = Boolean(busy);

  /** URL模式变化与账号切换清除密码；未完成的请求不把旧错误写回新表单。 */
  function clearModeState(next: AuthFormMode) {
    revision.current += 1; setMode(next); setErrors({}); setFeedback(null); setResetSent(null);
    setValues(previous => ({ ...previous, password: '', confirmPassword: '' }));
    setVisible({ password: false, confirmPassword: false });
  }
  useEffect(() => { clearModeState(requestedMode); }, [requestedMode]);
  useEffect(() => {
    setValues(previous => ({ ...previous, name: session.user?.displayName ?? '', password: '', confirmPassword: '', ...(session.user ? {} : { email: '' }) }));
    setErrors({}); setVisible({ password: false, confirmPassword: false }); setResetSent(null);
    if (!session.user) setRemember(false);
    if (!inFlight.current) setFeedback(null);
  }, [session.user?.uid]);
  useEffect(() => { if (session.user) setValues(previous => ({ ...previous, name: session.user?.displayName ?? '' })); }, [session.user?.displayName]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current += 1; }; }, []);
  useEffect(() => {
    setNow(Date.now());
    if (Math.max(verificationUntil, resetUntil) <= Date.now()) return;
    const interval = setInterval(() => {
      const at = Date.now(); setNow(at);
      if (at >= Math.max(verificationUntil, resetUntil)) clearInterval(interval);
    }, FORM.countdownTickMs);
    return () => clearInterval(interval);
  }, [verificationUntil, resetUntil]);

  function changeMode(next: AuthFormMode) {
    if (inFlight.current) return;
    clearModeState(next);
    // 找回密码保留登录URL；登录和注册可从外部深链接进入，也支持浏览器前后导航。
    if (next !== 'reset') setParams(previous => { const updated = new URLSearchParams(previous); updated.set('mode', next); return updated; }, { replace: true });
  }
  function updateField(field: AuthField, value: string) {
    setValues(previous => ({ ...previous, [field]: value }));
    setErrors(previous => {
      const next = { ...previous }; delete next[field];
      if (field === 'password') delete next.confirmPassword;
      return next;
    });
    setFeedback(null);
  }
  function blurField(field: AuthField) {
    const message = validateAuthForm(mode, values)[field];
    setErrors(previous => ({ ...previous, [field]: message }));
  }
  function beginCooldown(kind: 'verify' | 'reset') {
    const at = Date.now(); setNow(at);
    if (kind === 'verify') setVerificationUntil(at + FORM.verificationCooldownSeconds * 1000);
    else setResetUntil(at + FORM.resetCooldownSeconds * 1000);
  }

  /** ref立即互斥重复提交；所有成功提示仅在真实服务完成后出现在表单内。 */
  async function act(action: BusyAction, operation: () => Promise<void>, success?: string, after?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(action); setFeedback(null);
    const currentRevision = revision.current;
    const owner = currentOwner.current;
    const changesIdentity = action === 'signin' || action === 'signup' || action === 'signout';
    // 发信、验证、昵称等旧账号请求返回时，不把结果写到另一个账号的界面。
    const canPresent = () => mounted.current && currentRevision === revision.current && (changesIdentity || owner === currentOwner.current);
    try {
      await operation();
      if (!canPresent()) return;
      setValues(previous => ({ ...previous, password: '', confirmPassword: '' }));
      setVisible({ password: false, confirmPassword: false });
      if (success) setFeedback({ text: success, error: false });
      after?.();
    } catch (error) {
      // 过期身份请求安静退出；正常注册后的发信失败没有此code，仍保留可见说明。
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth/session-changed') return;
      if (!canPresent()) return;
      const field = action === 'signin' || action === 'signup' || action === 'reset' ? authErrorField(error) : null;
      if (field) {
        setErrors(previous => ({ ...previous, [field]: friendlyCloudError(error) }));
        document.getElementById(FIELD_IDS[field])?.focus();
      } else setFeedback({ text: friendlyCloudError(error), error: true });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !session.available || (mode === 'reset' && resetRemaining > 0)) return;
    const validation = validateAuthForm(mode, values);
    setErrors(validation); setFeedback(null);
    const first = (mode === 'signup' ? ['name', 'email', 'password', 'confirmPassword'] : mode === 'reset' ? ['email'] : ['email', 'password']).find(field => validation[field as AuthField]);
    if (first) { document.getElementById(FIELD_IDS[first as AuthField])?.focus(); return; }
    if (mode === 'signup') {
      await act('signup', () => session.signUp(values.email.trim(), values.password, values.name.trim(), remember), undefined, () => beginCooldown('verify'));
    } else if (mode === 'reset') {
      const email = values.email.trim();
      await act('reset', () => session.resetPassword(email), undefined, () => { setResetSent(email); beginCooldown('reset'); });
    } else await act('signin', () => session.signIn(values.email.trim(), values.password, remember));
  }
  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = values.name.trim();
    if (!name || name.length > FORM.maxDisplayNameLength) { setErrors({ name: '昵称请填写 1—' + FORM.maxDisplayNameLength + ' 个字。' }); return; }
    setErrors({}); void act('name', () => session.updateName(name), '昵称已更新。');
  }

  const title = session.user ? session.user.emailVerified ? '我的账号' : '验证邮箱' : mode === 'signup' ? '创建账号' : mode === 'reset' ? resetSent ? '查看邮箱' : '找回密码' : '登录片刻';
  return <section className="account-layout is-minimal" aria-label="我的账号">
    <div className="account-form-panel" aria-busy={disabled}>
      <div className="account-heading"><h1>{title}</h1></div>
      <p className="account-copy">日记仅你可见</p>
      {authReason && !session.user?.emailVerified && <p className="account-reason">{authReason}</p>}
      {!session.ready ? <p className="account-loading" role="status"><LoaderCircle className="account-spinner" size={20} aria-hidden="true" />正在确认账号…</p> : session.user ? <>
        <p className="account-email"><Mail size={18} aria-hidden="true" /><span>{session.user.email}</span></p>
        <div className={'account-verification' + (session.user.emailVerified ? ' is-verified' : '')}>
          <ShieldCheck size={21} aria-hidden="true" />
          <p>{session.user.emailVerified ? '邮箱已验证，可以同步记录。' : '打开邮箱中的验证链接，再回来确认。'}</p>
        </div>
        {!session.user.emailVerified ? <>
          <div className="account-actions is-verification">
            <button className="account-primary" type="button" disabled={disabled} onClick={() => void act('verify', session.reloadVerification, '验证成功，可以返回继续了。')}>
              <RefreshCw size={18} aria-hidden="true" />{busy === 'verify' ? '正在确认…' : '我已完成验证'}
            </button>
            <button className="account-text-button" type="button" disabled={disabled || verifyRemaining > 0} onClick={() => void act('resend', session.sendVerification, '验证邮件已发送，请查看邮箱。', () => beginCooldown('verify'))}>
              {busy === 'resend' ? '正在发送…' : verifyRemaining > 0 ? '重新发送（' + verifyRemaining + '秒）' : '重新发送验证邮件'}
            </button>
          </div>
          <p className="account-helper">没找到邮件？也看看垃圾邮件。</p>
        </> : <Link className="account-primary account-continue" to={destination}>{destination === '/' ? '返回记录' : '继续'}<ArrowRight size={19} aria-hidden="true" /></Link>}
        {/* 资料和密码管理折叠收纳；清空或过长昵称在字段旁给出具体原因。 */}
        <details className="account-settings">
          <summary>账号设置<ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="account-settings-body">
            <form className="account-form" onSubmit={saveName} noValidate>
              <div className="account-field">
                <label htmlFor={FIELD_IDS.name}>昵称</label>
                <div className="account-inline">
                  <input id={FIELD_IDS.name} name="name" autoComplete="nickname" value={values.name} onChange={event => updateField('name', event.target.value)}
                    maxLength={FORM.maxDisplayNameLength} required disabled={disabled} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? FIELD_IDS.name + '-error' : undefined} />
                  <button className="account-secondary" type="submit" disabled={disabled}>{busy === 'name' ? '保存中…' : '保存'}</button>
                </div>
                {errors.name && <p className="account-field-error" id={FIELD_IDS.name + '-error'} role="alert">{errors.name}</p>}
              </div>
            </form>
            <button className="account-text-button" type="button" disabled={disabled || resetRemaining > 0} onClick={() => void act('password-reset', () => session.resetPassword(session.user?.email ?? ''), '如该邮箱已注册，重置邮件将发送至邮箱。', () => beginCooldown('reset'))}>
              <LockKeyhole size={18} aria-hidden="true" />{busy === 'password-reset' ? '正在发送…' : resetRemaining > 0 ? '稍后再发送（' + resetRemaining + '秒）' : '通过邮件修改密码'}
            </button>
          </div>
        </details>
        <button className="account-text-button account-signout" type="button" disabled={disabled} onClick={() => void act('signout', session.signOut, '已退出登录。')}><LogOut size={18} aria-hidden="true" />{busy === 'signout' ? '正在退出…' : '退出登录'}</button>
      </> : <>
        {!session.available && <p className="account-unavailable" role="status">云同步尚未连接，暂时无法登录。</p>}
        {mode !== 'reset' && <div className="account-tabs" role="group" aria-label="选择登录或注册">
          <button type="button" aria-pressed={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} disabled={disabled} onClick={() => changeMode('signin')}>登录</button>
          <button type="button" aria-pressed={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} disabled={disabled} onClick={() => changeMode('signup')}>注册</button>
        </div>}
        {mode === 'reset' && resetSent ? <div className="account-reset-success" role="status">
          <span className="account-success-icon"><Check size={25} aria-hidden="true" /></span>
          <p>如果 <strong>{resetSent}</strong> 已注册，你会收到密码重置邮件。</p>
          <p className="account-helper">请查看收件箱和垃圾邮件。</p>
          <button type="button" className="account-primary" onClick={() => changeMode('signin')}>返回登录<ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" className="account-text-button" onClick={() => { setResetSent(null); setErrors({}); setFeedback(null); }}>换个邮箱</button>
        </div> : <form className="account-form" onSubmit={submit} noValidate>
          {mode === 'reset' && <p className="account-helper account-reset-description">输入注册邮箱，我们会发送重置链接。</p>}
          {mode === 'signup' && <div className="account-field">
            <label htmlFor={FIELD_IDS.name}>昵称</label>
            <input id={FIELD_IDS.name} name="name" value={values.name} autoComplete="nickname" placeholder="怎么称呼你"
              required maxLength={FORM.maxDisplayNameLength} disabled={disabled} onChange={event => updateField('name', event.target.value)} onBlur={() => blurField('name')}
              aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? FIELD_IDS.name + '-error' : undefined} />
            {errors.name && <p className="account-field-error" id={FIELD_IDS.name + '-error'} role="alert">{errors.name}</p>}
          </div>}
          <div className="account-field">
            <label htmlFor={FIELD_IDS.email}>邮箱</label>
            <input id={FIELD_IDS.email} name="email" type="email" value={values.email} autoComplete={mode === 'reset' ? 'email' : 'username'} inputMode="email" autoCapitalize="off" spellCheck={false} placeholder="you@example.com"
              required maxLength={FORM.maxEmailLength} disabled={disabled} onChange={event => updateField('email', event.target.value)} onBlur={() => blurField('email')}
              aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? FIELD_IDS.email + '-error' : undefined} />
            {errors.email && <p className="account-field-error" id={FIELD_IDS.email + '-error'} role="alert">{errors.email}</p>}
          </div>
          {mode !== 'reset' && <>
            <PasswordField field="password" label="密码" value={values.password} error={errors.password} visible={visible.password} disabled={disabled} signup={mode === 'signup'}
              onChange={value => updateField('password', value)} onBlur={() => blurField('password')} onToggle={() => setVisible(previous => ({ ...previous, password: !previous.password }))} />
            {mode === 'signup' && <PasswordField field="confirmPassword" label="确认密码" value={values.confirmPassword} error={errors.confirmPassword} visible={visible.confirmPassword} disabled={disabled} signup
              onChange={value => updateField('confirmPassword', value)} onBlur={() => blurField('confirmPassword')} onToggle={() => setVisible(previous => ({ ...previous, confirmPassword: !previous.confirmPassword }))} />}
            <div className="account-form-options">
              <label className="account-remember"><input type="checkbox" name="remember" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={disabled} /><span>记住我</span></label>
              {mode === 'signin' && <button type="button" className="account-text-button" disabled={disabled} onClick={() => changeMode('reset')}>忘记密码？</button>}
            </div>
          </>}
          <button className="account-primary account-submit" type="submit" disabled={disabled || !session.available || (mode === 'reset' && resetRemaining > 0)}>
            {disabled ? <LoaderCircle className="account-spinner" size={19} aria-hidden="true" /> : null}
            {disabled ? mode === 'signup' ? '正在创建…' : mode === 'reset' ? '正在发送…' : '正在登录…' : mode === 'signup' ? '创建账号' : mode === 'reset' ? resetRemaining > 0 ? resetRemaining + '秒后可再发送' : '发送重置邮件' : '登录'}
            {!disabled && <ArrowRight size={19} aria-hidden="true" />}
          </button>
          {mode === 'reset' && <button type="button" className="account-text-button account-reset-link" disabled={disabled} onClick={() => changeMode('signin')}><ArrowLeft size={17} aria-hidden="true" />返回登录</button>}
        </form>}
      </>}
      {feedback && <p className={'account-message' + (feedback.error ? ' is-error' : '')} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </div>
  </section>;
}
