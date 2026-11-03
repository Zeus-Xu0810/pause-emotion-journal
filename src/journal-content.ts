/** 日记中的提示、贴纸图案和陪伴短句集中维护；提示不会写入用户正文。 */
export const JOURNAL_SETTINGS = { receiptMs: 3200, stampReactionMs: 1800 };
export const JOURNAL_PROMPTS = [
  { id: 'free', label: '随心写', question: '想说什么，都可以。', placeholder: '一句话、几个字，都有它的位置。' },
  { id: 'little', label: '小小的好', question: '今天，哪件小事让你松了一口气？', placeholder: '也许是一口热饭，一阵风，或一个被接住的瞬间…' },
  { id: 'unload', label: '放下点什么', question: '有什么事，想先放在这里？', placeholder: '不用马上想明白，先把它写下来。' },
  { id: 'thanks', label: '谢谢自己', question: '今天的你，哪一点值得被抱抱？', placeholder: '很小的努力，也可以记在这里。' },
] as const;
export const JOURNAL_COMPANION_LINES = ['我在这儿，慢慢说。', '不想写字，贴个心情也好。', '每一种感受，都有位置。', '这张小纸条，留给你自己。'];
export const FEELING_ART = ['wind', 'moon', 'flame', 'cloud-rain', 'cloud', 'leaf', 'heart', 'sparkles'] as const;
export const CONTEXT_ART = ['book', 'briefcase', 'heart', 'users', 'moon', 'flower', 'cup', 'sun'] as const;
