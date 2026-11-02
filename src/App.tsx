import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, Download, Feather, Heart, UserRound, Wind, X } from 'lucide-react';
import { SOURCES } from './config';
import { friendlyCloudError, useAuthSession } from './lib/firebase';
import { useJournal } from './lib/useJournal';
import { selectDrawingOwner } from './lib/playDrawing';
import { dailySeries, dayKey, exportData, localInput, moodMeta } from './lib/domain';
import AccountPanel from './components/AccountPanel';
const CareStudio = lazy(() => import('./components/CareStudio'));
/** 趣味玩法按需加载，首页不承担游戏画布与会话逻辑的体积。 */
const PlayHub = lazy(() => import('./components/PlayHub'));
import HomeComposer, { type ComposerState } from './components/HomeComposer';
import JournalView from './views/JournalView';
import InsightsView from './views/InsightsView';
import type { PracticeKind, MoodEntry } from './types';

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
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const onNotice = useCallback((text: string) => setNotice({ text, id: Date.now() }), []);
  const journal = useJournal(session, onNotice);
  const [form, setForm] = useState<ComposerState>(emptyComposer);
  const [editing, setEditing] = useState<MoodEntry | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MoodEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const previousUid = useRef<string | null>(null);
  const heading = headings[location.pathname] ?? '片刻';

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { const changed = () => setOnline(navigator.onLine); window.addEventListener('online', changed); window.addEventListener('offline', changed); return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }; }, []);
  useEffect(() => { document.title = `片刻 · ${navigation.find(item => item.path === location.pathname)?.title ?? '我的空间'}`; window.scrollTo(0, 0); }, [location.pathname]);
  // 已登录账号退出或换人时立即清空编辑状态，防止共用设备留下前一人的文字。
  useLayoutEffect(() => { const uid = session.user?.uid ?? null; if (previousUid.current && previousUid.current !== uid) { setForm(emptyComposer()); setEditing(null); setLastSaved(null); setDeleting(null); } previousUid.current = uid; }, [session.user?.uid]);
  // 即使在账号页切换身份，也立即释放前一人的画作；普通路由切换继续保留。
  useLayoutEffect(() => { selectDrawingOwner(session.user?.uid ?? 'guest'); }, [session.user?.uid]);
  useEffect(() => { const leave = (event: BeforeUnloadEvent) => { if (form.note || editing) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [form.note, editing]);

  /** 保存失败不清稿；访客和正式云端分别给出准确的成功提示。 */
  async function save() {
    if (!form.mood) return false;
    try {
      const occurred = new Date(form.occurredAt);
      if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() + 60000) throw new Error('请填写不晚于现在的有效记录时间。');
      const entry = await journal.save({ mood: form.mood, feelings: form.feelings, contexts: form.contexts, note: form.note.trim(), occurredAt: occurred.toISOString() }, editing);
      setLastSaved(entry.id); setEditing(null); setForm(emptyComposer());
      return true;
    } catch (error) { onNotice(friendlyCloudError(error)); return false; }
  }
  function beginEdit(entry: MoodEntry) { setEditing(entry); setForm({ mood: entry.mood, feelings: [...entry.feelings], contexts: [...entry.contexts], note: entry.note, occurredAt: localInput(entry.occurredAt) }); navigate('/'); }
  function resetEditor() { setEditing(null); setForm(emptyComposer()); }
  async function remove() { if (!deleting) return; setRemoving(true); try { await journal.remove(deleting); if (editing?.id === deleting.id) resetEditor(); if (lastSaved === deleting.id) setLastSaved(null); setDeleting(null); onNotice('这条记录已删除。'); } catch (error) { onNotice(friendlyCloudError(error)); } finally { setRemoving(false); } }
  function loadLatest() { const current = journal.entries.find(entry => entry.id === editing?.id); if (current) beginEdit(current); else onNotice('原记录已删除，当前草稿可以另存一条。'); }
  const displayName = session.user?.displayName || '我的空间';
  const syncLabel = !online ? '当前离线' : !session.ready ? '连接中' : journal.sync === 'saving' ? '正在同步' : journal.sync === 'error' ? '同步未完成' : journal.cloud ? journal.sync === 'synced' ? '云端已同步' : '连接云端中' : session.user ? '邮箱待验证' : '访客体验';

  return <div className={`app-shell ${location.pathname === '/' ? 'is-home' : ''}`} style={{ '--mood-color': form.mood ? moodMeta(form.mood).color : '#8eaa91' } as CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="site-header"><Link className="header-brand" to="/" aria-label="片刻首页"><Logo /><span>片刻</span></Link><nav className="header-nav" aria-label="主要导航">{navigation.map(({ path, title }) => <NavLink end={path === '/'} className={({ isActive }) => isActive ? 'is-active' : ''} to={path} key={path}>{title}</NavLink>)}</nav>{location.pathname === '/' && <span className="home-header-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>}<div className="header-tools"><span className={`tiny-status ${!online || journal.sync === 'error' ? 'is-error' : ''}`} role="status" aria-label={syncLabel} title={syncLabel} /><Link className="account-orb" to="/account" aria-label="我的空间" title={session.user ? displayName : '登录 · 云端同步'}>{session.user?.displayName ? session.user.displayName[0] : <UserRound size={18} />}</Link></div></header>
    <main className="main-shell" id="main-content">
      {location.pathname !== '/' && <div className="subpage-heading"><h1 className="subpage-title">{heading}</h1></div>}
      {session.user && !session.user.emailVerified && location.pathname !== '/account' && <div className="notice-banner"><span>验证邮箱后即可同步</span><Link to="/account">去验证<ArrowUpRight size={14} /></Link></div>}
      {!online && <div className="notice-banner is-error">当前离线，草稿仅保留在本页。</div>}
      {journal.pendingGuest > 0 && <div className="notice-banner"><span>{journal.pendingGuest} 条体验记录待保存</span><button className="text-button" disabled={journal.sync === 'saving'} onClick={() => journal.importGuest().then(() => onNotice('已同步')).catch(error => onNotice(friendlyCloudError(error)))}>存入账号<ArrowRight size={14} /></button></div>}
      <Suspense fallback={<div className="route-loading" aria-label="正在打开"><span /></div>}><Routes><Route path="/" element={<><HomeComposer form={form} setForm={setForm} editing={editing} busy={journal.sync === 'saving'} onSave={save} onCancel={resetEditor} onKeepNew={() => setEditing(null)} onLoadLatest={loadLatest} /><div className="home-secondary">{!journal.cloud && <p className="home-footnote">体验记录仅本页保留</p>}<Link className="home-care-link" to="/care"><Wind size={20} />玩一会儿<ArrowRight size={18} /></Link></div>{journal.entries.length > 0 && <WeekStrip entries={journal.entries} />}</>} />
        <Route path="/journal" element={<JournalView entries={journal.entries} onEdit={beginEdit} onDelete={setDeleting} onCreate={() => navigate('/')} />} />
        <Route path="/insights" element={<InsightsView entries={journal.entries} sessions={journal.sessions} />} />
        <Route path="/care" element={<CareRoute mood={form.mood ?? journal.entries[0]?.mood ?? null} entryId={lastSaved} onComplete={journal.saveCare} onNotice={onNotice} ownerKey={session.user?.uid ?? 'guest'} />} />
        <Route path="/account" element={<><AccountPanel session={session} onNotice={onNotice} /><div className="settings-grid"><details className="settings-panel"><summary>数据与隐私<Download size={16} /></summary><div className="settings-content"><div className="data-list"><span>日记<strong>{journal.entries.length} 条</strong></span><span>关怀<strong>{journal.sessions.length} 次</strong></span></div><button className="secondary-button" disabled={!journal.entries.length && !journal.sessions.length} onClick={() => { exportData(journal.entries, journal.sessions); onNotice('备份已开始下载'); }}><Download size={15} />导出记录</button><p className="subtle-copy">日记仅你可见。访客内容仅保留在当前页面；登录后可选择同步，不用于广告或模型分析。</p></div></details><details className="settings-panel" id="sources"><summary>内容来源<BookOpen size={16} /></summary><div className="settings-content">{SOURCES.map(source => <a className="source-link" key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><strong>{source.title}<ArrowUpRight size={14} /></strong></a>)}<p className="subtle-copy">日常关怀工具。如果困扰持续影响生活，可以向专业人士求助。</p></div></details></div></>} />
        <Route path="*" element={<div className="empty-state"><h2>这一页还没有故事</h2><Link className="primary-button" to="/">回到此刻</Link></div>} />
      </Routes></Suspense>
    </main>
    <nav className="mobile-nav" aria-label="手机导航">{navigation.map(({ path, title, icon: Icon }) => <NavLink end={path === '/'} className={({ isActive }) => isActive ? 'is-active' : ''} to={path} key={path}><Icon size={20} /><span>{title}</span></NavLink>)}</nav>
    {notice && <div className="toast" role="status"><Check size={16} /><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {deleting && <div className="modal-backdrop" onClick={() => { if (!removing) setDeleting(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !removing) setDeleting(null);
      // 确认对话框内循环键盘焦点，避免误触后面的导航。
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    }}><h2 id="delete-title">删除这条记录？</h2><p>这条记录会从{journal.cloud ? '你的云端与其他设备' : '本次体验'}中删除，删除后无法恢复。</p><div className="modal-actions"><button className="secondary-button" autoFocus disabled={removing} onClick={() => setDeleting(null)}>先留着</button><button className="primary-button danger-button" disabled={removing} onClick={remove}>{removing ? '正在删除…' : '确认删除这一条'}</button></div></section></div>}
  </div>;
}

export default function App() { return <PageBoundary><Application /></PageBoundary>; }
