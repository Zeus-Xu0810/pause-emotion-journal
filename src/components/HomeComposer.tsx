import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, Plus, X } from 'lucide-react';
import { CONTEXTS, FEELINGS, MOODS, SETTINGS } from '../config';
import { localInput } from '../lib/domain';
import Weather from './Weather';
import type { MoodEntry, MoodScore } from '../types';

/** 三维资源单独加载，主操作先出现；低性能设备仍可记录。 */
const MoodSculpture = lazy(() => import('./MoodSculpture'));
export interface ComposerState { mood: MoodScore | null; feelings: string[]; contexts: string[]; note: string; occurredAt: string }
interface HomeComposerProps {
  form: ComposerState;
  setForm: (form: ComposerState) => void;
  editing: MoodEntry | null;
  busy: boolean;
  onSave: () => Promise<boolean>;
  onCancel: () => void;
  onKeepNew: () => void;
  onLoadLatest: () => void;
}

/** 首屏只选心情；文字、感受、情境和时间通过同一处渐进展开。 */
export default function HomeComposer({ form, setForm, editing, busy, onSave, onCancel, onKeepNew, onLoadLatest }: HomeComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'note' | 'feelings' | 'contexts'>('note');
  const [showTime, setShowTime] = useState(false);
  const [saved, setSaved] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { setExpanded(true); setTab('note'); } }, [editing?.id]);
  useEffect(() => { if (expanded && tab === 'note') noteRef.current?.focus(); }, [expanded, tab]);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(false), 2200); return () => clearTimeout(timer); }, [saved]);
  const toggle = (field: 'feelings' | 'contexts', value: string) => setForm({ ...form, [field]: form[field].includes(value) ? form[field].filter(item => item !== value) : [...form[field], value] });
  const extraCount = form.feelings.length + form.contexts.length;
  async function save() { if (await onSave()) { setSaved(true); setExpanded(false); setShowTime(false); } }

  return <section className="home-page" aria-label="情绪记录">
    <div className="home-heading"><p className="home-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p><h1 className="home-title">此刻，感觉如何？</h1></div>
    <div className="home-stage"><Suspense fallback={<div className="sculpture-loading"><Weather mood={form.mood ?? 5} /></div>}><MoodSculpture mood={form.mood} /></Suspense></div>
    <div className="home-moods" role="group" aria-label="选择情绪">{MOODS.map(mood => <button key={mood.score} className={`home-mood ${form.mood === mood.score ? 'is-selected' : ''}`} aria-pressed={form.mood === mood.score} style={{ '--mood-color': mood.color } as CSSProperties} onClick={() => { setSaved(false); setForm({ ...form, mood: mood.score }); }}><span className="mood-dot" aria-hidden="true" /><span>{mood.label}</span></button>)}</div>

    {editing && <div className="edit-banner"><span>编辑这一个片刻</span><div className="inline-actions"><button className="text-button" onClick={onLoadLatest}>更新版本</button><button className="text-button" onClick={onKeepNew}>另存</button><button className="icon-button" aria-label="取消编辑" onClick={onCancel}><X size={16} /></button></div></div>}
    {expanded && <div className="home-extras" id="moment-extras">
      <div className="extras-tabs" role="tablist" aria-label="补充记录">{(['note', 'feelings', 'contexts'] as const).map((key, index) => <button key={key} role="tab" id={`extra-tab-${key}`} aria-selected={tab === key} aria-controls="extra-panel" className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{['文字', '感受', '情境'][index]}{key !== 'note' && form[key].length > 0 && <span className="extra-count">{form[key].length}</span>}</button>)}<button className={`icon-button ${showTime ? 'is-active' : ''}`} aria-label="补记时间" aria-expanded={showTime} onClick={() => setShowTime(!showTime)}><Clock3 size={16} /></button></div>
      <div className="extras-section" id="extra-panel" role="tabpanel" aria-labelledby={`extra-tab-${tab}`}>{tab === 'note' ? <textarea ref={noteRef} className="home-note" aria-label="写下此刻" maxLength={SETTINGS.maxNoteLength} placeholder="想说什么，都可以。" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /> : <div className="tag-list" role="group" aria-label={tab === 'feelings' ? '细分感受' : '情绪情境'}>{(tab === 'feelings' ? FEELINGS : CONTEXTS).map(value => <button className={`tag ${form[tab].includes(value) ? 'is-selected' : ''}`} aria-pressed={form[tab].includes(value)} key={value} onClick={() => toggle(tab, value)}>{value}</button>)}</div>}</div>
      {showTime && <label className="record-time"><span>记录时间</span><input aria-label="记录时间" type="datetime-local" value={form.occurredAt} max={localInput()} onChange={event => setForm({ ...form, occurredAt: event.target.value })} /></label>}
      {tab === 'note' && form.note.length > 0 && <span className="char-count">{form.note.length} / {SETTINGS.maxNoteLength}</span>}
    </div>}
    {/* 补充与保存同行；展开的文字区自然增高，不挤压首屏角色。 */}
    <div className="home-actions"><button className="home-note-toggle" aria-expanded={expanded} aria-controls="moment-extras" onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Plus size={18} />}<span>{expanded ? '收起' : form.note || extraCount ? '继续补充' : '写几句'}</span>{!expanded && extraCount > 0 && <small>{extraCount}</small>}</button><button className={`primary-button home-save ${saved ? 'is-saved' : ''}`} disabled={(!form.mood && !saved) || busy || saved} onClick={() => void save()}>{saved ? <Check size={20} /> : null}{busy ? '保存中' : saved ? '已记下' : editing ? '保存修改' : '记下此刻'}{!saved && <ArrowRight size={20} />}</button></div>
  </section>;
}
