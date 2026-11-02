import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlayTime, pointInBoard, storedPlaySeconds } from '../src/lib/play.ts';
import { STAR_PATTERNS, STAR_SETTINGS } from '../src/play-content.ts';

/** 自由活动没有强制结束，只有上传秒数遵守既有规则边界。 */
test('完成记录保留秒数分辨率并限制在既有1—3600范围', () => {
  assert.equal(storedPlaySeconds(230), 1);
  assert.equal(storedPlaySeconds(1999), 1);
  assert.equal(storedPlaySeconds(61000), 61);
  assert.equal(storedPlaySeconds(4_200_000), 3600);
  assert.equal(formatPlayTime(4_200_000), '70:00');
});

/** 不同视口与DPR只改变纸面显示尺寸，不应改变归一化输入位置。 */
test('触屏和鼠标坐标在不同画布尺寸下对应同一内容位置', () => {
  const small = pointInBoard(210, 140, { left: 10, top: 20, width: 400, height: 240 }, 1000, 600);
  const large = pointInBoard(810, 500, { left: 10, top: 20, width: 1600, height: 960 }, 1000, 600);
  assert.deepEqual(small, { x: 500, y: 300 });
  assert.deepEqual(large, small);
  assert.deepEqual(pointInBoard(-50, 500, { left: 0, top: 0, width: 300, height: 180 }, 1000, 600), { x: 0, y: 600 });
});

/** 图案必须全部可达，不能因重复点或出界目标而卡在无法完成的状态。 */
test('八个指定图案有唯一标识、有效顺序和舞台内可达星点', () => {
  assert.deepEqual(STAR_PATTERNS.map(pattern => pattern.title), ['心', '月', '叶', '星', '云', '鲸', '猫', '兔']);
  assert.equal(new Set(STAR_PATTERNS.map(pattern => pattern.id)).size, 8);
  for (const pattern of STAR_PATTERNS) {
    assert.ok(pattern.points.length >= 5);
    for (let index = 0; index < pattern.points.length; index += 1) {
      const [x, y] = pattern.points[index];
      assert.ok(x >= STAR_SETTINGS.hitRadius && x <= STAR_SETTINGS.width - STAR_SETTINGS.hitRadius);
      assert.ok(y >= STAR_SETTINGS.hitRadius && y <= STAR_SETTINGS.height - STAR_SETTINGS.hitRadius);
      if (index) assert.notDeepEqual(pattern.points[index], pattern.points[index - 1]);
    }
  }
});
