import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/lib/playDrawing.ts';
import { DRAWING_SETTINGS } from '../src/play-content.ts';

/** 测试笔画使用独立点数组，便于验证提交后不被活动指针继续修改。 */
const stroke = (): store.DrawingStroke => ({ points: [{ x: 100, y: 150 }], color: DRAWING_SETTINGS.colors[0], width: 5, opacity: 1, brush: 'pen' });

/** 复现账号切换后旧画布清理仍读取数据的顺序，读取不得重新认领所有者。 */
test('旧账号的延迟读取和提交不会清空新账号画作', () => {
  store.selectDrawingOwner('old-owner');
  store.appendDrawingStroke('old-owner', stroke());
  store.selectDrawingOwner('new-owner');
  store.appendDrawingStroke('new-owner', stroke());
  assert.equal(store.getOwnedDrawing('old-owner'), null);
  store.appendDrawingStroke('old-owner', stroke());
  store.clearDrawing('old-owner');
  store.undoDrawing('old-owner');
  store.redoDrawing('old-owner');
  assert.equal(store.getOwnedDrawing('new-owner')?.strokes.length, 1);
  assert.equal(store.getOwnedDrawing('new-owner')?.past.length, 1);
});

/** 同一账号重新进入路由继续原画作，切换账号才释放旧文档。 */
test('同一账号重选保留画作，换账号后旧文档不可读', () => {
  store.selectDrawingOwner('route-owner');
  store.appendDrawingStroke('route-owner', stroke());
  assert.equal(store.selectDrawingOwner('route-owner').strokes.length, 1);
  assert.equal(store.selectDrawingOwner('another-owner').strokes.length, 0);
  assert.equal(store.getOwnedDrawing('route-owner'), null);
});

/** 清空也是可撤销命令；撤销后新落笔会正确丢弃已分叉的重做历史。 */
test('清空可以撤销和重做，新笔画会结束旧重做分支', () => {
  const key = 'history-owner';
  store.selectDrawingOwner(key);
  store.appendDrawingStroke(key, stroke());
  store.clearDrawing(key);
  assert.equal(store.getOwnedDrawing(key)?.strokes.length, 0);
  store.undoDrawing(key);
  assert.equal(store.getOwnedDrawing(key)?.strokes.length, 1);
  store.redoDrawing(key);
  assert.equal(store.getOwnedDrawing(key)?.strokes.length, 0);
  store.undoDrawing(key);
  store.appendDrawingStroke(key, stroke());
  assert.equal(store.getOwnedDrawing(key)?.strokes.length, 2);
  assert.equal(store.getOwnedDrawing(key)?.future.length, 0);
});

/** 提交保存点快照，仍在移动的原输入数组不能污染撤销历史。 */
test('已提交笔画与外部点数组隔离，画作和历史都有容量上限', () => {
  const key = 'bounded-owner';
  store.selectDrawingOwner(key);
  const input = stroke();
  store.appendDrawingStroke(key, input);
  input.points[0].x = 900;
  input.points.push({ x: 500, y: 400 });
  assert.deepEqual(store.getOwnedDrawing(key)?.strokes[0].points, [{ x: 100, y: 150 }]);
  for (let i = 0; i < DRAWING_SETTINGS.maxStrokes + 5; i += 1) store.appendDrawingStroke(key, stroke());
  assert.equal(store.getOwnedDrawing(key)?.strokes.length, DRAWING_SETTINGS.maxStrokes);
  assert.equal(store.getOwnedDrawing(key)?.past.length, DRAWING_SETTINGS.maxHistory);
});
