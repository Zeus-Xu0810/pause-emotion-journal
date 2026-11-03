import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, CircleAlert, Download, Feather, Heart, Info, UserRound, Wind, X } from 'lucide-react';
import { SOURCES } from './config';
import { friendlyCloudError, useAuthSession } from './lib/firebase';
import { useJournal } from './lib/useJournal';
import { selectDrawingOwner } from './lib/playDrawing';
import { saveAccess } from './lib/save-policy';
import AuthGateDialog from './components/AuthGateDialog';
import { dailySeries, dayKey, exportData, localInput, moodMeta } from './lib/domain';
import AccountPanel from './components/AccountPanel';
const CareStudio = lazy(() => import('./components/CareStudio'));
/** 趣味玩法按需加载，首页不承担游戏画布与会话逻辑的体积。 */
const PlayHub = lazy(() => import('./components/PlayHub'));
import HomeComposer, { type ComposerState } from './components/HomeComposer';
import JournalView from './views/JournalView';
import InsightsView from './views/InsightsView';
import type { CareSession, PracticeKind, MoodEntry } from './types';

/** 编辑草稿与路由分离，去登录或验证邮箱时不会丢掉正在写的内容。 */
const emptyComposer = (): ComposerState => ({ mood: null, feelings: [], contexts: [], note: '', occurredAt: localInput() });
const navigation = [
  { path: '/', title: '此刻', icon: Feather, number: '01' },
  { path: '/journal', title: '日记', icon: BookOpen, number: '02' },
  { path: '/insights', title: '回顾', icon: ChartNoAxesCombined, number: '03' },
  { path: '/care', title: '放松', icon: Heart, number: '04' },
];
const headings: Record<string, string> = {
  '/journal': '我的片刻', '/insights': '情绪轨迹', '/care': '照顾自己', '/account': '我的空间',
};

/** 简洁的品牌标识复用暂停符号，所有资源随网站一起发布。 */
function Logo() { return <svg viewBox="0 0 42 42" fill="none" aria-hidden="true"><circle cx="21" cy="21" r="18" stroke="currentColor" strokeWidth="1.2" /><path d="M16 14v14m10-14v14" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /></svg>; }

/** 七天色印链接到对应日期，缺失日期保留空心圆。 */
function WeekStrip({ entries }: { entries: MoodEntry[] }) {
  const week = dailySeries(entries, 7);
  return <section className="week-strip home-week"><div className="week-heading"><h2>最近七天</h2></div><div className="week-days">{week.map(day => <Link to={`/journal?date=${day.date}`} key={day.date} className={`day-cell ${day.count ? 'has-entry' : ''} ${day.date === dayKey(new Date()) ? 'is-today' : ''}`} aria-label={`${day.date}，${day.count}条记录`}><span>{new Date(`${day.date}T12:00`).toLocaleDateString('zh-CN', { weekday: 'narrow' })}</span><span className="day-dot" style={day.score ? { background: moodMeta(day.score).color, borderColor: moodMeta(day.score).color } : {}} /><span>{Number(day.date.slice(-2))}</span></Link>)}</div></section>;
}

/** 默认先看玩法目录；旧的练习链接仍能直达，不改变历史记录。 */
function CareRoute({ mood, entryId, onComplete, onNotice, ownerKey }: Pick<React.ComponentProps<typeof CareStudio>, 'mood' | 'entryId' | 'onComplete' | 'onNotice'> & { ownerKey: string }) {
  const [params] = useSearchParams();
  const selected = params.get('type');
  const initialKind: PracticeKind | null = selected === 'breathing' || selected === 'mindfulness' || selected === 'movement' || selected === 'music' ? selected : null;
  if (!initialKind) return <PlayHub key={ownerKey} mood={mood} entryId={entryId} onComplete={onComplete} onNotice={onNotice} ownerKey={ownerKey} />;
  return <><Link className="care-directory-link text-button" to="/care">← 所有活动</Link><CareStudio key={`${ownerKey}-${initialKind}`} mood={mood} entryId={entryId} onComplete={onComplete} onNotice={onNotice} initialKind={initialKind} /></>;
}

/** 保存入口带来的返回地址和提示只在站内使用，登录后由本人再次确认保存。 */
function AccountRoute({ session, onNotice }: React.ComponentProps<typeof AccountPanel>) {
  const [params] = useSearchParams();
  const reason = params.get('reason');
  return <AccountPanel session={session} onNotice={onNotice} returnTo={params.get('returnTo') ?? '/'} authReason={reason === 'save' ? '草稿还在，登录后返回继续保存。' : reason === 'care' ? '登录后返回，保存刚才的活动反馈。' : undefined} />;
}

/** 应用错误边界保留可恢复入口，避免异常后呈现空白页面。 */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="empty-state"><h1>这一页暂时没打开</h1><p>可以刷新后再试一次，云端记录仍保存在你的账号里。</p><a className="primary-button" href="/">重新打开片刻</a></main> : this.props.children; }
}

function Application() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState<{ text: string; id: number; kind: 'info' | 'success' | 'error' } | null>(null);
  const onNotice = useCallback((text: string, kind: 'info' | 'success' | 'error' = 'info') => setNotice({ text, kind, id: Date.now() }), []);
  const journal = useJournal(session, onNotice);
  const [form, setForm] = useState<ComposerState>(emptyComposer);
  const [editing, setEditing] = useState<MoodEntry | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MoodEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const previousUser = useRef<typeof session.user>(null);
  const [authGate, setAuthGate] = useState<{ kind: 'signin' | 'verify'; returnTo: '/' | '/care' } | null>(null);
  const [pendingCare, setPendingCare] = useState<{ care: CareSession; owner: string | null } | null>(null);
  const operationOwner = useRef({ uid: session.user?.uid ?? null, user: session.user, epoch: 0 });
  const uid = session.user?.uid ?? null;
  if (operationOwner.current.user !== session.user) operationOwner.current = { uid, user: session.user, epoch: operationOwner.current.epoch + 1 };
  const liveDraft = useRef({ form, editing });
  liveDraft.current = { form, editing };
  const savingDraft = useRef<symbol | null>(null);
  const savingCare = useRef<symbol | null>(null);
  const heading = headings[location.pathname] ?? '片刻';
  // 无字贴纸也是草稿，刷新/关闭提示与活动关联使用同一个判断。
  const hasDraft = Boolean(form.mood || form.note || form.feelings.length || form.contexts.length || editing);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { const changed = () => setOnline(navigator.onLine); window.addEventListener('online', changed); window.addEventListener('offline', changed); return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }; }, []);
  useEffect(() => { document.title = `片刻 · ${navigation.find(item => item.path === location.pathname)?.title ?? '我的空间'}`; window.scrollTo(0, 0); }, [location.pathname]);
  // 已登录身份退出或重新登录时清空编辑；同一User的验证和昵称刷新不丢稿。
  useLayoutEffect(() => { if (previousUser.current && previousUser.current !== session.user) { setForm(emptyComposer()); setEditing(null); setLastSaved(null); setDeleting(null); setRemoving(false); setPendingCare(null); setAuthGate(null); savingDraft.current = null; savingCare.current = null; } previousUser.current = session.user; }, [session.user]);
  // 即使在账号页切换身份，也立即释放前一人的画作；普通路由切换继续保留。
  useLayoutEffect(() => { selectDrawingOwner(session.user?.uid ?? 'guest'); }, [session.user?.uid]);
  useEffect(() => { const leave = (event: BeforeUnloadEvent) => { if (hasDraft) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [hasDraft]);

  /** 先检查登录，再检查内容；访客即使尚未选情绪也能看到明确的保存说明。 */
  function canSave(returnTo: '/' | '/care') {
    const access = saveAccess(session);
    if (access === 'checking') { onNotice('正在确认登录状态，请稍后重试。'); return false; }
    if (access !== 'allowed') { setAuthGate({ kind: access, returnTo }); return false; }
    return true;
  }
  function continueToAccount(mode: 'signin' | 'signup') {
    if (!authGate) return;
    const params = new URLSearchParams({ mode, returnTo: authGate.returnTo, reason: authGate.returnTo === '/' ? 'save' : 'care' });
    setAuthGate(null); navigate(`/account?${params}`);
  }
  /** 保存期间捕获身份及草稿；迟到的响应不能清空后写的草稿或另一人的页面。 */
  async function save() {
    if (!canSave('/')) return false;
    if (!form.mood) { onNotice('先选一种此刻的心情。'); document.querySelector<HTMLButtonElement>('.home-mood')?.focus(); return false; }
    if (savingDraft.current) return false;
    const request = Symbol('diary-save'); savingDraft.current = request;
    const owner = operationOwner.current; const draft = form; const edited = editing;
    try {
      const occurred = new Date(draft.occurredAt);
      if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() + 60000) throw new Error('请填写不晚于现在的有效记录时间。');
      const entry = await journal.save({ mood: draft.mood!, feelings: draft.feelings, contexts: draft.contexts, note: draft.note.trim(), occurredAt: occurred.toISOString() }, edited);
      if (operationOwner.current !== owner) return false;
      if (liveDraft.current.form !== draft || liveDraft.current.editing !== edited) { onNotice('刚才的记录已保存，当前草稿仍为你保留。', 'success'); return false; }
      setLastSaved(entry.id); setEditing(null); setForm(emptyComposer());
      return true;
    } catch (error) { if (operationOwner.current === owner) onNotice(friendlyCloudError(error), 'error'); return false; }
    finally { if (savingDraft.current === request) savingDraft.current = null; }
  }
  /** 未登录的活动反馈仅暂存内存；登录后仍须主动保存，不上传画作或轨迹。 */
  async function saveCare(care: CareSession) {
    if (!canSave('/care')) {
      setPendingCare({ care, owner: uid });
      throw Object.assign(new Error('登录并验证邮箱后才能保存活动反馈。'), { code: 'auth-required' });
    }
    if (savingCare.current) throw new Error('上一份反馈正在保存，请稍候。');
    const request = Symbol('care-save'); savingCare.current = request;
    const owner = operationOwner.current;
    try {
      await journal.saveCare(care);
      if (operationOwner.current === owner) setPendingCare(previous => previous?.care.id === care.id ? null : previous);
    } finally { if (savingCare.current === request) savingCare.current = null; }
  }
  async function savePendingCare() {
    if (!pendingCare) return;
    const owner = operationOwner.current;
    try { await saveCare({ ...pendingCare.care, entryId: pendingCare.owner === uid ? pendingCare.care.entryId : null }); if (operationOwner.current === owner) onNotice('活动反馈已保存。', 'success'); }
    catch (error) { if (operationOwner.current === owner && !(error && typeof error === 'object' && 'code' in error && error.code === 'auth-required')) onNotice(friendlyCloudError(error), 'error'); }
  }
  function beginEdit(entry: MoodEntry) { setLastSaved(null); setEditing(entry); setForm({ mood: entry.mood, feelings: [...entry.feelings], contexts: [...entry.contexts], note: entry.note, occurredAt: localInput(entry.occurredAt) }); navigate('/'); }
  function resetEditor() { setEditing(null); setForm(emptyComposer()); }
  async function remove() {
    if (!deleting || removing) return;
    const entry = deleting; const owner = operationOwner.current; setRemoving(true);
    try {
      await journal.remove(entry);
      if (operationOwner.current !== owner) return;
      if (liveDraft.current.editing?.id === entry.id) resetEditor();
      setLastSaved(previous => previous === entry.id ? null : previous);
      setDeleting(null); onNotice('这条记录已删除。', 'success');
    } catch (error) { if (operationOwner.current === owner) onNotice(friendlyCloudError(error), 'error'); }
    finally { if (operationOwner.current === owner) setRemoving(false); }
  }
  function loadLatest() { const current = journal.entries.find(entry => entry.id === editing?.id); if (current) beginEdit(current); else onNotice('原记录已删除，当前草稿可以另存一条。'); }
  // 新草稿不能再关联上一条已保存日记，避免关怀反馈串联到错误情绪。
  const careEntryId = hasDraft ? null : lastSaved;
  /** 初次读取失败显示重连入口，不能把网络失败当作账号没有记录。 */
  const recordLoadError = <div className="empty-state" role="alert"><h2>暂时无法读取记录</h2><p>检查网络后重试，当前草稿仍在。</p><button className="secondary-button" onClick={journal.retry}>重新连接</button></div>;
  const displayName = session.user?.displayName || '我的空间';
  const syncLabel = !online ? '当前离线' : !session.ready ? '连接中' : journal.sync === 'saving' ? '正在同步' : journal.sync === 'error' ? '同步未完成' : journal.cloud ? journal.sync === 'synced' ? '云端已同步' : '连接云端中' : session.user ? '邮箱待验证' : '访客体验';

  return <div className={`app-shell ${location.pathname === '/' ? 'is-home' : ''}`} style={{ '--mood-color': form.mood ? moodMeta(form.mood).color : '#8eaa91' } as CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="site-header"><Link className="header-brand" to="/" aria-label="片刻首页"><Logo /><span>片刻</span></Link><nav className="header-nav" aria-label="主要导航">{navigation.map(({ path, title }) => <NavLink end={path === '/'} className={({ isActive }) => isActive ? 'is-active' : ''} to={path} key={path}>{title}</NavLink>)}</nav>{location.pathname === '/' && <span className="home-header-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>}<div className="header-tools"><span className={`tiny-status ${!online || journal.sync === 'error' ? 'is-error' : ''}`} role="status" aria-label={syncLabel} title={syncLabel} /><Link className="account-orb" to="/account" aria-label="我的空间" title={session.user ? displayName : '登录 · 云端同步'}>{session.user?.displayName ? session.user.displayName[0] : <UserRound size={18} />}</Link></div></header>
    <main className="main-shell" id="main-content">
      {location.pathname !== '/' && location.pathname !== '/account' && <div className="subpage-heading"><h1 className="subpage-title">{heading}</h1></div>}
      {session.user && !session.user.emailVerified && location.pathname !== '/account' && <div className="notice-banner"><span>验证邮箱后即可同步</span><Link to="/account">去验证<ArrowUpRight size={14} /></Link></div>}
      {!online && <div className="notice-banner is-error">当前离线，草稿仅保留在本页。</div>}
      {pendingCare && journal.cloud && location.pathname === '/care' && <div className="notice-banner"><span>有一份活动反馈尚未保存</span><button className="text-button" disabled={journal.sync === 'saving'} onClick={() => void savePendingCare()}>保存反馈<ArrowRight size={16} /></button></div>}
      {/* 身份更换时同时清空纸条的本地成功邮票，避免沿用上一人的视觉反馈。 */}
      <Suspense fallback={<div className="route-loading" aria-label="正在打开"><span /></div>}><Routes><Route path="/" element={<><HomeComposer key={`${uid ?? 'guest'}:${operationOwner.current.epoch}`} form={form} setForm={setForm} editing={editing} busy={journal.sync === 'saving'} startExpanded={Boolean(location.state?.notebook)} onSave={save} onCancel={resetEditor} onKeepNew={() => setEditing(null)} onLoadLatest={loadLatest} /><div className="home-secondary">{!journal.cloud && <p className="home-footnote">登录并验证邮箱后保存</p>}<Link className="home-care-link" to="/care"><Wind size={20} />玩一会儿<ArrowRight size={18} /></Link></div>{journal.entries.length > 0 && <WeekStrip entries={journal.entries} />}</>} />
        <Route path="/journal" element={<>{journal.loadFailed ? recordLoadError : journal.loading ? <div className="route-loading" role="status">正在读取日记…</div> : <JournalView entries={journal.entries} onEdit={beginEdit} onDelete={setDeleting} onCreate={() => navigate('/', { state: { notebook: true } })} />}</>} />
        <Route path="/insights" element={<>{journal.loadFailed ? recordLoadError : journal.loading ? <div className="route-loading" role="status">正在读取情绪轨迹…</div> : <InsightsView entries={journal.entries} sessions={journal.sessions} />}</>} />
        <Route path="/care" element={<CareRoute mood={form.mood ?? journal.entries[0]?.mood ?? null} entryId={careEntryId} onComplete={saveCare} onNotice={onNotice} ownerKey={session.user?.uid ?? 'guest'} />} />
        <Route path="/account" element={<><AccountRoute session={session} onNotice={onNotice} /><div className="settings-grid"><details className="settings-panel"><summary>数据与隐私<Download size={16} /></summary><div className="settings-content"><div className="data-list"><span>日记<strong>{journal.entries.length} 条</strong></span><span>关怀<strong>{journal.sessions.length} 次</strong></span></div><button className="secondary-button" disabled={!journal.entries.length && !journal.sessions.length} onClick={() => { exportData(journal.entries, journal.sessions); onNotice('备份已开始下载', 'success'); }}><Download size={15} />导出记录</button><p className="subtle-copy">草稿只在当前页面保留，登录并验证邮箱后才会保存到个人云端。不用于广告或模型分析。</p></div></details><details className="settings-panel" id="sources"><summary>内容来源<BookOpen size={16} /></summary><div className="settings-content">{SOURCES.map(source => <a className="source-link" key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><strong>{source.title}<ArrowUpRight size={14} /></strong></a>)}<p className="subtle-copy">日常关怀工具。如果困扰持续影响生活，可以向专业人士求助。</p></div></details></div></>} />
        <Route path="*" element={<div className="empty-state"><h2>这一页还没有故事</h2><Link className="primary-button" to="/">回到此刻</Link></div>} />
      </Routes></Suspense>
    </main>
    <nav className="mobile-nav" aria-label="手机导航">{navigation.map(({ path, title, icon: Icon }) => <NavLink end={path === '/'} className={({ isActive }) => isActive ? 'is-active' : ''} to={path} key={path}><Icon size={20} /><span>{title}</span></NavLink>)}</nav>
    {notice && <div className={`toast is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'error' ? <CircleAlert size={18} /> : notice.kind === 'success' ? <Check size={18} /> : <Info size={18} />}<span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {authGate && <AuthGateDialog kind={authGate.kind} onClose={() => setAuthGate(null)} onContinue={continueToAccount} />}
    {deleting && <div className="modal-backdrop" onClick={() => { if (!removing) setDeleting(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !removing) setDeleting(null);
      // 确认对话框内循环键盘焦点，避免误触后面的导航。
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    }}><h2 id="delete-title">删除这条记录？</h2><p>这条记录会从你的云端与其他设备中删除，删除后无法恢复。</p><div className="modal-actions"><button className="secondary-button" autoFocus disabled={removing} onClick={() => setDeleting(null)}>先留着</button><button className="primary-button danger-button" disabled={removing} onClick={remove}>{removing ? '正在删除…' : '确认删除这一条'}</button></div></section></div>}
  </div>;
}

export default function App() { return <PageBoundary><Application /></PageBoundary>; }
