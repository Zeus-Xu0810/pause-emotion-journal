/** 趣味活动的目录、输入参数和图案集中维护；不设置分数、关卡或失败惩罚。 */
export type PlayActivityId = 'drawing' | 'constellation' | 'catchlight';
export const PLAY_ACTIVITIES: { id: PlayActivityId; title: string; hint: string; color: string }[] = [
  { id: 'drawing', title: '自由涂鸦', hint: '让颜色，跟着手走。', color: '#eee4d9' },
  { id: 'constellation', title: '星光连线', hint: '把散落的星光，慢慢连起来。', color: '#e6e4ef' },
  { id: 'catchlight', title: '接住光点', hint: '和团子，接一点光。', color: '#deece4' },
];
export const PLAY_SETTINGS = { tickMilliseconds: 200, maxStoredSeconds: 3600, intersectionThreshold: 0.08 };
export const DRAWING_SETTINGS = {
  colors: ['#496f60', '#c68577', '#b8a067', '#8b8daf', '#374953'],
  brushes: [
    { id: 'pen', label: '细笔', width: 5, opacity: 1 },
    { id: 'soft', label: '柔笔', width: 22, opacity: 0.35 },
    { id: 'chalk', label: '粉笔', width: 10, opacity: 0.75 },
  ] as const,
  paper: '#fffdf7', width: 1000, height: 600, maxStrokes: 240, maxPointsPerStroke: 1800, maxHistory: 40, keyboardStep: 14,
};
export const STAR_SETTINGS = { width: 100, height: 72, hitRadius: 5.5 };
export interface StarPattern { id: string; title: string; points: readonly (readonly [number, number])[]; closed: boolean }

/** 八幅原创点阵图案，坐标均落在舞台内；重复起点由闭合线处理。 */
export const STAR_PATTERNS: readonly StarPattern[] = [
  { id: 'heart', title: '心', closed: true, points: [[50, 20], [40, 12], [27, 14], [20, 25], [24, 39], [36, 51], [50, 62], [64, 51], [76, 39], [80, 25], [73, 14], [60, 12]] },
  { id: 'moon', title: '月', closed: true, points: [[62, 10], [43, 12], [28, 23], [24, 39], [32, 55], [49, 62], [67, 58], [78, 45], [65, 48], [52, 43], [46, 32], [49, 20]] },
  { id: 'leaf', title: '叶', closed: true, points: [[77, 12], [58, 14], [39, 20], [25, 33], [22, 46], [30, 56], [44, 57], [59, 48], [68, 33], [70, 21], [50, 35], [32, 50]] },
  { id: 'star', title: '星', closed: true, points: [[50, 9], [60, 27], [83, 30], [66, 43], [71, 64], [50, 54], [29, 64], [34, 43], [17, 30], [40, 27]] },
  { id: 'cloud', title: '云', closed: true, points: [[24, 52], [15, 44], [18, 33], [29, 29], [32, 17], [45, 12], [59, 18], [64, 30], [76, 30], [85, 40], [80, 51], [66, 55], [43, 55]] },
  { id: 'whale', title: '鲸', closed: true, points: [[18, 40], [23, 25], [39, 18], [56, 22], [69, 37], [81, 35], [87, 24], [89, 43], [79, 49], [67, 45], [55, 57], [36, 57], [23, 51]] },
  { id: 'cat', title: '猫', closed: true, points: [[29, 30], [25, 11], [42, 22], [58, 22], [75, 11], [71, 30], [80, 42], [73, 56], [58, 61], [42, 61], [27, 56], [20, 42]] },
  { id: 'rabbit', title: '兔', closed: true, points: [[32, 32], [28, 15], [34, 7], [41, 14], [44, 30], [52, 30], [57, 13], [65, 8], [71, 16], [65, 34], [75, 45], [68, 59], [50, 64], [31, 58], [24, 44]] },
];
export const LIGHT_SETTINGS = {
  width: 1000, height: 600, count: 11, catcherRadius: 65, playerScale: 1.55, keyboardStep: 30, respawnMilliseconds: 1500,
  maximumDeltaSeconds: 0.05, minimumSpeed: 18, speedSpread: 22, background: '#173d34', lightColor: '#ead4a6',
  brightnessPerCatch: 0.065, litBackground: '#295444',
};
