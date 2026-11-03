import { MASCOT_SETTINGS } from '../mascot-content.ts';

/** 短软臂的形状和骨长输入集中维护；坐标全部为rig局部形变前坐标。 */
export const MASCOT_LIMB_SETTINGS = {
  maxReach: 0.64,
  armRadius: 0.095,
  restPivot: { x: 0.86, y: 0.03, z: 0.02 },
  restRotation: 0.12,
  palmOffset: { x: 0.13, y: -0.17, z: 0.12 },
  palmRadii: { x: 0.14, y: 0.22, z: 0.15 },
  shoulderUnit: { x: 0.82, y: 0.03 },
  shoulderInset: 0.96,
  palmSurfaceOffset: 0.11,
  ownSideMinimum: 0.12,
  wristOverlap: 0.075,
  surfaceIterations: 24,
  epsilon: 1e-8,
};
export interface LimbPoint { x: number; y: number; z: number }
export interface LimbBody { width: number; height: number; depth: number }
export interface MascotLimbSolution { shoulder: LimbPoint; palm: LimbPoint; wrist: LimbPoint; connectorMidpoint: LimbPoint; connectorLength: number; reach: number; limited: boolean }
const distance = (a: LimbPoint, b: LimbPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mix = (a: LimbPoint, b: LimbPoint, t: number): LimbPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** 无效配置回落到实际身体输入，不能把一个坏目标扩散成WebGL矩阵中的NaN。 */
function validBody(body: LimbBody): LimbBody {
  const fallback = MASCOT_SETTINGS.body;
  return { width: Number.isFinite(body.width) && body.width > 0 ? body.width : fallback.width, height: Number.isFinite(body.height) && body.height > 0 ? body.height : fallback.height, depth: Number.isFinite(body.depth) && body.depth > 0 ? body.depth : fallback.depth };
}
function frontGap(point: LimbPoint, body: LimbBody): number {
  const crossSection = 1 - (point.x / body.width) ** 2 - (point.y / body.height) ** 2;
  return point.z - body.depth * Math.sqrt(Math.max(0, crossSection)) - MASCOT_LIMB_SETTINGS.palmSurfaceOffset;
}

/** 当前arm Group的位移不能冒充手掌中心，先加入随Z轴旋转的child偏移。 */
export function mascotPalmFromPose(side: -1 | 1, pivot: LimbPoint, rotationZ: number): LimbPoint {
  const offset = MASCOT_LIMB_SETTINGS.palmOffset; const cosine = Math.cos(rotationZ); const sine = Math.sin(rotationZ);
  return { x: pivot.x + side * offset.x * cosine - offset.y * sine, y: pivot.y + side * offset.x * sine + offset.y * cosine, z: pivot.z + offset.z };
}

/** 肩根略内嵌体表，连接器从真实身体中长出；左右共享同一个椭球比例。 */
export function mascotShoulderPoint(side: -1 | 1, body: LimbBody = MASCOT_SETTINGS.body): LimbPoint {
  body = validBody(body);
  const { x, y } = MASCOT_LIMB_SETTINGS.shoulderUnit;
  const inset = MASCOT_LIMB_SETTINGS.shoulderInset;
  return { x: side * x * body.width * inset, y: y * body.height * inset, z: Math.sqrt(1 - x * x - y * y) * body.depth * inset };
}

/** 固定肩锚、限长，再避开前表面；返回值由场景统一形变一次后连接真实软臂。 */
export function solveMascotLimb(side: -1 | 1, desiredPalm: LimbPoint, body: LimbBody = MASCOT_SETTINGS.body): MascotLimbSolution {
  body = validBody(body);
  const settings = MASCOT_LIMB_SETTINGS; const shoulder = mascotShoulderPoint(side, body);
  const rest = mascotPalmFromPose(side, { ...settings.restPivot, x: side * settings.restPivot.x }, side * settings.restRotation);
  const valid = Object.values(desiredPalm).every(Number.isFinite);
  const desired = { x: Number.isFinite(desiredPalm.x) ? desiredPalm.x : rest.x, y: Number.isFinite(desiredPalm.y) ? desiredPalm.y : rest.y, z: Number.isFinite(desiredPalm.z) ? desiredPalm.z : rest.z };
  let palm: LimbPoint = { x: side * Math.max(body.width * settings.ownSideMinimum, side * desired.x), y: desired.y, z: Math.max(settings.palmSurfaceOffset, desired.z) };
  const requestedReach = distance(shoulder, palm);
  if (requestedReach > settings.maxReach) palm = mix(shoulder, palm, settings.maxReach / requestedReach);

  // 单纯限长可能把揉眼/喂食掌心拉回体内；向同一只手的外侧可行点连续投影。
  if (frontGap(palm, body) < 0) {
    const outward = { x: shoulder.x / body.width ** 2, y: shoulder.y / body.height ** 2, z: shoulder.z / body.depth ** 2 };
    const normalLength = Math.hypot(outward.x, outward.y, outward.z);
    const reference = { x: shoulder.x + outward.x / normalLength * settings.maxReach * 0.9, y: shoulder.y + outward.y / normalLength * settings.maxReach * 0.9, z: shoulder.z + outward.z / normalLength * settings.maxReach * 0.9 };
    let near = 0; let far = 1;
    for (let iteration = 0; iteration < settings.surfaceIterations; iteration += 1) {
      const middle = (near + far) / 2;
      if (frontGap(mix(reference, palm, middle), body) >= 0) near = middle; else far = middle;
    }
    palm = mix(reference, palm, near);
  }
  const reach = Math.hypot(palm.x - shoulder.x, palm.y - shoulder.y, palm.z - shoulder.z);
  const connectorLength = Math.max(0, reach - settings.wristOverlap);
  const wrist = mix(shoulder, palm, reach > settings.epsilon ? connectorLength / reach : 0);
  return { shoulder, palm, wrist, connectorMidpoint: mix(shoulder, wrist, 0.5), connectorLength, reach, limited: !valid || distance(palm, desired) > settings.epsilon };
}
