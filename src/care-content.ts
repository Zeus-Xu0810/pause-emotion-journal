import type { CareFeedback, CareKind } from './types';

/** 关怀内容与可调整的输入设置集中维护；呼吸节奏统一读取主 config。 */
export const CARE_SETTINGS = {
  minimumRecordSeconds: 10,
  tickMilliseconds: 100,
  initialVolume: 0.35,
  musicMinutes: [3, 5, 10],
  mindfulnessMinutes: 3,
  stretchMinutes: 5,
  walkMinutes: 10,
};

/** 合成音输入设置同样集中于内容配置，主音量衰减避免多声源叠加过响。 */
export const AUDIO_SETTINGS = {
  masterLevel: 0.19,
  bufferSeconds: 5,
  chordFrequencies: [130.8128, 195.9977, 246.9417, 329.6276],
  chordVoiceLevel: 0.12,
  rainLowpassHz: 6500,
  waveLowpassHz: 700,
};

/** 四种练习的真实操作入口，不将任何练习承诺为治疗。 */
export const CARE_KINDS: { kind: CareKind; label: string; title: string; intro: string }[] = [
  { kind: 'breathing', label: '呼吸', title: '缓缓呼吸', intro: '跟着自己的节奏。' },
  { kind: 'mindfulness', label: '正念', title: '回到此刻', intro: '给注意力一点空间。' },
  { kind: 'music', label: '声音', title: '听一会儿', intro: '选一个喜欢的声音。' },
  { kind: 'movement', label: '活动', title: '轻轻活动', intro: '在舒服的范围里动一动。' },
];

/** 正念分为三个可追踪阶段，暂停时阶段也同步停留。 */
export const MINDFUL_STEPS = [
  { title: '找到支点', text: '双脚落地，感受身体被稳稳托住。', detail: '可以睁着眼。' },
  { title: '听见此刻', text: '听一听，远处和近处的声音。', detail: '走神了，再回来。' },
  { title: '慢慢回来', text: '留意一次呼吸，再看看周围。', detail: '轻轻动动手指。' },
];

/** 运动引导不包含高强度动作；不适时可以立即停止。 */
export const MOVEMENT_STEPS = {
  stretch: [
    { title: '安顿身体', text: '坐稳或站稳，轻轻活动手指与脚踝。' },
    { title: '放下肩膀', text: '缓慢抬肩、放松，再轻轻向后绕圈。' },
    { title: '打开手臂', text: '双臂前伸，再缓慢打开。' },
    { title: '松动双腿', text: '扶稳椅背，交替提脚跟；或坐着轻伸腿。' },
    { title: '回到日常', text: '自然站好或坐好，感受此刻的身体。' },
  ],
  walk: [
    { title: '选一条路', text: '在平坦、熟悉的路上慢走，室内也可以。' },
    { title: '自己的步速', text: '按能轻松说话的速度前行。' },
    { title: '看看周围', text: '留意三种颜色和一个声音。' },
    { title: '放松肩膀', text: '松开下颌，让手臂自然摆动。累了就停。' },
    { title: '慢慢停下', text: '放慢脚步，找个舒服的位置停下。' },
  ],
};

/** 所有声景均在设备上合成，不加载第三方歌曲或远程音频。 */
export const SOUND_OPTIONS = [
  { id: 'chords', label: '和弦', subtitle: '绵长', title: '缓缓和弦' },
  { id: 'rain', label: '雨声', subtitle: '细密', title: '窗边小雨' },
  { id: 'waves', label: '海浪', subtitle: '起伏', title: '海的来信' },
] as const;

/** 不把练习效果预先写死，让用户保留自己的真实体验。 */
export const FEEDBACK_OPTIONS: { value: CareFeedback; label: string }[] = [
  { value: 'better', label: '轻松些' },
  { value: 'same', label: '差不多' },
  { value: 'unsuitable', label: '不适合' },
];
