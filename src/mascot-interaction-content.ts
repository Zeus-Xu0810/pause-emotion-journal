import type { MascotExpression } from './mascot-content';
import type { MascotGesture, MascotHit, MascotMode } from './lib/mascot-interaction-types';

/** 手势可调阈值集中于此；坐标与距离使用CSS像素，时间使用单调毫秒。 */
export const MASCOT_INTERACTION_SETTINGS = {
  tapMaximumMs: 260,
  tapMaximumTravel: 8,
  doubleTapMaximumMs: 300,
  doubleTapMaximumDistance: 22,
  longPressMs: 420,
  // 未被长按认领前，明显的触屏纵向移动优先交还页面滚动。
  touchScrollDistance: 10,
  touchScrollAxisRatio: 1.2,
  dragStartDistance: 9,
  faceDragStartDistance: 8,
  // 换向只有在走过足够距离后才计数，忽略手指微颤和像素噪声。
  reversalMinimumDistance: 14,
  scrubMinimumReversals: 2,
  scrubMaximumMs: 1200,
  shakeMinimumReversals: 2,
  shakeMaximumMs: 650,
  shakeMinimumTravel: 60,
  pinchMinimumSpan: 24,
  pinchMinimumDistance: 6,
  pinchMinimumScaleChange: 0.08,
  pinchMinimumScale: 0.55,
  pinchMaximumScale: 1.6,
  strengthDistance: 80,
  maximumMotionSamples: 96,
  // 供DOM接入层共用的舞台坐标与反馈时长设置。
  keyboardStep: 0.04,
  maxPointerDelta: 0.65,
  reactionResetMs: 1200,
  gestureCooldownMs: 180,
  modeHintMs: 3000,
};

/** 模式提示只描述当前可做的动作，保留自动模式的页面纵向滚动。 */
export const MASCOT_MODE_HINTS: Record<MascotMode, string> = {
  auto: '点点、摸摸，看看回应', poke: '轻轻点一下', pinch: '拉拉脸颊，或用双指捏合',
  drag: '按住身体，挪一小步', pat: '在头顶左右摸摸', tickle: '在肚皮左右挠挠',
};

/** 情境短句独立于原有一百条回复，不给用户的情绪贴标签。 */
export const MASCOT_GESTURE_REPLIES: Record<MascotGesture, readonly string[]> = {
  poke: ['嘿，碰到你啦', '软软的一小下', '我在这里呀'],
  pinch: ['脸颊借你捏一下', '慢慢捏，软乎乎', '圆圆的脸也会伸懒腰'],
  drag: ['跟着你挪一小步', '到这里也挺舒服', '一起换个小位置'],
  pat: ['摸摸头，收到啦', '头顶暖暖的', '再靠近一点点'],
  tickle: ['痒痒，嘿嘿', '肚皮收到轻轻的问候', '笑得更圆了一点'],
  wave: ['你好呀，挥挥手', '今天也碰个面', '手手和你打招呼'],
  bounce: ['弹一下，轻轻落地', '带着笑意蹦一小下', '一颗软软的小弹跳'],
  shake: ['左右晃晃也很自在', '跟着你轻轻摇', '软软地晃一小会儿'],
};
export const MASCOT_GESTURE_EXPRESSIONS: Record<MascotGesture, MascotExpression> = {
  poke: 'curious', pinch: 'shy', drag: 'curious', pat: 'soft', tickle: 'happy', wave: 'wink', bounce: 'happy', shake: 'happy',
};

/** 键盘及静态后备的默认局部命中位置；真实Three光线命中仍由场景计算。 */
const BODY_HIT: MascotHit = { region: 'body', local: { x: 0, y: 0, z: 0.72 } };
export const MASCOT_GESTURE_HITS: Record<MascotGesture, MascotHit> = {
  poke: BODY_HIT, drag: BODY_HIT, bounce: BODY_HIT, shake: BODY_HIT,
  pinch: { region: 'cheek-left', local: { x: -0.36, y: 0.02, z: 0.72 } },
  pat: { region: 'head', local: { x: 0, y: 0.72, z: 0.35 } },
  tickle: { region: 'belly', local: { x: 0, y: -0.25, z: 0.75 } },
  wave: { region: 'hand-right', local: { x: 0.85, y: -0.18, z: 0.12 } },
};
