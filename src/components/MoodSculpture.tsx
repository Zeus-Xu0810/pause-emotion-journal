import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Apple, CircleDot, Hand, Moon, MoreHorizontal, RotateCcw, Sparkles, Sun } from 'lucide-react';
import { MASCOT_REPLIES, MASCOT_SETTINGS } from '../mascot-content';
import type { MascotExpression } from '../mascot-content';
import { MASCOT_GESTURE_EXPRESSIONS, MASCOT_GESTURE_REPLIES, MASCOT_INTERACTION_SETTINGS, MASCOT_MODE_HINTS } from '../mascot-interaction-content';
import { createMascotDeck } from '../lib/mascot-deck';
import { createMascotScene } from '../lib/mascot-scene';
import { defaultHitForGesture } from '../lib/mascot-gestures';
import { usePetCare } from '../lib/usePetCare';
import type { PetActivity } from '../lib/pet-care';
import { useMascotInteraction } from '../lib/useMascotInteraction';
import type { MascotBounds, MascotGesture, MascotHit, MascotMode, MascotSceneController } from '../lib/mascot-interaction-types';
import MascotFallback, { fallbackBounds } from './MascotFallback';
import type { MoodScore } from '../types';
import '../sculpture.css';

interface MoodSculptureProps { mood?: MoodScore | null; className?: string }
interface Bubble { id: number; text: string; durationMs: number }
/** 主工具只留四个短入口，其他小动作折叠；可调交互阈值统一来自内容配置。 */
const MAIN_MODES: { mode: MascotMode; label: string }[] = [{ mode: 'auto', label: '随心' }, { mode: 'pinch', label: '捏脸' }, { mode: 'drag', label: '拽拽' }, { mode: 'pat', label: '摸摸' }];
const CARE_ACTIVITIES = [{ kind: 'feed', label: '喂食', icon: Apple }, { kind: 'tease', label: '逗玩', icon: CircleDot }, { kind: 'sleep', label: '哄睡', icon: Moon }] as const;
// 道具说明兼顾触屏、自由抛接和原生键盘操作。
const PET_PROP_LABELS: Record<PetActivity, string> = { feed: '拖动点心甩出喂食，空中也可再抓；轻触或回车递一口', tease: '拖动小球甩出逗玩，可空中再抓；轻触或回车递球', sleep: '慢慢摇动月亮哄睡，轻触或回车也可安抚' };
const baseExpression = (mood: MoodScore | null): MascotExpression => mood !== null && mood <= 3 ? 'soft' : 'happy';

/** 团子只读情绪来共情；任何鼠标、触屏或键盘动作都不选择评分或写入日记。 */
export default function MoodSculpture({ mood = null, className = '' }: MoodSculptureProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MascotSceneController | null>(null);
  const readyRef = useRef(false);
  const petCareRef = useRef<ReturnType<typeof usePetCare> | null>(null);
  const latestMood = useRef(mood);
  const deckRef = useRef<ReturnType<typeof createMascotDeck> | null>(null);
  const bubbleSequence = useRef(0);
  const responseAfter = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextIndex = useRef<Partial<Record<MascotGesture, number>>>({});
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<MascotMode>('auto');
  const [more, setMore] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [expression, setExpression] = useState<MascotExpression>(baseExpression(mood));
  const [reaction, setReaction] = useState<MascotGesture | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const helpId = useId();
  latestMood.current = mood;
  const say = useCallback((text: string, durationMs = MASCOT_SETTINGS.replyVisibleMs) => setBubble({ text, durationMs, id: ++bubbleSequence.current }), []);

  /** 过程反馈与松手反应分开：按住时就回应，但绝不打断Three里的持续抓取。 */
  const contextualReply = useCallback((kind: MascotGesture) => {
    const choices = MASCOT_GESTURE_REPLIES[kind];
    const previous = contextIndex.current[kind];
    let index = Math.floor(Math.random() * choices.length);
    if (choices.length > 1 && index === previous) index = (index + 1) % choices.length;
    contextIndex.current[kind] = index; say(choices[index]);
  }, [say]);
  const engage = useCallback((kind: MascotGesture) => {
    if (petCareRef.current?.touch(kind)) return;
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    setReaction(null); setExpression(MASCOT_GESTURE_EXPRESSIONS[kind]);
    const now = performance.now();
    if (now >= responseAfter.current) { contextualReply(kind); responseAfter.current = now + 1100; }
  }, [contextualReply]);
  /** 每次真实接触都有物理反应；短冷却只限文字，不吞掉快节奏的戳、抓、放。 */
  const react = useCallback((kind: MascotGesture, hit: MascotHit) => {
    const now = performance.now();
    sceneRef.current?.react(kind, hit);
    if (petCareRef.current?.touch(kind, true)) return;
    if (now >= responseAfter.current) {
      if (kind === 'poke') {
        deckRef.current ??= createMascotDeck(MASCOT_REPLIES);
        const next = deckRef.current.draw(); say(next.text); sceneRef.current?.play(next);
      } else contextualReply(kind);
      responseAfter.current = now + MASCOT_INTERACTION_SETTINGS.gestureCooldownMs;
    }
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    setReaction(kind); setExpression(MASCOT_GESTURE_EXPRESSIONS[kind]);
    reactionTimer.current = setTimeout(() => { setReaction(null); setExpression(baseExpression(latestMood.current)); }, MASCOT_INTERACTION_SETTINGS.reactionResetMs);
  }, [say, contextualReply]);
  const controls = useMascotInteraction({ mode, ready, scene: sceneRef, host: hostRef, button: buttonRef, onReact: react, onEngage: engage });

  const care = usePetCare({ scene: sceneRef, host: hostRef, ready, say, beforeSelect: controls.reset });
  petCareRef.current = care;

  const setBounds = useCallback((bounds: MascotBounds) => {
    const target = buttonRef.current;
    if (!target) return;
    target.style.left = `${bounds.left}px`; target.style.top = `${bounds.top}px`;
    target.style.width = `${bounds.width}px`; target.style.height = `${bounds.height}px`;
  }, []);
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    let active = true;
    const fallbackSize = () => { if (!readyRef.current) setBounds(fallbackBounds(host.clientWidth, host.clientHeight)); };
    fallbackSize();
    // 场景失败可直接回到同一套交互的CSS后备，不让WebGL成为操作前提。
    const scene = createMascotScene(host, { mood: latestMood.current, onReady: value => { if (active) { readyRef.current = value; setReady(value); if (!value) fallbackSize(); } }, onBounds: bounds => { if (active) setBounds(bounds); }, onPetEvent: care.event, onPetTargets: care.publishTargets });
    sceneRef.current = scene;
    scene.setPetActivity(petCareRef.current?.activity ?? null);
    if (petCareRef.current?.response) scene.petRespond(petCareRef.current.response);
    const observer = new ResizeObserver(fallbackSize); observer.observe(host);
    return () => { active = false; observer.disconnect(); scene.dispose(); sceneRef.current = null; readyRef.current = false; };
  }, [setBounds, care.event, care.publishTargets]);
  useEffect(() => { sceneRef.current?.setMood(mood); setExpression(baseExpression(mood)); }, [mood]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!more) return;
    const outside = (event: globalThis.PointerEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setMore(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [more]);

  // 气泡按真正可见的时长停留，离屏/隐藏暂停，恢复后继续，不累积聊天记录。
  useEffect(() => {
    if (!bubble) return;
    let remaining = bubble.durationMs; let startedAt: number | null = null; let timer: ReturnType<typeof setTimeout> | null = null; let visible = true;
    const pause = () => { if (timer) clearTimeout(timer); timer = null; if (startedAt !== null) remaining = Math.max(0, remaining - (performance.now() - startedAt)); startedAt = null; };
    const resume = () => { pause(); if (document.hidden || !visible) return; if (!remaining) { setBubble(null); return; } startedAt = performance.now(); timer = setTimeout(() => setBubble(null), remaining); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); }, { threshold: 0.01 });
    if (rootRef.current) observer.observe(rootRef.current);
    document.addEventListener('visibilitychange', resume); resume();
    return () => { pause(); observer.disconnect(); document.removeEventListener('visibilitychange', resume); };
  }, [bubble]);
  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);

  function selectMode(next: MascotMode) {
    care.reset(); controls.reset(); setMore(false); setMode(next);
    say(MASCOT_MODE_HINTS[next], MASCOT_INTERACTION_SETTINGS.modeHintMs);
    buttonRef.current?.focus({ preventScroll: true });
  }
  function quick(kind: MascotGesture) { controls.reset(); setMore(false); react(kind, defaultHitForGesture(kind)); buttonRef.current?.focus({ preventScroll: true }); }
  function reset() { care.reset(); controls.reset(); setMore(false); setMode('auto'); setBubble(null); setReaction(null); setExpression(baseExpression(mood)); sceneRef.current?.look(0, 0); if (reactionTimer.current) clearTimeout(reactionTimer.current); }
  const careExpression: MascotExpression = care.response ? ['asleep', 'drowsy'].includes(care.response.kind) ? 'sleepy' : care.response.kind === 'full' ? 'soft' : care.response.kind === 'wake' ? 'curious' : 'happy' : expression;
  const style = { '--sculpture-color': mood === null ? MASCOT_SETTINGS.neutralColor : MASCOT_SETTINGS.moodColors[mood] } as CSSProperties;
  return <div ref={rootRef} className={`mood-sculpture ${ready ? 'is-ready' : 'is-fallback'} ${className}`} style={style} data-mode={mode} data-pet-activity={care.activity ?? 'none'} data-pet-response={care.response?.kind ?? 'idle'} data-gesture={controls.interaction?.kind ?? reaction ?? 'idle'} onKeyDown={event => { if (event.key === 'Escape') { setMore(false); setBubble(null); } }}>
    <div className="mascot-reply-space"><p className={`mascot-reply ${bubble ? 'is-visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">{bubble?.text ?? ''}</p></div>
    <div className="mascot-visual-stage">
      <div ref={hostRef} className="mood-sculpture-canvas" aria-hidden="true" />
      {!ready && <MascotFallback mood={mood} expression={careExpression} activity={care.activity} response={care.response} petInput={care.lastInput} onPetTargets={care.publishTargets} onPetEvent={care.event} gaze={controls.gaze} interaction={controls.interaction} reaction={reaction} reduced={reduced} />}
      <button ref={buttonRef} className={`mascot-touch-target ${controls.interaction ? 'is-manipulating' : ''}`} type="button" aria-label="和小团子玩一下" aria-describedby={helpId} data-mode={mode} data-region={controls.region ?? 'none'} data-gesture={controls.interaction?.kind ?? 'idle'} {...controls.handlers} />
      {care.activity && <button ref={care.propRef} className="mascot-care-target" type="button" style={{ visibility: 'hidden' }} disabled={care.busy} aria-label={PET_PROP_LABELS[care.activity]} {...care.handlers}><span className="mascot-sr-only">{PET_PROP_LABELS[care.activity]}</span></button>}
      <span className="mascot-sr-only" id={helpId}>当前{MAIN_MODES.find(item => item.mode === mode)?.label ?? '挠痒'}模式。Enter或空格互动，选捏脸或拽拽后可按方向键，松键回弹，Escape放开。</span>
    </div>
    <div className="mascot-tools has-care-tools" ref={toolsRef} role="group" aria-label="团子互动工具">
      <div className="mascot-care-toolbar" role="group" aria-label="照顾团子">{CARE_ACTIVITIES.map(({ kind, label, icon: Icon }) => <button key={kind} className="mascot-care-button" type="button" aria-pressed={care.activity === kind} onClick={() => { setMore(false); setMode('auto'); care.select(kind); }}>{kind === 'sleep' && care.sleeping ? <Sun size={15} /> : <Icon size={15} />}<span>{kind === 'sleep' && care.sleeping ? '叫醒它' : label}</span></button>)}</div>
      <div className="mascot-touch-tools">
      {MAIN_MODES.map(item => <button className="mascot-toolbutton" key={item.mode} type="button" aria-pressed={mode === item.mode} onClick={() => selectMode(item.mode)}>{item.mode === 'auto' ? <Sparkles size={13} /> : item.mode === 'pat' ? <Hand size={13} /> : null}{item.label}</button>)}
      <div className="mascot-more"><button className="mascot-toolbutton" type="button" aria-label="更多团子互动" aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={18} /></button>
        {more && <div className="mascot-tools-menu" role="group" aria-label="更多玩法"><button type="button" onClick={() => quick('poke')}>戳一下</button><button type="button" onClick={() => selectMode('tickle')}>挠痒痒</button><button type="button" onClick={() => quick('wave')}>击个掌</button><button type="button" onClick={() => quick('bounce')}>蹦一下</button><button type="button" onClick={reset}><RotateCcw size={13} />回到原位</button></div>}
      </div>
      </div>
    </div>
  </div>;
}
