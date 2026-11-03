import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CARE_SETTINGS as SETTINGS, createPetMemory, respondToPet, type PetEvent, type PetEventKind, type PetMemory, type PetResponse } from '../src/lib/pet-care.ts';

/** 显式推进单调时间，验证真实序列与边界；不启动计时器或任何云服务。 */
function sequence(kinds: readonly PetEventKind[], start = 0, step = SETTINGS.cooldownMs) {
  let memory = createPetMemory(start);
  const responses: PetResponse[] = [];
  kinds.forEach((kind, index) => {
    const next = respondToPet(memory, { kind, at: start + index * step });
    memory = next.memory;
    if (next.response) responses.push(next.response);
  });
  return { memory, responses };
}

test('首个事件立即可用，三口有不同回应，第四口软拒绝且不再增加饱腹', () => {
  const { memory, responses } = sequence(['bite', 'bite', 'bite', 'bite']);
  assert.deepEqual(responses.map(response => response.kind), ['eat', 'eat', 'eat', 'full']);
  assert.deepEqual(responses.slice(0, 3).map(response => response.variant), [0, 1, 2]);
  assert.equal(new Set(responses.slice(0, 3).map(response => response.text)).size, 3);
  assert.ok(memory.satiety <= SETTINGS.maxSatiety && memory.satiety >= SETTINGS.fullThreshold);
  const later = respondToPet(memory, { kind: 'bite', at: memory.lastAt + SETTINGS.cooldownMs });
  assert.equal(later.response?.kind, 'full');
  assert.ok(later.memory.satiety < memory.satiety);
});

test('冷却采用接受事件的时间，忽略的重复输入不会一直延长等待', () => {
  const first = respondToPet(createPetMemory(100), { kind: 'catch', at: 100 });
  for (const at of [100, 101, 100 + SETTINGS.cooldownMs - 1]) {
    const ignored = respondToPet(first.memory, { kind: 'catch', at });
    assert.equal(ignored.memory, first.memory); assert.equal(ignored.response, null);
  }
  const edge = respondToPet(first.memory, { kind: 'catch', at: 100 + SETTINGS.cooldownMs });
  assert.ok(edge.response); assert.equal(edge.memory.sequence, 2);
});

test('喂食中穿插逗玩和安抚，前三口仍有变化，不被全局事件序号锁定同一变体', () => {
  const mixed = sequence(['bite', 'catch', 'soothe', 'bite', 'catch', 'soothe', 'bite']);
  const eating = mixed.responses.filter(response => response.kind === 'eat');
  assert.equal(eating.length, 3); assert.equal(new Set(eating.map(response => response.variant)).size, 3);
});

test('普通逗玩逐渐兴奋，密集时想休息，休息后又能轻松玩', () => {
  const { memory, responses } = sequence(['catch', 'catch', 'catch', 'catch', 'catch']);
  assert.deepEqual(responses.map(response => response.kind), ['play', 'play', 'excited', 'excited', 'tired']);
  const rested = respondToPet(memory, { kind: 'catch', at: memory.lastAt + SETTINGS.excitementDecayMsPerUnit * SETTINGS.maxExcitement });
  assert.equal(rested.response?.kind, 'play'); assert.equal(rested.memory.streak, 1);
  assert.equal(rested.memory.excitement, SETTINGS.catchExcitement);
});

test('普通状态安抚三次入睡，先玩兴奋后需要多安抚，不跳过困倦过程', () => {
  const normal = sequence(['soothe', 'soothe', 'soothe']);
  assert.deepEqual(normal.responses.map(response => response.kind), ['drowsy', 'drowsy', 'asleep']);
  assert.equal(normal.memory.sleeping, true);
  const excited = sequence(['catch', 'catch', 'catch', 'soothe', 'soothe', 'soothe', 'soothe']);
  assert.deepEqual(excited.responses.slice(3).map(response => response.kind), ['drowsy', 'drowsy', 'drowsy', 'asleep']);
});

test('睡着时食物和玩具立刻温柔唤醒，不受冷却阻挡，也不边睡边吃或算作接住', () => {
  const asleep = sequence(['soothe', 'soothe', 'soothe']).memory;
  for (const kind of ['bite', 'catch', 'wake'] as const) {
    const next = respondToPet(asleep, { kind, at: asleep.lastAt + 1 });
    assert.equal(next.response?.kind, 'wake'); assert.equal(next.memory.sleeping, false);
    assert.equal(next.memory.satiety, 0);
    assert.equal(next.memory.excitement, SETTINGS.wakeExcitement);
    assert.equal(next.memory.calm, 0);
  }
  assert.equal(respondToPet(asleep, { kind: 'wake', at: asleep.lastAt - 1 }).response, null);
});

test('清醒时明确唤醒也不受普通冷却阻挡，短时间继续喂食仍遵守普通冷却', () => {
  const play = respondToPet(createPetMemory(0), { kind: 'catch', at: 0 });
  const wake = respondToPet(play.memory, { kind: 'wake', at: 1 });
  assert.equal(wake.response?.kind, 'wake');
  const early = respondToPet(wake.memory, { kind: 'bite', at: 2 });
  assert.equal(early.response, null); assert.equal(early.memory, wake.memory);
  assert.equal(respondToPet(wake.memory, { kind: 'bite', at: 1 + SETTINGS.cooldownMs }).response?.kind, 'eat');
});

test('自然衰减恢复胃口，打断安抚后不会沿用旧的即将入睡状态', () => {
  const full = sequence(['bite', 'bite', 'bite', 'bite']).memory;
  const hungryAgain = respondToPet(full, { kind: 'bite', at: full.lastAt + SETTINGS.satietyDecayMsPerUnit * SETTINGS.maxSatiety });
  assert.equal(hungryAgain.response?.kind, 'eat'); assert.equal(hungryAgain.memory.satiety, SETTINGS.biteSatiety);
  const mixed = sequence(['soothe', 'soothe', 'catch', 'soothe']);
  assert.equal(mixed.responses.at(-1)?.kind, 'drowsy');
  assert.ok(mixed.memory.calm <= SETTINGS.sootheCalm); assert.equal(mixed.memory.streak, 1);
  const calm = sequence(['soothe', 'soothe']).memory;
  const longPause = respondToPet(calm, { kind: 'soothe', at: calm.lastAt + SETTINGS.calmDecayMsPerUnit * SETTINGS.maxCalm });
  assert.equal(longPause.response?.kind, 'drowsy'); assert.equal(longPause.memory.calm, SETTINGS.sootheCalm);
});

test('睡着后继续安抚不会醒来，清醒后重新累积安静而非立即睡回去', () => {
  const asleep = sequence(['soothe', 'soothe', 'soothe']).memory;
  const sleeping = respondToPet(asleep, { kind: 'soothe', at: asleep.lastAt + SETTINGS.cooldownMs });
  assert.equal(sleeping.response?.kind, 'asleep'); assert.equal(sleeping.memory.sleeping, true);
  const wake = respondToPet(sleeping.memory, { kind: 'wake', at: sleeping.memory.lastAt });
  const soothed = respondToPet(wake.memory, { kind: 'soothe', at: wake.memory.lastAt + SETTINGS.cooldownMs });
  assert.equal(soothed.response?.kind, 'drowsy'); assert.equal(soothed.memory.sleeping, false);
});

test('无效和陈旧事件完整忽略，输入对象不被修改', () => {
  const memory = respondToPet(createPetMemory(100), { kind: 'bite', at: 100 }).memory;
  const original = structuredClone(memory);
  for (const event of [{ kind: 'bite', at: Number.NaN }, { kind: 'wake', at: Infinity }, { kind: 'wake', at: -1 }, { kind: 'bite', at: 99 }, { kind: 'wake', at: Number.MAX_VALUE }, { kind: 'unknown', at: 1000 }] as PetEvent[]) {
    const next = respondToPet(memory, event); assert.equal(next.response, null); assert.equal(next.memory, memory);
  }
  respondToPet(memory, { kind: 'catch', at: 100 + SETTINGS.cooldownMs });
  assert.deepEqual(memory, original);
  assert.equal(createPetMemory(Number.NaN).lastAt, 0); assert.equal(createPetMemory(-5).lastAt, 0);
});

test('相同输入确定地产生相同回应，ID递增，强度/时长/三变体均有效', () => {
  const actions: PetEventKind[] = ['bite', 'catch', 'soothe', 'wake', 'bite', 'catch', 'soothe'];
  const first = sequence(actions); const second = sequence(actions);
  assert.deepEqual(first, second);
  assert.deepEqual(first.responses.map(response => response.id), actions.map((_, index) => index + 1));
  for (const response of first.responses) {
    const count = ['play', 'excited', 'tired'].includes(response.kind) ? SETTINGS.ballVariantCount : SETTINGS.variantCount;
    assert.ok(response.variant >= 0 && response.variant < count);
    assert.ok(response.intensity > 0 && response.intensity <= 1);
    assert.equal(response.durationMs, SETTINGS.responses[response.kind].durationMs);
  }
  for (const [kind, content] of Object.entries(SETTINGS.responses)) {
    assert.equal(new Set(content.texts).size, ['play', 'excited', 'tired'].includes(kind) ? SETTINGS.ballVariantCount : SETTINGS.variantCount);
    assert.ok(content.texts.every(text => text.length > 0 && text.length < 30));
  }
});

test('长序列始终有界，没有失败惩罚或无限累积的记忆数值', () => {
  let memory: PetMemory = createPetMemory(0);
  for (let index = 0; index < 400; index += 1) {
    const kind: PetEventKind = index < 150 ? 'catch' : index < 300 ? 'bite' : 'soothe';
    const next = respondToPet(memory, { kind, at: index * SETTINGS.cooldownMs }); memory = next.memory;
    assert.ok(Number.isFinite(memory.satiety) && memory.satiety >= 0 && memory.satiety <= SETTINGS.maxSatiety);
    assert.ok(Number.isFinite(memory.excitement) && memory.excitement >= 0 && memory.excitement <= SETTINGS.maxExcitement);
    assert.ok(Number.isFinite(memory.calm) && memory.calm >= 0 && memory.calm <= SETTINGS.maxCalm);
    assert.ok(memory.streak >= 1 && memory.streak <= SETTINGS.maxStreak);
    assert.ok(next.response);
  }
});

/** 喂食和哄睡使用自己的序号，不能打断球的一轮五套玩法。 */
test('玩球采用独立五套序列，穿插喂食安抚仍不相邻重复', () => {
  const result = sequence(['catch', 'bite', 'soothe', 'catch', 'bite', 'catch', 'soothe', 'catch', 'bite', 'catch', 'catch']);
  const balls = result.responses.filter(r => ['play', 'excited', 'tired'].includes(r.kind));
  assert.deepEqual(balls.map(r => r.variant), [0, 1, 2, 3, 4, 0]);
  assert.equal(result.memory.playSequence, 6);
});
