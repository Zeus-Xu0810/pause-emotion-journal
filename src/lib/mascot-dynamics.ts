/** 团子的受力与回弹参数集中调整；按住跟手，松开后用较低阻尼留下余韵。 */
export const MASCOT_DYNAMICS = {
  heldStiffness: 280, heldDamping: 27,
  releaseStiffness: 95, releaseDamping: 9.5,
  pressureStiffness: 210, pressureDamping: 21,
  maximumStep: 1 / 120, maximumDelta: 0.05,
  dragLimitX: 0.82, dragLimitUp: 0.56, dragLimitDown: 0.14,
  cheekLimitX: 0.56, cheekLimitY: 0.34,
  restEpsilon: 0.0004,
  blinkMinimumSeconds: 2.3, blinkRangeSeconds: 3.8, blinkSeconds: 0.19,
  idleMinimumSeconds: 4.5, idleRangeSeconds: 4.5,
  sleepAfterSeconds: 20,
};
export interface SpringAxis { value: number; velocity: number }

/** 小步积分避免低帧率把软弹簧算炸；既有速度被保留，连续抓放不会跳回休息姿势。 */
export function advanceMascotSpring(axis: SpringAxis, target: number, delta: number, stiffness: number, damping: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  const duration = Math.min(delta, MASCOT_DYNAMICS.maximumDelta);
  const steps = Math.max(1, Math.ceil(duration / MASCOT_DYNAMICS.maximumStep));
  const step = duration / steps;
  for (let index = 0; index < steps; index += 1) {
    axis.velocity += ((target - axis.value) * stiffness - axis.velocity * damping) * step;
    axis.value += axis.velocity * step;
  }
  if (target === 0 && Math.abs(axis.value) + Math.abs(axis.velocity) < MASCOT_DYNAMICS.restEpsilon) { axis.value = 0; axis.velocity = 0; }
}

/** 边缘是逐渐变紧的软阻力，不在到达上限的一瞬间卡成一堵墙。 */
export function mascotSoftLimit(value: number, limit: number): number {
  return limit * Math.tanh(value / limit);
}
