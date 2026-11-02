import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, ChartNoAxesCombined, Check, Cloud, Download, Feather, Heart, LockKeyhole, UserRound, WifiOff, X } from 'lucide-react';
import { CONTEXTS, FEELINGS, MOODS, SETTINGS, SOURCES } from './config';
import { friendlyCloudError, useAuthSession } from './lib/firebase';
import { useJournal } from './lib/useJournal';
import { dailySeries, dayKey, exportData, localInput, moodMeta, recommendCare } from './lib/domain';
import AccountPanel from './components/AccountPanel';
import CareStudio from './components/CareStudio';
import Weather from './components/Weather';
import JournalView from './views/JournalView';
import InsightsView from './views/InsightsView';
import type { CareKind, MoodEntry, MoodScore } from './types';

/** 编辑草稿与路由分离，去登录或验证邮箱时不会丢掉正在写的内容。 */
interface ComposerState { mood: MoodScore | null; feelings: string[]; contexts: string[]; note: string; occurredAt: string }
const emptyComposer = (): ComposerState => ({ mood: null, feelings: [], contexts: [], note: '', occurredAt: localInput() });
const navigation = [
  { path: '/', title: '此刻', icon: Feather, number: '01' },
  { path: '/journal', title: '日记', icon: BookOpen, number: '02' },
  { path: '/insights', title: '看见自己', icon: ChartNoAxesCombined, number: '03' },
  { path: '/care', title: '关怀小站', icon: Heart, number: '04' },
];
const headings: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/': { eyebrow: 'A LITTLE SPACE, JUST FOR YOU', title: '此刻，心里是什么天气？', description: '一笔就好，不必写得完整。' },
  '/journal': { eyebrow: 'THE DAYS WE KEEP', title: '每一页，都有当时的你。', description: '翻一翻那些片刻，情绪会留下自己的纹理。' },
  '/insights': { eyebrow: 'GETTING TO KNOW YOURSELF', title: '慢慢地，看见自己的节奏。', description: '从记录里找线索，不急着给情绪下结论。' },
  '/care': { eyebrow: 'SMALL THINGS THAT HELP', title: '照顾自己，从一件小事开始。', description: '有一分钟也可以。挑一种此刻想试试的方式。' },
  '/account': { eyebrow: 'YOUR OWN QUIET CORNER', title: '留一个，只属于你的空间。', description: '网站向所有人开放，你的日记只对你可见。' },
};

/** 简洁的品牌标识复用暂停符号，所有资源随网站一起发布。 */
function Logo() { return <svg viewBox="0 0 42 42" fill="none" aria-hidden="true"><circle cx="21" cy="21" r="18" stroke="currentColor" strokeWidth="1.2" /><path d="M16 14v14m10-14v14" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /></svg>; }

/** 记录编辑器将评分、感受与情境分开，文字保持可选。 */
function Composer({ form, setForm, editing, busy, onSave, onCancel, onKeepNew, onLoadLatest }: { form: ComposerState; setForm: (form: ComposerState) => void; editing: MoodEntry | null; busy: boolean; onSave: () => void; onCancel: () => void; onKeepNew: () => void; onLoadLatest: () => void }) {
  const selected = form.mood ? moodMeta(form.mood) : null;
  const toggle = (field: 'feelings' | 'contexts', value: string) => setForm({ ...form, [field]: form[field].includes(value) ? form[field].filter(item => item !== value) : [...form[field], value] });
  return <section className="journal-panel" aria-label="情绪记录">
    <div className="panel-heading"><span className="section-number">01 / CHECK IN</span><h2>给此刻留一笔</h2><Feather size={17} strokeWidth={1.3} /></div>
    {editing && <div className="edit-banner"><p>正在编辑 {new Date(editing.occurredAt).toLocaleDateString('zh-CN')} 的记录</p><div className="inline-actions"><button className="text-button" onClick={onLoadLatest}>载入最新版本</button><button className="text-button" onClick={onKeepNew}>另存一条</button><button className="icon-button" aria-label="取消编辑" onClick={onCancel}><X size={16} /></button></div></div>}
    <div className="mood-stage" style={{ color: selected?.color ?? 'var(--green)' }}><Weather mood={form.mood ?? 3} /><p className="mood-label">{selected ? selected.weather : '先感受一下自己'}</p><p className="mood-hint">{selected ? selected.hint : '晴天、阴天，都是生活的一部分。'}</p></div>
    <div className="mood-selector" role="group" aria-label="选择情绪">{MOODS.map(mood => <button key={mood.score} type="button" className={`mood-option ${form.mood === mood.score ? 'is-selected' : ''}`} aria-pressed={form.mood === mood.score} style={{ '--mood-color': mood.color } as CSSProperties} onClick={() => setForm({ ...form, mood: mood.score })}><Weather mood={mood.score} mini /><span className="mood-name">{mood.label}</span></button>)}</div>
    <p className="field-label">更具体一点，是什么感觉？<span>可多选</span></p><div className="tag-list" role="group" aria-label="细分感受">{FEELINGS.map(feeling => <button type="button" className={`tag ${form.feelings.includes(feeling) ? 'is-selected' : ''}`} aria-pressed={form.feelings.includes(feeling)} key={feeling} onClick={() => toggle('feelings', feeling)}>{feeling}</button>)}</div>
    <p className="field-label">可能和什么有关？<span>可多选</span></p><div className="tag-list" role="group" aria-label="情绪情境">{CONTEXTS.map(context => <button type="button" className={`tag ${form.contexts.includes(context) ? 'is-selected' : ''}`} aria-pressed={form.contexts.includes(context)} key={context} onClick={() => toggle('contexts', context)}>{context}</button>)}</div>
    <label className="field-label" htmlFor="journal-note">想写的话，放在这里。<span>也可以留空</span></label><textarea id="journal-note" className="note-input" maxLength={SETTINGS.maxNoteLength} placeholder="发生了什么？或者，有什么想对自己说的……" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /><div className="char-count">{form.note.length} / {SETTINGS.maxNoteLength}</div>
    <label className="record-time" htmlFor="occurred-at"><CalendarDays size={14} /><span>记录时间</span><input id="occurred-at" aria-label="记录时间" type="datetime-local" value={form.occurredAt} max={localInput()} onChange={event => setForm({ ...form, occurredAt: event.target.value })} /></label>
    <div className="composer-footer"><span className="privacy-note"><LockKeyhole size={13} />每一种情绪，都可以被记下。</span><button className="primary-button" disabled={!form.mood || busy} onClick={onSave}>{busy ? '正在保存…' : editing ? '保存修改' : '收好这一刻'}<ArrowRight size={16} /></button></div>
  </section>;
}

/** 七天色印链接到对应日期，缺失日期保留空心圆。 */
function WeekStrip({ entries }: { entries: MoodEntry[] }) {
  const week = dailySeries(entries, 7);
  return <section className="week-strip"><div className="week-heading"><h2>这一周的片刻</h2><p>不必每天都有答案。</p></div><div className="week-days">{week.map(day => <Link to={`/journal?date=${day.date}`} key={day.date} className={`day-cell ${day.count ? 'has-entry' : ''} ${day.date === dayKey(new Date()) ? 'is-today' : ''}`} aria-label={`${day.date}，${day.count}条记录`}><span>{new Date(`${day.date}T12:00`).toLocaleDateString('zh-CN', { weekday: 'narrow' })}</span><span className="day-dot" style={day.score ? { background: moodMeta(day.score).color, borderColor: moodMeta(day.score).color } : {}} /><span>{Number(day.date.slice(-2))}</span></Link>)}</div></section>;
}

/** 关怀路由允许首页推荐直接指定类型，其他选择由关怀模块自行管理。 */
function CareRoute({ mood, entryId, onComplete, onNotice }: Pick<React.ComponentProps<typeof CareStudio>, 'mood' | 'entryId' | 'onComplete' | 'onNotice'>) {
  const [params] = useSearchParams();
  const selected = params.get('type');
  const initialKind: CareKind = selected === 'breathing' || selected === 'mindfulness' || selected === 'movement' || selected === 'music' ? selected : 'breathing';
  return <CareStudio key={initialKind} mood={mood} entryId={entryId} onComplete={onComplete} onNotice={onNotice} initialKind={initialKind} />;
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
  const heading = headings[location.pathname] ?? headings['/'];
  const recommendation = recommendCare(form.feelings, journal.sessions);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { const changed = () => setOnline(navigator.onLine); window.addEventListener('online', changed); window.addEventListener('offline', changed); return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }; }, []);
  useEffect(() => { document.title = `片刻 · ${navigation.find(item => item.path === location.pathname)?.title ?? '我的空间'}`; window.scrollTo(0, 0); }, [location.pathname]);
  // 已登录账号退出或换人时立即清空编辑状态，防止共用设备留下前一人的文字。
  useLayoutEffect(() => { const uid = session.user?.uid ?? null; if (previousUid.current && previousUid.current !== uid) { setForm(emptyComposer()); setEditing(null); setLastSaved(null); setDeleting(null); } previousUid.current = uid; }, [session.user?.uid]);
  useEffect(() => { const leave = (event: BeforeUnloadEvent) => { if (form.note || editing) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [form.note, editing]);

  /** 保存失败不清稿；访客和正式云端分别给出准确的成功提示。 */
  async function save() {
    if (!form.mood) return;
    try {
      const occurred = new Date(form.occurredAt);
      if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() + 60000) throw new Error('请填写不晚于现在的有效记录时间。');
      const entry = await journal.save({ mood: form.mood, feelings: form.feelings, contexts: form.contexts, note: form.note.trim(), occurredAt: occurred.toISOString() }, editing);
      setLastSaved(entry.id); setEditing(null); setForm(emptyComposer());
      onNotice(journal.cloud ? '已保存到你的个人云端。' : '已收好这一刻。访客记录仅在本次页面中保留。');
    } catch (error) { onNotice(friendlyCloudError(error)); }
  }
  function beginEdit(entry: MoodEntry) { setEditing(entry); setForm({ mood: entry.mood, feelings: [...entry.feelings], contexts: [...entry.contexts], note: entry.note, occurredAt: localInput(entry.occurredAt) }); navigate('/'); }
  function resetEditor() { setEditing(null); setForm(emptyComposer()); }
  async function remove() { if (!deleting) return; setRemoving(true); try { await journal.remove(deleting); if (editing?.id === deleting.id) resetEditor(); if (lastSaved === deleting.id) setLastSaved(null); setDeleting(null); onNotice('这条记录已删除。'); } catch (error) { onNotice(friendlyCloudError(error)); } finally { setRemoving(false); } }
  function loadLatest() { const current = journal.entries.find(entry => entry.id === editing?.id); if (current) beginEdit(current); else onNotice('原记录已删除，当前草稿可以另存一条。'); }
  const displayName = session.user?.displayName || '我的空间';
  const syncLabel = !online ? '当前离线' : !session.ready ? '连接中' : journal.sync === 'saving' ? '正在同步' : journal.sync === 'error' ? '同步未完成' : journal.cloud ? journal.sync === 'synced' ? '云端已同步' : '连接云端中' : session.user ? '邮箱待验证' : '访客体验';

  return <div className="app-shell" style={{ '--mood-color': form.mood ? moodMeta(form.mood).color : '#8eaa91' } as CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar"><Link className="brand" to="/" aria-label="片刻首页"><span className="brand-mark"><Logo /></span><div><span className="brand-title">片刻</span><span className="brand-en">PAUSE</span></div></Link><nav className="nav-list" aria-label="主要导航">{navigation.map(({ path, title, icon: Icon, number }) => <NavLink end={path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`} to={path} key={path}><Icon size={18} /><span>{title}</span><span className="nav-index">{number}</span></NavLink>)}</nav><div className="sidebar-foot"><p>有晴，也有雨。</p><p>都可以在这里停一会儿。</p><Link to="/account" className="sidebar-account"><UserRound size={15} />我的空间<ArrowUpRight size={13} /></Link></div></aside>
    <main className="main-shell" id="main-content"><header className="topbar"><p className="date-line"><span className="mobile-brand"><Logo />片刻</span>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p><div className="topbar-right"><span className={`sync-badge ${!online || journal.sync === 'error' ? 'is-error' : ''}`} role="status">{!online ? <WifiOff size={13} /> : journal.cloud ? <Cloud size={13} /> : <span className="status-dot" />}{syncLabel}</span><Link className="account-button" to="/account"><UserRound size={16} /><span>{displayName}</span></Link></div></header>
      <div className="page-heading"><p className="eyebrow">{heading.eyebrow}</p><h1>{heading.title}</h1><p>{heading.description}</p></div>
      {!journal.cloud && location.pathname !== '/account' && <div className="notice-banner"><span>{session.user ? '验证邮箱后，可以把记录保存在你的个人云端。' : '访客记录仅保留在当前页面。登录后，可以跨设备继续。'}</span><Link to="/account">{session.user ? '去验证' : '登录 / 注册'}<ArrowUpRight size={14} /></Link></div>}
      {!online && <div className="notice-banner is-error">当前离线。未同步内容只保留在此页面，关闭前请导出备份。</div>}
      {journal.pendingGuest > 0 && <div className="notice-banner"><span>还有 {journal.pendingGuest} 条体验记录保留在本页，是否存入当前账号？</span><button className="text-button" disabled={journal.sync === 'saving'} onClick={() => journal.importGuest().then(() => onNotice('体验记录已保存到你的个人云端。')).catch(error => onNotice(friendlyCloudError(error)))}>保存到我的账号<ArrowRight size={14} /></button></div>}
      <Routes><Route path="/" element={<><div className="dashboard-grid"><Composer form={form} setForm={setForm} editing={editing} busy={journal.sync === 'saving'} onSave={save} onCancel={resetEditor} onKeepNew={() => { setEditing(null); onNotice('草稿已保留，下一次保存会新建一条。'); }} onLoadLatest={loadLatest} /><CareStudio compact mood={form.mood} entryId={lastSaved} onComplete={journal.saveCare} onNotice={onNotice} /></div><WeekStrip entries={journal.entries} /><Link className="recommendation-strip" to={`/care?type=${recommendation.kind}`}><div><p className="eyebrow">ONE SMALL THING</p><h2>{recommendation.title}</h2><p>{recommendation.reason}</p></div><span className="recommendation-arrow"><ArrowUpRight size={26} /></span></Link></>} />
        <Route path="/journal" element={<JournalView entries={journal.entries} onEdit={beginEdit} onDelete={setDeleting} onCreate={() => navigate('/')} />} />
        <Route path="/insights" element={<InsightsView entries={journal.entries} sessions={journal.sessions} />} />
        <Route path="/care" element={<CareRoute mood={form.mood ?? journal.entries[0]?.mood ?? null} entryId={lastSaved} onComplete={journal.saveCare} onNotice={onNotice} />} />
        <Route path="/account" element={<><AccountPanel session={session} onNotice={onNotice} /><div className="settings-grid"><section className="settings-panel"><div className="panel-heading"><Download size={18} /><h2>你的记录，由你保管</h2></div><p>下载完整日记与关怀反馈，保存一份属于自己的备份。</p><div className="data-list"><span>情绪记录<strong>{journal.entries.length} 条</strong></span><span>关怀反馈<strong>{journal.sessions.length} 次</strong></span></div><button className="secondary-button" disabled={!journal.entries.length && !journal.sessions.length} onClick={() => { exportData(journal.entries, journal.sessions); onNotice('备份已开始下载。请妥善保存这个私人文件。'); }}><Download size={16} />导出我的记录</button><p className="subtle-copy">未保存的输入仅留在当前页面；切换账号会清空。私人日记不用于广告，也不发送给大模型分析。</p></section><section className="settings-panel" id="sources"><div className="panel-heading"><BookOpen size={18} /><h2>关于这些小方法</h2></div><p>关怀内容参考以下公开资料。每个人适合的方式不同，可以慢慢尝试。</p>{SOURCES.map(source => <a className="source-link" key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><strong>{source.title}<ArrowUpRight size={14} /></strong><span>{source.description}</span></a>)}</section></div></>} />
        <Route path="*" element={<div className="empty-state"><h2>这一页还没有故事</h2><Link className="primary-button" to="/">回到此刻</Link></div>} />
      </Routes>
      <footer className="quiet-footer"><p>片刻 / 给情绪一点空间</p><p>日常自我关怀工具。如果困扰持续影响生活，可以向专业人士求助。</p></footer>
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
    }}><p className="eyebrow">YOUR JOURNAL</p><h2 id="delete-title">删除这一个片刻？</h2><p>这条记录会从{journal.cloud ? '你的云端与其他设备' : '本次体验'}中删除，删除后无法恢复。</p><div className="modal-actions"><button className="secondary-button" autoFocus disabled={removing} onClick={() => setDeleting(null)}>先留着</button><button className="primary-button danger-button" disabled={removing} onClick={remove}>{removing ? '正在删除…' : '确认删除这一条'}</button></div></section></div>}
  </div>;
}

export default function App() { return <PageBoundary><Application /></PageBoundary>; }
