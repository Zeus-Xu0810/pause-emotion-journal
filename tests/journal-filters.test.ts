import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextReviewQuery, filterJournalEntries, journalFilterCount, journalMonth, parseJournalFilters, recentCareSessions, validJournalDate } from '../src/lib/journal-filters.ts';
import { recentEntries } from '../src/lib/domain.ts';
import type { CareSession, MoodEntry } from '../src/types.ts';

/** 自然日边界和固定现在时间集中在样本中，不依赖执行测试的当天或 UTC 时区。 */
const now = new Date(2026, 10, 3, 0, 30);
const entry = (id: string, date: Date, context = '工作'): MoodEntry => ({ id, mood: 3, feelings: [], contexts: [context], note: '', occurredAt: date.toISOString(), createdAt: date.toISOString(), updatedAt: date.toISOString(), revision: 1 });

test('非法URL条件不隐形过滤，合法单日优先于回顾范围', () => {
  assert.equal(validJournalDate('2024-02-29'), true);
  assert.equal(validJournalDate('2026-02-29'), false);
  assert.equal(validJournalDate('2026-02-31'), false);
  const invalid = parseJournalFilters(new URLSearchParams('date=2026-02-31&mood=9&context=unknown&foo=bar'));
  assert.equal(journalFilterCount(invalid), 0);
  assert.equal(filterJournalEntries([entry('one', now)], invalid).length, 1);
  const exact = parseJournalFilters(new URLSearchParams('date=2024-02-29&from=2026-10-28&to=2026-11-03&context=工作'));
  assert.equal(exact.date, '2024-02-29');
  assert.equal(exact.from, '');
  assert.equal(exact.to, '');
  assert.equal(journalFilterCount(exact), 2);
  const reversed = parseJournalFilters(new URLSearchParams('from=2026-11-03&to=2026-10-28&context=工作'));
  assert.equal(reversed.from, '');
  assert.equal(reversed.context, '工作');
});

test('情境回看携带相同自然日窗口，月历定位到旧日期所在月份', () => {
  const query = contextReviewQuery('工作', 7, now);
  const filters = parseJournalFilters(new URLSearchParams(query));
  assert.equal(filters.from, '2026-10-28');
  assert.equal(filters.to, '2026-11-03');
  const entries = [entry('old', new Date(2026, 9, 27, 23, 59)), entry('start', new Date(2026, 9, 28)), entry('inside', new Date(2026, 10, 2, 13)), entry('today', new Date(2026, 10, 3, 0, 20)), entry('other-context', new Date(2026, 10, 2), '睡眠'), entry('tomorrow', new Date(2026, 10, 4))];
  assert.deepEqual(filterJournalEntries(entries, filters).map(item => item.id), ['start', 'inside', 'today']);
  const oldMonth = journalMonth('2024-02-29', now);
  assert.equal(oldMonth.getFullYear(), 2024);
  assert.equal(oldMonth.getMonth(), 1);
  assert.equal(journalMonth('invalid', now).getMonth(), now.getMonth());
});

test('关怀反馈和情绪记录采用同一窗口，排除额外旧日及未来时间', () => {
  const entries = [entry('old', new Date(2026, 9, 27, 23, 59)), entry('start', new Date(2026, 9, 28)), entry('today', new Date(2026, 10, 3, 0, 20)), entry('future', new Date(2026, 10, 3, 0, 31))];
  const sessions: CareSession[] = entries.map(item => ({ id: item.id, type: 'breathing', title: '呼吸', durationSeconds: 60, beforeMood: null, feedback: 'same', entryId: null, createdAt: item.occurredAt }));
  const sessionIds = recentCareSessions(sessions, 7, now).map(item => item.id);
  assert.deepEqual(sessionIds, ['start', 'today']);
  assert.deepEqual(sessionIds, recentEntries(entries, 7, now).map(item => item.id));
});
