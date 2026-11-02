import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASCOT_ACTIONS, MASCOT_EXPRESSIONS, MASCOT_REPLIES } from '../src/mascot-content.ts';
import { createMascotDeck, isMascotTap } from '../src/lib/mascot-deck.ts';

/** 内容数量、长度与动作契约必须真实满足一百种回复，不用重复句子充数。 */
test('一百条回复均唯一、简短且绑定有效动作与表情', () => {
  assert.equal(MASCOT_REPLIES.length, 100);
  assert.equal(new Set(MASCOT_REPLIES.map(reply => reply.id)).size, 100);
  assert.equal(new Set(MASCOT_REPLIES.map(reply => reply.text)).size, 100);
  for (const reply of MASCOT_REPLIES) {
    assert.ok([...reply.text].length >= 6 && [...reply.text].length <= 20, reply.text);
    assert.ok(MASCOT_ACTIONS.includes(reply.action));
    assert.ok(MASCOT_EXPRESSIONS.includes(reply.expression));
    assert.ok(reply.durationMs >= 500 && reply.durationMs <= 1500);
  }
  assert.equal(new Set(MASCOT_REPLIES.map(reply => reply.action)).size, 12);
});

/** 固定随机源仍需在每轮抽尽全部内容，且跨轮不会产生相邻重复。 */
test('连续十轮各一百条无重复，轮次边界不相邻重复', () => {
  for (const random of [() => 0, () => 0.999999999, () => 0.5]) {
    const deck = createMascotDeck(MASCOT_REPLIES, random);
    let lastId: string | null = null;
    for (let round = 0; round < 10; round += 1) {
      const ids = Array.from({ length: 100 }, () => deck.draw().id);
      assert.equal(new Set(ids).size, 100);
      assert.notEqual(ids[0], lastId);
      lastId = ids.at(-1)!;
    }
  }
});

/** 防止抽取改变原始内容顺序；小型素材集也应保持边界行为正确。 */
test('不修改源列表，并正确处理一个和两个回复', () => {
  const original = MASCOT_REPLIES.map(reply => reply.id);
  const deck = createMascotDeck(MASCOT_REPLIES, () => 0.1);
  for (let index = 0; index < 205; index += 1) deck.draw();
  assert.deepEqual(MASCOT_REPLIES.map(reply => reply.id), original);
  const pair = createMascotDeck(MASCOT_REPLIES.slice(0, 2), () => 0);
  let previous = pair.draw().id;
  for (let index = 0; index < 10; index += 1) { const next = pair.draw().id; assert.notEqual(next, previous); previous = next; }
  const single = createMascotDeck(MASCOT_REPLIES.slice(0, 1));
  assert.equal(single.draw().id, single.draw().id);
  assert.throws(() => createMascotDeck([]));
});

/** 位移、长按和系统取消都不能误触，键盘不受历史指针状态影响。 */
test('轻触接受短按，拒绝滚动长按与取消，保留键盘激活', () => {
  const tap = { keyboard: false, cancelled: false, travelPixels: 3, durationMs: 130 };
  assert.equal(isMascotTap(tap), true);
  assert.equal(isMascotTap({ ...tap, travelPixels: 11 }), false);
  assert.equal(isMascotTap({ ...tap, durationMs: 651 }), false);
  assert.equal(isMascotTap({ ...tap, cancelled: true }), false);
  assert.equal(isMascotTap({ keyboard: true, cancelled: true, travelPixels: 100, durationMs: 5000 }), true);
});
