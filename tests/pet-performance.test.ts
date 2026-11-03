import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePetMeal, samplePetSleep } from '../src/lib/pet-performance.ts';

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
