import type { MoodScore } from './types';

/** 可修改的品牌、输入范围、分类和练习参数统一放在这里。 */
export const SETTINGS = {
  name: '片刻',
  englishName: 'PAUSE',
  publicUrl: 'https://pause-emotion-journal.vercel.app',
  maxNoteLength: 2000,
  minPasswordLength: 8,
  maxPasswordLength: 128,
  maxDisplayNameLength: 30,
  maxEmailLength: 254,
  inhaleSeconds: 4,
  exhaleSeconds: 6,
  breathingMinutes: [1, 3, 5],
  minimumInsightEntries: 3,
  pageSize: 30,
};

/** 天气颜色仅表达不同状态，不为情绪贴上好坏标签。 */
export const MOODS: { score: MoodScore; label: string; weather: string; color: string; hint: string }[] = [
  { score: 1, label: '很低落', weather: '雨天', color: '#7d93a5', hint: '有些日子，心里也会下雨。' },
  { score: 2, label: '有点低落', weather: '阴天', color: '#a49aaf', hint: '不必急着把乌云赶走。' },
  { score: 3, label: '平平静静', weather: '多云', color: '#8eaa91', hint: '就这样待一会儿，也很好。' },
  { score: 4, label: '还不错', weather: '晴间多云', color: '#c49a54', hint: '留住生活里这一点亮色。' },
  { score: 5, label: '很愉快', weather: '晴天', color: '#d09a48', hint: '把这份轻快，记在今天。' },
];
export const FEELINGS = ['焦虑', '疲惫', '烦躁', '委屈', '孤独', '平静', '满足', '期待'];
export const CONTEXTS = ['学业', '工作', '关系', '社交', '睡眠', '身体', '独处', '日常小事'];

/** 内容来源可在产品内查看；不将个人日记发送给第三方分析模型。 */
export const SOURCES = [
  { title: 'NIMH · 日常自我关怀', url: 'https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health', description: '运动、放松、音乐与人际支持；寻找适合自己的方式。' },
  { title: 'JMIR · 年轻用户如何使用情绪记录工具', url: 'https://mhealth.jmir.org/2020/10/e18140/', description: '支持低负担记录、灵活编辑与回顾情绪变化。' },
];
