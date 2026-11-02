import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, List, Pencil, Trash2, ChevronLeft, ChevronRight, Feather, X } from 'lucide-react';
import { CONTEXTS, MOODS } from '../config';
import { dayKey, moodMeta } from '../lib/domain';
import type { MoodEntry } from '../types';

/** 时间线和月历共用筛选结果；详情始终展示真实记录时间。 */
export default function JournalView({ entries, onEdit, onDelete, onCreate }: { entries: MoodEntry[]; onEdit: (entry: MoodEntry) => void; onDelete: (entry: MoodEntry) => void; onCreate: () => void }) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const date = params.get('date') ?? '';
  const context = params.get('context') ?? '';
  const mood = params.get('mood') ?? '';
  function filter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); }
  const filtered = entries.filter(entry => (!date || dayKey(entry.occurredAt) === date) && (!context || entry.contexts.includes(context)) && (!mood || String(entry.mood) === mood));
  const first = new Date(month);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, i) => { const day = new Date(first); day.setDate(day.getDate() + i); return day; });
  const changeMonth = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));

  return <section className="journal-view">
    <div className="filters">
      <label className="filter-control">日期<input aria-label="筛选日期" type="date" value={date} onChange={event => filter('date', event.target.value)} /></label>
      <label className="filter-control">情绪<select aria-label="筛选情绪" value={mood} onChange={event => filter('mood', event.target.value)}><option value="">全部情绪</option>{MOODS.map(item => <option key={item.score} value={item.score}>{item.label}</option>)}</select></label>
      <label className="filter-control">情境<select aria-label="筛选情境" value={context} onChange={event => filter('context', event.target.value)}><option value="">全部情境</option>{CONTEXTS.map(item => <option key={item}>{item}</option>)}</select></label>
      {params.size > 0 && <button className="text-button" onClick={() => setParams({})}><X size={14} />清除筛选</button>}
      <div className="view-toggle" aria-label="日记视图"><button className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} />时间线</button><button className={view === 'calendar' ? 'is-active' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={17} />月历</button></div>
    </div>
    {view === 'calendar' && <section className="calendar-panel"><div className="calendar-header"><h2>{month.getFullYear()}年 {month.getMonth() + 1}月</h2><div className="inline-actions"><button className="icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button><button className="text-button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>回到本月</button><button className="icon-button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button></div></div><div className="calendar-grid">{['一', '二', '三', '四', '五', '六', '日'].map(day => <div className="calendar-weekday" key={day}>周{day}</div>)}{days.map(day => {
      const key = dayKey(day);
      const matches = entries.filter(entry => dayKey(entry.occurredAt) === key && (!context || entry.contexts.includes(context)) && (!mood || String(entry.mood) === mood));
      return <button className={`calendar-cell ${day.getMonth() !== month.getMonth() ? 'is-outside' : ''} ${matches.length ? 'has-entry' : ''} ${date === key ? 'is-selected' : ''}`} aria-label={`${key}，${matches.length}条记录`} aria-pressed={date === key} key={key} onClick={() => filter('date', date === key ? '' : key)}><span>{day.getDate()}</span><span className="calendar-dots">{matches.slice(0, 4).map(entry => <i key={entry.id} style={{ background: moodMeta(entry.mood).color }} />)}</span></button>;
    })}</div></section>}
    <div className="section-heading"><p>{date ? `${date} · ` : ''}共 {filtered.length} 个片刻</p><button className="text-button" onClick={onCreate}><Feather size={15} />记下此刻</button></div>
    {filtered.length === 0 ? <div className="empty-state"><Feather size={32} strokeWidth={1.2} /><h2>{entries.length ? '这里暂时没有记录' : '故事从一个片刻开始'}</h2><p>{entries.length ? '换一个日期或情境，找找之前的自己。' : '不必写成一篇文章，选一种感觉就可以。'}</p><button className="primary-button" onClick={onCreate}>记下第一笔</button></div> : <div className="entry-list">{[...filtered].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(entry => {
      const when = new Date(entry.occurredAt);
      const meta = moodMeta(entry.mood);
      return <article className="entry-item" key={entry.id}><time className="entry-date" dateTime={entry.occurredAt}><span>{when.getMonth() + 1}月</span><strong>{when.getDate()}</strong><span>{when.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></time><div><div className="entry-mood"><span className="day-dot" style={{ background: meta.color }} /><h2>{meta.label}</h2><span>{entry.feelings.join(' · ')}</span></div><p className="entry-text">{entry.note || '这一刻，先记住感觉。'}</p><div className="entry-tags">{entry.contexts.map(item => <span key={item}>{item}</span>)}</div></div><div className="entry-actions"><button className="icon-button" aria-label={`编辑${when.toLocaleDateString('zh-CN')}的记录`} onClick={() => onEdit(entry)}><Pencil size={16} /></button><button className="icon-button" aria-label={`删除${when.toLocaleDateString('zh-CN')}的记录`} onClick={() => onDelete(entry)}><Trash2 size={16} /></button></div></article>;
    })}</div>}
  </section>;
}
