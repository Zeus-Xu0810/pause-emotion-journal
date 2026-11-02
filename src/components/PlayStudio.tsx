import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Pause, Play } from 'lucide-react';
import { FEEDBACK_OPTIONS } from '../care-content';
import { PLAY_ACTIVITIES, PLAY_SETTINGS, type PlayActivityId } from '../play-content';
import { formatPlayTime, storedPlaySeconds } from '../lib/play';
import type { CareFeedback, CareSession } from '../types';
import type { PlayHubProps } from './PlayHub';
import DrawingGame from './games/DrawingGame';
import ConstellationGame from './games/ConstellationGame';
import CatchLightGame from './games/CatchLightGame';

type PlayStatus = 'idle' | 'running' | 'paused' | 'finished';
/** 三个玩法复用同一会话控制器；记录只包含标题、真实活动时长与本人反馈。 */
export default function PlayStudio({ activityId, onBack, mood, entryId = null, onComplete, onNotice, ownerKey }: PlayHubProps & { activityId: PlayActivityId; onBack: () => void }) {
  const activity = PLAY_ACTIVITIES.find(item => item.id === activityId)!;
  const [status, setStatus] = useState<PlayStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<CareFeedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const hostRef = useRef<HTMLElement>(null);
  const statusRef = useRef<PlayStatus>('idle');
  const startedAt = useRef<number | null>(null);
  const accumulated = useRef(0);
  const firstMood = useRef({ mood, entryId });
  const pending = useRef<Omit<CareSession, 'feedback'> | null>(null);
  const mounted = useRef(true);
  const inViewport = useRef(true);
  const readElapsed = useCallback(() => accumulated.current + (startedAt.current === null ? 0 : performance.now() - startedAt.current), []);
  const changeStatus = useCallback((next: PlayStatus) => { statusRef.current = next; setStatus(next); }, []);
  const pause = useCallback(() => {
    if (statusRef.current !== 'running') return;
    accumulated.current = readElapsed(); startedAt.current = null; setElapsed(accumulated.current); changeStatus('paused');
  }, [changeStatus, readElapsed]);

  // 首次落笔、连星或移动团子才计时，目录浏览和选择工具均不创建记录。
  const interact = useCallback(() => {
    if (!visible || statusRef.current !== 'idle') return;
    firstMood.current = { mood, entryId }; startedAt.current = performance.now(); changeStatus('running');
  }, [changeStatus, entryId, mood, visible]);
  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { setVisible(!document.hidden && inViewport.current); if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(entries => { inViewport.current = Boolean(entries[0]?.isIntersecting); setVisible(!document.hidden && inViewport.current); if (!inViewport.current) pause(); }, { threshold: PLAY_SETTINGS.intersectionThreshold });
    if (hostRef.current) observer.observe(hostRef.current);
    return () => { mounted.current = false; observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); startedAt.current = null; };
  }, [pause]);
  useEffect(() => {
    if (status !== 'running') return;
    const timer = window.setInterval(() => setElapsed(readElapsed()), PLAY_SETTINGS.tickMilliseconds);
    return () => window.clearInterval(timer);
  }, [readElapsed, status]);

  function resume() { if (!visible || statusRef.current !== 'paused') return; startedAt.current = performance.now(); changeStatus('running'); }
  function finish() {
    if (statusRef.current !== 'running' && statusRef.current !== 'paused') return;
    const actual = readElapsed(); accumulated.current = actual; startedAt.current = null; setElapsed(actual);
    pending.current = { id: crypto.randomUUID(), type: 'play', title: activity.title, durationSeconds: storedPlaySeconds(actual), beforeMood: firstMood.current.mood, entryId: firstMood.current.entryId, createdAt: new Date().toISOString() };
    changeStatus('finished');
  }
  function reset() { pending.current = null; accumulated.current = 0; startedAt.current = null; setElapsed(0); setFeedback(null); setSaved(false); changeStatus('idle'); }
  // 失败保留同一个UUID与反馈，继续点击保存不会变成多条完成记录。
  async function save() {
    if (!pending.current || !feedback || saving || saved) return;
    setSaving(true);
    try { await onComplete({ ...pending.current, feedback }); if (mounted.current) setSaved(true); }
    catch (error) { onNotice(error instanceof Error ? error.message : '暂未记下，请重试。'); }
    finally { if (mounted.current) setSaving(false); }
  }
  const active = visible && (status === 'idle' || status === 'running');
  return <section className={`play-studio play-studio-${activityId}`} ref={hostRef} aria-label={activity.title}>
    {/* 手机只显示返回图标时仍保留可读名称，键盘和读屏均可返回目录。 */}
    <header className="play-studio-heading"><button type="button" className="play-back" aria-label="全部活动" disabled={saving} onClick={onBack}><ArrowLeft size={17} /><span>全部活动</span></button><h2>{activity.title}</h2><span className="play-session-time" aria-label={`本次活动 ${formatPlayTime(elapsed)}`}>{status === 'idle' ? '' : formatPlayTime(elapsed)}</span></header>
    {status === 'finished' ? <div className="play-finish" aria-live="polite"><span className="play-finish-mark"><Check size={25} strokeWidth={1.4} /></span><h3>{saved ? '已记下' : '现在感觉怎样？'}</h3>{!saved && <><div className="play-feedback" role="group" aria-label="活动后的感受">{FEEDBACK_OPTIONS.map(item => <button type="button" key={item.value} aria-pressed={feedback === item.value} disabled={saving} className={feedback === item.value ? 'is-selected' : ''} onClick={() => setFeedback(item.value)}>{item.label}</button>)}</div><button type="button" className="primary-button" disabled={!feedback || saving} onClick={() => void save()}>{saving ? '保存中' : '记下'}<ArrowRight size={15} /></button></>}<button type="button" className="play-link-button" disabled={saving} onClick={saved ? reset : onBack}>{saved ? '再玩一会儿' : '暂不记录'}</button></div> : <>
      <div className="play-stage-wrap">
        {activityId === 'drawing' ? <DrawingGame ownerKey={ownerKey} active={active} onInteract={interact} onNotice={onNotice} /> : activityId === 'constellation' ? <ConstellationGame active={active} onInteract={interact} /> : <CatchLightGame active={active} onInteract={interact} />}
        {status === 'paused' && <div className="play-pause-overlay"><span>停一会儿</span><button type="button" className="primary-button" onClick={resume}><Play size={15} />继续</button></div>}
      </div>
      <div className="play-session-controls">{status !== 'idle' && <button type="button" className="play-soft-button" onClick={status === 'paused' ? resume : pause}>{status === 'paused' ? <Play size={15} /> : <Pause size={15} />}{status === 'paused' ? '继续' : '暂停'}</button>}<button type="button" className="play-end-button" disabled={status === 'idle'} onClick={finish}>结束这一小会儿<ArrowRight size={15} /></button></div>
    </>}
  </section>;
}
