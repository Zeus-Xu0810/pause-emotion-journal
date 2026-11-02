import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Redo2, Trash2, Undo2 } from 'lucide-react';
import { DRAWING_SETTINGS } from '../../play-content';
import { clamp, pointInBoard } from '../../lib/play';
import { appendDrawingStroke, clearDrawing, getOwnedDrawing, paintDrawing, redoDrawing, selectDrawingOwner, undoDrawing, type DrawingStroke } from '../../lib/playDrawing';

/** 笔迹只保留在当前使用者的内存中，退出路由再回来仍可接着画。 */
export default function DrawingGame({ ownerKey, active, onInteract, onNotice }: { ownerKey: string; active: boolean; onInteract: () => void; onNotice: (message: string) => void }) {
  const [color, setColor] = useState(DRAWING_SETTINGS.colors[0]);
  const [brush, setBrush] = useState<(typeof DRAWING_SETTINGS.brushes)[number]>(DRAWING_SETTINGS.brushes[0]);
  const [, refresh] = useState(0);
  const [cursor, setCursor] = useState({ x: DRAWING_SETTINGS.width / 2, y: DRAWING_SETTINGS.height / 2 });
  const [keyboard, setKeyboard] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<DrawingStroke | null>(null);
  const keyboardPen = useRef(false);
  const pointerId = useRef<number | null>(null);
  const document = getOwnedDrawing(ownerKey);

  /** 画布使用真实DPR尺寸，输入坐标统一换算为固定纸张坐标。 */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const owned = getOwnedDrawing(ownerKey);
    if (!owned) return;
    const saved = owned.strokes;
    paintDrawing(context, strokeRef.current ? [...saved, strokeRef.current] : saved, canvas.width, canvas.height);
  }, [ownerKey]);
  const finishStroke = useCallback(() => {
    if (strokeRef.current) {
      // 换账号后只释放旧组件的临时笔迹，不再读取或重置新账号的文档。
      if (getOwnedDrawing(ownerKey)) { appendDrawingStroke(ownerKey, strokeRef.current); refresh(value => value + 1); }
      strokeRef.current = null;
    }
    keyboardPen.current = false; pointerId.current = null;
    draw();
  }, [draw, ownerKey]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 只有进入当前账号的画布时认领文档，重绘与退出清理都只读。
    selectDrawingOwner(ownerKey);
    refresh(value => value + 1);
    const resize = () => { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); draw(); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    return () => { observer.disconnect(); finishStroke(); };
  }, [draw, finishStroke, ownerKey]);
  useEffect(() => { if (!active) finishStroke(); }, [active, finishStroke]);

  /** 一笔的第一个真实点才启动会话，调色和浏览工具不计入活动时长。 */
  function beginStroke(point: { x: number; y: number }) {
    if (!active) return false;
    finishStroke();
    const owned = getOwnedDrawing(ownerKey);
    if (!owned) return false;
    if (owned.strokes.length >= DRAWING_SETTINGS.maxStrokes) { onNotice('纸上已经很热闹了。可以导出，再清空继续画。'); return false; }
    strokeRef.current = { points: [point], color, width: brush.width, opacity: brush.opacity, brush: brush.id };
    onInteract(); draw(); return true;
  }
  function addPoint(point: { x: number; y: number }) {
    if (!active || !strokeRef.current || strokeRef.current.points.length >= DRAWING_SETTINGS.maxPointsPerStroke) return;
    const previous = strokeRef.current.points.at(-1)!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.1) return;
    strokeRef.current.points.push(point); draw();
  }
  function command(action: () => void) { if (!active) return; finishStroke(); action(); refresh(value => value + 1); draw(); }
  function exportPng() {
    finishStroke();
    const strokes = getOwnedDrawing(ownerKey)?.strokes;
    if (!strokes?.length) return;
    const exported = window.document.createElement('canvas'); exported.width = DRAWING_SETTINGS.width; exported.height = DRAWING_SETTINGS.height;
    const context = exported.getContext('2d'); if (!context) { onNotice('当前浏览器无法导出画作。'); return; }
    paintDrawing(context, strokes, exported.width, exported.height);
    exported.toBlob(blob => { if (!getOwnedDrawing(ownerKey)) return; if (!blob) { onNotice('导出没有完成，请重试。'); return; } const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url; link.download = '片刻涂鸦.png'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'image/png');
  }

  return <div className="drawing-game">
    {/* 调色与换笔不计为实际绘画，暂停时禁用工具选择。 */}
    <div className="drawing-toolbar">
      <div className="drawing-colors" role="group" aria-label="画笔颜色">{DRAWING_SETTINGS.colors.map((item, index) => <button type="button" key={item} className={color === item ? 'is-selected' : ''} aria-label={`颜色${index + 1}`} aria-pressed={color === item} disabled={!active} style={{ '--swatch': item } as React.CSSProperties} onClick={() => setColor(item)} />)}</div>
      <div className="drawing-brushes" role="group" aria-label="笔刷">{DRAWING_SETTINGS.brushes.map(item => <button type="button" key={item.id} aria-pressed={brush.id === item.id} className={brush.id === item.id ? 'is-selected' : ''} disabled={!active} onClick={() => setBrush(item)}>{item.label}</button>)}</div>
    </div>
    {/* 画布只接收一个活动指针，键盘笔尖与触屏共用相同纸张坐标。 */}
    <div className="drawing-paper">
      <canvas ref={canvasRef} tabIndex={0} role="application" aria-label="自由涂鸦画布；鼠标或手指绘画，方向键移动笔尖，空格开始或停止落笔。" onPointerDown={event => { if (!active || pointerId.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return; event.preventDefault(); setKeyboard(false); const point = pointInBoard(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), DRAWING_SETTINGS.width, DRAWING_SETTINGS.height); if (beginStroke(point)) { event.currentTarget.focus({ preventScroll: true }); pointerId.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={event => { if (pointerId.current !== event.pointerId) return; addPoint(pointInBoard(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), DRAWING_SETTINGS.width, DRAWING_SETTINGS.height)); }} onPointerUp={event => { if (pointerId.current === event.pointerId) finishStroke(); }} onPointerCancel={event => { if (pointerId.current === event.pointerId) finishStroke(); }} onLostPointerCapture={event => { if (pointerId.current === event.pointerId) finishStroke(); }} onBlur={finishStroke} onKeyDown={event => {
        if (!active) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setKeyboard(true); const next = { x: clamp(cursor.x + (event.key === 'ArrowRight' ? DRAWING_SETTINGS.keyboardStep : event.key === 'ArrowLeft' ? -DRAWING_SETTINGS.keyboardStep : 0), 0, DRAWING_SETTINGS.width), y: clamp(cursor.y + (event.key === 'ArrowDown' ? DRAWING_SETTINGS.keyboardStep : event.key === 'ArrowUp' ? -DRAWING_SETTINGS.keyboardStep : 0), 0, DRAWING_SETTINGS.height) }; setCursor(next); if (keyboardPen.current) addPoint(next); }
        else if (event.key === ' ') { event.preventDefault(); if (event.repeat) return; setKeyboard(true); if (keyboardPen.current) finishStroke(); else if (beginStroke(cursor)) keyboardPen.current = true; }
      }} />
      {keyboard && <span className="drawing-cursor" style={{ left: `${cursor.x / DRAWING_SETTINGS.width * 100}%`, top: `${cursor.y / DRAWING_SETTINGS.height * 100}%` }} aria-hidden="true" />}
    </div>
    {/* 清空也保留撤销历史；导出始终复用当前账号自己的笔迹。 */}
    <div className="drawing-actions"><div><button type="button" className="play-icon-button" aria-label="撤销" title="撤销" disabled={!active || !document?.past.length} onClick={() => command(() => undoDrawing(ownerKey))}><Undo2 size={18} /></button><button type="button" className="play-icon-button" aria-label="重做" title="重做" disabled={!active || !document?.future.length} onClick={() => command(() => redoDrawing(ownerKey))}><Redo2 size={18} /></button><button type="button" className="play-icon-button" aria-label="清空画纸，可撤销" title="清空，可撤销" disabled={!active || !document?.strokes.length} onClick={() => command(() => clearDrawing(ownerKey))}><Trash2 size={17} /></button></div><button type="button" className="play-soft-button" disabled={!document?.strokes.length} onClick={exportPng}><Download size={16} />导出图片</button></div>
    <details className="play-help"><summary>涂鸦提示</summary><p>画作只留在当前页面内存里，刷新会清除。方向键移动笔尖，空格落笔或停笔。</p></details>
  </div>;
}
