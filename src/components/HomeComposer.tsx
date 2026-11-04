import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, Feather, X } from 'lucide-react';
import { MOODS } from '../config';
import { JOURNAL_SETTINGS } from '../journal-content';
import Weather from './Weather';
import JournalNotebook from './JournalNotebook';
import JournalStamp from './JournalStamp';
import type { MoodEntry, MoodScore } from '../types';

/** 三维资源单独加载，主操作先出现；低性能设备仍可记录。 */
const MoodSculpture = lazy(() => import('./MoodSculpture'));
export interface ComposerState { mood: MoodScore | null; feelings: string[]; contexts: string[]; note: string; occurredAt: string }
interface HomeComposerProps {
  form: ComposerState;
  setForm: (form: ComposerState) => void;
  editing: MoodEntry | null;
  busy: boolean;
  startExpanded?: boolean;
  onSave: () => Promise<boolean>;
  onCancel: () => void;
  onKeepNew: () => void;
  onLoadLatest: () => void;
}

/** 首屏保留快速记录；主动展开后用贴纸和纸条补充，不强迫打字。 */
export default function HomeComposer({ form, setForm, editing, busy, startExpanded = false, onSave, onCancel, onKeepNew, onLoadLatest }: HomeComposerProps) {
  // 从日记页“记一笔”进入时直接打开小纸条，仍不自动唤出键盘。
  const [expanded, setExpanded] = useState(startExpanded || Boolean(editing));
  const [saved, setSaved] = useState(false);
  const [receiptMood, setReceiptMood] = useState<MoodScore | null>(null);
  const saving = useRef(false);
  const scrollToDiary = useRef(false);
  useEffect(() => { if (editing) setExpanded(true); }, [editing?.id]);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(false), JOURNAL_SETTINGS.receiptMs); return () => clearTimeout(timer); }, [saved]);
  // 主动点击写日记后展示纸条位置，手机键盘仍由用户点击输入框唤出。
  useEffect(() => {
    if (!expanded || !scrollToDiary.current) return;
    scrollToDiary.current = false;
    document.getElementById('moment-extras')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [expanded]);
  const extraCount = form.feelings.length + form.contexts.length;
  // 只有真实保存成功才收好纸条；失败、访客拦截和重复点击均不播放成功反馈。
  async function save() {
    if (saving.current) return;
    saving.current = true; const mood = form.mood;
    try { if (await onSave()) { setReceiptMood(mood); setSaved(true); setExpanded(false); } }
    finally { saving.current = false; }
  }

  return <section className="home-page" aria-label="情绪记录">
    <div className="home-heading"><p className="home-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p><h1 className="home-title">此刻，感觉如何？</h1></div>
    <div className="home-stage"><Suspense fallback={<div className="sculpture-loading"><Weather mood={form.mood ?? 5} /></div>}><MoodSculpture mood={form.mood} /></Suspense></div>
    <div className="home-moods" role="group" aria-label="选择情绪">{MOODS.map(mood => <button key={mood.score} className={`home-mood ${form.mood === mood.score ? 'is-selected' : ''}`} disabled={busy} aria-pressed={form.mood === mood.score} style={{ '--mood-color': mood.color } as CSSProperties} onClick={() => { setSaved(false); setForm({ ...form, mood: mood.score }); }}><span className="mood-dot" aria-hidden="true" /><span>{mood.label}</span></button>)}</div>

    {editing && <div className="edit-banner"><span>编辑这一个片刻</span><div className="inline-actions"><button className="text-button" disabled={busy} onClick={onLoadLatest}>更新版本</button><button className="text-button" disabled={busy} onClick={onKeepNew}>另存</button><button className="icon-button" aria-label="取消编辑" disabled={busy} onClick={onCancel}><X size={16} /></button></div></div>}
    {expanded && <JournalNotebook form={form} setForm={setForm} busy={busy} editing={editing} initialTab="note" />}
    {/* 访客与未选情绪均可点击保存并收到说明；仅请求处理中或刚保存成功时短暂禁用。 */}
    {/* 日记入口与保存同级呈现，用明确名称和两行短提示说明可以写下具体经历。 */}
    <div className="home-actions"><button className="home-note-toggle" disabled={busy} aria-label={expanded ? '收起日记' : form.note ? '继续写日记' : '写日记'} aria-expanded={expanded} aria-controls="moment-extras" onClick={() => { setSaved(false); scrollToDiary.current = !expanded; setExpanded(!expanded); }}>{expanded ? <X size={18} /> : <Feather size={20} />}<span className="home-diary-copy"><span>{expanded ? '收起' : form.note ? '继续写日记' : '写日记'}</span>{!expanded && <small>写下今天的小事</small>}</span>{!expanded && extraCount > 0 && <span className="home-diary-count">{extraCount}</span>}</button><button className={`primary-button home-save ${saved ? 'is-saved' : ''}`} disabled={busy || saved} onClick={() => void save()}>{saved ? <Check size={20} /> : null}{busy ? '保存中' : saved ? '已记下' : editing ? '保存修改' : '记下此刻'}{!saved && <ArrowRight size={20} />}</button></div>
    {saved && <div className="notebook-receipt" role="status"><span className="notebook-receipt-art"><JournalStamp mood={receiptMood} /></span><span>收好啦，这一刻有了自己的位置。</span></div>}
  </section>;
}
