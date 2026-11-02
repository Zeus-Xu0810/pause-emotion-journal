import { MASCOT_GESTURE_HITS, MASCOT_INTERACTION_SETTINGS as SETTINGS } from '../mascot-interaction-content.ts';
import type { MascotGesture, MascotHit, MascotMode, MascotPoint, MascotRegion } from './mascot-interaction-types';

/** 纯状态机不读DOM，不设置touch-action，也不阻止浏览器滚动。 */
export interface GestureStart { mode: MascotMode; region: MascotRegion | null; start: MascotPoint; at: number; pointerType: string }
interface MotionSample extends MascotPoint { at: number }
export interface GestureState extends GestureStart {
  point: MascotPoint; lastAt: number; dx: number; dy: number; maxTravel: number;
  kind: MascotGesture | null; claimed: boolean; cancelled: boolean; hasInteraction: boolean; tapPending: boolean; finished: boolean;
  strength: number; samples: readonly MotionSample[]; pinchScale?: number;
}
export interface PendingTap { region: MascotRegion; point: MascotPoint; at: number; kind: MascotGesture }
export interface TapUpdate { pending: PendingTap | null; kind: MascotGesture | null }
export interface PinchStart { mode: MascotMode; regions: readonly [MascotRegion | null, MascotRegion | null]; points: readonly [MascotPoint, MascotPoint]; at: number }
export interface PinchState extends GestureState { initialSpan: number; points: readonly [MascotPoint, MascotPoint] }
const bounded = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const distance = (a: MascotPoint, b: MascotPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const validPoint = (point: MascotPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const isCheek = (region: MascotRegion | null) => region === 'cheek-left' || region === 'cheek-right';
const isHand = (region: MascotRegion | null) => region === 'hand-left' || region === 'hand-right';
const defaultTap = (region: MascotRegion): MascotGesture => region === 'head' ? 'pat' : isHand(region) ? 'wave' : 'poke';

/** 空白没有可认领对象；所有后续调用都可安全收到已取消/已结束状态。 */
export function startGesture(input: GestureStart): GestureState {
  return { ...input, start: { ...input.start }, point: { ...input.start }, lastAt: input.at, dx: 0, dy: 0, maxTravel: 0,
    kind: null, claimed: false, cancelled: input.region === null || !validPoint(input.start) || !Number.isFinite(input.at),
    hasInteraction: false, tapPending: false, finished: false, strength: 0, samples: [{ ...input.start, at: input.at }] };
}
export function cancelGesture<T extends GestureState>(state: T): T {
  return { ...state, cancelled: true, finished: true, kind: null, claimed: false, hasInteraction: false, tapPending: false, strength: 0 };
}
function recognized(state: GestureState, kind: MascotGesture, minimumStrength = 0): GestureState {
  return { ...state, kind, claimed: true, hasInteraction: true, tapPending: false, strength: bounded(Math.max(minimumStrength, state.maxTravel / SETTINGS.strengthDistance), 0, 1) };
}
function permittedKind(mode: MascotMode, region: MascotRegion): MascotGesture | null {
  if (mode === 'auto' || mode === 'poke') return defaultTap(region);
  if (mode === 'pinch') return isCheek(region) ? 'pinch' : null;
  if (mode === 'drag') return region === 'body' || region === 'belly' ? 'drag' : null;
  if (mode === 'pat') return region === 'head' ? 'pat' : null;
  return region === 'belly' ? 'tickle' : null;
}

/** 有效换向须先走出完整一段距离；细微颤动不会累计成摸头、挠痒或摇晃。 */
function horizontalMotion(samples: readonly MotionSample[]) {
  if (samples.length < 2) return { reversals: 0, travel: 0 };
  let direction = 0; let extreme = samples[0].x; let reversals = 0; let travel = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const x = samples[index].x; travel += Math.abs(x - samples[index - 1].x);
    if (direction === 0) { if (Math.abs(x - extreme) >= SETTINGS.reversalMinimumDistance) { direction = Math.sign(x - extreme); extreme = x; } }
    else if (direction > 0) { if (x > extreme) extreme = x; else if (extreme - x >= SETTINGS.reversalMinimumDistance) { reversals += 1; direction = -1; extreme = x; } }
    else if (x < extreme) extreme = x;
    else if (x - extreme >= SETTINGS.reversalMinimumDistance) { reversals += 1; direction = 1; extreme = x; }
  }
  return { reversals, travel };
}

/** auto触屏始终优先纵向滚动；显式模式是否可捕获由DOM预先设置目标区域决定。 */
export function moveGesture(state: GestureState, point: MascotPoint, at: number): GestureState {
  if (state.cancelled || state.finished || at < state.lastAt) return state;
  if (!validPoint(point) || !Number.isFinite(at)) return cancelGesture(state);
  const dx = point.x - state.start.x; const dy = point.y - state.start.y;
  let next: GestureState = { ...state, point: { ...point }, lastAt: at, dx, dy, maxTravel: Math.max(state.maxTravel, distance(point, state.start)),
    samples: [...state.samples.filter(sample => at - sample.at <= SETTINGS.scrubMaximumMs), { ...point, at }].slice(-SETTINGS.maximumMotionSamples) };
  if (state.pointerType === 'touch' && state.mode === 'auto' && Math.abs(dy) >= SETTINGS.touchScrollDistance && Math.abs(dy) >= Math.abs(dx) * SETTINGS.touchScrollAxisRatio) return cancelGesture(next);
  if (!next.region || next.mode === 'poke') return next;
  if (state.pointerType === 'touch' && state.mode === 'auto' && Math.abs(dx) < Math.abs(dy) * SETTINGS.touchScrollAxisRatio) return next;
  if (isCheek(next.region) && (next.mode === 'auto' || next.mode === 'pinch') && next.maxTravel >= SETTINGS.faceDragStartDistance) return recognized(next, 'pinch', 0.2);
  if (next.mode !== 'auto') {
    const kind = permittedKind(next.mode, next.region);
    if (kind && next.maxTravel >= SETTINGS.dragStartDistance) return recognized(next, kind, 0.2);
    return next;
  }
  const scrub = horizontalMotion(next.samples);
  if (next.region === 'head' && scrub.reversals >= SETTINGS.scrubMinimumReversals) return recognized(next, 'pat', 0.3);
  if (next.region === 'belly' && scrub.reversals >= SETTINGS.scrubMinimumReversals) return recognized(next, 'tickle', 0.3);
  if (next.region === 'body') {
    const shake = horizontalMotion(next.samples.filter(sample => at - sample.at <= SETTINGS.shakeMaximumMs));
    if (shake.reversals >= SETTINGS.shakeMinimumReversals && shake.travel >= SETTINGS.shakeMinimumTravel) return recognized(next, 'shake', 0.3);
    if (next.maxTravel >= SETTINGS.dragStartDistance) next = recognized(next, next.kind === 'shake' ? 'shake' : 'drag', 0.2);
  }
  return next;
}

/** 根组件在长按截止时调用tick；离开目标、取消或已经拖动后不会补发长按。 */
export function tickGesture(state: GestureState, at: number): GestureState {
  if (state.cancelled || state.finished || at < state.lastAt || !Number.isFinite(at)) return state;
  const next = { ...state, lastAt: at };
  if (state.kind || state.maxTravel > SETTINGS.tapMaximumTravel || at - state.at < SETTINGS.longPressMs || !state.region || state.mode === 'poke') return next;
  const kind = state.mode === 'auto' ? isCheek(state.region) ? 'pinch' : state.region === 'body' ? 'drag' : state.region === 'head' ? 'pat' : null : permittedKind(state.mode, state.region);
  return kind ? recognized(next, kind, 0.25) : next;
}

/** 短按只进入连击等待区；已移动、长按或取消的指针绝不会退化为轻触。 */
export function finishGesture(state: GestureState, point: MascotPoint, at: number): GestureState {
  if (state.cancelled || state.finished) return state;
  // 双指结束沿用最后一次双指样本，不把剩下的一指错误升级为单指拉脸。
  if ('initialSpan' in state) return finishPinch(state as PinchState);
  let next = moveGesture(state, point, at);
  if (next.cancelled || at < state.lastAt) return cancelGesture(next);
  next = tickGesture(next, at);
  if (next.hasInteraction) return { ...next, finished: true, tapPending: false };
  const kind = next.region && next.maxTravel <= SETTINGS.tapMaximumTravel && at - next.at <= SETTINGS.tapMaximumMs ? permittedKind(next.mode, next.region) : null;
  return { ...next, finished: true, kind: kind || null, hasInteraction: Boolean(kind), tapPending: Boolean(kind) };
}

/** 第一击不返回动作；相同区域的近距第二击只返回bounce，不重复触发poke。 */
export function registerTap(pending: PendingTap | null, tap: PendingTap): TapUpdate {
  if (!validPoint(tap.point) || !Number.isFinite(tap.at) || (pending && tap.at < pending.at)) return { pending, kind: null };
  if (pending && tap.at >= pending.at && tap.at - pending.at <= SETTINGS.doubleTapMaximumMs && tap.region === pending.region && distance(tap.point, pending.point) <= SETTINGS.doubleTapMaximumDistance) return { pending: null, kind: 'bounce' };
  return { pending: { ...tap, point: { ...tap.point } }, kind: pending?.kind ?? null };
}
export function flushTap(pending: PendingTap | null, at: number): TapUpdate {
  if (!pending || !Number.isFinite(at) || at - pending.at < SETTINGS.doubleTapMaximumMs) return { pending, kind: null };
  return { pending: null, kind: pending.kind };
}

/** 键盘与上次指针状态完全分离；原生按钮只接一次click，重复keydown须由组件阻止。 */
export function keyboardGesture(mode: MascotMode, region: MascotRegion | null = null, repeat = false): MascotGesture | null {
  if (repeat) return null;
  const target = region ?? (mode === 'pinch' ? 'cheek-left' : mode === 'pat' ? 'head' : mode === 'tickle' ? 'belly' : 'body');
  return permittedKind(mode, target);
}

/** 双指只在预先选定pinch模式且两次命中脸颊时成立；auto交还系统缩放。 */
export function startPinch(input: PinchStart): PinchState {
  const [first, second] = input.points; const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const state: PinchState = { ...startGesture({ mode: input.mode, region: input.regions[0], start: center, at: input.at, pointerType: 'touch' }), initialSpan: distance(first, second), points: [{ ...first }, { ...second }], pinchScale: 1 };
  if (input.mode !== 'pinch' || !input.regions.every(isCheek) || !input.points.every(validPoint) || state.initialSpan < SETTINGS.pinchMinimumSpan) return cancelGesture(state);
  return { ...state, claimed: true };
}
export function movePinch(state: PinchState, points: readonly [MascotPoint, MascotPoint], at: number, pointerCount = 2): PinchState {
  if (state.cancelled || state.finished || at < state.lastAt) return state;
  if (pointerCount !== 2 || !points.every(validPoint) || !Number.isFinite(at)) return cancelGesture(state);
  const span = distance(points[0], points[1]); const scale = span / state.initialSpan;
  const point = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  const changed = Math.abs(span - state.initialSpan) >= SETTINGS.pinchMinimumDistance && Math.abs(scale - 1) + Number.EPSILON >= SETTINGS.pinchMinimumScaleChange;
  return { ...state, point, points: [{ ...points[0] }, { ...points[1] }], lastAt: at, dx: point.x - state.start.x, dy: point.y - state.start.y,
    kind: changed || state.hasInteraction ? 'pinch' : null, claimed: true, hasInteraction: changed || state.hasInteraction,
    strength: changed ? bounded(Math.abs(scale - 1) * 2, 0.2, 1) : state.strength,
    pinchScale: bounded(scale, SETTINGS.pinchMinimumScale, SETTINGS.pinchMaximumScale), tapPending: false };
}
export function finishPinch(state: PinchState): PinchState {
  if (state.cancelled || state.finished) return state;
  return { ...state, finished: true, claimed: state.hasInteraction, kind: state.hasInteraction ? 'pinch' : null, tapPending: false };
}

/** 无WebGL或键盘模式使用的几何命中后备，不冒充实际光线命中结果。 */
export function defaultHitForGesture(kind: MascotGesture): MascotHit {
  const hit = MASCOT_GESTURE_HITS[kind];
  return { region: hit.region, local: { ...hit.local } };
}
