import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPetPointer, petArcPoint, petSafeZoom, petTargetContains } from '../src/lib/pet-scene-math.ts';

/** 覆盖短屏和宽屏的真实CSS尺寸，确保道具中心加半径后仍留在可见舞台。 */
test('道具拖动边界按CSS像素留白，窄舞台及非法指针仍有限', () => {
  for (const [width, height] of [[280, 190], [390, 330], [980, 660]]) for (const x of [-3, 0, 3]) for (const y of [-3, 0, 3]) {
    const point = clampPetPointer({ x, y }, width, height, 22, 12);
    const pixel = { x: (point.x + 1) * width / 2, y: (point.y + 1) * height / 2 };
    assert.ok(pixel.x >= 34 - 1e-9 && pixel.x <= width - 34 + 1e-9);
    assert.ok(pixel.y >= 34 - 1e-9 && pixel.y <= height - 34 + 1e-9);
  }
  assert.deepEqual(clampPetPointer({ x: NaN, y: Infinity }, 0, 0, 20, 12), { x: 0, y: 0 });
});

test('接触只在嘴或手的接收范围内成立，远处及非有限坐标不触发', () => {
  const target = { x: 160, y: 90 };
  assert.equal(petTargetContains({ x: 184, y: 97 }, target, 25), true);
  assert.equal(petTargetContains({ x: 186, y: 90 }, target, 25), false);
  assert.equal(petTargetContains({ x: NaN, y: 90 }, target, 25), false);
  assert.equal(petTargetContains(target, target, -1), false);
});

test('自动递送路径首尾准确，始终处于两端前后深度范围且没有越过身体表面', () => {
  const start = { x: -0.9, y: -0.48, z: 1.2 }; const end = { x: 0, y: -0.235, z: 1.06 };
  assert.deepEqual(petArcPoint(start, end, 0, 0.19, { x: 0, y: 0, z: 0 }), start);
  const final = petArcPoint(start, end, 1, 0.19, { x: 0, y: 0, z: 0 });
  assert.ok(Math.hypot(final.x - end.x, final.y - end.y, final.z - end.z) < 1e-12);
  for (let step = 0; step <= 100; step += 1) {
    const point = petArcPoint(start, end, step / 100, 0.19, { x: 0, y: 0, z: 0 });
    assert.ok(Object.values(point).every(Number.isFinite));
    assert.ok(point.z >= end.z && point.z <= start.z);
    assert.ok(point.x >= start.x && point.x <= end.x);
  }
});


test('道具边缘取景与当前zoom无关，并为44像素触控区保留完整舞台空间', () => {
  const base = { base: 1, halfWidth: 1.4, halfHeight: 1.2, width: 390, height: 180, worldRadius: 0.28, hitRadius: 22 };
  const first = petSafeZoom({ ...base, x: 0.7, y: -0.87, zoom: 1 });
  const second = petSafeZoom({ ...base, x: 0.7 * 0.8, y: -0.87 * 0.8, zoom: 0.8 });
  assert.ok(Math.abs(first - second) < 0.00001, '同一物体不能让镜头在两种zoom来回跳');
  const pixelY = (1 + 0.87 * first) * base.height / 2;
  assert.ok(pixelY + base.hitRadius <= base.height + 0.001);
  assert.ok(first > 0.5 && first <= 1);
});
