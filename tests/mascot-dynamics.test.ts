import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceMascotSpring, mascotSoftLimit, MASCOT_DYNAMICS as SETTINGS } from '../src/lib/mascot-dynamics.ts';

/** 覆盖实际30/60/120帧输入与抓住后松开的完整过程，不复制弹簧实现作为预期。 */
test('按住时快速跟手，松开后越过原点再稳定归零', () => {
  const axis = { value: 0, velocity: 0 };
  for (let frame = 0; frame < 12; frame += 1) advanceMascotSpring(axis, 0.6, 1 / 60, SETTINGS.heldStiffness, SETTINGS.heldDamping);
  assert.ok(axis.value > 0.5 && axis.value < 0.65, '200ms内应明显跟上手指');
  let crossed = false;
  for (let frame = 0; frame < 240; frame += 1) { advanceMascotSpring(axis, 0, 1 / 60, SETTINGS.releaseStiffness, SETTINGS.releaseDamping); if (axis.value < -0.015) crossed = true; }
  assert.ok(crossed, '释放要有可见余振，而非单调机械复位');
  assert.deepEqual(axis, { value: 0, velocity: 0 });
});
test('不同帧率连续抓放仍有限且不累积漂移', () => {
  for (const fps of [30, 60, 120]) {
    const axis = { value: 0, velocity: 0 };
    for (let frame = 0; frame < fps * 12; frame += 1) {
      const target = frame < fps * 8 ? Math.sin(frame / fps * 9) * 0.8 : 0;
      advanceMascotSpring(axis, target, 1 / fps, SETTINGS.releaseStiffness, SETTINGS.releaseDamping);
      assert.ok(Number.isFinite(axis.value) && Math.abs(axis.value) < 1.8);
    }
    assert.deepEqual(axis, { value: 0, velocity: 0 });
  }
});
test('软边界连续、保留方向并在大位移时逐渐减小增量', () => {
  for (const value of [-100, -1, -0.2, 0, 0.2, 1, 100]) assert.ok(Math.abs(mascotSoftLimit(value, 0.8)) <= 0.8);
  assert.equal(mascotSoftLimit(0, 0.8), 0);
  assert.ok(mascotSoftLimit(0.2, 0.8) > 0.19);
  assert.ok(mascotSoftLimit(1.2, 0.8) - mascotSoftLimit(1, 0.8) < mascotSoftLimit(0.2, 0.8));
});


test('30、60、120帧下同一次拖放的回弹峰值与收敛时长保持接近', () => {
  const records = [30, 60, 120].map(fps => {
    const axis = { value: 0, velocity: 0 }; let minimum = 0; let settledAt = 0;
    for (let frame = 0; frame < fps / 5; frame += 1) advanceMascotSpring(axis, 0.6, 1 / fps, SETTINGS.heldStiffness, SETTINGS.heldDamping);
    for (let frame = 0; frame < fps * 3; frame += 1) {
      advanceMascotSpring(axis, 0, 1 / fps, SETTINGS.releaseStiffness, SETTINGS.releaseDamping);
      minimum = Math.min(minimum, axis.value);
      if (!settledAt && Math.abs(axis.value) + Math.abs(axis.velocity) < 0.005) settledAt = (frame + 1) / fps;
    }
    return { minimum, settledAt };
  });
  for (const item of records) {
    assert.ok(Math.abs(item.minimum / records[1].minimum - 1) < 0.1);
    assert.ok(Math.abs(item.settledAt / records[1].settledAt - 1) < 0.1);
  }
});
