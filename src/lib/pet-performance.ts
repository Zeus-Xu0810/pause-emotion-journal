/** 表演节奏集中维护：先接住，再分小口吃；眼、嘴、短手使用不同的拍点。 */
export const PET_PERFORMANCE = {
  meal: { carryEnd: 0.2, firstBite: [0.22, 0.32], secondBite: [0.49, 0.59], lastBite: [0.72, 0.81], swallow: [0.82, 0.87, 0.93] },
  moon: { minimumSeconds: 0.22, slowMaximumSpeed: 1.15, fastMaximumSpeed: 2.4 },
  pursuit: { gain: 0.8, bodyHalfWidth: 1.18, minimumTravel: 0.15 },
  pickup: { bend: 0.1, inspectSeconds: 1.4 },
  catchBlendPhase: 0.15,
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = (value: number, start: number, end: number) => { const t = clamp01((value - start) / (end - start)); return t * t * (3 - 2 * t); };

/** 追随只看固定镜框宽度，不能反过来放大被自动取景缩小后的世界范围。 */
export function petPursuitTarget(pointX: number, halfWidth: number): number {
  const extent = Math.max(PET_PERFORMANCE.pursuit.minimumTravel, halfWidth - PET_PERFORMANCE.pursuit.bodyHalfWidth);
  return Math.max(-extent, Math.min(extent, pointX * halfWidth * PET_PERFORMANCE.pursuit.gain));
}
export function petCatchBlend(progress: number): number { return smooth(progress, 0, PET_PERFORMANCE.catchBlendPhase); }

/** 不对称拍点使抬头、咬下、吞咽和满足错开，避免所有部件共用正弦。 */
export function petBeat(progress: number, start: number, peak: number, end: number): number {
  return progress < peak ? smooth(progress, start, peak) : 1 - smooth(progress, peak, end);
}
export function samplePetMeal(progress: number, variant: number) {
  const p = clamp01(progress); const offset = (Math.abs(Math.floor(variant)) % 3) * 0.008;
  const first = smooth(p, 0.22, 0.32); const second = smooth(p, 0.49 + offset, 0.59 + offset); const last = smooth(p, 0.72, 0.81);
  const jaw = petBeat(p, 0.2, 0.245, 0.29) + petBeat(p, 0.33, 0.365, 0.42) * 0.52 + petBeat(p, 0.47 + offset, 0.525 + offset, 0.58 + offset) * 0.9 + petBeat(p, 0.6, 0.635, 0.69) * 0.45 + petBeat(p, 0.7, 0.755, 0.81) * 0.7;
  return {
    carry: smooth(p, 0, PET_PERFORMANCE.meal.carryEnd),
    size: Math.max(0, 1 - first * 0.3 - second * 0.34 - last * 0.36),
    jaw, swallow: petBeat(p, ...PET_PERFORMANCE.meal.swallow as [number, number, number]),
    nod: petBeat(p, 0.29, 0.36, 0.46) * 0.5 + petBeat(p, 0.84, 0.94, 1),
    delight: petBeat(p, 0.78, 0.94, 1),
    hand: 1 - smooth(p, 0.84, 1),
  };
}

/** 安抚从哈欠与靠头过渡到睡姿；醒来先揉眼，随后伸展，均有明确首尾。 */
export function samplePetSleep(progress: number, asleep: boolean, waking: boolean) {
  const p = clamp01(progress);
  if (waking) return { closed: 1 - smooth(p, 0.08, 0.43), hug: 1 - smooth(p, 0.05, 0.42), lean: 1 - smooth(p, 0.08, 0.5), yawn: petBeat(p, 0.3, 0.43, 0.55), rub: petBeat(p, 0.03, 0.18, 0.4), stretch: petBeat(p, 0.42, 0.68, 1), smile: smooth(p, 0.63, 0.9) };
  return { closed: smooth(p, 0.12, 0.9) * (asleep ? 1 : 0.75), hug: smooth(p, 0.18, 0.75), lean: smooth(p, 0.04, 0.68), yawn: petBeat(p, 0.08, 0.27, 0.49), rub: 0, stretch: 0, smile: smooth(p, 0.65, 1) * (asleep ? 1 : 0.45) };
}
