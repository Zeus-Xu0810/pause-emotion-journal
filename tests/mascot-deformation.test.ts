import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deformMascotPoint } from '../src/lib/mascot-deformation.ts';
import type { MascotDeformation, SurfacePoint } from '../src/lib/mascot-deformation.ts';
import type { MascotGesture } from '../src/lib/mascot-interaction-types.ts';
import { MASCOT_SETTINGS } from '../src/mascot-content.ts';

/** 测试输入集中在此：覆盖当前合法操纵极值，不依赖 Three.js 或浏览器。 */
const TEST_SETTINGS = {
  maximumPull: { x: 0.32, y: 0.24 },
  maximumPinch: 0.5,
  derivativeStep: 0.0001,
  faceClearance: 0.025,
  anchors: [{ x: 0.43, y: -0.05, z: 0.78 }, { x: 0, y: 0.65, z: 0.5 }, { x: 0, y: -0.4, z: 0.7 }],
  grid: [-1, -0.5, 0, 0.5, 1],
};
const kinds: MascotGesture[] = ['poke', 'pinch', 'drag', 'pat', 'tickle', 'wave', 'bounce', 'shake'];
const baseField: MascotDeformation = {
  kind: 'poke', anchor: TEST_SETTINGS.anchors[0], pull: { x: 0, y: 0, z: 0 }, pressure: 0, pinch: 0, impulse: 0, time: 1,
};
const map = (point: SurfacePoint, field: MascotDeformation): SurfacePoint => deformMascotPoint(point, field, { x: 0, y: 0, z: 0 });

/** 通过实际映射的有限差分检查局部朝向，不复制形变公式作为预期值。 */
function derivatives(point: SurfacePoint, field: MascotDeformation): number[][] {
  const origin = map(point, field);
  return (['x', 'y', 'z'] as const).map(axis => {
    const shifted = { ...point, [axis]: point[axis] + TEST_SETTINGS.derivativeStep };
    const mapped = map(shifted, field);
    return [mapped.x - origin.x, mapped.y - origin.y, mapped.z - origin.z].map(value => value / TEST_SETTINGS.derivativeStep);
  });
}
function determinant([a, b, c]: number[][]): number {
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
}
const extremeFields = TEST_SETTINGS.anchors.flatMap(anchor => (['poke', 'pinch', 'drag', 'pat', 'tickle'] as const).flatMap(kind => [-1, 1].flatMap(horizontal => [-1, 1].map(vertical => ({
  ...baseField, kind, anchor,
  pull: { x: horizontal * TEST_SETTINGS.maximumPull.x, y: vertical * TEST_SETTINGS.maximumPull.y, z: 0 },
  pressure: 1, impulse: 1, pinch: horizontal * TEST_SETTINGS.maximumPinch,
})))));

test('所有动作归零后准确恢复原坐标', () => {
  const points = [{ x: 0, y: 0, z: 0.8 }, { x: 0.5, y: 0.2, z: 0.6 }, { x: 0, y: -0.9, z: 0 }];
  for (const kind of kinds) for (const point of points) assert.deepEqual(map(point, { ...baseField, kind }), point);
});

test('戳凹集中在命中处，远处和背面保持稳定', () => {
  const field = { ...baseField, pressure: 1 };
  const anchor = field.anchor;
  const back = { ...anchor, z: -anchor.z };
  const distant = { x: -0.75, y: 0.6, z: 0.5 };
  const indentation = anchor.z - map(anchor, field).z;
  assert.ok(indentation > 0.1, '命中处必须发生真实压入');
  assert.ok(Math.abs(back.z - map(back, field).z) < indentation * 0.01, '不能把背面一起压凹');
  assert.ok(Math.abs(distant.z - map(distant, field).z) < indentation * 0.01, '不能把局部戳按变成全身平移');
});

test('合法极值的四千五百个采样点保持有限且没有局部翻面', () => {
  let sampleCount = 0;
  for (const field of extremeFields) for (const x of TEST_SETTINGS.grid) for (const y of TEST_SETTINGS.grid) for (const z of [-0.83, 0, 0.83]) {
    const point = { x, y, z };
    const mapped = map(point, field);
    const orientation = determinant(derivatives(point, field));
    if (![mapped.x, mapped.y, mapped.z, orientation].every(Number.isFinite) || orientation <= 0) {
      assert.fail(`形变极值破坏曲面：${JSON.stringify({ field, point, mapped, orientation })}`);
    }
    sampleCount += 1;
  }
  assert.equal(sampleCount, 4500);
});

test('五官经过相同映射后仍位于身体表面外侧', () => {
  const { width, height, depth } = MASCOT_SETTINGS.body;
  const surface = (x: number, y: number): SurfacePoint => ({ x, y, z: depth * Math.sqrt(1 - (x / width) ** 2 - (y / height) ** 2) });
  const facePoints = [[-0.255, 0.16], [0.255, 0.16], [-0.43, -0.055], [0.43, -0.055], [0, -0.24]];
  for (const field of extremeFields) for (const [x, y] of facePoints) {
    const rest = surface(x, y);
    const skin = map(rest, field);
    const attached = map({ ...rest, z: rest.z + TEST_SETTINGS.faceClearance }, field);
    const alongX = map(surface(x + TEST_SETTINGS.derivativeStep, y), field);
    const alongY = map(surface(x, y + TEST_SETTINGS.derivativeStep), field);
    const u = [alongX.x - skin.x, alongX.y - skin.y, alongX.z - skin.z];
    const v = [alongY.x - skin.x, alongY.y - skin.y, alongY.z - skin.z];
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const signedGap = (attached.x - skin.x) * normal[0] + (attached.y - skin.y) * normal[1] + (attached.z - skin.z) * normal[2];
    assert.ok(Number.isFinite(signedGap) && signedGap > 0, `五官不能埋入变形表面：${JSON.stringify({ kind: field.kind, x, y, signedGap })}`);
  }
});
