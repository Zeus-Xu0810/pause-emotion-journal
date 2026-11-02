import { MOODS, SETTINGS } from '../config.ts';
import type { CareKind, CareSession, EntryDraft, MoodEntry } from '../types.ts';

/** 使用本地日历日期归档，避免 UTC 跨日使夜间记录跑到前一天。 */
export function dayKey(value: string | Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function localInput(value: string | Date = new Date()): string {
  const date = new Date(value);
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function shiftDay(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/** 访客记录只保留在内存中；与正式云端日记使用相同类型。 */
export function makeGuestEntry(draft: EntryDraft): MoodEntry {
  const now = new Date().toISOString();
  return { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now, revision: 1 };
}

/** 统计以自然日为窗口；空缺日保持 null，不能误当作低情绪。 */
export function recentEntries(entries: MoodEntry[], days: number, now = new Date()): MoodEntry[] {
  const start = shiftDay(now, 1 - days);
  start.setHours(0, 0, 0, 0);
  return entries.filter(entry => new Date(entry.occurredAt) >= start && new Date(entry.occurredAt) <= now);
}
export function dailySeries(entries: MoodEntry[], days: number, now = new Date()) {
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDay(now, index - days + 1);
    const key = dayKey(date);
    const matches = entries.filter(entry => dayKey(entry.occurredAt) === key);
    return { date: key, count: matches.length, score: matches.length ? matches.reduce((sum, entry) => sum + entry.mood, 0) / matches.length : null };
  });
}
export function contextCounts(entries: MoodEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach(entry => new Set(entry.contexts).forEach(context => counts.set(context, (counts.get(context) ?? 0) + 1)));
  return [...counts.entries()].map(([context, count]) => ({ context, count })).sort((a, b) => b.count - a.count || a.context.localeCompare(b.context, 'zh-CN'));
}

/** 建议来自可解释规则和本人反馈，不推断疾病，也不替用户确定原因。 */
export function recommendCare(feelings: string[], sessions: CareSession[]) {
  let kind: CareKind = feelings.includes('焦虑') || feelings.includes('烦躁') ? 'breathing' : feelings.includes('疲惫') ? 'movement' : feelings.includes('孤独') || feelings.includes('委屈') ? 'mindfulness' : 'music';
  let reason = feelings.length ? `根据你选的「${feelings[0]}」，先试一件轻量的小事。` : '给自己留几分钟，选择一种舒服的节奏。';
  const latestFeedback = sessions.filter(session => session.type === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latestFeedback?.feedback === 'unsuitable') {
    kind = kind === 'music' ? 'mindfulness' : 'music';
    reason = '上次的方法不太适合，这次换一种试试。';
  }
  const titles: Record<CareKind, string> = { breathing: '让呼吸慢下来', mindfulness: '把注意力带回此刻', music: '听一会儿，歇一会儿', movement: '松一松肩，动一动身体' };
  return { kind, title: titles[kind], reason };
}

/** 示例数据只用于用户主动打开的示例视图，不写入任何个人账户。 */
export function sampleEntries(now = new Date()): MoodEntry[] {
  const scores = [3, 2, 4, 3, 2, 4, 5, 3, 4, 2, 3, 4, 3, 4] as const;
  return scores.map((mood, index) => {
    const date = shiftDay(now, index - scores.length + 1);
    date.setHours(12, 0, 0, 0);
    const stamp = date.toISOString();
    return { id: `example-${index}`, mood, feelings: [mood <= 2 ? '疲惫' : '平静'], contexts: [index % 3 === 0 ? '工作' : index % 3 === 1 ? '睡眠' : '日常小事'], note: '示例记录，不属于任何真实用户。', occurredAt: stamp, createdAt: stamp, updatedAt: stamp, revision: 1 };
  });
}

/** 导出保留版本与时间，供用户自行备份，不包含身份令牌。 */
export function exportData(entries: MoodEntry[], sessions: CareSession[]) {
  const payload = { application: SETTINGS.name, version: 1, exportedAt: new Date().toISOString(), entries, careSessions: sessions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `片刻备份-${dayKey(new Date())}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function moodMeta(score: number) { return MOODS[Math.max(0, Math.min(4, Math.round(score) - 1))]; }
