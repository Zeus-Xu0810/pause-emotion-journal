import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_BALL_PLAY_SETTINGS as SETTINGS, samplePetBallPlay, type PetBallHand } from '../src/lib/pet-ball-play.ts';

/** 验证真正的路径约束与连续性，不依赖帧率、动画时钟或浏览器私有状态。 */
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a}与${b}不接近`);
const boundaries = [0, SETTINGS.gatherEnd, SETTINGS.settleStart, SETTINGS.spin.start, SETTINGS.spin.end,
  ...SETTINGS.tap.beats.flatMap(b => [b.start, b.peak, b.end]), SETTINGS.pass.out.start, SETTINGS.pass.out.end, SETTINGS.pass.back.start, SETTINGS.pass.back.end,
  SETTINGS.squeeze.start, SETTINGS.squeeze.end, SETTINGS.balance.start, SETTINGS.balance.end, 1];

test('五套掌心玩法依次轮换，一轮用完之前没有重复', () => {
  const first = Array.from({ length: 5 }, (_, i) => samplePetBallPlay(0.5, i).pattern);
  assert.deepEqual(first, ['spin', 'tap', 'pass', 'squeeze', 'balance']);
  assert.equal(new Set(first).size, 5);
  for (let i = 0; i < 20; i += 1) assert.notEqual(samplePetBallPlay(0.5, i).pattern, samplePetBallPlay(0.5, i + 1).pattern);
});
test('每套完整结束后球仍在原掌，手部姿态保持托球，不产生释放指令', () => {
  for (let variant = 0; variant < 5; variant += 1) for (const hand of ['left', 'right'] as PetBallHand[]) {
    const first = samplePetBallPlay(0, variant, hand); const last = samplePetBallPlay(1, variant, hand);
    assert.equal(first.phase, 'gather'); assert.equal(last.phase, 'done');
    assert.equal(last.ball[hand], 1); assert.equal(last.ball.floor, 0); assert.equal(last.pose[hand], 1);
    assert.equal(last.ball.lift, 0); near(last.ball.orbitX, 0); near(last.ball.orbitY, 0); near(last.ball.orbitZ, 0);
    assert.equal(last.ball.scaleX, 1); assert.equal(last.ball.scaleY, 1);
    assert.equal('released' in last, false); assert.equal('releaseAt' in last, false);
    assert.deepEqual(samplePetBallPlay(10, variant, hand), last);
  }
});
test('转圈始终贴近原手掌，小偏心与连续自转分别存在', () => {
  let previous = 0;
  for (let i = 0; i <= 1000; i += 1) {
    const b = samplePetBallPlay(i / 1000, 0).ball;
    assert.equal(b.right, 1); assert.ok(Math.hypot(b.orbitX, b.orbitY, b.orbitZ) <= 0.4);
    assert.ok(b.spin >= previous); previous = b.spin;
  }
  near(previous, SETTINGS.spin.turns * Math.PI * 2);
});
test('掌心轻拍只有两次小幅抬落，球不落地、不消失', () => {
  for (const b of SETTINGS.tap.beats) {
    const start = samplePetBallPlay(b.start, 1).ball; const peak = samplePetBallPlay(b.peak, 1).ball; const end = samplePetBallPlay(b.end, 1).ball;
    assert.equal(start.lift, 0); near(peak.lift, SETTINGS.tap.lift); near(end.lift, 0);
    assert.equal(peak.floor, 0); assert.equal(peak.right, 1);
  }
});
test('双手传球先到另一手再回来，途中在圆肚子前方而非穿体', () => {
  assert.equal(samplePetBallPlay(SETTINGS.pass.out.end, 2).activeHand, 'left');
  assert.equal(samplePetBallPlay(SETTINGS.pass.back.end, 2).activeHand, 'right');
  for (const leg of [SETTINGS.pass.out, SETTINGS.pass.back]) {
    const s = samplePetBallPlay((leg.start + leg.end) / 2, 2);
    near(s.ball.left, 0.5); near(s.ball.right, 0.5); assert.ok(s.ball.orbitZ > 0); assert.ok(s.ball.lift > 0);
  }
});
test('捏软球会压扁恢复，掌心平衡只轻晃不离开手部范围', () => {
  assert.ok(samplePetBallPlay(0.4, 3).ball.scaleY < 1);
  assert.equal(samplePetBallPlay(0.4, 3).ball.right, 1);
  assert.ok(Math.abs(samplePetBallPlay(0.4, 4).ball.orbitX) > 0);
  assert.equal(samplePetBallPlay(0.4, 4).ball.right, 1);
});
test('五套动作左右镜像、有界且边界连续，静止采样不积累位移', () => {
  for (let variant = 0; variant < 5; variant += 1) {
    for (let step = 0; step <= 1000; step += 1) {
      const left = samplePetBallPlay(step / 1000, variant, 'left'); const right = samplePetBallPlay(step / 1000, variant, 'right');
      near(left.ball.left, right.ball.right); near(left.ball.right, right.ball.left); near(left.ball.orbitX, -right.ball.orbitX); near(left.ball.spin, -right.ball.spin);
      near(right.ball.left + right.ball.right, 1); assert.equal(right.ball.floor, 0);
      for (const value of Object.values(right.ball)) assert.ok(Number.isFinite(value));
      for (const value of Object.values(right.pose)) assert.ok(value >= 0 && value <= 1);
      assert.ok(right.ball.scaleY >= 0.89 && right.ball.scaleX <= 1.11);
    }
    for (const b of boundaries) {
      const before = samplePetBallPlay(b - 1e-7, variant); const after = samplePetBallPlay(b + 1e-7, variant);
      for (const k of Object.keys(before.ball) as (keyof typeof before.ball)[]) near(before.ball[k], after.ball[k], 1e-4);
      for (const k of Object.keys(before.pose) as (keyof typeof before.pose)[]) near(before.pose[k], after.pose[k], 1e-4);
    }
  }
});
test('非法输入安全回落，相同输入重复调用得到相同轨迹', () => {
  assert.deepEqual(samplePetBallPlay(NaN, NaN), samplePetBallPlay(0, 0));
  assert.deepEqual(samplePetBallPlay(Infinity, 4), samplePetBallPlay(1, 4));
  const expected = samplePetBallPlay(0.6, 4, 'left');
  for (let i = 0; i < 100; i += 1) assert.deepEqual(samplePetBallPlay(0.6, 4, 'left'), expected);
});
