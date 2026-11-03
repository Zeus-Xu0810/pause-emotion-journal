/** 团子照顾玩法的公共协议；状态只保存在当前页面，不属于日记或账号数据。 */
export type PetActivity = 'feed' | 'tease' | 'sleep';
export type PetEventKind = 'bite' | 'catch' | 'soothe' | 'wake';
export interface PetEvent { kind: PetEventKind; at: number }
export type PetResponseKind = 'eat' | 'full' | 'play' | 'excited' | 'tired' | 'drowsy' | 'asleep' | 'wake';
export interface PetResponse { id: number; kind: PetResponseKind; text: string; intensity: number; variant: number; durationMs: number }
export interface PetMemory { satiety: number; excitement: number; calm: number; sleeping: boolean; lastAt: number; lastEventAt: number; lastKind: PetEventKind | null; sequence: number; playSequence: number; streak: number }
export interface PetPoint { x: number; y: number }
export type PetPropPhase = 'ready' | 'held' | 'flight' | 'contact' | 'playing' | 'cradled' | 'eating' | 'return' | 'responding' | 'sleeping';
export interface PetTargets { phase?: PetPropPhase; leftHand?: PetPoint; rightHand?: PetPoint; prop: { x: number; y: number; radius: number } | null; mouth: PetPoint; hand: PetPoint }
/** 输入坐标来自整个舞台，x向右、y向下且范围[-1,1]。 */
export interface PetInput { type: 'start' | 'move' | 'release' | 'activate' | 'cancel'; point?: PetPoint; velocity?: PetPoint }

/** 可调节的互动节奏、记忆衰减与回应集中于此；时间全部使用单调毫秒。 */
export const PET_CARE_SETTINGS = {
  cooldownMs: 650,
  streakWindowMs: 8000,
  maxStreak: 8,
  maxSatiety: 3,
  satietyDecayMsPerUnit: 45000,
  fullThreshold: 2.5,
  biteSatiety: 1,
  maxExcitement: 6,
  excitementDecayMsPerUnit: 7000,
  catchExcitement: 1,
  excitedThreshold: 2.5,
  tiredThreshold: 4.4,
  tiredMinimumStreak: 5,
  maxCalm: 6,
  calmDecayMsPerUnit: 18000,
  sootheCalm: 1,
  sootheExcitementReduction: 0.55,
  sleepCalmThreshold: 2.7,
  sleepExcitementMaximum: 0.65,
  wakeExcitement: 0.25,
  variantCount: 3,
  ballVariantCount: 5,
  variantIntensityStep: 0.045,
  responses: {
    eat: { durationMs: 1600, intensity: 0.55, texts: ['啊呜，甜甜的', '再来一小口', '这一口慢慢嚼'] },
    full: { durationMs: 1900, intensity: 0.3, texts: ['肚子圆圆啦，留一点下次吃', '吃饱啦，陪我坐会儿', '这口先替我收好嘛'] },
    play: { durationMs: 1900, intensity: 0.5, texts: ['看我转个小圈圈', '掌心轻轻拍拍', '左手右手，都接住啦', '软软的球，捏一捏', '稳稳托住，不掉下来'] },
    excited: { durationMs: 2200, intensity: 0.75, texts: ['转起来啦，嘿', '轻轻弹，接住啦', '传给另一只小手', '捏捏软球，嘿嘿', '小球在掌心摇摇'] },
    tired: { durationMs: 2500, intensity: 0.35, texts: ['慢慢转一圈就好', '轻轻拍两下就歇会儿', '慢慢传，我接得住', '抱着软球歇一会儿', '慢慢摇，我托着呢'] },
    drowsy: { durationMs: 2100, intensity: 0.4, texts: ['嗯，轻轻摸就好', '眼皮有点沉啦', '再陪我安静一会儿'] },
    asleep: { durationMs: 4800, intensity: 0.25, texts: ['呼……睡一小会儿', '抱着软软的梦睡啦', '我先眯一下，就在这里'] },
    wake: { durationMs: 1800, intensity: 0.45, texts: ['嗯？我醒啦', '伸个懒腰，看到你啦', '醒来先靠你近一点'] },
  } satisfies Record<PetResponseKind, { durationMs: number; intensity: number; texts: readonly string[] }>,
};

const bounded = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));
const validTime = (at: number) => Number.isFinite(at) && at >= 0 && at <= Number.MAX_SAFE_INTEGER;

/** 创建新的页面记忆；首个事件立即可用，非法起始时间回到安全的零点。 */
export function createPetMemory(at: number): PetMemory {
  const start = validTime(at) ? at : 0;
  return { satiety: 0, excitement: 0, calm: 0, sleeping: false, lastAt: start, lastEventAt: start - PET_CARE_SETTINGS.cooldownMs, lastKind: null, sequence: 0, playSequence: 0, streak: 0 };
}

/** 衰减按真实经过时间计算，与调用频率无关；不会修改调用方保留的上一份记忆。 */
function decayMemory(memory: PetMemory, at: number): PetMemory {
  const elapsed = at - memory.lastAt;
  return {
    ...memory,
    satiety: bounded(memory.satiety - elapsed / PET_CARE_SETTINGS.satietyDecayMsPerUnit, PET_CARE_SETTINGS.maxSatiety),
    excitement: bounded(memory.excitement - elapsed / PET_CARE_SETTINGS.excitementDecayMsPerUnit, PET_CARE_SETTINGS.maxExcitement),
    calm: bounded(memory.calm - elapsed / PET_CARE_SETTINGS.calmDecayMsPerUnit, PET_CARE_SETTINGS.maxCalm),
  };
}

/** 回应保留稳定ID；玩球用独立五套序列，喂食/哄睡穿插不会造成相邻重播。 */
function responseFor(memory: PetMemory, kind: PetResponseKind): PetResponse {
  const content = PET_CARE_SETTINGS.responses[kind];
  // 进食按尚记得的几口轮换，插入摸摸或逗玩也不会让前三口碰巧全用同一种回应。
  const isBall = kind === 'play' || kind === 'excited' || kind === 'tired';
  const variant = isBall ? Math.max(0, memory.playSequence - 1) % PET_CARE_SETTINGS.ballVariantCount : kind === 'eat'
    ? Math.max(0, Math.round(memory.satiety / PET_CARE_SETTINGS.biteSatiety) - 1) % PET_CARE_SETTINGS.variantCount
    : (memory.sequence - 1) % PET_CARE_SETTINGS.variantCount;
  return { id: memory.sequence, kind, text: content.texts[variant], variant, durationMs: content.durationMs, intensity: bounded(content.intensity + variant * PET_CARE_SETTINGS.variantIntensityStep, 1) };
}

/** 照顾事件只推进内存状态；冷却/陈旧事件完整忽略，避免重复输入拖长等待。 */
export function respondToPet(memory: PetMemory, event: PetEvent): { memory: PetMemory; response: PetResponse | null } {
  if (!event || !['bite', 'catch', 'soothe', 'wake'].includes(event.kind) || !validTime(event.at) || event.at < memory.lastAt) return { memory, response: null };
  // 明确唤醒，以及睡着时被食物/玩具碰到都立即醒来，不能被普通互动冷却挡住。
  const waking = event.kind === 'wake' || (memory.sleeping && (event.kind === 'bite' || event.kind === 'catch'));
  if (!waking && event.at - memory.lastEventAt < PET_CARE_SETTINGS.cooldownMs) return { memory, response: null };
  const next = decayMemory(memory, event.at);
  next.lastAt = event.at; next.lastEventAt = event.at; next.sequence += 1;
  next.streak = memory.lastKind === event.kind && event.at - memory.lastEventAt <= PET_CARE_SETTINGS.streakWindowMs ? Math.min(memory.streak + 1, PET_CARE_SETTINGS.maxStreak) : 1;
  next.lastKind = event.kind;
  let kind: PetResponseKind;
  if (waking) {
    // 这一拍只醒来，不偷偷算作吃一口或抓一次，下一次再继续玩。
    next.sleeping = false; next.calm = 0; next.excitement = PET_CARE_SETTINGS.wakeExcitement; next.streak = 1;
    kind = 'wake';
  } else if (next.sleeping) {
    next.calm = Math.max(next.calm, PET_CARE_SETTINGS.sleepCalmThreshold);
    kind = 'asleep';
  } else if (event.kind === 'bite') {
    kind = next.satiety >= PET_CARE_SETTINGS.fullThreshold ? 'full' : 'eat';
    if (kind === 'eat') next.satiety = bounded(next.satiety + PET_CARE_SETTINGS.biteSatiety, PET_CARE_SETTINGS.maxSatiety);
    next.calm = 0;
  } else if (event.kind === 'catch') {
    next.playSequence += 1;
    next.excitement = bounded(next.excitement + PET_CARE_SETTINGS.catchExcitement, PET_CARE_SETTINGS.maxExcitement);
    next.calm = 0;
    kind = next.streak >= PET_CARE_SETTINGS.tiredMinimumStreak && next.excitement >= PET_CARE_SETTINGS.tiredThreshold ? 'tired' : next.excitement >= PET_CARE_SETTINGS.excitedThreshold ? 'excited' : 'play';
  } else {
    next.calm = bounded(next.calm + PET_CARE_SETTINGS.sootheCalm, PET_CARE_SETTINGS.maxCalm);
    next.excitement = bounded(next.excitement - PET_CARE_SETTINGS.sootheExcitementReduction, PET_CARE_SETTINGS.maxExcitement);
    next.sleeping = next.calm >= PET_CARE_SETTINGS.sleepCalmThreshold && next.excitement <= PET_CARE_SETTINGS.sleepExcitementMaximum;
    kind = next.sleeping ? 'asleep' : 'drowsy';
  }
  return { memory: next, response: responseFor(next, kind) };
}
