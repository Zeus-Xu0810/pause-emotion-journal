import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChartNoAxesCombined, ChevronDown } from 'lucide-react';
import { contextCounts, dailySeries, dayKey, moodMeta, recentEntries, sampleEntries } from '../lib/domain';
import type { CareSession, MoodEntry } from '../types';

/** 首屏只保留轨迹与必要统计，情境和反馈在需要时再展开。 */
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
  const x = (index: number) => 42 + index * (616 / Math.max(1, days - 1));
  const y = (score: number) => 190 - (score - 1) * 38;
  let segment = '';
  const segments: string[] = [];
  // 无记录的日期保持空白，不把两个不连续的片刻连接成趋势。
  series.forEach((point, index) => { if (point.score === null) { if (segment) segments.push(segment); segment = ''; } else segment += `${segment ? ' L' : 'M'}${x(index)} ${y(point.score)}`; });
  if (segment) segments.push(segment);
  const openDay = (date: string) => { if (!sample) navigate(`/journal?date=${date}`); };

  return <section className="insights-view">
    <div className="insights-toolbar"><div className="view-toggle" aria-label="回顾时间"><button aria-pressed={days === 7} className={days === 7 ? 'is-active' : ''} onClick={() => setDays(7)}>近7天</button><button aria-pressed={days === 30} className={days === 30 ? 'is-active' : ''} onClick={() => setDays(30)}>近30天</button></div><button className="text-button" onClick={() => setSample(!sample)}>{sample ? '返回我的记录' : '看看示例'}</button></div>
    {sample && <div className="sample-banner">示例数据 · 不会保存到账号</div>}
    <p className="insight-summary"><span><strong>{selected.length}</strong> 条记录</span><span className="insight-summary-dot" aria-hidden="true">·</span><span><strong>{recordedDays}</strong> 个日子</span></p>
    {/* 圆点仍可通过键盘或点击回看当天日记，示例不跳转到真实记录。 */}
    <section className="chart-panel"><div className="panel-heading"><h2>情绪轨迹</h2></div>{selected.length ? <><svg className="chart-svg" viewBox="0 0 700 235" role="img" aria-label={`近${days}天情绪自评趋势；空缺日期不连线，每个点代表一天的平均自评。`}><title>情绪变化趋势</title>{[1, 2, 3, 4, 5].map(score => <g key={score}><line x1="42" x2="658" y1={y(score)} y2={y(score)} stroke="var(--line)" strokeDasharray="3 7" /><text x="18" y={y(score) + 4} fill="var(--ink-soft)" fontSize="12">{score}</text></g>)}{segments.map((path, index) => <path key={index} d={path} stroke="var(--green)" strokeWidth="2.5" fill="none" strokeLinejoin="round" />)}{series.map((point, index) => <g key={point.date}>{point.score !== null && <g role={sample ? undefined : 'button'} tabIndex={sample ? undefined : 0} aria-label={`${point.date}，平均${point.score.toFixed(1)}，${point.count}条记录，查看日记`} onClick={() => openDay(point.date)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDay(point.date); } }} style={{ cursor: sample ? 'default' : 'pointer' }}><circle cx={x(index)} cy={y(point.score)} r="10" fill="transparent" /><circle cx={x(index)} cy={y(point.score)} r="4.5" fill={moodMeta(point.score).color} stroke="var(--paper)" strokeWidth="2" /></g>}{(days === 7 || index % 5 === 0 || index === days - 1) && <text x={x(index)} y="220" textAnchor="middle" fill="var(--ink-soft)" fontSize="11">{point.date.slice(5).replace('-', '/')}</text>}</g>)}</svg><p className="chart-legend">每日平均自评，空白为未记录。</p></> : <div className="chart-empty"><ChartNoAxesCombined size={34} strokeWidth={1} /><p>记下此刻，看见变化。</p><div className="insight-empty-actions"><button className="text-button" onClick={() => navigate('/')}>记一笔<ArrowUpRight size={15} /></button></div></div>}</section>
    {/* 频次与自评仅用于个人回顾，不给出因果判断或疗效承诺。 */}
    <div className="insight-folds">
      <details className="insight-details"><summary>情境线索<ChevronDown size={17} aria-hidden="true" /></summary><div className="insight-details-body">{contexts.length ? contexts.map(item => <button className="context-row" key={item.context} disabled={sample} onClick={() => navigate(`/journal?context=${encodeURIComponent(item.context)}`)}><span>{item.context}</span><span className="context-track"><i className="context-fill" style={{ width: `${item.count / selected.length * 100}%` }} /></span><span>{item.count}条</span><ArrowUpRight size={15} /></button>) : <p className="subtle-copy">记录时选个情境，线索会留在这里。</p>}<p className="chart-legend">标签出现次数，不代表因果。</p></div></details>
      <details className="insight-details"><summary>关怀反馈<ChevronDown size={17} aria-hidden="true" /></summary><div className="insight-details-body">{(['better', 'same', 'unsuitable'] as const).map((feedback, index) => <div className="feedback-row" key={feedback}><span>{['松了一点', '差不多', '不太适合'][index]}</span><strong>{selectedSessions.filter(session => session.feedback === feedback).length}<small> 次</small></strong></div>)}<p className="chart-legend">每一种感受都算数。</p></div></details>
    </div>
  </section>;
}