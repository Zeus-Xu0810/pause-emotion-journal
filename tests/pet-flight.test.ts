import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_FLIGHT_SETTINGS as SETTINGS, advancePetFlight, createPetFlight, estimatePetRelease, isPetFlick, isPetFlightResting, predictFlightLanding, sweptPetCatch, type PetFlight, type PetReleaseSample } from '../src/lib/pet-flight.ts';

/** 用真实时间步长推进同一归一化轨迹，不依赖DOM、Three、随机数或计时器。 */
const radius = { x: 0.08, y: 0.1 };
function simulate(initial: PetFlight, seconds: number, fps = 120): PetFlight {
  let state = initial;
  for (let frame = 0; frame < seconds * fps; frame += 1) state = advancePetFlight(state, 1 / fps, radius);
  return state;
}
const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' 应接近 ' + expected);

test('抛起先上升再下落，横向保留惯性且轨迹有限', () => {
  const initial = createPetFlight({ x: -0.6, y: -0.4 }, { x: 0.8, y: -1.5 });
  const up = simulate(initial, 0.2);
  const down = simulate(initial, 1);
  assert.ok(up.y < initial.y && up.vy < 0);
  assert.ok(down.vy > 0 && down.y > up.y);
  assert.ok(down.x > up.x && down.vx > 0 && down.vx < initial.vx);
  assert.ok(Object.values(down).every(Number.isFinite));
  assert.ok(SETTINGS.stepSeconds <= 1 / 120);
});

test('左右墙面对称反弹并衰减，不把球穿到舞台外', () => {
  const right = advancePetFlight(createPetFlight({ x: 0.86, y: 0 }, { x: 3, y: 0 }), 1 / 30, radius);
  const left = advancePetFlight(createPetFlight({ x: -0.86, y: 0 }, { x: -3, y: 0 }), 1 / 30, radius);
  assert.ok(right.vx < 0 && left.vx > 0); assert.ok(right.bounces >= 1 && left.bounces >= 1);
  assert.ok(Math.abs(right.vx) < 3); near(left.x, -right.x); near(left.vx, -right.vx); near(left.y, right.y);
  assert.ok(Math.abs(right.x) <= 1 - radius.x && Math.abs(left.x) <= 1 - radius.x);
});

test('地面和顶边分别反弹，地面同时损失水平速度', () => {
  const falling = createPetFlight({ x: 0, y: 0.89 }, { x: 1, y: 2 });
  const floor = advancePetFlight(falling, 1 / 60, radius);
  assert.ok(floor.vy < 0 && floor.bounces >= 1 && floor.vx < falling.vx);
  assert.ok(floor.y <= 1 - radius.y);
  const ceiling = advancePetFlight(createPetFlight({ x: 0, y: -0.89 }, { x: 0, y: -2 }), 1 / 60, radius);
  assert.ok(ceiling.vy > 0 && ceiling.bounces >= 1 && ceiling.y >= -1 + radius.y);
});

test('弹几次后自然落地减速，静止后不被重力制造无限微弹', () => {
  const initial = createPetFlight({ x: -0.4, y: -0.5 }, { x: 1.3, y: -1.8 });
  const settled = simulate(initial, 8);
  assert.equal(isPetFlightResting(settled, radius), true);
  assert.ok(settled.bounces >= 2 && settled.bounces < 12);
  const later = simulate(settled, 4);
  near(later.x, settled.x); near(later.y, settled.y); near(later.spin, settled.spin);
  assert.equal(later.bounces, settled.bounces); assert.equal(later.vx, 0); assert.equal(later.vy, 0);
  const sliding = createPetFlight({ x: 0, y: 1 - radius.y }, { x: 0.8, y: 0 });
  const slower = simulate(sliding, 0.2);
  assert.ok(slower.x > sliding.x && slower.vx < sliding.vx); assert.equal(slower.vy, 0);
});

test('30/60/120fps下整条抓放轨迹及反弹次数一致', () => {
  const initial = createPetFlight({ x: -0.55, y: 0.1 }, { x: 3.1, y: -2.4 });
  for (const seconds of [0.5, 1, 2, 4]) {
    const standard = simulate(initial, seconds, 120);
    for (const fps of [30, 60]) {
      const other = simulate(initial, seconds, fps);
      for (const key of ['x', 'y', 'vx', 'vy', 'spin', 'age'] as const) near(other[key], standard[key], 1e-8);
      assert.equal(other.bounces, standard.bounces);
    }
  }
});

test('单次长帧有界追赶，非法输入安全且不修改上一个状态', () => {
  const state = createPetFlight({ x: 0, y: 0 }, { x: 1, y: -1 }); const snapshot = structuredClone(state);
  const long = advancePetFlight(state, 50, radius);
  near(long.age, SETTINGS.maxAdvanceSeconds); assert.deepEqual(state, snapshot); assert.notEqual(long, state);
  for (const delta of [-1, 0, Number.NaN, Infinity]) assert.deepEqual(advancePetFlight(state, delta, radius), state);
  const invalid = createPetFlight({ x: NaN, y: Infinity }, { x: NaN, y: 2 });
  assert.ok(Object.values(invalid).every(Number.isFinite));
  assert.ok(Object.values(advancePetFlight(invalid, 1 / 30, { x: -5, y: Infinity })).every(Number.isFinite));
});

test('松手速度来自最近窗口，单个跳点、倒序和非法采样不会污染方向', () => {
  const samples: PetReleaseSample[] = Array.from({ length: 7 }, (_, index) => ({ x: index * 0.04, y: -index * 0.02, at: 100 + index * 15 }));
  samples[3] = { ...samples[3], x: 2.4, y: -2.4 };
  samples.push({ x: 8, y: 8, at: 110 }, { x: NaN, y: 2, at: 200 });
  const velocity = estimatePetRelease(samples);
  near(velocity.x, 0.04 * 1000 / 15); near(velocity.y, -0.02 * 1000 / 15);
  assert.equal(isPetFlick(velocity), true);
  const slow = estimatePetRelease([{ x: -1, y: 0, at: 0 }, { x: 0, y: 0, at: 400 }, { x: 0.02, y: 0, at: 450 }, { x: 0.04, y: 0, at: 500 }]);
  near(slow.x, 0.4); assert.equal(isPetFlick(slow), false);
});

test('甩过后停住再松手会归零，不能沿用早先的高速', () => {
  const stopped = [{ x: 0, y: 0, at: 0 }, { x: 0.25, y: -0.1, at: 20 }, { x: 0.6, y: -0.2, at: 40 }, { x: 0.602, y: -0.2, at: 75 }, { x: 0.6, y: -0.2, at: 110 }];
  assert.deepEqual(estimatePetRelease(stopped), { x: 0, y: 0 });
  assert.equal(isPetFlick(estimatePetRelease(stopped)), false);
  assert.deepEqual(estimatePetRelease([...stopped, { x: 0.6, y: -0.2, at: 400 }]), { x: 0, y: 0 });
  assert.deepEqual(estimatePetRelease([]), { x: 0, y: 0 });
  assert.deepEqual(estimatePetRelease([{ x: 0, y: 0, at: 0 }, { x: 0.1, y: 0, at: SETTINGS.minimumReleaseSpanMs - 1 }]), { x: 0, y: 0 });
});

test('最后反向甩出保留末端方向，极快斜甩按向量统一限速', () => {
  const reversed = estimatePetRelease([{ x: 0, y: 0, at: 0 }, { x: 0.2, y: 0, at: 25 }, { x: 0.4, y: 0, at: 50 }, { x: 0.2, y: 0, at: 75 }, { x: 0, y: 0, at: 100 }]);
  assert.ok(reversed.x < -SETTINGS.flickThreshold);
  const fast = estimatePetRelease([{ x: 0, y: 0, at: 0 }, { x: 0.8, y: 0.8, at: 20 }]);
  near(Math.hypot(fast.x, fast.y), SETTINGS.maxReleaseSpeed); near(fast.x, fast.y);
  assert.equal(isPetFlick({ x: SETTINGS.flickThreshold - 0.001, y: 0 }), false);
  assert.equal(isPetFlick({ x: SETTINGS.flickThreshold, y: 0 }), true);
  assert.equal(isPetFlick({ x: NaN, y: 1 }), false);
  assert.deepEqual(estimatePetRelease([{ x: 0, y: 0, at: 0 }, { x: 0.003, y: 0, at: 100 }]), { x: 0, y: 0 });
});

test('扫掠椭圆碰撞抓住低帧穿手轨迹，擦过边缘也有明确边界', () => {
  const hand = { x: 0, y: 0 }; const reach = { x: 0.1, y: 0.2 };
  assert.equal(sweptPetCatch({ x: -0.6, y: 0 }, { x: 0.6, y: 0 }, hand, reach), true);
  assert.equal(sweptPetCatch({ x: -0.6, y: 0.2 }, { x: 0.6, y: 0.2 }, hand, reach), true);
  assert.equal(sweptPetCatch({ x: -0.6, y: 0.201 }, { x: 0.6, y: 0.201 }, hand, reach), false);
  assert.equal(sweptPetCatch(hand, hand, hand, reach), true);
  assert.equal(sweptPetCatch({ x: 0.2, y: 0 }, { x: 0.3, y: 0 }, hand, reach), false);
  assert.equal(sweptPetCatch({ x: NaN, y: 0 }, hand, hand, reach), false);
  assert.equal(sweptPetCatch(hand, hand, hand, { x: 0, y: 1 }), false);
});

test('视线拦截预测对应实际下降轨迹，够不到的高度不编造落点', () => {
  const state = createPetFlight({ x: -0.4, y: 0.1 }, { x: 0.7, y: -1.1 });
  const prediction = predictFlightLanding(state, 0.4);
  assert.ok(prediction && prediction.time > 0);
  let real = state; let remaining = prediction.time;
  while (remaining > 1e-10) { const step = Math.min(remaining, 1 / 120); real = advancePetFlight(real, step, radius); remaining -= step; }
  near(real.x, prediction.x, 1e-7); near(real.y, prediction.y, 1e-7); assert.ok(real.vy > 0);
  assert.equal(predictFlightLanding(createPetFlight({ x: 0, y: 0 }, { x: 0, y: 0 }), -0.5), null);
  assert.equal(predictFlightLanding(state, NaN), null);
});
