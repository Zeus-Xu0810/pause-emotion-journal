import { CONTEXTS, MOODS } from '../config.ts';
import { dayKey, shiftDay } from './domain.ts';
import type { CareSession, MoodEntry } from '../types.ts';

/** URL 只接收已知筛选，非法日期不会变成看不见却仍生效的条件。 */
export interface JournalFilters { date: string; mood: string; context: string; from: string; to: string }
export function validJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && dayKey(parsed) === value;
}
export function parseJournalFilters(params: URLSearchParams): JournalFilters {
  const rawDate = params.get('date') ?? '';
  const rawMood = params.get('mood') ?? '';
  const rawContext = params.get('context') ?? '';
  const date = validJournalDate(rawDate) ? rawDate : '';
  let from = params.get('from') ?? ''; let to = params.get('to') ?? '';
  if (!validJournalDate(from)) from = '';
  if (!validJournalDate(to)) to = '';
  if (date || from && to && from > to) { from = ''; to = ''; }
  return { date, mood: MOODS.some(item => String(item.score) === rawMood) ? rawMood : '', context: CONTEXTS.includes(rawContext) ? rawContext : '', from, to };
}
export function journalFilterCount(filters: JournalFilters): number {
  return Number(Boolean(filters.date)) + Number(Boolean(filters.mood)) + Number(Boolean(filters.context)) + Number(Boolean(filters.from || filters.to));
}
export function filterJournalEntries(entries: MoodEntry[], filters: JournalFilters): MoodEntry[] {
  return entries.filter(entry => {
    const day = dayKey(entry.occurredAt);
    return (!filters.date || day === filters.date) && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
      && (!filters.mood || String(entry.mood) === filters.mood) && (!filters.context || entry.contexts.includes(filters.context));
  });
}
export function journalMonth(date: string, now = new Date()): Date {
  const selected = validJournalDate(date) ? new Date(`${date}T12:00:00`) : now;
  return new Date(selected.getFullYear(), selected.getMonth(), 1);
}

/** 回顾与关怀采用同一自然日窗口，并排除未来时间，而不是混用滚动小时数。 */
export function recentCareSessions(sessions: CareSession[], days: number, now = new Date()): CareSession[] {
  const start = shiftDay(now, 1 - days); start.setHours(0, 0, 0, 0);
  return sessions.filter(session => { const stamp = new Date(session.createdAt); return stamp >= start && stamp <= now; });
}
export function contextReviewQuery(context: string, days: number, now = new Date()): string {
  const start = shiftDay(now, 1 - days); start.setHours(0, 0, 0, 0);
  return new URLSearchParams({ context, from: dayKey(start), to: dayKey(now) }).toString();
}
