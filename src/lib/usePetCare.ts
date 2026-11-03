import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';
import { createPetMemory, respondToPet } from './pet-care';
import type { PetActivity, PetEvent, PetInput, PetPoint, PetPropPhase, PetResponse, PetTargets } from './pet-care';
import { estimatePetRelease } from './pet-flight';
import type { MascotGesture, MascotSceneController } from './mascot-interaction-types';

/** 输入配置集中设置；飞行与真实嘴、双手接触统一由渲染场景判断。 */
const INPUT = { keyboardHintMs: 4200, tapMaximumPx: 6, tapMaximumMs: 420, sampleWindowMs: 220 };
export const PET_ACTIVITY_HINTS: Record<PetActivity, string> = { feed: '把点心抛过来，我来接', tease: '点点小球，看我换个玩法', sleep: '轻轻摇月亮，陪我打个盹' };
interface PetCareOptions {
  scene: RefObject<MascotSceneController | null>;
  host: RefObject<HTMLDivElement | null>;
  ready: boolean;
  say: (text: string, duration?: number) => void;
  beforeSelect: () => void;
}
interface PropGrip { id: number; start: number; point: PetPoint; travelPx: number; samples: Array<PetPoint & { at: number }> }

/** 页面内记忆与可访问的道具输入桥接；不读写账号、日记或浏览器持久存储。 */
export function usePetCare(options: PetCareOptions) {
  const latest = useRef(options); latest.current = options;
  const memory = useRef(createPetMemory(0));
  const activityRef = useRef<PetActivity | null>(null);
  const responseRef = useRef<PetResponse | null>(null);
  const phaseRef = useRef<PetPropPhase | undefined>(undefined);
  const grip = useRef<PropGrip | null>(null);
  const propRef = useRef<HTMLButtonElement>(null);
  const [activity, setActivity] = useState<PetActivity | null>(null);
  const [response, setResponse] = useState<PetResponse | null>(null);
  const [lastInput, setLastInput] = useState<PetInput | null>(null);
  const [phase, setPhase] = useState<PetPropPhase | undefined>();

  /** 真实碰撞只提交一次模型事件；冷却拒绝也回ACK，不能留下场景等待锁。 */
  const event = useCallback((input: PetEvent) => {
    const result = respondToPet(memory.current, input); memory.current = result.memory;
    latest.current.scene.current?.petRespond(result.response);
    if (result.response) { responseRef.current = result.response; setResponse(result.response); latest.current.say(result.response.text); }
    return result.response;
  }, []);
  const publishTargets = useCallback((next: PetTargets) => {
    // 只在阶段改变时更新React，连续坐标直接定位透明命中区，避免每帧重渲染。
    if (phaseRef.current !== next.phase) { phaseRef.current = next.phase; setPhase(next.phase); }
    const button = propRef.current; if (!button) return;
    button.hidden = !next.prop;
    if (!next.prop) return;
    const radius = Math.max(22, next.prop.radius);
    button.style.left = `${next.prop.x - radius}px`; button.style.top = `${next.prop.y - radius}px`;
    button.style.width = `${radius * 2}px`; button.style.height = `${radius * 2}px`;
    button.style.visibility = 'visible';
  }, []);
  const pointAt = useCallback((clientX: number, clientY: number): PetPoint => {
    const rect = latest.current.host.current?.getBoundingClientRect();
    return rect ? { x: Math.max(-1, Math.min(1, (clientX - rect.left) / rect.width * 2 - 1)), y: Math.max(-1, Math.min(1, (clientY - rect.top) / rect.height * 2 - 1)) } : { x: 0, y: 0 };
  }, []);
  const send = useCallback((input: PetInput) => {
    latest.current.scene.current?.petInput(input); setLastInput(input);
    // 后备渲染也自行检测真实轨迹；输入桥不能凭释放位置提前发出吃到/接到事件。
  }, []);
  const cancel = useCallback(() => {
    const current = grip.current; grip.current = null;
    if (current) { try { if (propRef.current?.hasPointerCapture(current.id)) propRef.current.releasePointerCapture(current.id); } catch { /* 系统可能已释放捕获。 */ } }
    send({ type: 'cancel' });
  }, [send]);
  const select = useCallback((next: PetActivity) => {
    latest.current.beforeSelect(); cancel();
    if (next === 'sleep' && memory.current.sleeping) { event({ kind: 'wake', at: performance.now() }); return; }
    const selected = activityRef.current === next ? null : next;
    activityRef.current = selected; setActivity(selected); setLastInput(null);
    latest.current.scene.current?.setPetActivity(selected);
    if (memory.current.sleeping && selected) event({ kind: 'wake', at: performance.now() });
    else if (!memory.current.sleeping) { responseRef.current = null; setResponse(null); }
    if (selected && !memory.current.sleeping && responseRef.current?.kind !== 'wake') latest.current.say(PET_ACTIVITY_HINTS[selected], INPUT.keyboardHintMs);
  }, [cancel, event]);
  const touch = useCallback((kind: MascotGesture, finished = false) => {
    // Three可能已经在这一拍接触中唤醒；完成手势不能立刻清掉刚生成的伸展回应。
    if (responseRef.current?.kind === 'wake') return true;
    if (kind === 'pat' && activityRef.current === 'sleep') { if (finished) event({ kind: 'soothe', at: performance.now() }); return finished; }
    if (memory.current.sleeping || responseRef.current?.kind === 'drowsy') { event({ kind: 'wake', at: performance.now() }); return true; }
    if (responseRef.current) { responseRef.current = null; setResponse(null); }
    return false;
  }, [event]);
  const reset = useCallback(() => { cancel(); activityRef.current = null; setActivity(null); setLastInput(null); latest.current.scene.current?.setPetActivity(null); if (memory.current.sleeping || responseRef.current?.kind === 'drowsy') event({ kind: 'wake', at: performance.now() }); else { responseRef.current = null; setResponse(null); } }, [cancel, event]);

  /** 普通反应只按可见时长结束；困倦和熟睡持续保留，切标签或离屏不会偷偷演完。 */
  useEffect(() => {
    if (!response || response.kind === 'asleep' || response.kind === 'drowsy') return;
    let remaining = response.durationMs; let started: number | null = null; let timer: ReturnType<typeof setTimeout> | null = null; let visible = true;
    const pause = () => { if (timer) clearTimeout(timer); timer = null; if (started !== null) remaining = Math.max(0, remaining - (performance.now() - started)); started = null; };
    const sync = () => { pause(); if (document.hidden || !visible) return; started = performance.now(); timer = setTimeout(() => { if (responseRef.current?.id === response.id) responseRef.current = null; setResponse(previous => previous?.id === response.id ? null : previous); }, remaining); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    if (latest.current.host.current) observer.observe(latest.current.host.current);
    document.addEventListener('visibilitychange', sync); sync();
    return () => { pause(); observer.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [response]);
  useEffect(() => { const blur = () => { if (grip.current) cancel(); }; const hidden = () => { if (document.hidden) blur(); }; window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden); return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); }; }, [cancel]);

  /** 道具保留原生键盘激活；指针拖动只作用于小道具，不覆盖页面空白区。 */
  function pointerDown(input: PointerEvent<HTMLButtonElement>) {
    if (input.button !== 0 || grip.current) return;
    input.preventDefault(); input.stopPropagation();
    const point = pointAt(input.clientX, input.clientY); const at = performance.now();
    grip.current = { id: input.pointerId, start: at, point, travelPx: 0, samples: [{ ...point, at }] };
    input.currentTarget.setPointerCapture(input.pointerId); send({ type: 'start', point });
  }
  function pointerMove(input: PointerEvent<HTMLButtonElement>) {
    const current = grip.current; if (!current || current.id !== input.pointerId) return;
    input.preventDefault(); const point = pointAt(input.clientX, input.clientY); const at = performance.now();
    const host = latest.current.host.current;
    current.travelPx += Math.hypot((point.x - current.point.x) * (host?.clientWidth ?? 1) / 2, (point.y - current.point.y) * (host?.clientHeight ?? 1) / 2);
    current.point = point;
    // 使用实际采样时刻，保留短窗口；停住后松手不会沿用早先的高速甩动。
    current.samples = current.samples.filter(sample => at - sample.at <= INPUT.sampleWindowMs);
    current.samples.push({ ...point, at }); send({ type: 'move', point });
  }
  function pointerUp(input: PointerEvent<HTMLButtonElement>) {
    if (grip.current?.id !== input.pointerId) return;
    const current = grip.current; const point = pointAt(input.clientX, input.clientY); const host = latest.current.host.current;
    const travelPx = current.travelPx + Math.hypot((point.x - current.point.x) * (host?.clientWidth ?? 1) / 2, (point.y - current.point.y) * (host?.clientHeight ?? 1) / 2);
    // 轻触支持一键递食；拖拽释放携带真实末段速度，交给统一飞行与碰撞系统。
    if (travelPx <= INPUT.tapMaximumPx && performance.now() - current.start <= INPUT.tapMaximumMs) { send({ type: 'cancel' }); send({ type: 'activate' }); }
    else send({ type: 'release', point, velocity: estimatePetRelease([...current.samples, { ...point, at: performance.now() }]) });
    grip.current = null;
    try { if (input.currentTarget.hasPointerCapture(input.pointerId)) input.currentTarget.releasePointerCapture(input.pointerId); } catch { /* 浏览器可隐式释放。 */ }
  }
  function click(input: MouseEvent<HTMLButtonElement>) { if (input.detail === 0) send({ type: 'activate' }); }
  function keyDown(input: KeyboardEvent<HTMLButtonElement>) { if (input.key === 'Escape') { input.preventDefault(); cancel(); } if ((input.key === 'Enter' || input.key === ' ') && input.repeat) input.preventDefault(); }
  return { activity, response, phase, lastInput, sleeping: memory.current.sleeping, propRef, event, publishTargets, select, touch, reset,
    // 掌心等候、玩球中和自由飞行均可再次抓取；只有接稳、咀嚼等阶段锁定输入。
    busy: phase !== undefined ? ['contact', 'eating', 'responding'].includes(phase) : response !== null && !['drowsy', 'asleep'].includes(response.kind),
    handlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: cancel, onLostPointerCapture: () => { if (grip.current) cancel(); }, onClick: click, onKeyDown: keyDown },
  };
}
