import { DRAWING_SETTINGS } from '../play-content.ts';

/** 画作只驻留内存，命令历史共享不可变笔画，避免每次撤销深复制全部点。 */
export interface DrawingPoint { x: number; y: number }
export interface DrawingStroke { points: DrawingPoint[]; color: string; width: number; opacity: number; brush: 'pen' | 'soft' | 'chalk' }
export interface DrawingDocument { strokes: DrawingStroke[]; past: DrawingStroke[][]; future: DrawingStroke[][] }
let owner: string | null = null;
let drawing: DrawingDocument = { strokes: [], past: [], future: [] };

/** 只保留当前使用者一份画作；切换账号立即释放前一人的内存画作。 */
export function selectDrawingOwner(nextOwner: string): DrawingDocument {
  if (owner !== nextOwner) { owner = nextOwner; drawing = { strokes: [], past: [], future: [] }; }
  return drawing;
}

/** 旧组件的清理和延迟回调只读取自己的文档，不得重新切换当前账号。 */
export function getOwnedDrawing(ownerKey: string): DrawingDocument | null {
  return owner === ownerKey ? drawing : null;
}
function commit(ownerKey: string, strokes: DrawingStroke[]) {
  if (owner !== ownerKey) return;
  drawing = { strokes, past: [...drawing.past, drawing.strokes].slice(-DRAWING_SETTINGS.maxHistory), future: [] };
}
export function appendDrawingStroke(ownerKey: string, stroke: DrawingStroke) {
  if (owner !== ownerKey || drawing.strokes.length >= DRAWING_SETTINGS.maxStrokes || stroke.points.length === 0) return;
  commit(ownerKey, [...drawing.strokes, { ...stroke, points: stroke.points.map(point => ({ ...point })) }]);
}
export function clearDrawing(ownerKey: string) { if (owner === ownerKey && drawing.strokes.length) commit(ownerKey, []); }
export function undoDrawing(ownerKey: string) {
  if (owner !== ownerKey || !drawing.past.length) return;
  drawing = { strokes: drawing.past[drawing.past.length - 1], past: drawing.past.slice(0, -1), future: [drawing.strokes, ...drawing.future].slice(0, DRAWING_SETTINGS.maxHistory) };
}
export function redoDrawing(ownerKey: string) {
  if (owner !== ownerKey || !drawing.future.length) return;
  drawing = { strokes: drawing.future[0], past: [...drawing.past, drawing.strokes].slice(-DRAWING_SETTINGS.maxHistory), future: drawing.future.slice(1) };
}

/** 屏幕与PNG复用同一绘制逻辑；粉笔使用规律留白，不引入逐帧随机抖动。 */
export function paintDrawing(context: CanvasRenderingContext2D, strokes: DrawingStroke[], width: number, height: number) {
  context.setTransform(width / DRAWING_SETTINGS.width, 0, 0, height / DRAWING_SETTINGS.height, 0, 0);
  context.fillStyle = DRAWING_SETTINGS.paper;
  context.fillRect(0, 0, DRAWING_SETTINGS.width, DRAWING_SETTINGS.height);
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.save(); context.globalAlpha = stroke.opacity; context.strokeStyle = stroke.color; context.fillStyle = stroke.color;
    context.lineWidth = stroke.width; context.lineCap = 'round'; context.lineJoin = 'round';
    if (stroke.brush === 'chalk') context.setLineDash([1.8, 3.2]);
    const [first, ...rest] = stroke.points;
    if (!rest.length) { context.beginPath(); context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); context.fill(); }
    else { context.beginPath(); context.moveTo(first.x, first.y); rest.forEach(point => context.lineTo(point.x, point.y)); context.stroke(); }
    context.restore();
  }
}
