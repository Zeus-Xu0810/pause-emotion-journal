import test from 'node:test';
import assert from 'node:assert/strict';
import { MASCOT_GESTURE_EXPRESSIONS, MASCOT_GESTURE_REPLIES, MASCOT_INTERACTION_SETTINGS as SETTINGS, MASCOT_MODE_HINTS } from '../src/mascot-interaction-content.ts';
import { cancelGesture, defaultHitForGesture, finishGesture, finishPinch, flushTap, keyboardGesture, moveGesture, movePinch, registerTap, startGesture, startPinch, tickGesture } from '../src/lib/mascot-gestures.ts';
import type { MascotMode, MascotRegion } from '../src/lib/mascot-interaction-types.ts';

/** 输入均为CSS像素与单调毫秒，测试不依赖DOM、Three或浏览器定时器。 */
const begin = (region: MascotRegion | null = 'body', mode: MascotMode = 'auto', pointerType = 'mouse') => startGesture({ mode, region, start: { x: 100, y: 100 }, at: 0, pointerType });
const tap = (region: MascotRegion = 'body', at = 0, x = 100) => ({ region, point: { x, y: 100 }, at, kind: region === 'head' ? 'pat' as const : 'poke' as const });

test('空白、显式取消和已结束输入都不会复活为轻触', () => {
  const blank = begin(null);
  assert.equal(blank.cancelled, true);
  assert.equal(finishGesture(blank, { x: 100, y: 100 }, 20).hasInteraction, false);
  const cancelled = cancelGesture(moveGesture(begin(), { x: 125, y: 100 }, 50));
  assert.equal(cancelled.kind, null);
  assert.equal(cancelled.claimed, false);
  assert.equal(finishGesture(cancelled, { x: 100, y: 100 }, 100).tapPending, false);
  const finished = finishGesture(begin(), { x: 100, y: 100 }, 100);
  assert.equal(moveGesture(finished, { x: 180, y: 100 }, 200), finished);
});
test('短按的时间和位移上界可接受，超时区间不误判成长按或poke', () => {
  const edge = finishGesture(begin(), { x: 108, y: 100 }, SETTINGS.tapMaximumMs);
  assert.equal(edge.kind, 'poke'); assert.equal(edge.tapPending, true);
  const hold = finishGesture(begin(), { x: 100, y: 100 }, SETTINGS.tapMaximumMs + 1);
  assert.equal(hold.hasInteraction, false); assert.equal(hold.tapPending, false);
});
test('头部短按为pat，左右手短按为wave，脸和身体短按保持poke', () => {
  for (const [region, expected] of [['head', 'pat'], ['hand-left', 'wave'], ['hand-right', 'wave'], ['cheek-left', 'poke'], ['body', 'poke']] as const) assert.equal(finishGesture(begin(region), { x: 100, y: 100 }, 80).kind, expected);
});
test('长按阈值精确区分：脸捏、身体和肚皮抓取，手不会凭空触发', () => {
  assert.equal(tickGesture(begin('cheek-left'), SETTINGS.longPressMs - 1).kind, null);
  assert.equal(tickGesture(begin('cheek-left'), SETTINGS.longPressMs).kind, 'pinch');
  assert.equal(tickGesture(begin('body'), SETTINGS.longPressMs).kind, 'drag');
  assert.equal(tickGesture(begin('hand-left'), SETTINGS.longPressMs).kind, null);
  assert.equal(tickGesture(begin('belly'), SETTINGS.longPressMs).kind, 'drag');
  assert.equal(tickGesture(begin('cheek-left', 'poke'), SETTINGS.longPressMs).kind, null);
  const delayedTimer = finishGesture(begin('cheek-right'), { x: 100, y: 100 }, SETTINGS.longPressMs + 20);
  assert.equal(delayedTimer.kind, 'pinch'); assert.equal(delayedTimer.tapPending, false);
});
test('曾走出短按范围再回原位，不会退化为轻触', () => {
  const moved = moveGesture(begin('head'), { x: 120, y: 100 }, 60);
  const released = finishGesture(moved, { x: 100, y: 100 }, 120);
  assert.equal(released.tapPending, false);
  assert.equal(released.maxTravel, 20);
});
test('拉脸直接pinch，头顶横摸纵拖，手不会误拖整体；显式drag也不会拉走脸', () => {
  assert.equal(moveGesture(begin('cheek-right'), { x: 130, y: 100 }, 80).kind, 'pinch');
  assert.equal(moveGesture(begin('head'), { x: 130, y: 100 }, 80).kind, 'pat');
  assert.equal(moveGesture(begin('head'), { x: 100, y: 130 }, 80).kind, 'drag');
  assert.equal(moveGesture(begin('head', 'drag'), { x: 130, y: 100 }, 80).kind, 'drag');
  assert.equal(moveGesture(begin('hand-left'), { x: 130, y: 100 }, 80).kind, null);
  assert.equal(moveGesture(begin('cheek-left', 'drag'), { x: 130, y: 100 }, 80).kind, null);
});
test('auto触屏纵移先交还滚动，阈值前不抢拖拽，取消后永久抑制up', () => {
  const pending = moveGesture(begin('body', 'auto', 'touch'), { x: 100, y: 109 }, 50);
  assert.equal(pending.claimed, false);
  const scroll = moveGesture(pending, { x: 100, y: 110 }, 70);
  assert.equal(scroll.cancelled, true);
  assert.equal(moveGesture(scroll, { x: 170, y: 110 }, 100).hasInteraction, false);
  assert.equal(finishGesture(scroll, { x: 100, y: 100 }, 150).tapPending, false);
});
test('auto纵向滚动能取消长按；显式drag在目标内可以纵向移动', () => {
  const claimed = tickGesture(begin('body', 'auto', 'touch'), SETTINGS.longPressMs);
  assert.equal(claimed.kind, 'drag');
  assert.equal(moveGesture(claimed, { x: 100, y: 120 }, 500).cancelled, true);
  const explicit = moveGesture(begin('body', 'drag', 'touch'), { x: 100, y: 145 }, 80);
  assert.equal(explicit.kind, 'drag'); assert.equal(explicit.dy, 45); assert.equal(explicit.cancelled, false);
});
test('摸头一笔即可，肚皮先拖动后挠痒，微颤不会冒充抚摸', () => {
  assert.equal(moveGesture(begin('head'), { x: 130, y: 100 }, 100).kind, 'pat');
  let belly = moveGesture(begin('belly'), { x: 130, y: 100 }, 100);
  assert.equal(belly.kind, 'drag');
  belly = moveGesture(belly, { x: 100, y: 100 }, 200);
  assert.equal(belly.kind, 'drag');
  belly = moveGesture(belly, { x: 130, y: 100 }, 300);
  assert.equal(belly.kind, 'tickle');
  assert.equal(moveGesture(belly, { x: 135, y: 100 }, SETTINGS.scrubMaximumMs + 1000).kind, 'tickle');
  let jitter = begin('head');
  [108, 101, 109, 100, 108].forEach((x, index) => { jitter = moveGesture(jitter, { x, y: 100 }, 40 + index * 35); });
  assert.equal(jitter.kind, null);
});

test('直接拖动保留独立门槛，身体肚皮不等长按，脸颊只拉脸', () => {
  for (const region of ['body', 'belly'] as const) {
    const pending = moveGesture(begin(region), { x: 100 + SETTINGS.dragStartDistance - 1, y: 100 }, 40);
    assert.equal(pending.hasInteraction, false);
    const drag = moveGesture(pending, { x: 100 + SETTINGS.dragStartDistance, y: 100 }, 60);
    assert.equal(drag.kind, 'drag'); assert.equal(drag.dx, SETTINGS.dragStartDistance);
    assert.ok(drag.strength >= SETTINGS.dragMinimumStrength);
  }
  assert.equal(moveGesture(begin('cheek-left'), { x: 100 + SETTINGS.faceDragStartDistance - 1, y: 100 }, 40).hasInteraction, false);
  assert.equal(moveGesture(begin('cheek-left'), { x: 100 + SETTINGS.faceDragStartDistance, y: 100 }, 60).kind, 'pinch');
});

test('头顶抚摸的微移边界与方向选择明确，确认后不在抚摸和拖动间来回闪烁', () => {
  assert.equal(moveGesture(begin('head'), { x: 100 + SETTINGS.headStrokeStartDistance - 1, y: 100 }, 50).hasInteraction, false);
  const pat = moveGesture(begin('head'), { x: 100 + SETTINGS.headStrokeStartDistance, y: 100 }, 70);
  assert.equal(pat.kind, 'pat');
  assert.equal(moveGesture(pat, { x: 100, y: 140 }, 100).kind, 'pat');
  const drag = moveGesture(begin('head'), { x: 101, y: 100 + SETTINGS.dragStartDistance }, 50);
  assert.equal(drag.kind, 'drag');
  assert.equal(moveGesture(drag, { x: 130, y: 105 }, 100).kind, 'pat');
});

test('auto肚皮和头顶触屏纵向始终让行，横向可以直接拖动或抚摸', () => {
  for (const region of ['head', 'belly'] as const) {
    const scroll = moveGesture(begin(region, 'auto', 'touch'), { x: 101, y: 125 }, 80);
    assert.equal(scroll.cancelled, true); assert.equal(finishGesture(scroll, { x: 130, y: 125 }, 120).hasInteraction, false);
  }
  assert.equal(moveGesture(begin('belly', 'auto', 'touch'), { x: 120, y: 101 }, 60).kind, 'drag');
  assert.equal(moveGesture(begin('head', 'auto', 'touch'), { x: 120, y: 101 }, 60).kind, 'pat');
});
test('快左右往返身体才shake，慢拖仍为drag，显式模式不意外升级', () => {
  let fast = begin();
  [130, 90, 130].forEach((x, index) => { fast = moveGesture(fast, { x, y: 100 }, 100 + index * 80); });
  assert.equal(fast.kind, 'shake'); assert.ok(fast.strength <= 1);
  let slow = begin();
  [130, 90, 130].forEach((x, index) => { slow = moveGesture(slow, { x, y: 100 }, 100 + index * 800); });
  assert.equal(slow.kind, 'drag');
  let explicit = begin('body', 'drag');
  [130, 90, 130].forEach((x, index) => { explicit = moveGesture(explicit, { x, y: 100 }, 100 + index * 80); });
  assert.equal(explicit.kind, 'drag');
});
test('同区域近距双击只bounce，旧timer刷新不会再poke', () => {
  const first = registerTap(null, tap());
  assert.equal(first.kind, null); assert.ok(first.pending);
  const second = registerTap(first.pending, tap('body', SETTINGS.doubleTapMaximumMs, 122));
  assert.equal(second.kind, 'bounce'); assert.equal(second.pending, null);
  assert.equal(flushTap(second.pending, 1000).kind, null);
});
test('单击先等待；跨区域、超距离和超时都不会误判双击', () => {
  const first = registerTap(null, tap());
  assert.equal(flushTap(first.pending, SETTINGS.doubleTapMaximumMs - 1).kind, null);
  assert.equal(flushTap(first.pending, SETTINGS.doubleTapMaximumMs).kind, 'poke');
  for (const other of [tap('head', 100), tap('body', 100, 123), tap('body', 301)]) {
    const result = registerTap(first.pending, other);
    assert.equal(result.kind, 'poke'); assert.ok(result.pending);
  }
});
test('旧指针取消不污染键盘，按键repeat不产生第二次激活', () => {
  const oldPointer = cancelGesture(begin());
  assert.equal(oldPointer.hasInteraction, false);
  assert.equal(keyboardGesture('auto', 'head'), 'pat');
  assert.equal(keyboardGesture('auto', 'hand-right'), 'wave');
  assert.equal(keyboardGesture('pinch'), 'pinch');
  assert.equal(keyboardGesture('drag', null, true), null);
});

/** 双指序列一旦混入第三指或松开一指就取消，不能把幸存手指当成新短按。 */
const beginPinch = (mode: MascotMode = 'pinch', regions: readonly [MascotRegion | null, MascotRegion | null] = ['cheek-left', 'cheek-right']) => startPinch({ mode, regions, points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], at: 0 });
test('只有显式pinch和双脸颊接受双指，auto保留系统缩放', () => {
  assert.equal(beginPinch('auto').cancelled, true);
  assert.equal(beginPinch('pinch', ['cheek-left', 'body']).cancelled, true);
  const state = beginPinch();
  assert.equal(state.cancelled, false); assert.equal(state.claimed, true); assert.equal(state.hasInteraction, false);
});
test('双指初始距离、位移和相对比例共同滤除噪声', () => {
  assert.equal(startPinch({ mode: 'pinch', regions: ['cheek-left', 'cheek-right'], points: [{ x: 0, y: 0 }, { x: 23, y: 0 }], at: 0 }).cancelled, true);
  assert.equal(movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 204, y: 100 }], 50).hasInteraction, false);
  const edge = movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 208, y: 100 }], 80);
  assert.equal(edge.kind, 'pinch'); assert.equal(edge.pinchScale, 1.08);
});
test('双指取消不恢复，比例限制避免零尺度或过度形变', () => {
  const third = movePinch(beginPinch(), [{ x: 90, y: 100 }, { x: 220, y: 100 }], 80, 3);
  assert.equal(third.cancelled, true);
  assert.equal(movePinch(third, [{ x: 95, y: 100 }, { x: 225, y: 100 }], 100).hasInteraction, false);
  assert.equal(movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 200, y: 100 }], 80, 1).cancelled, true);
  assert.equal(movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 1100, y: 100 }], 80).pinchScale, SETTINGS.pinchMaximumScale);
  assert.equal(movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 101, y: 100 }], 80).pinchScale, SETTINGS.pinchMinimumScale);
});
test('双指抬起只结束既有pinch，不把剩余单指的位置当成新的拉脸或tap', () => {
  const idlePair = beginPinch();
  const idleUp = finishGesture(idlePair, { x: 100, y: 100 }, 100);
  assert.equal(idleUp.kind, null); assert.equal(idleUp.tapPending, false);
  const changed = movePinch(beginPinch(), [{ x: 100, y: 100 }, { x: 230, y: 100 }], 80);
  assert.equal(finishPinch(changed).kind, 'pinch');
  assert.equal(finishGesture(changed, { x: 100, y: 100 }, 100).dx, changed.dx);
});
test('函数不修改输入，陈旧或非有限采样不会制造动作', () => {
  const state = begin('head'); const original = structuredClone(state);
  const moved = moveGesture(state, { x: 120, y: 100 }, 50);
  assert.deepEqual(state, original);
  assert.equal(moveGesture(moved, { x: 180, y: 100 }, 40), moved);
  assert.equal(moveGesture(state, { x: Number.NaN, y: 100 }, 10).cancelled, true);
  const pending = registerTap(null, tap('body', 100)).pending;
  assert.deepEqual(registerTap(pending, tap('body', 90)), { pending, kind: null });
  assert.equal(flushTap(pending, Number.NaN).kind, null);
});
test('全部手势有短回复和表情，模式提示及后备命中完整', () => {
  assert.deepEqual(Object.keys(MASCOT_GESTURE_REPLIES).sort(), ['bounce', 'drag', 'pat', 'pinch', 'poke', 'shake', 'tickle', 'wave']);
  for (const [kind, replies] of Object.entries(MASCOT_GESTURE_REPLIES)) { assert.equal(replies.length, 3); assert.ok(replies.every(reply => reply.length > 0 && reply.length < 30)); assert.ok(kind in MASCOT_GESTURE_EXPRESSIONS); }
  assert.equal(Object.keys(MASCOT_MODE_HINTS).length, 6);
  assert.equal(defaultHitForGesture('pinch').region, 'cheek-left');
  assert.equal(defaultHitForGesture('pat').region, 'head');
  assert.equal(defaultHitForGesture('tickle').region, 'belly');
  assert.equal(defaultHitForGesture('wave').region, 'hand-right');
});
