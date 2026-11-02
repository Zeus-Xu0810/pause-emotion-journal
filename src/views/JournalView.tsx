import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, List, Pencil, Trash2, ChevronDown, ChevronLeft, ChevronRight, Feather, SlidersHorizontal, X } from 'lucide-react';
import { CONTEXTS, MOODS } from '../config';
import { dayKey, moodMeta } from '../lib/domain';
import type { MoodEntry } from '../types';

/** 日记先呈现日期、心情与短记，筛选和操作按需展开。 */
export default function JournalView({ entries, onEdit, onDelete, onCreate }: { entries: MoodEntry[]; onEdit: (entry: MoodEntry) => void; onDelete: (entry: MoodEntry) => void; onCreate: () => void }) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [filtersOpen, setFiltersOpen] = useState(() => params.size > 0);
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
    {/* 视图切换常驻，筛选收起时仍能看见当前筛选数量。 */}
    <div className="journal-toolbar">
      <button className={`filter-toggle ${filtersOpen ? 'is-active' : ''}`} aria-expanded={filtersOpen} aria-controls="journal-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />筛选{params.size > 0 && <span className="filter-count">{params.size}</span>}</button>
      <div className="view-toggle" aria-label="日记视图"><button className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} />时间线</button><button className={view === 'calendar' ? 'is-active' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={17} />月历</button></div>
    </div>
    <div id="journal-filters" className="filters journal-filter-panel" hidden={!filtersOpen}>
      <label className="filter-control">日期<input aria-label="筛选日期" type="date" value={date} onChange={event => filter('date', event.target.value)} /></label>
      <label className="filter-control">情绪<select aria-label="筛选情绪" value={mood} onChange={event => filter('mood', event.target.value)}><option value="">全部</option>{MOODS.map(item => <option key={item.score} value={item.score}>{item.label}</option>)}</select></label>
      <label className="filter-control">情境<select aria-label="筛选情境" value={context} onChange={event => filter('context', event.target.value)}><option value="">全部</option>{CONTEXTS.map(item => <option key={item}>{item}</option>)}</select></label>
      {params.size > 0 && <button className="text-button" onClick={() => setParams({})}><X size={14} />清除</button>}
    </div>
    {/* 月历保留真实记录印记，点击日期与时间线共用筛选。 */}
    {view === 'calendar' && <section className="calendar-panel"><div className="calendar-header"><h2>{month.getFullYear()}年 {month.getMonth() + 1}月</h2><div className="inline-actions"><button className="icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button><button className="text-button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>本月</button><button className="icon-button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button></div></div><div className="calendar-grid">{['一', '二', '三', '四', '五', '六', '日'].map(day => <div className="calendar-weekday" key={day}>周{day}</div>)}{days.map(day => {
      const key = dayKey(day);
      const matches = entries.filter(entry => dayKey(entry.occurredAt) === key && (!context || entry.contexts.includes(context)) && (!mood || String(entry.mood) === mood));
      return <button className={`calendar-cell ${day.getMonth() !== month.getMonth() ? 'is-outside' : ''} ${matches.length ? 'has-entry' : ''} ${date === key ? 'is-selected' : ''}`} aria-label={`${key}，${matches.length}条记录`} aria-pressed={date === key} key={key} onClick={() => filter('date', date === key ? '' : key)}><span>{day.getDate()}</span><span className="calendar-dots">{matches.slice(0, 4).map(entry => <i key={entry.id} style={{ background: moodMeta(entry.mood).color }} />)}</span></button>;
    })}</div></section>}
    <div className="section-heading"><p>{date ? `${date} · ` : ''}{filtered.length} 个片刻</p><button className="text-button" onClick={onCreate}><Feather size={15} />记一笔</button></div>
    {filtered.length === 0 ? <div className="empty-state"><Feather size={32} strokeWidth={1.2} /><h2>{entries.length ? '没有匹配的片刻' : '从此刻开始'}</h2><button className="primary-button" onClick={entries.length ? () => setParams({}) : onCreate}>{entries.length ? '清除筛选' : '记一笔'}</button></div> : <div className="entry-list">{[...filtered].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(entry => {
      const when = new Date(entry.occurredAt);
      const meta = moodMeta(entry.mood);
      return <article className="entry-item" key={entry.id}>
        <time className="entry-date" dateTime={entry.occurredAt}><span>{when.getMonth() + 1}月</span><strong>{when.getDate()}</strong><span>{when.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></time>
        <details className="entry-disclosure">
          <summary className="entry-summary"><div className="entry-summary-copy"><div className="entry-mood"><span className="day-dot" style={{ background: meta.color }} /><h2>{meta.label}</h2></div><p className="entry-text entry-preview">{entry.note || '只记了心情'}</p></div><ChevronDown size={17} className="entry-chevron" aria-hidden="true" /></summary>
          <div className="entry-detail"><p className="entry-text">{entry.note || '只记了心情'}</p>{(entry.feelings.length > 0 || entry.contexts.length > 0) && <div className="entry-tags">{entry.feelings.map(item => <span key={`feeling-${item}`}>{item}</span>)}{entry.contexts.map(item => <span key={`context-${item}`}>{item}</span>)}</div>}<div className="entry-detail-actions"><button className="text-button" aria-label={`编辑${when.toLocaleDateString('zh-CN')}的记录`} onClick={() => onEdit(entry)}><Pencil size={15} />编辑</button><button className="text-button" aria-label={`删除${when.toLocaleDateString('zh-CN')}的记录`} onClick={() => onDelete(entry)}><Trash2 size={15} />删除</button></div></div>
        </details>
      </article>;
    })}</div>}
  </section>;
}