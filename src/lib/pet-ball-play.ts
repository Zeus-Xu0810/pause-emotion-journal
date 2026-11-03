/** 五套掌心玩法的时序、幅度集中设置；偏移以球半径为单位，结束后始终托在原手。 */
export const PET_BALL_PLAY_SETTINGS = {
  gatherEnd: 0.16, settleStart: 0.84,
  patterns: ['spin', 'tap', 'pass', 'squeeze', 'balance'],
  spin: { start: 0.18, end: 0.8, fade: 0.1, turns: 2, orbitRadius: 0.32, orbitDepth: 0.08 },
  tap: { beats: [{ start: 0.2, peak: 0.34, end: 0.49 }, { start: 0.52, peak: 0.65, end: 0.81 }], lift: 0.52, squash: 0.1 },
  pass: { out: { start: 0.22, end: 0.46 }, back: { start: 0.55, end: 0.8 }, lift: 0.6, front: 0.85 },
  squeeze: { start: 0.2, end: 0.81, pulses: 2, amount: 0.1 },
  balance: { start: 0.2, end: 0.8, turns: 1.5, swing: 0.55, lift: 0.12 },
  pose: { receivingReach: 0.4 },
} as const;
export type PetBallPattern = typeof PET_BALL_PLAY_SETTINGS.patterns[number];
export type PetBallHand = 'left' | 'right';
export type PetBallPlayPhase = 'gather' | 'perform' | 'settle' | 'done';
export interface PetBallPlaySample {
  pattern: PetBallPattern; phase: PetBallPlayPhase; activeHand: PetBallHand;
  /** 权重始终合计为1，floor恒为0；掌心轻拍不再把球拍落到地面。 */
  ball: { left: number; right: number; floor: number; lift: number; orbitX: number; orbitY: number; orbitZ: number; spin: number; scaleX: number; scaleY: number; scaleZ: number };
  pose: { left: number; right: number; spin: number; dribble: number; pass: number; squeeze: number; balance: number };
}
const clamp01 = (value: number) => Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
const smooth01 = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const smooth = (p: number, start: number, end: number) => smooth01((p - start) / (end - start));
const beat = (p: number, start: number, peak: number, end: number) => p <= peak ? smooth(p, start, peak) : 1 - smooth(p, peak, end);

/** 纯函数只编排手与球，不读时钟或发事件；同一轮收势后的位置和姿态保持连续。 */
export function samplePetBallPlay(progress: number, variant: number, caughtHand: PetBallHand = 'right'): PetBallPlaySample {
  const p = clamp01(progress); const settings = PET_BALL_PLAY_SETTINGS;
  const index = Number.isFinite(variant) ? Math.abs(Math.floor(variant)) % settings.patterns.length : 0;
  const pattern = settings.patterns[index]; const primary = caughtHand === 'left' ? 'left' : 'right';
  const other = primary === 'left' ? 'right' : 'left'; const direction = primary === 'left' ? -1 : 1;
  const phase = p >= 1 ? 'done' : p >= settings.settleStart ? 'settle' : p < settings.gatherEnd ? 'gather' : 'perform';
  let transfer = 0; let lift = 0; let orbitX = 0; let orbitY = 0; let orbitZ = 0; let spin = 0; let squash = 0;
  let spinPose = 0; let tapPose = 0; let passPose = 0; let squeezePose = 0; let balancePose = 0;
  if (pattern === 'spin') {
    const s = settings.spin; const t = smooth(p, s.start, s.end);
    const envelope = smooth(p, s.start, s.start + s.fade) * (1 - smooth(p, s.end - s.fade, s.end));
    const angle = t * Math.PI * 2;
    orbitX = Math.sin(angle) * s.orbitRadius * envelope * direction;
    orbitY = (1 - Math.cos(angle)) * s.orbitRadius / 2 * envelope; orbitZ = Math.sin(angle * 2) * s.orbitDepth * envelope;
    spin = t * Math.PI * 2 * s.turns * direction; spinPose = envelope;
  } else if (pattern === 'tap') {
    for (const stroke of settings.tap.beats) {
      const pulse = beat(p, stroke.start, stroke.peak, stroke.end);
      lift += pulse * settings.tap.lift; tapPose = Math.max(tapPose, pulse);
      squash = Math.max(squash, beat(p, stroke.start, stroke.start + 0.025, stroke.start + 0.075));
    }
    spin = Math.sin(p * Math.PI * 4) * tapPose * 0.35 * direction;
  } else if (pattern === 'pass') {
    const s = settings.pass; let arc = 0;
    if (p >= s.out.start && p <= s.out.end) { transfer = smooth(p, s.out.start, s.out.end); arc = Math.sin(Math.PI * transfer); }
    else if (p > s.out.end && p < s.back.start) transfer = 1;
    else if (p >= s.back.start && p <= s.back.end) { const t = smooth(p, s.back.start, s.back.end); transfer = 1 - t; arc = Math.sin(Math.PI * t); }
    lift = arc * s.lift; orbitZ = arc * s.front; passPose = arc; spin = transfer * Math.PI * direction;
  } else if (pattern === 'squeeze') {
    const s = settings.squeeze; const t = smooth(p, s.start, s.end);
    const envelope = Math.sin(Math.PI * t) ** 2;
    squeezePose = envelope;
    squash = Math.sin(t * Math.PI * s.pulses) ** 2 * envelope;
    orbitZ = envelope * settings.pass.front;
  } else {
    const s = settings.balance; const t = smooth(p, s.start, s.end); const envelope = Math.sin(Math.PI * t) ** 2;
    balancePose = envelope; orbitX = Math.sin(t * Math.PI * 2 * s.turns) * s.swing * envelope * direction;
    orbitY = Math.sin(t * Math.PI * 4) * s.lift * envelope; spin = orbitX * 1.5;
  }
  // 最后一拍平稳回到最初接球手；没有释放阈值、归还飞行或额外接球事件。
  const left = primary === 'left' ? 1 - transfer : transfer; const right = 1 - left;
  const anticipate = passPose * settings.pose.receivingReach;
  const squashAmount = pattern === 'squeeze' ? settings.squeeze.amount : settings.tap.squash;
  return { pattern, phase, activeHand: transfer > 0.5 ? other : primary,
    ball: { left, right, floor: 0, lift, orbitX, orbitY, orbitZ, spin,
      scaleX: 1 + squash * squashAmount, scaleY: 1 - squash * squashAmount, scaleZ: 1 + squash * squashAmount * 0.5 },
    pose: { left: clamp01(left + anticipate), right: clamp01(right + anticipate), spin: spinPose, dribble: tapPose, pass: passPose, squeeze: squeezePose, balance: balancePose } };
}
