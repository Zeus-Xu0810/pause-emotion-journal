import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petCatchBlend, petPursuitTarget, samplePetMeal, samplePetSleep } from '../src/lib/pet-performance.ts';

/** 进食分口而非一次消失，拍点错开且所有曲线连续、有界。 */
test('点心先完整递到嘴，再分三口消失，咀嚼与满足不同时起停', () => {
  assert.equal(samplePetMeal(0.19, 0).size, 1);
  assert.equal(samplePetMeal(0.4, 0).size, 0.7);
  assert.ok(Math.abs(samplePetMeal(0.66, 0).size - 0.36) < 1e-12);
  assert.equal(samplePetMeal(0.83, 0).size, 0);
  assert.equal(samplePetMeal(0.4, 0).delight, 0);
  assert.ok(samplePetMeal(0.92, 0).delight > 0.9);
  for (let index = 0; index <= 1000; index += 1) {
    const current = samplePetMeal(index / 1000, 2); const next = samplePetMeal((index + 1) / 1000, 2);
    for (const key of Object.keys(current) as (keyof typeof current)[]) { assert.ok(Number.isFinite(current[key]) && current[key] >= 0 && current[key] <= 1); assert.ok(Math.abs(current[key] - next[key]) < 0.06); }
  }
});

test('睡着持续闭眼靠头抱手，醒来揉眼先于伸懒腰', () => {
  const sleeping = samplePetSleep(1, true, false);
  assert.equal(sleeping.closed, 1); assert.equal(sleeping.hug, 1); assert.equal(sleeping.yawn, 0);
  assert.ok(samplePetSleep(0.18, true, true).rub > 0.9);
  assert.equal(samplePetSleep(0.18, true, true).stretch, 0);
  assert.ok(samplePetSleep(0.68, true, true).stretch > 0.9);
  assert.equal(samplePetSleep(1, true, true).closed, 0);
  assert.equal(samplePetSleep(1, true, true).hug, 0);
});

test('窄镜框边缘追随不随自动缩放越追越远，宽镜框仍能移动到两边', () => {
  const narrow = 1.344; const goal = petPursuitTarget(0.9, narrow);
  assert.ok(goal > 0.15 && goal < 0.18);
  for (let frame = 0; frame < 60; frame += 1) {
    const zoom = narrow / (1.25 + goal);
    assert.ok(zoom > 0.9, '角色体量不应在追随期间持续缩小');
    assert.equal(petPursuitTarget(0.9, narrow), goal);
  }
  const wide = petPursuitTarget(0.9, 3.5);
  assert.ok(wide > 2 && wide + 1.18 <= 3.5 + 1e-12);
  assert.equal(petPursuitTarget(-0.9, 3.5), -wide);
});

test('接物首帧完整保留伸手和重心，前百分之十五阶段平滑交到回应姿态', () => {
  assert.equal(petCatchBlend(0), 0);
  assert.equal(petCatchBlend(0.15), 1);
  assert.equal(petCatchBlend(1), 1);
  assert.ok(petCatchBlend(0.001) < 0.001, '第一帧不能突然收回手');
  let previous = 0;
  for (let step = 0; step <= 150; step += 1) { const weight = petCatchBlend(step / 1000); assert.ok(weight >= previous && weight - previous < 0.011); previous = weight; }
});
