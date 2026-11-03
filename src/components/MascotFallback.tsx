import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { MASCOT_SETTINGS, type MascotExpression } from '../mascot-content';
import type { MoodScore } from '../types';
import type { MascotBounds, MascotGesture, MascotHit, MascotManipulation, MascotPoint } from '../lib/mascot-interaction-types';
import type { PetActivity, PetEvent, PetEventKind, PetInput, PetPoint, PetPropPhase, PetResponse, PetTargets } from '../lib/pet-care';
import { advancePetFlight, createPetFlight, isPetFlightResting, sweptPetCatch, type PetFlight } from '../lib/pet-flight';
import { samplePetMeal } from '../lib/pet-performance';

/** 后备团子的形状、命中区域和动作范围集中设置，绘制与命中共用同一份几何。 */
const FALLBACK = {
  widthShare: 0.7,
  heightShare: 0.8,
  aspect: 1.03,
  centerY: 0.49,
  stageInset: 8,
  dragTilt: 13,
  dragTiltPerPixel: 0.2,
  dragStretch: 0.065,
  gazeTravel: 3.6,
  cheekTravel: 0.24,
  cheekStretch: 1.8,
  facePull: 0.2,
  faceTilt: 11,
  patFaceLift: 3.4,
  care: {
    propSizeShare: 0.16,
    propMinSize: 36,
    propMaxSize: 58,
    homeInset: 8,
    responseMinMs: 700,
    responseMaxMs: 2400,
    targetTolerance: 0.35,
    handHoldSeconds: 0.22,
    handToMouthSeconds: 0.44,
    keyboardFlightSeconds: 0.5,
    keyboardArc: 0.12,
    keyboardCatchStart: 0.55,
    throwBackX: 0.82,
    throwBackY: -0.85,
    handReachPx: 20,
    mouthReachPx: 15,
    catchGraceSeconds: 0.24,
    sleepMinimumMs: 320,
    sleepTravel: 0.16,
    sleepMaximumSpeed: 1.25,
    moonAlertSeconds: 0.9,
    mealRegrowStart: 0.93,
    moonTravel: 0.27,
    feed: { x: 1.06, y: 0.77 },
    tease: { x: 1.1, y: 0.58 },
    sleep: { x: 0.96, y: 0.15 },
  },
  parts: {
    'hand-left': { x: -0.025, y: 0.585, rx: 0.075, ry: 0.12, angle: 18 },
    'hand-right': { x: 1.025, y: 0.585, rx: 0.075, ry: 0.12, angle: -18 },
    'foot-left': { x: 0.33, y: 0.985, rx: 0.1, ry: 0.058, angle: 0 },
    'foot-right': { x: 0.67, y: 0.985, rx: 0.1, ry: 0.058, angle: 0 },
  },
};
type Ellipse = { x: number; y: number; rx: number; ry: number; angle?: number };
type VariableStyle = CSSProperties & Record<`--${string}`, number | string>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

/** 使用舞台真实像素获得身体框；窄屏按宽度约束，矮屏按高度约束。 */
function bodyBounds(width: number, height: number): MascotBounds {
  const bodyWidth = Math.max(0, Math.min(width * FALLBACK.widthShare, height * FALLBACK.heightShare));
  const bodyHeight = bodyWidth / FALLBACK.aspect;
  return { left: (width - bodyWidth) / 2, top: height * FALLBACK.centerY - bodyHeight / 2, width: bodyWidth, height: bodyHeight };
}

/** 返回包含小手小脚的紧凑框，供HTML触控层使用，不覆盖空白舞台。 */
export function fallbackBounds(width: number, height: number): MascotBounds {
  if (width <= 0 || height <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const body = bodyBounds(width, height);
  let left = body.left; let top = body.top;
  let right = body.left + body.width; let bottom = body.top + body.height;
  for (const part of Object.values(FALLBACK.parts)) {
    const angle = part.angle * Math.PI / 180;
    const rx = part.rx * body.width; const ry = part.ry * body.height;
    const extentX = Math.hypot(rx * Math.cos(angle), ry * Math.sin(angle));
    const extentY = Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle));
    const cx = body.left + part.x * body.width; const cy = body.top + part.y * body.height;
    left = Math.min(left, cx - extentX); right = Math.max(right, cx + extentX);
    top = Math.min(top, cy - extentY); bottom = Math.max(bottom, cy + extentY);
  }
  return { left, top, width: right - left, height: bottom - top };
}

/** 命中仅接受椭圆身体和实际手脚；归一化点来自整个visual-stage而非触控框。 */
export function fallbackHitTest(point: MascotPoint, rect: { width: number; height: number }): MascotHit | null {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const body = bodyBounds(rect.width, rect.height);
  const x = ((point.x + 1) * rect.width / 2 - body.left) / body.width;
  const y = ((point.y + 1) * rect.height / 2 - body.top) / body.height;
  // 小手存在休息角度，先逆向旋转像素坐标再测试椭圆，避免视觉与命中错位。
  const inside = (part: Ellipse) => {
    const angle = (part.angle ?? 0) * Math.PI / 180;
    const dx = (x - part.x) * body.width; const dy = (y - part.y) * body.height;
    return ((dx * Math.cos(angle) + dy * Math.sin(angle)) / (part.rx * body.width)) ** 2 + ((-dx * Math.sin(angle) + dy * Math.cos(angle)) / (part.ry * body.height)) ** 2 <= 1;
  };
  let region: MascotHit['region'];
  if (inside(FALLBACK.parts['hand-left'])) region = 'hand-left';
  else if (inside(FALLBACK.parts['hand-right'])) region = 'hand-right';
  else if (inside({ x: 0.5, y: 0.5, rx: 0.5, ry: 0.5 })) {
    if (y < 0.31) region = 'head';
    else if (y > 0.36 && y < 0.61 && x < 0.37) region = 'cheek-left';
    else if (y > 0.36 && y < 0.61 && x > 0.63) region = 'cheek-right';
    else if (y > 0.58) region = 'belly';
    else region = 'body';
  } else if (inside(FALLBACK.parts['foot-left']) || inside(FALLBACK.parts['foot-right'])) region = 'body';
  else return null;
  const localX = (x - 0.5) * 1.94;
  const localY = (0.5 - y) * 1.92;
  return { region, local: { x: localX, y: localY, z: 0.83 * Math.sqrt(Math.max(0, 1 - localX ** 2 - localY ** 2)) } };
}

/** 手脚坐标由几何设置换算为百分比，CSS不会再维护另一组命中尺寸。 */
function partStyle(part: Ellipse): CSSProperties {
  return { left: `${(part.x - part.rx) * 100}%`, top: `${(part.y - part.ry) * 100}%`, width: `${part.rx * 200}%`, height: `${part.ry * 200}%`, '--fb-rest-angle': `${part.angle ?? 0}deg` } as VariableStyle;
}

interface MascotFallbackProps {
  mood: MoodScore | null;
  expression: MascotExpression;
  gaze: MascotPoint;
  interaction: MascotManipulation | null;
  reaction: MascotGesture | null;
  reduced: boolean;
  activity?: PetActivity | null;
  response?: PetResponse | null;
  onPetTargets?: (targets: PetTargets) => void;
  onPetEvent?: (event: PetEvent) => PetResponse | null;
  petInput?: PetInput | null;
}

/** 道具只由后备渲染层画一份，所有触控与键盘事件由外部透明按钮负责。 */
function PetProp({ activity }: { activity: PetActivity }) {
  if (activity === 'feed') return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M33 14C21 6 10 18 12 35c1 14 12 22 20 18 9 5 20-4 21-18C55 19 45 8 33 14Z" fill="#e3a084" stroke="#b97c66" strokeWidth="1.5" /><path d="M32 17c-1-7 2-11 7-13" fill="none" stroke="#776b49" strokeWidth="3" strokeLinecap="round" /><path d="M35 12c2-8 12-8 15-5-3 7-10 9-15 5Z" fill="#93b394" /><path d="M20 25c-3 4-3 9-1 12" fill="none" stroke="#fff0db" strokeWidth="3" strokeLinecap="round" opacity=".65" /></svg>;
  if (activity === 'tease') return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="33" r="24" fill="#d5c49a" stroke="#ac9d76" strokeWidth="1.5" /><path d="M14 17c11 1 24 10 36 28M22 11c-7 15-7 30 1 44M10 36c12-6 28-7 45-3" fill="none" stroke="#f6edd5" strokeWidth="5" /><path d="M21 18c-3 2-5 6-6 9" fill="none" stroke="#fff9e8" strokeWidth="3" strokeLinecap="round" opacity=".65" /></svg>;
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M43 8C17 6 4 35 21 50c14 13 34 5 38-9C36 48 22 24 43 8Z" fill="#e5d5a5" stroke="#c5b380" strokeWidth="1.5" strokeLinejoin="round" /><path d="m48 12 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#c5b380" /><circle cx="17" cy="13" r="2" fill="#c5b380" /></svg>;
}

type ElementRef<T extends HTMLElement> = RefObject<T | null>;
type CareHand = 'left' | 'right';
interface CareMotion {
  activity: PetActivity; phase: PetPropPhase; flight: PetFlight; scale: number; eligible: boolean;
  stage: 'deliver' | 'hand' | 'mouth' | 'eat' | 'ball' | 'wake' | null;
  elapsed: number; duration: number; clock: number; ignoreUntil: number; responseId: number | null; variant: number; alertUntil: number;
  hand: CareHand; from: PetPoint; grip: { at: number; point: PetPoint; travel: number } | null;
}
interface FallbackCareOptions {
  root: ElementRef<HTMLDivElement>; mouth: ElementRef<HTMLSpanElement>;
  leftHand: ElementRef<HTMLElement>; rightHand: ElementRef<HTMLElement>; prop: ElementRef<HTMLSpanElement>;
  activity: PetActivity | null; response: PetResponse | null; input: PetInput | null;
  width: number; height: number; home: PetPoint; propSize: number; reduced: boolean;
  onTargets?: (targets: PetTargets) => void; onEvent?: (event: PetEvent) => PetResponse | null;
}

/** 后备道具保留连续位置和速度；React只更新少量阶段，逐帧运动直接写CSS变量。 */
function useFallbackCare(options: FallbackCareOptions) {
  const latest = useRef(options); latest.current = options;
  const motion = useRef<CareMotion | null>(null);
  const seenInput = useRef<PetInput | null>(null);
  const controller = useRef<{ input: (input: PetInput) => void; respond: (response: PetResponse) => void } | null>(null);
  const [phase, setPhase] = useState<PetPropPhase>('ready');
  const [hand, setHand] = useState<CareHand>('right');

  useLayoutEffect(() => {
    const root = options.root.current;
    if (!root || !options.width || !options.height) return;
    const { width, height, propSize, activity } = options;
    const home = { x: options.home.x / width * 2 - 1, y: options.home.y / height * 2 - 1 };
    const radius = { x: (propSize + FALLBACK.care.homeInset * 2) / width, y: (propSize + FALLBACK.care.homeInset * 2) / height };
    const previous = motion.current;
    const changedActivity = previous?.activity !== activity;
    if (!activity) motion.current = null;
    else if (changedActivity) motion.current = { activity, phase: 'ready', flight: createPetFlight(home, { x: 0, y: 0 }), scale: 1, eligible: false, stage: null, elapsed: 0, duration: 0, clock: 0, ignoreUntil: 0, responseId: null, variant: 0, alertUntil: 0, hand: 'right', from: home, grip: null };
    if (changedActivity) { seenInput.current = options.input; setPhase('ready'); setHand('right'); }
    let frameId = 0; let lastAt: number | null = null; let visible = true; let lastTargets: PetTargets | null = null;

    // 嘴与左右手由可见DOM提供锚点，揉脸、摸头、接物时都沿真实姿态测量。
    const anchors = () => {
      const rect = root.getBoundingClientRect();
      const point = (element: HTMLElement | null): PetPoint => {
        const box = element?.getBoundingClientRect();
        return box ? { x: (box.left + box.width / 2 - rect.left) / width * 2 - 1, y: (box.top + box.height / 2 - rect.top) / height * 2 - 1 } : { x: 0, y: 0 };
      };
      return { mouth: point(latest.current.mouth.current), left: point(latest.current.leftHand.current), right: point(latest.current.rightHand.current) };
    };
    const pixels = (point: PetPoint): PetPoint => ({ x: (point.x + 1) * width / 2, y: (point.y + 1) * height / 2 });
    const setPosition = (state: CareMotion, point: PetPoint) => { state.flight.x = clamp(point.x, -1 + radius.x, 1 - radius.x); state.flight.y = clamp(point.y, -1 + radius.y, 1 - radius.y); };
    // 同一玩法改尺寸保留原位置、速度与阶段，仅将边缘位置钳回新的可见范围。
    if (motion.current) setPosition(motion.current, motion.current.flight);
    const setMotionPhase = (state: CareMotion, next: PetPropPhase) => { if (state.phase === next) return; state.phase = next; root.dataset.petPhase = next; setPhase(next); };
    const chooseHand = (state: CareMotion, side: CareHand) => { state.hand = side; root.dataset.petHand = side; setHand(side); };
    const throwBack = (state: CareMotion) => {
      const direction = state.hand === 'left' ? -1 : 1;
      state.stage = null; state.scale = 1; state.eligible = false; state.ignoreUntil = state.clock + FALLBACK.care.catchGraceSeconds;
      state.flight = createPetFlight(state.flight, { x: direction * FALLBACK.care.throwBackX, y: FALLBACK.care.throwBackY });
      setMotionPhase(state, 'return');
    };
    const respond = (response: PetResponse) => {
      const state = motion.current; if (!state || response.id === state.responseId) return;
      state.responseId = response.id; state.variant = response.variant; state.alertUntil = 0; state.elapsed = 0; state.duration = response.durationMs / 1000; state.grip = null;
      if (response.kind === 'eat') { state.stage = 'eat'; state.eligible = false; setMotionPhase(state, 'eating'); }
      else if (response.kind === 'play' || response.kind === 'excited' || response.kind === 'tired') { state.stage = 'ball'; state.eligible = false; setMotionPhase(state, 'contact'); }
      else if (response.kind === 'full') throwBack(state);
      else if (response.kind === 'wake') { state.stage = 'wake'; setMotionPhase(state, 'responding'); }
      else { state.stage = null; state.scale = 1; setMotionPhase(state, response.kind === 'asleep' ? 'sleeping' : 'ready'); }
      for (const animation of root.getAnimations?.({ subtree: true }) ?? []) if ('animationName' in animation && typeof animation.animationName === 'string' && animation.animationName.startsWith('mascot-pet-')) animation.currentTime = 0;
    };
    const emit = (state: CareMotion, kind: PetEventKind) => {
      const rejected = () => {
        if (activity === 'sleep') { state.stage = null; state.eligible = false; setPosition(state, home); setMotionPhase(state, latest.current.response?.kind === 'asleep' ? 'sleeping' : 'ready'); }
        else throwBack(state);
      };
      if (!latest.current.onEvent) { rejected(); return; }
      // 同步ACK后才决定吃掉、接住或弹开；一次用户抛掷最多提交一次照料事件。
      state.eligible = false; setMotionPhase(state, 'contact');
      const result = latest.current.onEvent({ kind, at: performance.now() });
      if (result) respond(result); else rejected();
    };
    const catchAlong = (state: CareMotion, from: PetPoint, to: PetPoint) => {
      if (!state.eligible || state.clock < state.ignoreUntil || activity === 'sleep') return false;
      const target = anchors();
      const mouthRadius = { x: (FALLBACK.care.mouthReachPx + propSize * 0.24) * 2 / width, y: (FALLBACK.care.mouthReachPx + propSize * 0.2) * 2 / height };
      const handRadius = { x: (FALLBACK.care.handReachPx + propSize * 0.23) * 2 / width, y: (FALLBACK.care.handReachPx + propSize * 0.32) * 2 / height };
      const mouthHit = activity === 'feed' && sweptPetCatch(from, to, target.mouth, mouthRadius);
      const hands = (['left', 'right'] as const).filter(side => sweptPetCatch(from, to, target[side], handRadius));
      hands.sort((a, b) => Math.hypot((target[a].x - from.x) * width, (target[a].y - from.y) * height) - Math.hypot((target[b].x - from.x) * width, (target[b].y - from.y) * height));
      // 高速一帧跨过手与嘴时先接触更近的部位，不能直接穿过左手算吃到嘴里。
      const firstHand = hands[0];
      const distance = (point: PetPoint) => Math.hypot((point.x - from.x) * width, (point.y - from.y) * height);
      if (mouthHit && (!firstHand || distance(target.mouth) < distance(target[firstHand]))) { setPosition(state, target.mouth); emit(state, 'bite'); return true; }
      const side = hands[0]; if (!side) return false;
      chooseHand(state, side); setPosition(state, target[side]); state.flight.vx = 0; state.flight.vy = 0; state.elapsed = 0;
      if (activity === 'feed') { state.stage = 'hand'; setMotionPhase(state, 'contact'); }
      else emit(state, 'catch');
      return true;
    };

    // 外部只传入意图，重新抓住会直接接管当前飞行位置，不回到预设起点。
    const input = (next: PetInput) => {
      const state = motion.current; if (!state) return;
      if (next.type === 'cancel') {
        state.stage = null; state.grip = null; state.eligible = false; state.scale = 1;
        if (activity === 'sleep') { setPosition(state, home); setMotionPhase(state, latest.current.response?.kind === 'asleep' ? 'sleeping' : 'ready'); }
        else { state.flight = createPetFlight(state.flight, { x: 0, y: 0 }); setMotionPhase(state, 'return'); }
        return;
      }
      if (next.type === 'activate') {
        state.grip = null; state.stage = null; state.eligible = true; state.scale = 1;
        if (activity === 'sleep') { emit(state, 'soothe'); return; }
        const target = anchors();
        const side = Math.hypot(target.left.x - state.flight.x, target.left.y - state.flight.y) < Math.hypot(target.right.x - state.flight.x, target.right.y - state.flight.y) ? 'left' : 'right';
        chooseHand(state, side); state.stage = 'deliver'; state.elapsed = 0; state.scale = 1; state.eligible = true; state.ignoreUntil = state.clock;
        // 一键递送跟随当前手掌，避免上一次手部动画让预先计算的抛物线投空；自由甩动仍走真实物理。
        state.from = { x: state.flight.x, y: state.flight.y }; state.flight = createPetFlight(state.flight, { x: 0, y: 0 });
        setMotionPhase(state, 'flight'); return;
      }
      if (next.type === 'start') { state.stage = null; state.eligible = true; state.scale = 1; state.grip = { at: performance.now(), point: next.point ?? state.flight, travel: 0 }; state.flight.vx = 0; state.flight.vy = 0; setMotionPhase(state, 'held'); }
      const previousPoint = { x: state.flight.x, y: state.flight.y };
      if (next.point) {
        if (state.grip) { state.grip.travel += Math.hypot(next.point.x - state.grip.point.x, next.point.y - state.grip.point.y); state.grip.point = next.point; }
        if (activity === 'sleep') {
          const dx = next.point.x - home.x; const dy = next.point.y - home.y; const ratio = Math.min(1, FALLBACK.care.moonTravel / Math.max(0.001, Math.hypot(dx, dy)));
          setPosition(state, { x: home.x + dx * ratio, y: home.y + dy * ratio });
        } else setPosition(state, next.point);
      }
      if (next.type === 'release') {
        if (activity === 'sleep') {
          const durationMs = state.grip ? performance.now() - state.grip.at : 0;
          const tailSpeed = Math.hypot(next.velocity?.x ?? 0, next.velocity?.y ?? 0);
          const gentle = state.grip && durationMs >= FALLBACK.care.sleepMinimumMs && state.grip.travel >= FALLBACK.care.sleepTravel && state.grip.travel / Math.max(0.001, durationMs / 1000) <= FALLBACK.care.sleepMaximumSpeed && tailSpeed <= FALLBACK.care.sleepMaximumSpeed;
          state.grip = null; setPosition(state, home);
          if (gentle) emit(state, 'soothe');
          else { state.alertUntil = state.clock + FALLBACK.care.moonAlertSeconds; setMotionPhase(state, latest.current.response?.kind === 'asleep' ? 'sleeping' : 'ready'); }
        } else {
          state.grip = null; state.ignoreUntil = state.clock; state.flight = createPetFlight(state.flight, next.velocity ?? { x: 0, y: 0 }); setMotionPhase(state, 'flight');
          catchAlong(state, previousPoint, state.flight);
        }
      }
    };
    controller.current = { input, respond };

    const advance = (state: CareMotion, delta: number) => {
      state.clock += delta; state.elapsed += delta;
      const target = anchors();
      if (state.stage === 'deliver') {
        const amount = Math.min(1, state.elapsed / FALLBACK.care.keyboardFlightSeconds); const smooth = amount * amount * (3 - 2 * amount);
        const previousPoint = { x: state.flight.x, y: state.flight.y }; const hand = target[state.hand];
        setPosition(state, { x: state.from.x + (hand.x - state.from.x) * smooth, y: state.from.y + (hand.y - state.from.y) * smooth - Math.sin(amount * Math.PI) * FALLBACK.care.keyboardArc });
        // 先留出抬起递送的可见过程，再允许接稳，不在原位第一帧直接判成功。
        if (amount >= FALLBACK.care.keyboardCatchStart) catchAlong(state, previousPoint, state.flight);
      } else if (state.stage === 'hand') {
        setPosition(state, target[state.hand]);
        if (state.elapsed >= FALLBACK.care.handHoldSeconds) { state.stage = 'mouth'; state.elapsed = 0; state.from = { x: state.flight.x, y: state.flight.y }; }
      } else if (state.stage === 'mouth') {
        const amount = Math.min(1, state.elapsed / FALLBACK.care.handToMouthSeconds); const smooth = amount * amount * (3 - 2 * amount);
        setPosition(state, { x: state.from.x + (target.mouth.x - state.from.x) * smooth, y: state.from.y + (target.mouth.y - state.from.y) * smooth - Math.sin(amount * Math.PI) * 0.08 });
        if (amount === 1) emit(state, 'bite');
      } else if (state.stage === 'eat') {
        const amount = state.elapsed / Math.max(0.001, state.duration);
        // 与Three共用三口拍点，咬完最后一口才在原处补充下一份食物。
        const meal = samplePetMeal(amount, state.variant);
        if (amount < FALLBACK.care.mealRegrowStart) { setPosition(state, target.mouth); state.scale = meal.size; }
        else { setPosition(state, home); state.scale = clamp((amount - FALLBACK.care.mealRegrowStart) / (1 - FALLBACK.care.mealRegrowStart), 0, 1); }
        if (amount >= 1) { state.stage = null; state.scale = 1; setPosition(state, home); setMotionPhase(state, 'ready'); }
      } else if (state.stage === 'ball') {
        setPosition(state, target[state.hand]);
        if (state.elapsed >= FALLBACK.care.handHoldSeconds) throwBack(state);
      } else if (state.stage === 'wake') {
        if (state.elapsed >= state.duration) { state.stage = null; setMotionPhase(state, 'ready'); }
      } else if (state.phase === 'flight' || state.phase === 'return') {
        const previousPoint = { x: state.flight.x, y: state.flight.y };
        state.flight = advancePetFlight(state.flight, delta, radius);
        if (!catchAlong(state, previousPoint, state.flight) && isPetFlightResting(state.flight, radius)) setMotionPhase(state, 'ready');
      }
    };
    const paint = () => {
      const state = motion.current; if (!state) return;
      const point = pixels(state.flight);
      root.dataset.petDelivery = state.stage ?? 'none';
      root.dataset.petAlert = state.clock < state.alertUntil ? 'true' : 'false';
      if (state.phase === 'flight' || state.phase === 'return' || state.phase === 'held') {
        const target = anchors();
        const side = Math.hypot((target.left.x - state.flight.x) * width, (target.left.y - state.flight.y) * height) < Math.hypot((target.right.x - state.flight.x) * width, (target.right.y - state.flight.y) * height) ? 'left' : 'right';
        if (side !== state.hand) chooseHand(state, side);
      }
      root.style.setProperty('--pet-x', `${point.x}px`); root.style.setProperty('--pet-y', `${point.y}px`);
      root.style.setProperty('--pet-scale', String(state.scale)); root.style.setProperty('--pet-spin', `${state.flight.spin}rad`);
      if (activity !== 'sleep' && !latest.current.reduced) {
        const body = root.querySelector('.mascot-static-body')?.getBoundingClientRect(); const board = root.getBoundingClientRect();
        if (body) { root.style.setProperty('--fb-gaze-x', String(clamp((point.x - (body.left - board.left + body.width / 2)) / Math.max(1, body.width * 0.55), -1, 1))); root.style.setProperty('--fb-gaze-y', String(clamp((point.y - (body.top - board.top + body.height * 0.42)) / Math.max(1, body.height * 0.6), -1, 1))); }
      }
    };
    const measure = () => {
      const target = anchors(); const state = motion.current; const element = latest.current.prop.current;
      const box = element?.getBoundingClientRect(); const board = root.getBoundingClientRect();
      const next: PetTargets = { phase: state?.phase ?? 'ready', mouth: pixels(target.mouth), hand: pixels(target.right), leftHand: pixels(target.left), rightHand: pixels(target.right), prop: state && state.scale > 0.06 && box ? { x: box.left + box.width / 2 - board.left, y: box.top + box.height / 2 - board.top, radius: propSize * state.scale / 2 } : null };
      const moved = (a: PetPoint, b: PetPoint) => Math.hypot(a.x - b.x, a.y - b.y) > FALLBACK.care.targetTolerance;
      if (!lastTargets || next.phase !== lastTargets.phase || Boolean(next.prop) !== Boolean(lastTargets.prop) || moved(next.mouth, lastTargets.mouth) || moved(next.leftHand!, lastTargets.leftHand!) || moved(next.rightHand!, lastTargets.rightHand!) || next.prop && lastTargets.prop && (moved(next.prop, lastTargets.prop) || Math.abs(next.prop.radius - lastTargets.prop.radius) > FALLBACK.care.targetTolerance)) { lastTargets = next; latest.current.onTargets?.(next); }
    };
    const tick = (at: number) => {
      frameId = 0; if (document.hidden || !visible) { lastAt = null; return; }
      // 表演阶段按实际可见时间推进；物理内部自行小步积分，低帧率不能拖长吃饭锁定。
      const delta = lastAt === null ? 0 : Math.max(0, (at - lastAt) / 1000); lastAt = at;
      if (motion.current) advance(motion.current, delta);
      paint(); measure(); if (activity) frameId = requestAnimationFrame(tick);
    };
    const resume = () => { if (frameId) cancelAnimationFrame(frameId); frameId = 0; lastAt = null; root.dataset.petPaused = document.hidden || !visible ? 'true' : 'false'; if (!document.hidden && visible) frameId = requestAnimationFrame(tick); };
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); }); intersection.observe(root);
    document.addEventListener('visibilitychange', resume); paint(); measure(); resume();
    if (options.response) respond(options.response);
    return () => { if (frameId) cancelAnimationFrame(frameId); intersection.disconnect(); document.removeEventListener('visibilitychange', resume); controller.current = null; };
  }, [options.activity, options.width, options.height]);
  useLayoutEffect(() => { if (options.response) controller.current?.respond(options.response); }, [options.response?.id]);
  useLayoutEffect(() => { if (!options.input || seenInput.current === options.input) return; seenInput.current = options.input; controller.current?.input(options.input); }, [options.input]);
  return { phase, hand };
}

/** CSS后备只消费同一套交互意图，不增加日志、不保存数据、不自行安装手势监听。 */
export default function MascotFallback({ mood, expression, gaze, interaction, reaction, reduced, activity = null, response = null, onPetTargets, onPetEvent, petInput = null }: MascotFallbackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mouthRef = useRef<HTMLSpanElement>(null);
  const leftHandRef = useRef<HTMLElement>(null);
  const handRef = useRef<HTMLElement>(null);
  const propRef = useRef<HTMLSpanElement>(null);
  const gripRef = useRef<MascotHit['local'] | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // 松手仍保留最后抓点作为回弹轴，避免旋转中心突然跳回肚子造成位置顿挫。
  useEffect(() => { if (interaction?.kind === 'drag') gripRef.current = interaction.hit.local; }, [interaction]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root); update();
    return () => observer.disconnect();
  }, []);

  const frame = bodyBounds(size.width, size.height);
  const propSize = clamp(frame.width * FALLBACK.care.propSizeShare, FALLBACK.care.propMinSize, FALLBACK.care.propMaxSize);
  const carePosition = FALLBACK.care[activity ?? 'feed'];
  const home = {
    x: clamp(frame.left + frame.width * carePosition.x, propSize / 2 + FALLBACK.care.homeInset, Math.max(propSize / 2 + FALLBACK.care.homeInset, size.width - propSize / 2 - FALLBACK.care.homeInset)),
    y: clamp(frame.top + frame.height * carePosition.y, propSize / 2 + FALLBACK.care.homeInset, Math.max(propSize / 2 + FALLBACK.care.homeInset, size.height - propSize / 2 - FALLBACK.care.homeInset)),
  };
  const petKind = activity ? response?.kind ?? 'idle' : 'idle';
  const care = useFallbackCare({ root: rootRef, mouth: mouthRef, leftHand: leftHandRef, rightHand: handRef, prop: propRef,
    activity, response, input: petInput, width: size.width, height: size.height, home, propSize, reduced,
    onTargets: onPetTargets, onEvent: onPetEvent });

  const kind = interaction?.kind ?? null;
  const strength = clamp(interaction?.strength ?? 0, 0, 1);
  const isPinch = kind === 'pinch';
  const isDrag = kind === 'drag';
  const isPat = kind === 'pat';
  const grip = isDrag ? interaction?.hit.local : gripRef.current;
  const side = interaction?.hit.region === 'cheek-left' ? 'left' : interaction?.hit.region === 'cheek-right' ? 'right' : null;
  const pullX = clamp((interaction?.dx ?? 0) * size.width / 2, -frame.width * FALLBACK.cheekTravel, frame.width * FALLBACK.cheekTravel);
  const pullY = clamp((interaction?.dy ?? 0) * size.height / 2, -frame.height * FALLBACK.cheekTravel, frame.height * FALLBACK.cheekTravel);
  // 双指与单侧揉捏共用局部皮肤；双指只拉两颊，不把整个身体等比放大。
  const twoCheekScale = interaction?.pinchScale;
  const isTwoCheeks = isPinch && twoCheekScale !== undefined;
  const pinchSpread = isTwoCheeks ? clamp(((twoCheekScale ?? 1) - 1) * frame.width * 0.4, -frame.width * 0.1, frame.width * FALLBACK.cheekTravel) : 0;
  const leftX = isPinch ? isTwoCheeks ? -pinchSpread : side === 'left' ? pullX : 0 : 0;
  const rightX = isPinch ? isTwoCheeks ? pinchSpread : side === 'right' ? pullX : 0 : 0;
  const leftY = isPinch && !isTwoCheeks && side === 'left' ? pullY : 0;
  const rightY = isPinch && !isTwoCheeks && side === 'right' ? pullY : 0;
  const cheekScale = (outward: number, selected: boolean) => selected ? 1 + clamp(outward / Math.max(1, frame.width) * FALLBACK.cheekStretch + strength * 0.12, -0.12, 0.58) : 1;
  // 跟手位移在真实舞台边缘内钳制，脚仍留在工具条上方；旋转围绕实际抓点。
  const bounds = fallbackBounds(size.width, size.height);
  const dragX = isDrag ? clamp((interaction?.dx ?? 0) * size.width / 2, Math.min(0, FALLBACK.stageInset - bounds.left), Math.max(0, size.width - bounds.left - bounds.width - FALLBACK.stageInset)) : 0;
  const dragY = isDrag ? clamp((interaction?.dy ?? 0) * size.height / 2, Math.min(0, FALLBACK.stageInset - bounds.top) * 0.75, Math.max(0, size.height - bounds.top - bounds.height - FALLBACK.stageInset) * 0.75) : 0;
  const faceX = (leftX + rightX) * FALLBACK.facePull;
  const faceY = (leftY + rightY) * FALLBACK.facePull;
  const faceTilt = isPinch && !isTwoCheeks ? clamp((side === 'left' ? -1 : 1) * pullY / Math.max(1, frame.height) * 58 + pullX / Math.max(1, frame.width) * 16, -FALLBACK.faceTilt, FALLBACK.faceTilt) : 0;
  const style: VariableStyle = {
    '--sculpture-color': mood === null ? MASCOT_SETTINGS.neutralColor : MASCOT_SETTINGS.moodColors[mood],
    '--fb-gaze-x': reduced ? 0 : clamp(gaze.x, -1, 1),
    '--fb-gaze-y': reduced ? 0 : clamp(gaze.y, -1, 1),
    '--fb-gaze-travel': `${FALLBACK.gazeTravel}px`,
    '--fb-drag-x': `${dragX}px`,
    '--fb-drag-y': `${dragY}px`,
    '--fb-drag-tilt': `${isDrag ? clamp(dragX * FALLBACK.dragTiltPerPixel, -FALLBACK.dragTilt, FALLBACK.dragTilt) : 0}deg`,
    '--fb-grip-x': `${clamp(50 + (grip?.x ?? 0) / 1.94 * 100, 15, 85)}%`,
    '--fb-grip-y': `${clamp(50 - (grip?.y ?? 0) / 1.92 * 100, 12, 88)}%`,
    '--fb-body-x': kind === 'poke' ? 1 + strength * 0.045 : isDrag ? 1 - strength * FALLBACK.dragStretch * 0.55 : isPat ? 1 + strength * 0.025 : 1,
    '--fb-body-y': kind === 'poke' ? 1 - strength * 0.055 : isDrag ? 1 + strength * FALLBACK.dragStretch : isPat ? 1 - strength * 0.03 : 1,
    '--fb-shadow-scale': isDrag ? 1 - strength * 0.2 : 1,
    '--fb-shadow-opacity': isDrag ? 0.58 : 1,
    '--fb-head-y': `${isPat ? strength * 5 : 0}%`,
    '--fb-head-scale': isPat ? 1 - strength * 0.14 : 1,
    '--fb-face-x': `${faceX}px`,
    '--fb-face-y': isPat ? `${-strength * FALLBACK.patFaceLift}%` : `${faceY}px`,
    '--fb-face-tilt': `${faceTilt}deg`,
    '--fb-cheek-left-x': `${leftX * 0.7}px`,
    '--fb-cheek-left-y': `${leftY * 0.85}px`,
    '--fb-cheek-right-x': `${rightX * 0.7}px`,
    '--fb-cheek-right-y': `${rightY * 0.85}px`,
    '--fb-cheek-left-scale': cheekScale(-leftX, isPinch && (isTwoCheeks || side === 'left')),
    '--fb-cheek-right-scale': cheekScale(rightX, isPinch && (isTwoCheeks || side === 'right')),
    '--fb-cheek-left-slim': isPinch && (isTwoCheeks || side === 'left') ? 1 - strength * 0.09 : 1,
    '--fb-cheek-right-slim': isPinch && (isTwoCheeks || side === 'right') ? 1 - strength * 0.09 : 1,
    '--fb-eye-left-x': `${leftX * 0.17}px`,
    '--fb-eye-left-y': `${leftY * 0.2}px`,
    '--fb-eye-right-x': `${rightX * 0.17}px`,
    '--fb-eye-right-y': `${rightY * 0.2}px`,
    '--fb-touch-x': `${clamp(50 + (interaction?.hit.local.x ?? 0) * 42, 15, 85)}%`,
    '--fb-touch-y': `${clamp(50 - (interaction?.hit.local.y ?? 0) * 45, 15, 85)}%`,
    '--pet-prop-size': `${propSize}px`,
    '--pet-home-x': `${home.x}px`, '--pet-home-y': `${home.y}px`,
    '--pet-x': `${home.x}px`, '--pet-y': `${home.y}px`, '--pet-scale': 1, '--pet-spin': '0rad',
    '--pet-response-time': `${clamp(response?.durationMs ?? 1200, FALLBACK.care.responseMinMs, FALLBACK.care.responseMaxMs)}ms`,
  };
  // 首帧使用CSS容器尺寸；观察器准备好后与命中函数共享精确像素位置。
  if (size.width > 0 && size.height > 0) {
    style['--fb-left'] = `${frame.left}px`; style['--fb-top'] = `${frame.top}px`;
    style['--fb-width'] = `${frame.width}px`; style['--fb-height'] = `${frame.height}px`;
  }

  return <div ref={rootRef} className={`mascot-fallback mascot-face-${expression} ${reduced ? 'is-reduced' : ''}`} data-gesture={kind ?? 'idle'} data-reaction={reaction ?? 'idle'} data-region={interaction?.hit.region ?? 'body'} data-pet-activity={activity ?? 'none'} data-pet-response={petKind} data-pet-phase={care.phase} data-pet-hand={care.hand} data-pet-variant={response?.variant ?? 0} style={style} aria-hidden="true">
    {/* 地面影子不随身体飞走，轻微缩淡让悬挂更有重量感。 */}
    <div className="mascot-fallback-ground"><span className="mascot-static-shadow" /></div>
    <div className="mascot-fallback-rig"><div className="mascot-fallback-suspension"><div className="mascot-fallback-pose"><div className="mascot-fallback-breath">
      {/* 手脚与主体分层，局部揉捏不会把整个团子连同影子一起拉成气球。 */}
      <span className="mascot-limb mascot-hand-rig left" style={partStyle(FALLBACK.parts['hand-left'])}><i ref={leftHandRef} className="mascot-static-hand left" /></span>
      <span className="mascot-limb mascot-hand-rig right" style={partStyle(FALLBACK.parts['hand-right'])}><i ref={handRef} className="mascot-static-hand right" /></span>
      <div className="mascot-static-body">
        <span className="mascot-static-crown" />
        <span className="mascot-cheek-patch left"><i className="mascot-static-cheek" /></span>
        <span className="mascot-cheek-patch right"><i className="mascot-static-cheek" /></span>
        {/* 五官整体跟随脸颊偏移，眼球、高光和眼皮各自保留微小反馈。 */}
        <div className="mascot-static-face">
          <i className="mascot-static-eye left"><span className="mascot-static-lid"><span className="mascot-static-pupil" /></span></i>
          <i className="mascot-static-eye right"><span className="mascot-static-lid"><span className="mascot-static-pupil" /></span></i>
          <span ref={mouthRef} className="mascot-static-mouth" />
        </div>
        <span className="mascot-static-dent" />
      </div>
      <span className="mascot-limb mascot-foot-rig left" style={partStyle(FALLBACK.parts['foot-left'])}><i className="mascot-static-foot left" /></span>
      <span className="mascot-limb mascot-foot-rig right" style={partStyle(FALLBACK.parts['foot-right'])}><i className="mascot-static-foot right" /></span>
      <span className="mascot-fallback-spark">✧</span>
      <span className="mascot-soft-mark left" /><span className="mascot-soft-mark right" />
    </div></div></div></div>
    {activity && <span key={activity} ref={propRef} className={`mascot-care-prop is-${activity}`}><PetProp activity={activity} /></span>}
    {activity === 'sleep' && petKind === 'asleep' && <span className="mascot-sleep-mark">z<span>z</span></span>}
  </div>;
}
