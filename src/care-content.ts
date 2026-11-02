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
  { kind: 'breathing', label: '呼吸', title: '把呼吸，慢慢放轻', intro: '不用赶走任何情绪。先跟着圆环，把这一口气呼完。' },
  { kind: 'mindfulness', label: '正念', title: '在这里，待三分钟', intro: '留意脚下、声音和身体。走神时，再轻轻回来。' },
  { kind: 'music', label: '声音', title: '给耳朵，一小片留白', intro: '选一个此刻愿意听的声音。音量轻一些，就好。' },
  { kind: 'movement', label: '活动', title: '让身体，松动一点', intro: '不追求表现。只在舒适范围里，动一动。' },
];

/** 正念分为三个可追踪阶段，暂停时阶段也同步停留。 */
export const MINDFUL_STEPS = [
  { title: '找到一个支点', text: '双脚落地，感受椅子托住身体。可以睁着眼，看看身边一个安静的物件。', detail: '先不用改变什么。' },
  { title: '留意此刻的声音', text: '听一听远处和近处。声音来了，又离开，不必判断，也不必追着它走。', detail: '走神很自然，再听一次就好。' },
  { title: '把注意力带回来', text: '感受一次自然的呼吸。轻轻动动手指和脚趾，看看周围，按自己的节奏结束。', detail: '把这一点空间，留给接下来的自己。' },
];

/** 运动引导不包含高强度动作；不适时可以立即停止。 */
export const MOVEMENT_STEPS = {
  stretch: [
    { title: '先安顿身体', text: '坐稳或站稳，双脚放平。自然呼吸，轻轻活动手指和脚踝。' },
    { title: '让肩膀放下来', text: '缓慢抬肩，再放松。让肩膀轻轻向后绕圈，不憋气，也不用做到最大幅度。' },
    { title: '打开手臂', text: '双臂向前伸，随后轻轻向两侧打开。动作小一点，找到舒服的位置。' },
    { title: '给双腿一点空间', text: '扶住稳固的椅背，交替提起脚跟；也可以坐着轮流伸直双腿。' },
    { title: '慢慢回到日常', text: '放下双手，回到自然站姿或坐姿。感受身体现在的样子，喝一口水也好。' },
  ],
  walk: [
    { title: '选一条安全的路', text: '找平坦、熟悉的路线，先慢走。若不适合出门，可以在室内走动。' },
    { title: '找到自己的步速', text: '按能轻松说话的速度走。感受脚掌接触地面，不需要计步或赶路。' },
    { title: '看看周围', text: '留意三种颜色、一处光线和一个声音。把目光从屏幕移向眼前。' },
    { title: '放松肩膀', text: '让手臂自然摆动，松开下颌。走累了就放慢，或找安全的位置休息。' },
    { title: '慢下来，再回来', text: '逐渐放慢脚步，选一个舒服的位置停下。看看自己比出发时多留意了什么。' },
  ],
};

/** 所有声景均在设备上合成，不加载第三方歌曲或远程音频。 */
export const SOUND_OPTIONS = [
  { id: 'chords', label: '缓缓和弦', subtitle: '温柔、绵长的合成音', title: '缓缓和弦' },
  { id: 'rain', label: '窗边小雨', subtitle: '细密、均匀的雨声', title: '窗边小雨' },
  { id: 'waves', label: '海的来信', subtitle: '缓慢起伏的海浪声', title: '海的来信' },
] as const;

/** 不把练习效果预先写死，让用户保留自己的真实体验。 */
export const FEEDBACK_OPTIONS: { value: CareFeedback; label: string }[] = [
  { value: 'better', label: '舒服一点' },
  { value: 'same', label: '和刚才差不多' },
  { value: 'unsuitable', label: '不太适合我' },
];
