import type { MascotGesture } from './mascot-interaction-types';

/** 形变参数集中维护，局部位移幅度与半径配合，避免曲面翻转。 */
export const DEFORMATION_SETTINGS = { localRadius: 0.42, pokeDepth: 0.13, pinchBulge: 0.065, headDepression: 0.055 };
export interface SurfacePoint { x: number; y: number; z: number }
export interface MascotDeformation {
  kind: MascotGesture;
  anchor: SurfacePoint;
  pull: SurfacePoint;
  pressure: number;
  pinch: number;
  impulse: number;
  time: number;
}

/** 身体顶点、嘴部顶点及五官锚点共用此纯映射；输出参数复用，逐帧不创建对象。 */
export function deformMascotPoint(point: SurfacePoint, field: MascotDeformation, output: SurfacePoint): SurfacePoint {
  output.x = point.x; output.y = point.y; output.z = point.z;
  const distance = (point.x - field.anchor.x) ** 2 + (point.y - field.anchor.y) ** 2 + (point.z - field.anchor.z) ** 2;
  const weight = Math.exp(-distance / (2 * DEFORMATION_SETTINGS.localRadius ** 2));
  const amount = field.pressure + field.impulse;
  if (field.kind === 'drag') {
    const t = Math.max(0, Math.min(1, (point.y + 0.95) / 1.75));
    const upper = t * t * (3 - 2 * t);
    output.x += field.pull.x * (0.28 + upper * 0.72);
    output.y += field.pull.y * (0.22 + upper * 0.78);
    output.z *= 1 - Math.min(0.06, Math.hypot(field.pull.x, field.pull.y, field.pull.z) * 0.13);
  } else {
    output.x += field.pull.x * weight;
    output.y += field.pull.y * weight;
    if (field.kind === 'pinch') {
      output.z += (amount * DEFORMATION_SETTINGS.pinchBulge + Math.abs(field.pinch) * 0.06) * weight;
      output.x += point.x * field.pinch * 0.18 * Math.exp(-point.y * point.y * 3);
      output.y -= point.y * Math.abs(field.pinch) * 0.08;
    } else if (field.kind === 'pat') output.y -= amount * DEFORMATION_SETTINGS.headDepression * weight;
    else if (field.kind === 'tickle') output.z += Math.sin(point.x * 10 + field.time * 20) * amount * 0.023 * weight;
    else if (field.kind === 'poke') output.z -= amount * DEFORMATION_SETTINGS.pokeDepth * weight;
  }
  return output;
}
