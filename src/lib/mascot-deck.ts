import type { MascotReply } from '../mascot-content';
import { MASCOT_SETTINGS } from '../mascot-content.ts';

/** 轻触只在短按且未滚动时成立；键盘激活不继承上一次指针的取消状态。 */
export function isMascotTap(input: { keyboard: boolean; cancelled: boolean; travelPixels: number; durationMs: number }): boolean {
  return input.keyboard || (!input.cancelled && input.travelPixels <= MASCOT_SETTINGS.maximumTapTravel && input.durationMs <= MASCOT_SETTINGS.maximumTapDurationMs);
}

/** 洗牌袋每轮抽完才重排，且跨轮首尾不重复；随机源可注入以测试边界。 */
export function createMascotDeck(replies: readonly MascotReply[], random: () => number = Math.random) {
  if (!replies.length) throw new Error('团子回复不能为空。');
  let bag: MascotReply[] = [];
  let previousId: string | null = null;
  return {
    draw(): MascotReply {
      if (!bag.length) {
        bag = [...replies];
        for (let index = bag.length - 1; index > 0; index -= 1) {
          const other = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1));
          [bag[index], bag[other]] = [bag[other], bag[index]];
        }
        // 从末尾抽取，因此只交换下一次将弹出的元素，不改变本轮完整性。
        if (bag.length > 1 && bag[bag.length - 1].id === previousId) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      const reply = bag.pop()!;
      previousId = reply.id;
      return reply;
    },
  };
}
