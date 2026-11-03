import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MASCOT_SETTINGS, type MascotExpression } from '../mascot-content';
import type { MoodScore } from '../types';
import type { MascotBounds, MascotGesture, MascotHit, MascotManipulation, MascotPoint } from '../lib/mascot-interaction-types';

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
}

/** CSS后备只消费同一套交互意图，不增加日志、不保存数据、不自行安装手势监听。 */
export default function MascotFallback({ mood, expression, gaze, interaction, reaction, reduced }: MascotFallbackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<MascotHit['local'] | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // 松手仍保留最后抓点作为回弹轴，避免旋转中心突然跳回肚子造成位置顿挫。
  useEffect(() => { if (interaction?.kind === 'drag') gripRef.current = interaction.hit.local; }, [interaction]);
  useEffect(() => {
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
  };
  // 首帧使用CSS容器尺寸；观察器准备好后与命中函数共享精确像素位置。
  if (size.width > 0 && size.height > 0) {
    style['--fb-left'] = `${frame.left}px`; style['--fb-top'] = `${frame.top}px`;
    style['--fb-width'] = `${frame.width}px`; style['--fb-height'] = `${frame.height}px`;
  }

  return <div ref={rootRef} className={`mascot-fallback mascot-face-${expression} ${reduced ? 'is-reduced' : ''}`} data-gesture={kind ?? 'idle'} data-reaction={reaction ?? 'idle'} data-region={interaction?.hit.region ?? 'body'} style={style} aria-hidden="true">
    {/* 地面影子不随身体飞走，轻微缩淡让悬挂更有重量感。 */}
    <div className="mascot-fallback-ground"><span className="mascot-static-shadow" /></div>
    <div className="mascot-fallback-rig"><div className="mascot-fallback-suspension"><div className="mascot-fallback-pose"><div className="mascot-fallback-breath">
      {/* 手脚与主体分层，局部揉捏不会把整个团子连同影子一起拉成气球。 */}
      <span className="mascot-limb mascot-hand-rig left" style={partStyle(FALLBACK.parts['hand-left'])}><i className="mascot-static-hand left" /></span>
      <span className="mascot-limb mascot-hand-rig right" style={partStyle(FALLBACK.parts['hand-right'])}><i className="mascot-static-hand right" /></span>
      <div className="mascot-static-body">
        <span className="mascot-static-crown" />
        <span className="mascot-cheek-patch left"><i className="mascot-static-cheek" /></span>
        <span className="mascot-cheek-patch right"><i className="mascot-static-cheek" /></span>
        {/* 五官整体跟随脸颊偏移，眼球、高光和眼皮各自保留微小反馈。 */}
        <div className="mascot-static-face">
          <i className="mascot-static-eye left"><span className="mascot-static-lid"><span className="mascot-static-pupil" /></span></i>
          <i className="mascot-static-eye right"><span className="mascot-static-lid"><span className="mascot-static-pupil" /></span></i>
          <span className="mascot-static-mouth" />
        </div>
        <span className="mascot-static-dent" />
      </div>
      <span className="mascot-limb mascot-foot-rig left" style={partStyle(FALLBACK.parts['foot-left'])}><i className="mascot-static-foot left" /></span>
      <span className="mascot-limb mascot-foot-rig right" style={partStyle(FALLBACK.parts['foot-right'])}><i className="mascot-static-foot right" /></span>
      <span className="mascot-fallback-spark">✧</span>
      <span className="mascot-soft-mark left" /><span className="mascot-soft-mark right" />
    </div></div></div></div>
  </div>;
}
