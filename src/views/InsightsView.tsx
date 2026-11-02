import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChartNoAxesCombined } from 'lucide-react';
import { SETTINGS } from '../config';
import { contextCounts, dailySeries, dayKey, moodMeta, recentEntries, sampleEntries } from '../lib/domain';
import type { CareSession, MoodEntry } from '../types';

/** 图表只解释当前筛选窗口里的记录；示例数据必须由用户主动打开。 */
export default function InsightsView({ entries, sessions }: { entries: MoodEntry[]; sessions: CareSession[] }) {
  const [days, setDays] = useState(7);
  const [sample, setSample] = useState(false);
  const navigate = useNavigate();
  const example = useMemo(() => sampleEntries(), []);
  const selected = recentEntries(sample ? example : entries, days);
  const series = dailySeries(selected, days);
  const contexts = contextCounts(selected);
  const recordedDays = new Set(selected.map(entry => dayKey(entry.occurredAt))).size;
  const selectedSessions = sample ? [] : sessions.filter(session => Date.parse(session.createdAt) >= Date.now() - days * 86400000);
  const average = selected.length ? selected.reduce((sum, entry) => sum + entry.mood, 0) / selected.length : null;
  const known = selected.length >= SETTINGS.minimumInsightEntries;
  const x = (index: number) => 42 + index * (616 / Math.max(1, days - 1));
  const y = (score: number) => 190 - (score - 1) * 38;
  let segment = '';
  const segments: string[] = [];
  series.forEach((point, index) => { if (point.score === null) { if (segment) segments.push(segment); segment = ''; } else segment += `${segment ? ' L' : 'M'}${x(index)} ${y(point.score)}`; });
  if (segment) segments.push(segment);
  const openDay = (date: string) => { if (!sample) navigate(`/journal?date=${date}`); };

  return <>
    <div className="filters"><div className="view-toggle"><button aria-pressed={days === 7} className={days === 7 ? 'is-active' : ''} onClick={() => setDays(7)}>近7天</button><button aria-pressed={days === 30} className={days === 30 ? 'is-active' : ''} onClick={() => setDays(30)}>近30天</button></div><button className="text-button" onClick={() => setSample(!sample)}>{sample ? '返回我的记录' : '看看示例'}</button></div>
    {sample && <div className="sample-banner">你正在查看示例数据，图表不代表你的情绪，也不会存入你的账号。</div>}
    <section className="insight-grid"><div className="stat-tile"><span className="stat-label">留下的片刻</span><strong className="stat-value">{selected.length}<small>条</small></strong><span>一天可以有很多种感觉</span></div><div className="stat-tile"><span className="stat-label">记录过的日子</span><strong className="stat-value">{recordedDays}<small>天</small></strong><span>没有连续打卡的要求</span></div><div className="stat-tile"><span className="stat-label">平均自评</span><strong className="stat-value">{average ? average.toFixed(1) : '—'}<small>/ 5</small></strong><span>只用于个人回顾</span></div><div className="stat-tile"><span className="stat-label">尝试的关怀</span><strong className="stat-value">{selectedSessions.length}<small>次</small></strong><span>适不适合，你说了算</span></div></section>
    <section className="chart-panel"><div className="panel-heading"><span className="section-number">01</span><h2>情绪有起伏，也有自己的节奏</h2></div>{selected.length ? <><svg className="chart-svg" viewBox="0 0 700 235" role="img" aria-label={`近${days}天情绪自评趋势；空缺日期不连线，每个点代表一天的平均自评。`}><title>情绪变化趋势</title>{[1, 2, 3, 4, 5].map(score => <g key={score}><line x1="42" x2="658" y1={y(score)} y2={y(score)} stroke="var(--line)" strokeDasharray="3 7" /><text x="18" y={y(score) + 4} fill="var(--ink-soft)" fontSize="12">{score}</text></g>)}{segments.map((path, index) => <path key={index} d={path} stroke="var(--green)" strokeWidth="2.5" fill="none" strokeLinejoin="round" />)}{series.map((point, index) => <g key={point.date}>{point.score !== null && <g role={sample ? undefined : 'button'} tabIndex={sample ? undefined : 0} aria-label={`${point.date}，平均${point.score.toFixed(1)}，${point.count}条记录，查看日记`} onClick={() => openDay(point.date)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDay(point.date); } }} style={{ cursor: sample ? 'default' : 'pointer' }}><circle cx={x(index)} cy={y(point.score)} r="10" fill="transparent" /><circle cx={x(index)} cy={y(point.score)} r="4.5" fill={moodMeta(point.score).color} stroke="var(--paper)" strokeWidth="2" /></g>}{(days === 7 || index % 5 === 0 || index === days - 1) && <text x={x(index)} y="220" textAnchor="middle" fill="var(--ink-soft)" fontSize="11">{point.date.slice(5).replace('-', '/')}</text>}</g>)}</svg><p className="chart-legend">每个点是当天自评均值 · 空白表示未记录{!sample && ' · 点击圆点回看当天'}</p></> : <div className="chart-empty"><ChartNoAxesCombined size={36} strokeWidth={1} /><p>先记下一些片刻，轨迹会慢慢出现。</p></div>}</section>
    <div className="insight-bottom-grid"><section className="insight-panel"><div className="panel-heading"><span className="section-number">02</span><h2>哪些情境经常出现</h2></div>{contexts.length ? contexts.map(item => <button className="context-row" key={item.context} disabled={sample} onClick={() => navigate(`/journal?context=${encodeURIComponent(item.context)}`)}><span>{item.context}</span><span className="context-track"><i className="context-fill" style={{ width: `${item.count / selected.length * 100}%` }} /></span><span>{item.count}条</span><ArrowUpRight size={15} /></button>) : <p className="subtle-copy">记录时选几个情境标签，回来看见生活的线索。</p>}<p className="chart-legend">一条记录可有多个标签；出现次数不代表因果。</p></section><section className="insight-panel"><div className="panel-heading"><span className="section-number">03</span><h2>关怀之后，感觉如何</h2></div>{(['better', 'same', 'unsuitable'] as const).map((feedback, index) => <div className="feedback-row" key={feedback}><span>{['松了一点', '差不多', '不太适合'][index]}</span><strong>{selectedSessions.filter(session => session.feedback === feedback).length}<small> 次</small></strong></div>)}<p className="chart-legend">保留每一种反馈，不要求每次都有效。</p></section></div>
    <div className="observation"><span className="eyebrow">一个小观察</span><p>{!known ? `目前有${selected.length}条记录。至少记录${SETTINGS.minimumInsightEntries}条，再一起找找线索。` : contexts.length ? `在这${selected.length}条记录里，你${contexts[0].count}次标记了「${contexts[0].context}」。回看那些片刻，也许能多了解一点自己。` : `你在${recordedDays}个日子里留下了${selected.length}个片刻。情绪的变化不需要被立刻解释。`}</p></div>
  </>;
}
