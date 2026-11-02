import { PLAY_SETTINGS } from '../play-content.ts';

/** 使用同一边界函数处理触屏、鼠标、键盘和持久化秒数。 */
export function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
export function storedPlaySeconds(milliseconds: number) { return clamp(Math.floor(Math.max(0, milliseconds) / 1000), 1, PLAY_SETTINGS.maxStoredSeconds); }
export function formatPlayTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function pointInBoard(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number) {
  return { x: clamp((clientX - rect.left) / Math.max(1, rect.width) * width, 0, width), y: clamp((clientY - rect.top) / Math.max(1, rect.height) * height, 0, height) };
}
export function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
