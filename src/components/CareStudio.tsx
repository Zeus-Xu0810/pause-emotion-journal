import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, CloudRain, Footprints, Headphones, Leaf, Pause, Play, RotateCcw, Volume2, Wind, X } from 'lucide-react';
import { SETTINGS } from '../config';
import { CARE_KINDS, CARE_SETTINGS, FEEDBACK_OPTIONS, MINDFUL_STEPS, MOVEMENT_STEPS, SOUND_OPTIONS } from '../care-content';
import { createCareAudio } from '../lib/audio';
import { friendlyCloudError } from '../lib/firebase';
import { isAuthenticationRequired } from '../lib/session-save';
import type { CareAudioController, CareSound } from '../lib/audio';
import type { CareFeedback, PracticeKind, CareSession, MoodScore } from '../types';
import '../care.css';

/** 首页仅呈现呼吸面板；完整关怀页复用同一套实际计时与反馈逻辑。 */
interface CareStudioProps {
  compact?: boolean;
  mood: MoodScore | null;
  entryId?: string | null;
  onComplete: (session: CareSession) => Promise<void>;
  onNotice: (message: string) => void;
  initialKind?: PracticeKind;
}
type PracticeStatus = 'idle' | 'running' | 'paused' | 'finished';
const KIND_ICONS = { breathing: Wind, mindfulness: Leaf, music: Headphones, movement: Footprints };

/** 秒数仅用于显示，计时本身始终以单调时间戳差值为准。 */
function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}

export default function CareStudio({ compact = false, mood, entryId = null, onComplete, onNotice, initialKind = 'breathing' }: CareStudioProps) {
  // 可修改选项来自集中内容配置；引用保存真实练习时间、用户起始情绪与唯一记录。
  const [kind, setKind] = useState<PracticeKind>(compact ? 'breathing' : initialKind);
  const [minutes, setMinutes] = useState(!compact && initialKind === 'music' ? CARE_SETTINGS.musicMinutes[0] : SETTINGS.breathingMinutes[0]);
  const [movement, setMovement] = useState<'stretch' | 'walk'>('stretch');
  const [sound, setSound] = useState<CareSound>('chords');
  const [volume, setVolume] = useState(CARE_SETTINGS.initialVolume);
  const [status, setStatus] = useState<PracticeStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<CareFeedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const soundRef = useRef<CareAudioController | null>(null);
  const startRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const statusRef = useRef<PracticeStatus>('idle');
  const mountedRef = useRef(true);
  const pendingRef = useRef<Omit<CareSession, 'feedback'> | null>(null);
  const saveLock = useRef(false);
  const attemptedFeedback = useRef<CareFeedback | null>(null);
  const runMetaRef = useRef({ mood, entryId, kind, title: '' });
  const practiceId = useId();
  const content = CARE_KINDS.find((item) => item.kind === kind)!;
  const totalSeconds = kind === 'mindfulness' ? CARE_SETTINGS.mindfulnessMinutes * 60 : kind === 'movement' ? (movement === 'stretch' ? CARE_SETTINGS.stretchMinutes : CARE_SETTINGS.walkMinutes) * 60 : minutes * 60;
  const title = kind === 'music' ? SOUND_OPTIONS.find((item) => item.id === sound)!.title : kind === 'movement' ? movement === 'stretch' ? `${CARE_SETTINGS.stretchMinutes} 分钟轻伸展` : `${CARE_SETTINGS.walkMinutes} 分钟慢步行` : kind === 'mindfulness' ? `${CARE_SETTINGS.mindfulnessMinutes} 分钟回到此刻` : '舒缓呼吸';
  const locked = status !== 'idle' && !saved;
  const running = status === 'running';
  const elapsedSeconds = elapsedMs / 1000;
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const progress = Math.min(1, elapsedSeconds / totalSeconds);
  const breathCycle = SETTINGS.inhaleSeconds + SETTINGS.exhaleSeconds;
  const breathPosition = elapsedSeconds % breathCycle;
  const inhaling = breathPosition < SETTINGS.inhaleSeconds;
  const breathFraction = inhaling ? breathPosition / SETTINGS.inhaleSeconds : 1 - (breathPosition - SETTINGS.inhaleSeconds) / SETTINGS.exhaleSeconds;
  const breathScale = 0.78 + 0.3 * (0.5 - Math.cos(breathFraction * Math.PI) / 2);
  const phaseText = status === 'idle' ? '慢慢来' : status === 'paused' ? '停一会儿' : status === 'finished' ? '已完成' : inhaling ? '轻轻吸气' : '慢慢呼气';
  const steps = kind === 'movement' ? MOVEMENT_STEPS[movement] : MINDFUL_STEPS;
  const stepIndex = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  const currentStep = steps[stepIndex];

  // 路由退出或严格模式卸载时释放音频，页面之外不会继续发声。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  const changeStatus = useCallback((next: PracticeStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const readElapsed = useCallback(() => accumulatedRef.current + (startRef.current === null ? 0 : performance.now() - startRef.current), []);

  // 取消与重置不会创建完成记录；重置也清除未提交的反馈。
  const reset = useCallback(() => {
    soundRef.current?.dispose();
    soundRef.current = null;
    startRef.current = null;
    accumulatedRef.current = 0;
    pendingRef.current = null;
    attemptedFeedback.current = null;
    changeStatus('idle');
    setElapsedMs(0);
    setFeedback(null);
    setSaved(false);
  }, [changeStatus]);

  // 实际练习足够时才允许写入，保存的是主动结束时长或自然完成时长。
  const finish = useCallback(() => {
    if (statusRef.current !== 'running' && statusRef.current !== 'paused') return;
    const actualMs = Math.min(readElapsed(), totalSeconds * 1000);
    soundRef.current?.dispose();
    soundRef.current = null;
    startRef.current = null;
    accumulatedRef.current = actualMs;
    if (actualMs < CARE_SETTINGS.minimumRecordSeconds * 1000) {
      reset();
      onNotice('练习已结束。短暂体验不计入关怀记录。');
      return;
    }
    const meta = runMetaRef.current;
    pendingRef.current = { id: crypto.randomUUID(), type: meta.kind, title: meta.title, durationSeconds: Math.floor(actualMs / 1000), beforeMood: meta.mood, entryId: meta.entryId, createdAt: new Date().toISOString() };
    setElapsedMs(actualMs);
    changeStatus('finished');
  }, [changeStatus, onNotice, readElapsed, reset, totalSeconds]);

  // 定时器只刷新画面；后台节流后恢复时仍从时间戳准确计算，不累计 tick 误差。
  useEffect(() => {
    if (!running) return;
    const refresh = () => {
      const actualMs = readElapsed();
      setElapsedMs(Math.min(actualMs, totalSeconds * 1000));
      if (actualMs >= totalSeconds * 1000) finish();
    };
    const interval = window.setInterval(refresh, CARE_SETTINGS.tickMilliseconds);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [finish, readElapsed, running, totalSeconds]);

  // 暂停后重新开始会接续同一次练习，声音必须由明确点击启动。
  const start = () => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'paused') return;
    if (statusRef.current === 'idle') runMetaRef.current = { mood, entryId, kind, title };
    if (kind === 'music') {
      try {
        const engine = soundRef.current ?? createCareAudio(sound, volume);
        soundRef.current = engine;
        void engine.play().catch(() => {
          if (!mountedRef.current || soundRef.current !== engine) return;
          accumulatedRef.current = readElapsed();
          startRef.current = null;
          setElapsedMs(accumulatedRef.current);
          changeStatus('paused');
          engine.pause();
          onNotice('声音暂时无法播放，请检查浏览器的声音权限后重试。');
        });
      } catch (error) {
        onNotice(error instanceof Error ? error.message : '当前浏览器暂不支持声音播放。');
        return;
      }
    }
    startRef.current = performance.now();
    changeStatus('running');
  };
  const pause = () => {
    if (statusRef.current !== 'running') return;
    const actualMs = readElapsed();
    if (actualMs >= totalSeconds * 1000) {
      finish();
      return;
    }
    accumulatedRef.current = actualMs;
    startRef.current = null;
    setElapsedMs(accumulatedRef.current);
    soundRef.current?.pause();
    changeStatus('paused');
  };
  const selectKind = (next: PracticeKind) => {
    if (locked) return;
    reset();
    setKind(next);
    setMinutes(next === 'music' ? CARE_SETTINGS.musicMinutes[0] : SETTINGS.breathingMinutes[0]);
  };

  // 唯一 ID 在结束时产生，保存失败重试复用 ID，避免重复提交同一次练习。
  const save = async () => {
    if (!feedback || !pendingRef.current || saveLock.current || saved) return;
    // 引用锁在事件当下生效，避免状态尚未刷新时连续触发同一保存。
    saveLock.current = true;
    attemptedFeedback.current ??= feedback;
    setSaving(true);
    try {
      await onComplete({ ...pendingRef.current, feedback: attemptedFeedback.current });
      pendingRef.current = null;
      if (mountedRef.current) setSaved(true);
    } catch (error) {
      // 写入结果不确定时，重试必须保留原反馈；账号门槛尚未写入，可以继续选择。
      if (isAuthenticationRequired(error)) attemptedFeedback.current = null;
      else onNotice(friendlyCloudError(error));
    } finally {
      saveLock.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return <section className={`cs-studio ${compact ? 'care-panel cs-compact' : 'cs-full'}`} aria-label={compact ? '舒缓呼吸' : '自我关怀练习'}>
    {!compact && <div className="cs-kind-tabs" role="tablist" aria-label="关怀方式" onKeyDown={(event) => {
      // 页签遵循方向键与 Home/End 规范，练习中保持当前方式以免意外丢失计时。
      if (locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = CARE_KINDS.findIndex((item) => item.kind === kind);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? CARE_KINDS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + CARE_KINDS.length) % CARE_KINDS.length;
      const next = CARE_KINDS[nextIndex].kind;
      selectKind(next);
      document.getElementById(`${practiceId}-${next}`)?.focus();
    }}>
      {CARE_KINDS.map((item) => { const Icon = KIND_ICONS[item.kind]; return <button type="button" key={item.kind} role="tab" tabIndex={kind === item.kind ? 0 : -1} aria-selected={kind === item.kind} aria-controls={`${practiceId}-panel`} id={`${practiceId}-${item.kind}`} disabled={locked && kind !== item.kind} className={kind === item.kind ? 'is-active' : ''} onClick={() => selectKind(item.kind)}><Icon size={18} /><span>{item.label}</span></button>; })}
    </div>}
    <div className="cs-practice" id={`${practiceId}-panel`} role={compact ? undefined : 'tabpanel'} aria-labelledby={compact ? undefined : `${practiceId}-${kind}`}>
      <div className="cs-intro">
        <h2>{content.title}</h2>
      </div>

      {status === 'finished' ? <div className="cs-finish" aria-live="polite">
        <div className="cs-finish-mark"><Check size={27} strokeWidth={1.3} /></div>
        <p className="cs-finish-time">{formatTime(elapsedSeconds)}</p>
        <h3>{saved ? '已记下' : '现在感觉怎样？'}</h3>
        {saved ? <p className="cs-finish-copy">已保存本次反馈</p> : <><div className="cs-feedback" role="group" aria-label="练习后的感受">{FEEDBACK_OPTIONS.map((item) => <button type="button" aria-pressed={feedback === item.value} disabled={saving || attemptedFeedback.current !== null} className={feedback === item.value ? 'is-selected' : ''} key={item.value} onClick={() => setFeedback(item.value)}>{item.label}</button>)}</div><button type="button" className="primary-button" disabled={!feedback || saving} onClick={() => void save()}>{saving ? '保存中' : '记下'}<ArrowRight size={14} /></button></>}
        <button type="button" className="cs-text-button" disabled={saving} onClick={reset}>{saved ? '再来一次' : '跳过'}</button>
      </div> : <>
        {kind === 'breathing' && <div className="cs-breath-stage">
          <div className="cs-breath-track" aria-hidden="true"><span /><span /></div>
          <div className="cs-breath-circle" style={{ transform: `scale(${status === 'idle' ? 0.88 : breathScale})` }}><span className="cs-breath-center" style={{ transform: `scale(${1 / (status === 'idle' ? 0.88 : breathScale)})` }}><strong aria-live="polite">{phaseText}</strong><small>{running ? `${Math.max(1, Math.ceil(inhaling ? SETTINGS.inhaleSeconds - breathPosition : breathCycle - breathPosition))} 秒` : `${SETTINGS.inhaleSeconds} 秒吸气 · ${SETTINGS.exhaleSeconds} 秒呼气`}</small></span></div>
        </div>}
        {(kind === 'mindfulness' || kind === 'movement') && <div className="cs-guidance">
          <div className="cs-step-index"><span>{String(stepIndex + 1).padStart(2, '0')}</span><span> / {String(steps.length).padStart(2, '0')}</span></div>
          <div className="cs-guidance-copy" aria-live="polite"><h3>{currentStep.title}</h3><p>{currentStep.text}</p></div>
          <div className="cs-step-progress" aria-label={`第 ${stepIndex + 1} 阶段，共 ${steps.length} 阶段`}>{steps.map((step, index) => <span key={step.title} className={index <= stepIndex ? 'is-active' : ''} />)}</div>
        </div>}
        {kind === 'music' && <div className="cs-sound-stage"><div className={`cs-sound-art ${running ? 'is-playing' : ''}`} aria-hidden="true">{Array.from({ length: 19 }, (_, index) => <span key={index} style={{ height: `${18 + Math.sin(index * 0.8) ** 2 * 58}px`, animationDelay: `${index * -0.15}s` }} />)}</div><div className="cs-sounds" role="group" aria-label="声音选择">{SOUND_OPTIONS.map((option) => <button type="button" key={option.id} aria-pressed={sound === option.id} disabled={locked} className={sound === option.id ? 'is-selected' : ''} onClick={() => setSound(option.id)}>{option.id === 'rain' ? <CloudRain size={20} /> : option.id === 'waves' ? <Wind size={20} /> : <Headphones size={20} />}<span><strong>{option.label}</strong></span>{sound === option.id && <Check size={15} />}</button>)}</div><label className="cs-volume"><Volume2 size={16} /><span>音量</span><input type="range" min="0" max="1" step="0.01" value={volume} aria-label="声音音量" onChange={(event) => { const next = Number(event.target.value); setVolume(next); soundRef.current?.setVolume(next); }} /><output>{Math.round(volume * 100)}%</output></label></div>}

        <div className="cs-session-footer">
          {(kind === 'breathing' || kind === 'music') && <div className="cs-duration" role="group" aria-label="练习时长">{(kind === 'breathing' ? SETTINGS.breathingMinutes : CARE_SETTINGS.musicMinutes).map((option) => <button type="button" aria-pressed={minutes === option} className={minutes === option ? 'is-selected' : ''} key={option} disabled={locked} onClick={() => setMinutes(option)}>{option} 分钟</button>)}</div>}
          {kind === 'movement' && <div className="cs-duration" role="group" aria-label="活动方式"><button type="button" aria-pressed={movement === 'stretch'} className={movement === 'stretch' ? 'is-selected' : ''} disabled={locked} onClick={() => setMovement('stretch')}>轻伸展 · {CARE_SETTINGS.stretchMinutes} 分钟</button><button type="button" aria-pressed={movement === 'walk'} className={movement === 'walk' ? 'is-selected' : ''} disabled={locked} onClick={() => setMovement('walk')}>慢步行 · {CARE_SETTINGS.walkMinutes} 分钟</button></div>}
          <div className="cs-timer-line"><span>{status === 'paused' ? '已暂停' : status === 'running' ? '进行中' : ''}</span><span role="timer" aria-label={`剩余 ${Math.ceil(remaining)} 秒`}>{formatTime(remaining)}</span></div>
          <div className="cs-progress" role="progressbar" aria-label="练习进度" aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={Math.floor(elapsedSeconds)}><span style={{ width: `${progress * 100}%` }} /></div>
          <div className="cs-controls"><button type="button" className="primary-button" onClick={running ? pause : start}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? '暂停' : status === 'paused' ? '继续' : '开始'}</button>{status !== 'idle' && <button type="button" className="secondary-button cs-reset" aria-label="重新开始练习" title="重新开始" onClick={reset}><RotateCcw size={16} /></button>}</div>
          {status !== 'idle' && <div className="cs-exit-controls"><button type="button" className="cs-text-button" onClick={finish}>结束</button><button type="button" className="cs-text-button" onClick={reset}><X size={12} />退出</button></div>}
          <details className="cs-safety"><summary>练习提示</summary><p>{kind === 'breathing' ? '按舒服的节奏呼吸，不必勉强跟上。若有头晕或不适，请停止。' : kind === 'movement' ? '量力而行。出现疼痛、眩晕或不适时，请立即停止。步行时留意周围安全。' : kind === 'music' ? '本站合成声景 · 建议低音量。声音不适合此刻，也可以换一种方式。' : '可以睁着眼，也可以随时停下。不必强求放松或清空思绪。'}</p></details>
        </div>
      </>}
    </div>
  </section>;
}
