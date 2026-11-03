import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_BALL_PLAY_SETTINGS as SETTINGS, samplePetBallPlay, type PetBallHand } from '../src/lib/pet-ball-play.ts';

/** 将三套编排的关键时刻集中收集，边界测试同时覆盖接稳、触地、换手和抛回。 */
const BOUNDARIES = [0, SETTINGS.gatherEnd, SETTINGS.spin.start, SETTINGS.spin.start + SETTINGS.spin.fade, SETTINGS.spin.end - SETTINGS.spin.fade, SETTINGS.spin.end,
  ...SETTINGS.dribble.strokes.flatMap(stroke => [stroke.start, stroke.impact - SETTINGS.dribble.impactLead, stroke.impact, stroke.impact + SETTINGS.dribble.impactTrail, stroke.end]),
  SETTINGS.pass.out.start, SETTINGS.pass.out.end, SETTINGS.pass.back.start, SETTINGS.pass.back.end, ...Object.values(SETTINGS.releaseAt), 1];
const near = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual}与${expected}不接近`);

test('三个变体依次转球、拍球、传球，接稳后执行并在约九成进度只交出释放状态', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(variant => samplePetBallPlay(0.5, variant).pattern), ['spin', 'dribble', 'pass', 'spin', 'dribble', 'pass']);
  for (const variant of [0, 1, 2]) {
    const first = samplePetBallPlay(0, variant); const release = samplePetBallPlay(first.releaseAt, variant);
    assert.equal(first.phase, 'gather'); assert.equal(first.released, false);
    assert.equal(samplePetBallPlay(SETTINGS.gatherEnd, variant).phase, 'perform');
    assert.ok(first.releaseAt >= 0.88 && first.releaseAt <= 0.92);
    assert.equal(samplePetBallPlay(first.releaseAt - 1e-8, variant).released, false);
    assert.equal(release.phase, 'release'); assert.equal(release.released, true);
    assert.equal(samplePetBallPlay(1, variant).phase, 'done'); assert.equal(samplePetBallPlay(1, variant).released, true);
    assert.equal(release.ball.right, 1); assert.equal(release.ball.left, 0); assert.equal(release.ball.floor, 0);
  }
});

test('转球始终贴近原掌，偏心不超过0.4个半径，球本体持续自转', () => {
  let previousSpin = 0;
  for (let step = 0; step <= 1000; step += 1) {
    const sample = samplePetBallPlay(step / 1000, 0);
    assert.equal(sample.ball.right, 1); assert.equal(sample.ball.left, 0); assert.equal(sample.ball.floor, 0);
    assert.ok(Math.hypot(sample.ball.orbitX, sample.ball.orbitY, sample.ball.orbitZ) <= 0.4);
    assert.ok(sample.ball.spin >= previousSpin); previousSpin = sample.ball.spin;
  }
  near(previousSpin, SETTINGS.spin.turns * Math.PI * 2);
});

test('拍球有两次真实触地，球到地面才压扁，弹回手后恢复圆形', () => {
  for (const stroke of SETTINGS.dribble.strokes) {
    const start = samplePetBallPlay(stroke.start, 1); const impact = samplePetBallPlay(stroke.impact, 1); const end = samplePetBallPlay(stroke.end, 1);
    assert.equal(start.ball.floor, 0); assert.equal(impact.ball.floor, 1); assert.equal(end.ball.floor, 0);
    assert.equal(impact.ball.right, 0); assert.ok(impact.ball.scaleY < 1); assert.ok(impact.ball.scaleX > 1);
    assert.equal(start.ball.scaleY, 1); assert.equal(end.ball.scaleY, 1);
    assert.ok(samplePetBallPlay((stroke.start + stroke.impact) / 2, 1).ball.floor > 0);
    assert.ok(samplePetBallPlay((stroke.impact + stroke.end) / 2, 1).ball.floor > 0);
  }
});

test('传球明确右手到左手再回来，两段小弧线端点贴手且不经过嘴部', () => {
  const received = samplePetBallPlay(SETTINGS.pass.out.end, 2); const returned = samplePetBallPlay(SETTINGS.pass.back.end, 2);
  assert.equal(received.activeHand, 'left'); assert.equal(received.ball.left, 1); near(received.ball.lift, 0);
  assert.equal(returned.activeHand, 'right'); assert.equal(returned.ball.right, 1); near(returned.ball.lift, 0);
  for (const leg of [SETTINGS.pass.out, SETTINGS.pass.back]) {
    const midpoint = samplePetBallPlay((leg.start + leg.end) / 2, 2);
    near(midpoint.ball.left, 0.5); near(midpoint.ball.right, 0.5);
    assert.ok(midpoint.ball.lift > 0); assert.ok(midpoint.ball.lift <= SETTINGS.pass.lift);
    assert.ok(midpoint.ball.orbitZ > 0); assert.equal(midpoint.ball.floor, 0);
  }
});

test('左右接球镜像一致，全部数值有界，球不会像进食那样缩小或消失', () => {
  for (const variant of [0, 1, 2]) for (let step = 0; step <= 1000; step += 1) {
    const p = step / 1000; const left = samplePetBallPlay(p, variant, 'left'); const right = samplePetBallPlay(p, variant, 'right');
    near(left.ball.left, right.ball.right); near(left.ball.right, right.ball.left); near(left.ball.floor, right.ball.floor);
    near(left.ball.orbitX, -right.ball.orbitX); near(left.ball.spin, -right.ball.spin);
    near(left.pose.left, right.pose.right); near(left.pose.right, right.pose.left);
    for (const value of Object.values(right.ball)) assert.ok(Number.isFinite(value));
    near(right.ball.left + right.ball.right + right.ball.floor, 1);
    assert.ok(right.ball.left >= 0 && right.ball.right >= 0 && right.ball.floor >= 0);
    for (const value of Object.values(right.pose)) assert.ok(value >= 0 && value <= 1);
    for (const scale of [right.ball.scaleX, right.ball.scaleY, right.ball.scaleZ]) assert.ok(scale >= 0.88 && scale <= 1.07);
    assert.equal('mouth' in right.ball, false);
  }
});

test('接稳、压地、换手和释放边界的路径与姿态连续，离散phase和activeHand不参与插值', () => {
  for (const variant of [0, 1, 2]) for (const hand of ['left', 'right'] as PetBallHand[]) for (const boundary of BOUNDARIES) {
    const before = samplePetBallPlay(boundary - 1e-7, variant, hand); const after = samplePetBallPlay(boundary + 1e-7, variant, hand);
    for (const key of Object.keys(before.ball) as (keyof typeof before.ball)[]) near(before.ball[key], after.ball[key], 1e-4);
    for (const key of Object.keys(before.pose) as (keyof typeof before.pose)[]) near(before.pose[key], after.pose[key], 1e-4);
  }
});

test('非法进度与变体有稳定边界，重复采样不积累记忆或产生抛掷事件', () => {
  assert.deepEqual(samplePetBallPlay(Number.NaN, Number.NaN), samplePetBallPlay(0, 0));
  assert.deepEqual(samplePetBallPlay(-Infinity, Infinity), samplePetBallPlay(0, 0));
  assert.deepEqual(samplePetBallPlay(Infinity, 2), samplePetBallPlay(1, 2));
  const initial = samplePetBallPlay(0.55, 2, 'left');
  for (let repeat = 0; repeat < 100; repeat += 1) assert.deepEqual(samplePetBallPlay(0.55, 2, 'left'), initial);
});
