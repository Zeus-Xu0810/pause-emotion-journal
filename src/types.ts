/** 情绪数值是用户自评刻度，不用于诊断。 */
export type MoodScore = 1 | 2 | 3 | 4 | 5;

/** 日记的统一结构：发生时间用于日历，版本号用于冲突保护。 */
export interface MoodEntry {
  id: string;
  mood: MoodScore;
  feelings: string[];
  contexts: string[];
  note: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** 自我关怀类型与完成反馈在各页面保持一致。 */
export type CareKind = 'breathing' | 'mindfulness' | 'music' | 'movement';
export type CareFeedback = 'better' | 'same' | 'unsuitable';
export interface CareSession {
  id: string;
  type: CareKind;
  title: string;
  durationSeconds: number;
  beforeMood: MoodScore | null;
  feedback: CareFeedback;
  entryId: string | null;
  createdAt: string;
}

/** 编辑时携带原版本，避免多设备操作静默覆盖。 */
export type EntryDraft = Pick<MoodEntry, 'mood' | 'feelings' | 'contexts' | 'note' | 'occurredAt'>;
