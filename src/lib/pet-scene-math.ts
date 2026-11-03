import type { PetPoint } from './pet-care';

/** 道具投影与接触判断使用舞台CSS像素；不依赖设备像素比。 */
export function clampPetPointer(point: PetPoint, width: number, height: number, radius: number, padding: number): PetPoint {
  const marginX = Math.min(0.9, (radius + padding) * 2 / Math.max(1, width));
  const marginY = Math.min(0.9, (radius + padding) * 2 / Math.max(1, height));
  return {
    x: Math.max(-1 + marginX, Math.min(1 - marginX, Number.isFinite(point.x) ? point.x : 0)),
    y: Math.max(-1 + marginY, Math.min(1 - marginY, Number.isFinite(point.y) ? point.y : 0)),
  };
}
export function petTargetContains(point: PetPoint, target: PetPoint, radius: number): boolean {
  return [point.x, point.y, target.x, target.y, radius].every(Number.isFinite) && radius >= 0 && Math.hypot(point.x - target.x, point.y - target.y) <= radius;
}

export interface PetWorldPoint { x: number; y: number; z: number }

/** 递食/递球先沿弧线靠近表面前方，再缩小或停在手前，不把完整道具塞进身体。 */
export function petArcPoint(start: PetWorldPoint, end: PetWorldPoint, progress: number, arcHeight: number, output: PetWorldPoint): PetWorldPoint {
  const phase = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const eased = phase * phase * (3 - 2 * phase);
  output.x = start.x + (end.x - start.x) * eased;
  output.y = start.y + (end.y - start.y) * eased + Math.sin(phase * Math.PI) * arcHeight;
  output.z = start.z + (end.z - start.z) * eased;
  return output;
}
