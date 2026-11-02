import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextCounts, dailySeries, recentEntries, recommendCare, sampleEntries } from '../src/lib/domain.ts';

/** 统计必须正确处理缺失日期、多条记录与时间窗口边界。 */
test('同日记录取均值，缺失日保留空值', () => {
  const now = new Date(2026, 10, 2, 20);
  const entry = sampleEntries(now).at(-1)!;
  const series = dailySeries([{ ...entry, mood: 1 }, { ...entry, id: 'other', mood: 5 }], 3, now);
  assert.equal(series[0].score, null);
  assert.equal(series[2].score, 3);
  assert.equal(series[2].count, 2);
});
test('窗口含起始日零点，排除未来记录', () => {
  const now = new Date(2026, 10, 2, 20);
  const entries = sampleEntries(now);
  assert.equal(recentEntries(entries, 7, now).length, 7);
  assert.equal(recentEntries([{ ...entries[0], occurredAt: new Date(2026, 10, 3).toISOString() }], 7, now).length, 0);
});
test('同一条日记的重复情境标签只计一次', () => {
  const entry = sampleEntries()[0];
  assert.deepEqual(contextCounts([{ ...entry, contexts: ['工作', '工作'] }]), [{ context: '工作', count: 1 }]);
});
test('个人反馈可更换建议，推荐不包含诊断', () => {
  const first = recommendCare(['焦虑'], []);
  assert.equal(first.kind, 'breathing');
  const changed = recommendCare(['焦虑'], [{ id: '1', type: 'breathing', title: '呼吸', durationSeconds: 60, beforeMood: 2, feedback: 'unsuitable', entryId: null, createdAt: new Date().toISOString() }]);
  assert.equal(changed.kind, 'music');
});
