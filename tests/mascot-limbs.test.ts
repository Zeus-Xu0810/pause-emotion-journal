import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASCOT_SETTINGS } from '../src/mascot-content.ts';
import { MASCOT_LIMB_SETTINGS as SETTINGS, mascotPalmFromPose, solveMascotLimb } from '../src/lib/mascot-limbs.ts';
import { deformMascotPoint } from '../src/lib/mascot-deformation.ts';

/** 来自实际拾球分支：pivot=(-.7,-.62,.9)，left Z旋转=-.12+.25。 */
const body = MASCOT_SETTINGS.body;
const detachedPalm = mascotPalmFromPose(-1, { x: -0.7, y: -0.62, z: 0.9 }, 0.13);
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('真实低位拾球样本原本完全离体，约束后肩掌距离不超过短软臂骨长', () => {
  const legacyGap = Math.hypot(detachedPalm.x, detachedPalm.y, detachedPalm.z) - Math.max(body.width, body.height, body.depth) * 1.022 - Math.max(...Object.values(SETTINGS.palmRadii));
  assert.ok(legacyGap > 0.3, '旧手掌与身体包围球之间至少有0.3单位明确空隙');
  const solved = solveMascotLimb(-1, detachedPalm, body);
  assert.ok(solved.reach <= SETTINGS.maxReach + 1e-10, `旧拾球目标离肩${solved.reach.toFixed(3)}，不能直接变成悬空的手`);
  assert.equal(solved.limited, true);
  assert.ok(distance(solved.shoulder, solved.palm) <= SETTINGS.maxReach + 1e-10);
});

test('左右完全对称，肩根读取实际身体尺寸并略微内嵌体表', () => {
  for (const dimensions of [body, { width: 1.2, height: 1.1, depth: 0.9 }, { width: 0.8, height: 0.75, depth: 0.7 }]) {
    const desired = { x: 0.4, y: -0.3, z: 0.98 };
    const right = solveMascotLimb(1, desired, dimensions); const left = solveMascotLimb(-1, { ...desired, x: -desired.x }, dimensions);
    for (const key of ['shoulder', 'palm', 'wrist', 'connectorMidpoint'] as const) { assert.equal(left[key].x, -right[key].x); assert.equal(left[key].y, right[key].y); assert.equal(left[key].z, right[key].z); }
    const q = (right.shoulder.x / dimensions.width) ** 2 + (right.shoulder.y / dimensions.height) ** 2 + (right.shoulder.z / dimensions.depth) ** 2;
    assert.ok(q > 0.9 && q < 1, '肩根须与真实身体相交，连接器不能从空中开始');
  }
});

test('拾取、进食、揉眼等极端目标既限长也不会被拉回皮肤内部', () => {
  for (const side of [-1, 1] as const) for (const x of [0, 0.2, 0.6, 1.2]) for (const y of [-1, -0.2, 0.5]) for (const z of [-0.2, 0.2, 0.8, 1.4]) {
    const solved = solveMascotLimb(side, { x: x * side, y, z }, body);
    assert.ok(solved.reach <= SETTINGS.maxReach + 1e-10);
    const skinZ = body.depth * Math.sqrt(Math.max(0, 1 - (solved.palm.x / body.width) ** 2 - (solved.palm.y / body.height) ** 2));
    assert.ok(solved.palm.z >= skinZ + SETTINGS.palmSurfaceOffset - 1e-8);
    assert.ok(distance(solved.palm, solved.wrist) <= SETTINGS.wristOverlap + 1e-10);
    assert.ok(Math.abs(distance(solved.shoulder, solved.wrist) - solved.connectorLength) < 1e-10);
    assert.ok(Object.values(solved.palm).every(Number.isFinite));
  }
});

test('连续目标和反复快照求解不累加位置、长度或体积', () => {
  const target = Object.freeze({ ...detachedPalm }); const first = solveMascotLimb(-1, target, body);
  for (let frame = 0; frame < 1000; frame += 1) assert.deepEqual(solveMascotLimb(-1, target, body), first);
  let previous = first.palm;
  for (let step = 1; step <= 200; step += 1) {
    const t = step / 200; const current = solveMascotLimb(-1, { x: detachedPalm.x + (-0.29 - detachedPalm.x) * t, y: detachedPalm.y + (0.16 - detachedPalm.y) * t, z: detachedPalm.z + (1.05 - detachedPalm.z) * t }, body);
    assert.ok(distance(previous, current.palm) < 0.025, '拾球到揉眼的连续姿态不能突然翻边或闪动'); previous = current.palm;
  }
  assert.deepEqual(target, detachedPalm);
});

test('肩掌和腕端统一形变后仍有真实连接重叠，坏采样不会产生NaN', () => {
  const solution = solveMascotLimb(-1, detachedPalm, body);
  for (const kind of ['drag', 'pinch', 'poke', 'pat'] as const) {
    const field = { kind, anchor: { x: -0.43, y: -0.05, z: 0.78 }, pull: { x: 0.56, y: -0.34, z: 0 }, pressure: 1, pinch: 0.5, impulse: 0.6, time: 1 };
    const palm = deformMascotPoint(solution.palm, field, { x: 0, y: 0, z: 0 }); const wrist = deformMascotPoint(solution.wrist, field, { x: 0, y: 0, z: 0 });
    assert.ok(distance(palm, wrist) < SETTINGS.palmRadii.x + SETTINGS.armRadius, '连接器末端必须落在手掌实体内');
  }
  const invalid = solveMascotLimb(1, { x: NaN, y: Infinity, z: -Infinity }, { width: NaN, height: 0, depth: Infinity });
  assert.ok(Object.values(invalid.palm).every(Number.isFinite)); assert.equal(invalid.limited, true);
});
