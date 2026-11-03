import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { MASCOT_SETTINGS, type MascotExpression } from '../mascot-content';
import type { MoodScore } from '../types';
import type { MascotBounds, MascotGesture, MascotHit, MascotManipulation, MascotPoint } from '../lib/mascot-interaction-types';
import type { PetActivity, PetInput, PetPoint, PetResponse, PetTargets } from '../lib/pet-care';

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
    resetDelayMs: 240,
    responseMinMs: 700,
    responseMaxMs: 2400,
    targetTolerance: 0.35,
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
  petInput?: PetInput | null;
}

/** 道具只由后备渲染层画一份，所有触控与键盘事件由外部透明按钮负责。 */
function PetProp({ activity }: { activity: PetActivity }) {
  if (activity === 'feed') return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M33 14C21 6 10 18 12 35c1 14 12 22 20 18 9 5 20-4 21-18C55 19 45 8 33 14Z" fill="#e3a084" stroke="#b97c66" strokeWidth="1.5" /><path d="M32 17c-1-7 2-11 7-13" fill="none" stroke="#776b49" strokeWidth="3" strokeLinecap="round" /><path d="M35 12c2-8 12-8 15-5-3 7-10 9-15 5Z" fill="#93b394" /><path d="M20 25c-3 4-3 9-1 12" fill="none" stroke="#fff0db" strokeWidth="3" strokeLinecap="round" opacity=".65" /></svg>;
  if (activity === 'tease') return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="33" r="24" fill="#d5c49a" stroke="#ac9d76" strokeWidth="1.5" /><path d="M14 17c11 1 24 10 36 28M22 11c-7 15-7 30 1 44M10 36c12-6 28-7 45-3" fill="none" stroke="#f6edd5" strokeWidth="5" /><path d="M21 18c-3 2-5 6-6 9" fill="none" stroke="#fff9e8" strokeWidth="3" strokeLinecap="round" opacity=".65" /></svg>;
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M43 8C17 6 4 35 21 50c14 13 34 5 38-9C36 48 22 24 43 8Z" fill="#e5d5a5" stroke="#c5b380" strokeWidth="1.5" strokeLinejoin="round" /><path d="m48 12 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#c5b380" /><circle cx="17" cy="13" r="2" fill="#c5b380" /></svg>;
}

/** CSS后备只消费同一套交互意图，不增加日志、不保存数据、不自行安装手势监听。 */
export default function MascotFallback({ mood, expression, gaze, interaction, reaction, reduced, activity = null, response = null, onPetTargets, petInput = null }: MascotFallbackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mouthRef = useRef<HTMLSpanElement>(null);
  const handRef = useRef<HTMLElement>(null);
  const propRef = useRef<HTMLSpanElement>(null);
  const targetsCallback = useRef(onPetTargets);
  const consumedInput = useRef<PetInput | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gripRef = useRef<MascotHit['local'] | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [propPoint, setPropPoint] = useState<PetPoint | null>(null);
  const [transfer, setTransfer] = useState<{ id: number; from: PetPoint; to: PetPoint } | null>(null);
  useEffect(() => { targetsCallback.current = onPetTargets; }, [onPetTargets]);
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
  const isHeld = petInput?.type === 'start' || petInput?.type === 'move';

  // 切换玩法或舞台尺寸时重置当前道具，退出后不残留上一个玩法的坐标和延迟。
  useLayoutEffect(() => {
    setPropPoint(null); setTransfer(null);
    consumedInput.current = petInput;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  }, [activity, size.width, size.height]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  // 这里只消费外部输入；默认纵向滚动和显式接管都由主输入层决定。
  useLayoutEffect(() => {
    if (!activity || activity === 'sleep' || !petInput || consumedInput.current === petInput) return;
    consumedInput.current = petInput;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
    if (petInput.type === 'cancel') { setPropPoint(null); return; }
    if (petInput.point && petInput.type !== 'activate') {
      setPropPoint({
        x: clamp((petInput.point.x + 1) * size.width / 2, propSize / 2, Math.max(propSize / 2, size.width - propSize / 2)),
        y: clamp((petInput.point.y + 1) * size.height / 2, propSize / 2, Math.max(propSize / 2, size.height - propSize / 2)),
      });
    }
    if (petInput.type === 'release') resetTimer.current = setTimeout(() => { setPropPoint(null); resetTimer.current = null; }, FALLBACK.care.resetDelayMs);
  }, [activity, petInput, size.width, size.height, propSize]);

  // 从可见位置快照到真实嘴/右手位置，动画开始后不追写终点，避免反馈闭环越跑越远。
  useLayoutEffect(() => {
    if (!activity || !response || !rootRef.current) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
    if ((activity === 'feed' && response.kind === 'eat') || (activity === 'tease' && (response.kind === 'play' || response.kind === 'excited'))) {
      const stage = rootRef.current.getBoundingClientRect();
      const prop = propRef.current?.getBoundingClientRect();
      const anchor = (activity === 'feed' ? mouthRef : handRef).current?.getBoundingClientRect();
      if (prop && anchor) setTransfer({ id: response.id, from: { x: prop.left + prop.width / 2 - stage.left - home.x, y: prop.top + prop.height / 2 - stage.top - home.y }, to: { x: anchor.left + anchor.width / 2 - stage.left - home.x, y: anchor.top + anchor.height / 2 - stage.top - home.y } });
    } else setTransfer(null);
    setPropPoint(null);
    // 同一种回应可以连续触发，按新id重启局部动画，不重挂整个角色或改变命中几何。
    for (const animation of rootRef.current.getAnimations?.({ subtree: true }) ?? []) {
      if ('animationName' in animation && typeof animation.animationName === 'string' && animation.animationName.startsWith('mascot-pet-')) animation.currentTime = 0;
    }
  }, [activity, response?.id, size.width, size.height]);

  // 只在活动可见时逐帧回报真实DOM锚点；轻微浮动、吃东西和伸手时按钮不会留在旧坐标。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frameId = 0; let visible = true; let last: PetTargets | null = null;
    const changed = (a: PetPoint, b: PetPoint) => Math.hypot(a.x - b.x, a.y - b.y) > FALLBACK.care.targetTolerance;
    const measure = () => {
      frameId = 0;
      if (document.hidden || !visible) return;
      const stage = root.getBoundingClientRect();
      const center = (element: HTMLElement | null, fallback: PetPoint): PetPoint => {
        if (!element) return fallback;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - stage.left, y: rect.top + rect.height / 2 - stage.top };
      };
      const propRect = propRef.current?.getBoundingClientRect();
      const propVisible = activity && propRect && propRect.width > 2 && propRef.current && Number(getComputedStyle(propRef.current).opacity) > 0.1;
      const next: PetTargets = {
        prop: propVisible ? { ...center(propRef.current, { x: 0, y: 0 }), radius: Math.max(propRect.width, propRect.height) / 2 } : null,
        mouth: center(mouthRef.current, { x: stage.width / 2, y: stage.height / 2 }),
        hand: center(handRef.current, { x: stage.width / 2, y: stage.height / 2 }),
      };
      // 球飞回时也继续追看真实位置，直接写视线变量，避免为了动画每帧重渲染React。
      if (activity === 'tease' && next.prop && !reduced) {
        const body = root.querySelector('.mascot-static-body')?.getBoundingClientRect();
        if (body) {
          root.style.setProperty('--fb-gaze-x', String(clamp((next.prop.x - (body.left - stage.left + body.width / 2)) / Math.max(1, body.width * 0.55), -1, 1)));
          root.style.setProperty('--fb-gaze-y', String(clamp((next.prop.y - (body.top - stage.top + body.height * 0.42)) / Math.max(1, body.height * 0.6), -1, 1)));
        }
      }
      if (!last || changed(next.mouth, last.mouth) || changed(next.hand, last.hand) || Boolean(next.prop) !== Boolean(last.prop) || (next.prop && last.prop && (changed(next.prop, last.prop) || Math.abs(next.prop.radius - last.prop.radius) > FALLBACK.care.targetTolerance))) {
        last = next; targetsCallback.current?.(next);
      }
      if (activity) frameId = requestAnimationFrame(measure);
    };
    const resume = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      root.dataset.petPaused = document.hidden || !visible ? 'true' : 'false';
      if (!document.hidden && visible) frameId = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(resume); observer.observe(root);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); }); intersection.observe(root);
    document.addEventListener('visibilitychange', resume); resume();
    return () => { if (frameId) cancelAnimationFrame(frameId); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', resume); };
  }, [activity, reduced]);

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
  // 逗球时眼睛看向真实道具位置，睡着则闭眼；直接手势仍优先保留自己的脸部形变。
  const careGaze = activity === 'tease' ? { x: ((propPoint?.x ?? home.x) - (frame.left + frame.width / 2)) / Math.max(1, frame.width * 0.55), y: ((propPoint?.y ?? home.y) - (frame.top + frame.height * 0.42)) / Math.max(1, frame.height * 0.6) } : gaze;
  const style: VariableStyle = {
    '--sculpture-color': mood === null ? MASCOT_SETTINGS.neutralColor : MASCOT_SETTINGS.moodColors[mood],
    '--fb-gaze-x': reduced ? 0 : clamp(careGaze.x, -1, 1),
    '--fb-gaze-y': reduced ? 0 : clamp(careGaze.y, -1, 1),
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
    '--pet-offset-x': `${(propPoint?.x ?? home.x) - home.x}px`, '--pet-offset-y': `${(propPoint?.y ?? home.y) - home.y}px`,
    '--pet-from-x': `${transfer?.from.x ?? 0}px`, '--pet-from-y': `${transfer?.from.y ?? 0}px`,
    '--pet-to-x': `${transfer?.to.x ?? 0}px`, '--pet-to-y': `${transfer?.to.y ?? 0}px`,
    '--pet-response-time': `${clamp(response?.durationMs ?? 1200, FALLBACK.care.responseMinMs, FALLBACK.care.responseMaxMs)}ms`,
  };
  // 首帧使用CSS容器尺寸；观察器准备好后与命中函数共享精确像素位置。
  if (size.width > 0 && size.height > 0) {
    style['--fb-left'] = `${frame.left}px`; style['--fb-top'] = `${frame.top}px`;
    style['--fb-width'] = `${frame.width}px`; style['--fb-height'] = `${frame.height}px`;
  }

  return <div ref={rootRef} className={`mascot-fallback mascot-face-${expression} ${reduced ? 'is-reduced' : ''}`} data-gesture={kind ?? 'idle'} data-reaction={reaction ?? 'idle'} data-region={interaction?.hit.region ?? 'body'} data-pet-activity={activity ?? 'none'} data-pet-response={petKind} data-pet-held={isHeld ? 'true' : 'false'} style={style} aria-hidden="true">
    {/* 地面影子不随身体飞走，轻微缩淡让悬挂更有重量感。 */}
    <div className="mascot-fallback-ground"><span className="mascot-static-shadow" /></div>
    <div className="mascot-fallback-rig"><div className="mascot-fallback-suspension"><div className="mascot-fallback-pose"><div className="mascot-fallback-breath">
      {/* 手脚与主体分层，局部揉捏不会把整个团子连同影子一起拉成气球。 */}
      <span className="mascot-limb mascot-hand-rig left" style={partStyle(FALLBACK.parts['hand-left'])}><i className="mascot-static-hand left" /></span>
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
    {activity && <span key={`${activity}-${response?.id ?? 0}`} ref={propRef} className={`mascot-care-prop is-${activity} ${transfer !== null && transfer.id === response?.id ? 'is-transferring' : ''}`}><PetProp activity={activity} /></span>}
    {activity === 'sleep' && petKind === 'asleep' && <span className="mascot-sleep-mark">z<span>z</span></span>}
  </div>;
}
