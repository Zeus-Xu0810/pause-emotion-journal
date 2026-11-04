import { useEffect, useRef, useState } from 'react';
import { BookOpen, BriefcaseBusiness, Check, Clock3, Cloud, CloudRain, Coffee, Flame, Flower2, Heart, Leaf, Moon, Sparkles, Sun, UsersRound, Wind } from 'lucide-react';
import { CONTEXTS, FEELINGS, SETTINGS } from '../config';
import { CONTEXT_ART, FEELING_ART, JOURNAL_COMPANION_LINES, JOURNAL_PROMPTS, JOURNAL_SETTINGS } from '../journal-content';
import { localInput } from '../lib/domain';
import type { MoodEntry } from '../types';
import type { ComposerState } from './HomeComposer';
import JournalStamp from './JournalStamp';
import '../journal.css';

/** 图案和已有感受/情境一一对应，点选仍保存原有结构，不上传装饰或生成日记。 */
const ART = { wind: Wind, moon: Moon, flame: Flame, 'cloud-rain': CloudRain, cloud: Cloud, leaf: Leaf, heart: Heart, sparkles: Sparkles, book: BookOpen, briefcase: BriefcaseBusiness, users: UsersRound, flower: Flower2, cup: Coffee, sun: Sun };
const TABS = [{ id: 'feelings', label: '贴心情' }, { id: 'note', label: '小纸条' }, { id: 'contexts', label: '今天的事' }] as const;
type NotebookTab = typeof TABS[number]['id'];

/** 贴纸、写字、情境共用同一份受控草稿；切换提示和摸摸团子均不会改动正文。 */
export default function JournalNotebook({ form, setForm, busy, editing, initialTab = 'feelings' }: { form: ComposerState; setForm: (next: ComposerState) => void; busy: boolean; editing: MoodEntry | null; initialTab?: NotebookTab }) {
  // 首页写日记直达文字页，贴纸仍由用户自行选择，不改变已有草稿内容。
  const [tab, setTab] = useState<NotebookTab>(editing ? 'note' : initialTab);
  const [prompt, setPrompt] = useState(0);
  const [showTime, setShowTime] = useState(false);
  const [companion, setCompanion] = useState(-1);
  const [patted, setPatted] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { if (editing) setTab('note'); }, [editing?.id]);
  useEffect(() => { if (!patted) return; const timer = setTimeout(() => setPatted(false), JOURNAL_SETTINGS.stampReactionMs); return () => clearTimeout(timer); }, [patted, companion]);
  const toggle = (field: 'feelings' | 'contexts', value: string) => setForm({ ...form, [field]: form[field].includes(value) ? form[field].filter(item => item !== value) : [...form[field], value] });
  const message = companion < 0 ? '慢慢来，我在听。' : JOURNAL_COMPANION_LINES[companion];
  const pickTab = (index: number) => { setTab(TABS[index].id); tabRefs.current[index]?.focus(); };

  return <div className="home-extras journal-notebook" id="moment-extras">
    <div className="notebook-welcome">
      <button className={`notebook-companion ${patted ? 'is-patted' : ''}`} disabled={busy} aria-label="摸摸纸上的小团子" onClick={() => { setCompanion(value => (value + 1) % JOURNAL_COMPANION_LINES.length); setPatted(true); }}><JournalStamp mood={form.mood} /><Heart className="notebook-pat-heart" size={15} aria-hidden="true" /></button>
      <div><p className="notebook-eyebrow">这一刻的小纸条</p><p className="notebook-greeting" role="status">{message}</p></div>
    </div>
    <div className="notebook-tabs" role="tablist" aria-label="补充记录">{TABS.map((item, index) => <button key={item.id} ref={node => { tabRefs.current[index] = node; }} role="tab" id={`extra-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`extra-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} disabled={busy} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} onKeyDown={event => {
      // 标签用方向键切换；不会将焦点强行移入输入框或弹出手机键盘。
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); pickTab((index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); pickTab(event.key === 'Home' ? 0 : TABS.length - 1); }
    }}>{item.label}{item.id !== 'note' && form[item.id].length > 0 && <span className="notebook-count">{form[item.id].length}</span>}</button>)}</div>
    <div className="notebook-panel" role="tabpanel" id={`extra-panel-${tab}`} aria-labelledby={`extra-tab-${tab}`}>
      {tab === 'note' ? <>
        <div className="notebook-prompts" role="group" aria-label="写作小提示">{JOURNAL_PROMPTS.map((item, index) => <button disabled={busy} key={item.id} aria-pressed={prompt === index} className={prompt === index ? 'is-selected' : ''} onClick={() => setPrompt(index)}>{item.label}</button>)}</div>
        <div className="notebook-paper"><label htmlFor="moment-note" className="notebook-question">{JOURNAL_PROMPTS[prompt].question}</label><textarea id="moment-note" className="home-note notebook-note" disabled={busy} aria-label="写下此刻" maxLength={SETTINGS.maxNoteLength} placeholder={JOURNAL_PROMPTS[prompt].placeholder} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /><div className="notebook-paper-footer"><span>不用写完整，也不用写漂亮。</span><span>{form.note.length} / {SETTINGS.maxNoteLength}</span></div></div>
      </> : <><div className="notebook-section-title"><span>{tab === 'feelings' ? '给感受找个小名字' : '今天，和什么有关？'}</span><small>可多选</small></div><div className={`notebook-stickers ${tab === 'contexts' ? 'is-contexts' : ''}`} role="group" aria-label={tab === 'feelings' ? '细分感受' : '情绪情境'}>{(tab === 'feelings' ? FEELINGS : CONTEXTS).map((value, index) => {
        const selected = form[tab].includes(value); const Icon = ART[(tab === 'feelings' ? FEELING_ART : CONTEXT_ART)[index]];
        return <button key={value} className={`notebook-sticker tone-${index % 4} ${selected ? 'is-selected' : ''}`} disabled={busy} aria-pressed={selected} onClick={() => toggle(tab, value)}><span className="notebook-sticker-art"><Icon size={26} strokeWidth={1.5} aria-hidden="true" /></span><span>{value}</span>{selected && <Check size={13} className="notebook-sticker-check" aria-hidden="true" />}</button>;
      })}</div></>}
    </div>
    <div className="notebook-bottom"><span>{form.feelings.length + form.contexts.length > 0 ? `已贴好 ${form.feelings.length + form.contexts.length} 枚小贴纸` : '只记心情，也是一篇日记。'}</span><button className="text-button" disabled={busy} aria-label="补记时间" aria-expanded={showTime} aria-controls="notebook-time" onClick={() => setShowTime(value => !value)}><Clock3 size={15} />时间</button></div>
    {showTime && <label className="record-time" id="notebook-time"><span>记录时间</span><input disabled={busy} aria-label="记录时间" type="datetime-local" value={form.occurredAt} max={localInput()} onChange={event => setForm({ ...form, occurredAt: event.target.value })} /></label>}
  </div>;
}
