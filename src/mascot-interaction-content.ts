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
  // 鼠标轻压立刻可见，但正式拖拽仍越过独立门槛；触屏预览更轻，不抢滚动。
  mousePressStrength: 0.55,
  touchPressStrength: 0.2,
  headStrokeStartDistance: 10,
  dragMinimumStrength: 0.28,
  scrubMinimumStrength: 0.36,
  holdMinimumStrength: 0.3,
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
  keyboardStrength: 0.35,
  gazeLimit: 1.4,
  tapFlushPaddingMs: 5,
  maxPointerDelta: 0.65,
  reactionResetMs: 1200,
  gestureCooldownMs: 180,
  modeHintMs: 3000,
};

/** 模式提示只描述当前可做的动作，保留自动模式的页面纵向滚动。 */
export const MASCOT_MODE_HINTS: Record<MascotMode, string> = {
  auto: '过来，陪我玩会儿', poke: '轻轻戳一下', pinch: '脸脸软软的',
  drag: '带我挪一小步', pat: '摸摸我的头', tickle: '肚皮有点痒',
};

/** 情境短句独立于原有一百条回复，不给用户的情绪贴标签。 */
export const MASCOT_GESTURE_REPLIES: Record<MascotGesture, readonly string[]> = {
  poke: ['嗯？是你呀', '嘿，碰到我啦', '我在呢'],
  pinch: ['唔，脸脸软吧', '轻点捏嘛', '再捏就变扁啦'],
  drag: ['带我去哪儿呀', '我跟着你', '挪一小步，嘿'],
  pat: ['嗯，好舒服', '还想被摸摸', '再摸一下嘛'],
  tickle: ['嘿嘿，好痒', '肚皮要躲起来啦', '哈哈，轻一点嘛'],
  wave: ['嗨，手给你', '碰个掌吧', '今天也见到你啦'],
  bounce: ['啵，弹回来啦', '嘿，再弹一下', '软软落地'],
  shake: ['晃呀晃', '跟你摇一摇', '像坐小摇椅'],
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
