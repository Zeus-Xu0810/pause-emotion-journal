/** 球的玩法时序、动作幅度集中设置；进度为[0,1]，空间偏移以球半径为单位。 */
export const PET_BALL_PLAY_SETTINGS = {
  gatherEnd: 0.16,
  releaseAt: { spin: 0.9, dribble: 0.91, pass: 0.9 },
  spin: { start: 0.18, end: 0.8, fade: 0.1, turns: 2, orbitTurns: 1, orbitRadius: 0.32, orbitDepth: 0.08 },
  dribble: {
    strokes: [{ start: 0.2, impact: 0.34, end: 0.49 }, { start: 0.52, impact: 0.65, end: 0.81 }],
    impactLead: 0.025, impactTrail: 0.04, squashY: 0.11, squashXZ: 0.06, turns: 1.3,
  },
  pass: { out: { start: 0.22, end: 0.46 }, back: { start: 0.55, end: 0.8 }, lift: 1.2, front: 0.85, turns: 0.5 },
  pose: { receivingReach: 0.4 },
} as const;

export type PetBallPattern = 'spin' | 'dribble' | 'pass';
export type PetBallHand = 'left' | 'right';
export type PetBallPlayPhase = 'gather' | 'perform' | 'release' | 'done';
export interface PetBallPlaySample {
  pattern: PetBallPattern;
  phase: PetBallPlayPhase;
  activeHand: PetBallHand;
  /** 三个权重之和为1；floor应放在接球手正下方、球心高于地面一个半径。 */
  ball: { left: number; right: number; floor: number; lift: number; orbitX: number; orbitY: number; orbitZ: number; spin: number; scaleX: number; scaleY: number; scaleZ: number };
  /** 姿态权重均在[0,1]；dribble可用于轻点头，pass用于两只手交替迎接。 */
  pose: { left: number; right: number; spin: number; dribble: number; pass: number };
  releaseAt: number;
  /** 这是阈值状态，调用方应锁存首次变true的边沿，只抛回一次，不提交额外catch。 */
  released: boolean;
}

const clamp01 = (value: number) => Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
const smooth01 = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const smooth = (p: number, start: number, end: number) => smooth01((p - start) / (end - start));
const beat = (p: number, start: number, peak: number, end: number) => p <= peak ? smooth(p, start, peak) : 1 - smooth(p, peak, end);

/** 只编排球与手的相对位置，不读时钟、不发事件，也不借用食物递嘴/缩小曲线。 */
export function samplePetBallPlay(progress: number, variant: number, caughtHand: PetBallHand = 'right'): PetBallPlaySample {
  const p = clamp01(progress);
  const index = Number.isFinite(variant) ? Math.abs(Math.floor(variant)) % 3 : 0;
  const pattern: PetBallPattern = (['spin', 'dribble', 'pass'] as const)[index];
  const primary: PetBallHand = caughtHand === 'left' ? 'left' : 'right';
  const other: PetBallHand = primary === 'left' ? 'right' : 'left';
  const direction = primary === 'left' ? -1 : 1;
  const releaseAt = PET_BALL_PLAY_SETTINGS.releaseAt[pattern];
  const phase: PetBallPlayPhase = p >= 1 ? 'done' : p >= releaseAt ? 'release' : p < PET_BALL_PLAY_SETTINGS.gatherEnd ? 'gather' : 'perform';
  let transfer = 0; let floor = 0; let lift = 0; let orbitX = 0; let orbitY = 0; let orbitZ = 0; let spin = 0; let squash = 0;
  let spinPose = 0; let dribblePose = 0; let passPose = 0;

  if (pattern === 'spin') {
    const setting = PET_BALL_PLAY_SETTINGS.spin;
    const t = smooth(p, setting.start, setting.end);
    const envelope = smooth(p, setting.start, setting.start + setting.fade) * (1 - smooth(p, setting.end - setting.fade, setting.end));
    const angle = t * Math.PI * 2 * setting.orbitTurns;
    // 偏心不超过0.4个半径，球仍留在指尖附近，自转与小范围绕指各有自己的幅度。
    orbitX = Math.sin(angle) * setting.orbitRadius * envelope * direction;
    orbitY = (1 - Math.cos(angle)) * setting.orbitRadius / 2 * envelope;
    orbitZ = Math.sin(angle * 2) * setting.orbitDepth * envelope;
    spin = t * Math.PI * 2 * setting.turns * direction;
    spinPose = envelope;
  } else if (pattern === 'dribble') {
    const setting = PET_BALL_PLAY_SETTINGS.dribble;
    for (const stroke of setting.strokes) {
      if (p >= stroke.start && p <= stroke.impact) floor = ((p - stroke.start) / (stroke.impact - stroke.start)) ** 2;
      else if (p > stroke.impact && p <= stroke.end) floor = (1 - (p - stroke.impact) / (stroke.end - stroke.impact)) ** 2;
      // 触地允许速度反向，位置保持连续；压扁只发生在实际触地拍点。
      squash = Math.max(squash, beat(p, stroke.impact - setting.impactLead, stroke.impact, stroke.impact + setting.impactTrail));
      dribblePose = Math.max(dribblePose, beat(p, stroke.start, stroke.impact, stroke.end));
    }
    spin = smooth(p, PET_BALL_PLAY_SETTINGS.gatherEnd, releaseAt) * Math.PI * 2 * setting.turns * direction;
  } else {
    const setting = PET_BALL_PLAY_SETTINGS.pass;
    let arc = 0;
    if (p < setting.out.start) transfer = 0;
    else if (p <= setting.out.end) { transfer = smooth(p, setting.out.start, setting.out.end); arc = Math.sin(Math.PI * transfer); }
    else if (p < setting.back.start) transfer = 1;
    else if (p <= setting.back.end) { const t = smooth(p, setting.back.start, setting.back.end); transfer = 1 - t; arc = Math.sin(Math.PI * t); }
    // 传球只画两手之间的小弧线，front沿相机正面偏出，避免穿过圆肚子。
    lift = arc * setting.lift; orbitZ = arc * setting.front; passPose = arc;
    spin = transfer * Math.PI * 2 * setting.turns * direction;
  }

  const primaryWeight = (1 - floor) * (1 - transfer);
  const otherWeight = (1 - floor) * transfer;
  const left = primary === 'left' ? primaryWeight : otherWeight;
  const right = primary === 'right' ? primaryWeight : otherWeight;
  const relax = 1 - smooth(p, releaseAt, 1);
  const anticipate = passPose * PET_BALL_PLAY_SETTINGS.pose.receivingReach;
  return {
    pattern, phase, activeHand: transfer > 0.5 ? other : primary,
    ball: { left, right, floor, lift, orbitX, orbitY, orbitZ, spin,
      scaleX: 1 + squash * PET_BALL_PLAY_SETTINGS.dribble.squashXZ,
      scaleY: 1 - squash * PET_BALL_PLAY_SETTINGS.dribble.squashY,
      scaleZ: 1 + squash * PET_BALL_PLAY_SETTINGS.dribble.squashXZ },
    pose: { left: clamp01(left + (primary === 'left' ? floor : 0) + anticipate) * relax,
      right: clamp01(right + (primary === 'right' ? floor : 0) + anticipate) * relax,
      spin: spinPose, dribble: dribblePose, pass: passPose },
    releaseAt, released: p >= releaseAt,
  };
}
