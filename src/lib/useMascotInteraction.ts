import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';
import { MASCOT_INTERACTION_SETTINGS as SETTINGS } from '../mascot-interaction-content';
import { fallbackHitTest } from '../components/MascotFallback';
import { cancelGesture, defaultHitForGesture, finishGesture, flushTap, keyboardGesture, moveGesture, movePinch, registerTap, startGesture, startPinch, tickGesture } from './mascot-gestures';
import type { GestureState, PendingTap, PinchState } from './mascot-gestures';
import type { MascotGesture, MascotHit, MascotManipulation, MascotMode, MascotPoint, MascotRegion, MascotSceneController } from './mascot-interaction-types';

interface InteractionOptions {
  mode: MascotMode;
  ready: boolean;
  scene: RefObject<MascotSceneController | null>;
  host: RefObject<HTMLDivElement | null>;
  button: RefObject<HTMLButtonElement | null>;
  onReact: (kind: MascotGesture, hit: MascotHit) => void;
  /** 持续手势首次确认或类型切换时通知表情文案；调用方不能在此播放release动画。 */
  onEngage?: (kind: MascotGesture, hit: MascotHit) => void;
}
interface HeldPointer { point: MascotPoint; hit: MascotHit }
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** 输入层只负责识别意图；模型形变和日记保存分别由自己的模块处理。 */
export function useMascotInteraction(options: InteractionOptions) {
  const latest = useRef(options); latest.current = options;
  const held = useRef(new Map<number, HeldPointer>());
  const downIds = useRef(new Set<number>());
  const blocked = useRef(false);
  const gesture = useRef<GestureState | null>(null);
  const pinch = useRef<PinchState | null>(null);
  const anchor = useRef<MascotHit | null>(null);
  const pendingTap = useRef<PendingTap | null>(null);
  const pendingHit = useRef<MascotHit | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyHeld = useRef<MascotManipulation | null>(null);
  const engagedKind = useRef<MascotGesture | null>(null);
  const gazeFrame = useRef(0);
  const pointerPosition = useRef<MascotPoint>({ x: 0, y: 0 });
  const [gaze, setGaze] = useState<MascotPoint>({ x: 0, y: 0 });
  const [region, setRegion] = useState<MascotRegion | null>(null);
  const [interaction, setInteraction] = useState<MascotManipulation | null>(null);

  const clearTap = useCallback(() => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null; pendingTap.current = null; pendingHit.current = null;
  }, []);
  const clearHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const apply = useCallback((value: MascotManipulation | null) => {
    if (!value) engagedKind.current = null;
    latest.current.scene.current?.manipulate(value); setInteraction(value);
  }, []);
  // 移动可逐帧更新形变，表情文案只在确认和切换时通知一次，不反复打断正在抓住的身体。
  const engage = useCallback((kind: MascotGesture, hit: MascotHit) => {
    if (engagedKind.current === kind) return;
    engagedKind.current = kind; latest.current.onEngage?.(kind, hit);
  }, []);
  const reset = useCallback(() => {
    clearTap(); clearHold();
    const ids = [...held.current.keys()];
    held.current.clear(); downIds.current.clear(); blocked.current = false; gesture.current = null; pinch.current = null; anchor.current = null; keyHeld.current = null;
    for (const id of ids) { try { if (latest.current.button.current?.hasPointerCapture(id)) latest.current.button.current.releasePointerCapture(id); } catch { /* 系统已收回的指针无需再次释放。 */ } }
    apply(null); setRegion(null);
  }, [apply, clearTap]);
  const stagePoint = useCallback((point: MascotPoint): MascotPoint => {
    const rect = latest.current.host.current?.getBoundingClientRect();
    return rect ? { x: (point.x - rect.left) / Math.max(1, rect.width) * 2 - 1, y: (point.y - rect.top) / Math.max(1, rect.height) * 2 - 1 } : { x: 0, y: 0 };
  }, []);
  const hitAt = useCallback((point: MascotPoint) => {
    const host = latest.current.host.current; if (!host) return null;
    const normalized = stagePoint(point);
    if (Math.abs(normalized.x) > 1 || Math.abs(normalized.y) > 1) return null;
    return latest.current.ready ? latest.current.scene.current?.hitTest(normalized.x, normalized.y) ?? null : fallbackHitTest(normalized, { width: host.clientWidth, height: host.clientHeight });
  }, [stagePoint]);
  const applyState = useCallback((state: GestureState) => {
    if (state.cancelled) { apply(null); return; }
    if (!state.kind || !state.hasInteraction || !anchor.current) return;
    clearTap(); clearHold();
    const host = latest.current.host.current;
    const limit = SETTINGS.maxPointerDelta;
    apply({ kind: state.kind, hit: anchor.current, dx: clamp(state.dx / Math.max(1, host?.clientWidth ?? 1) * 2, limit), dy: clamp(state.dy / Math.max(1, host?.clientHeight ?? 1) * 2, limit), strength: state.strength, pinchScale: state.pinchScale });
    engage(state.kind, anchor.current);
  }, [apply, clearTap, engage]);

  // 鼠标在页面其他位置移动时眼睛也会看过去；后备视图刷新节流到每帧一次。
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      if (gazeFrame.current) return;
      gazeFrame.current = requestAnimationFrame(() => {
        gazeFrame.current = 0;
        const point = stagePoint(pointerPosition.current);
        const next = { x: clamp(point.x, SETTINGS.gazeLimit), y: clamp(point.y, SETTINGS.gazeLimit) };
        latest.current.scene.current?.look(next.x, next.y);
        if (!latest.current.ready) setGaze(next);
        setRegion(hitAt(pointerPosition.current)?.region ?? null);
      });
    };
    const hidden = () => { if (document.hidden) reset(); };
    const leave = (event: globalThis.PointerEvent) => { if (!event.relatedTarget && held.current.size === 0) { latest.current.scene.current?.look(0, 0); setGaze({ x: 0, y: 0 }); setRegion(null); } };
    window.addEventListener('pointermove', move, { passive: true }); window.addEventListener('pointerout', leave);
    window.addEventListener('blur', reset); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerout', leave); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', hidden);
      if (gazeFrame.current) cancelAnimationFrame(gazeFrame.current); gazeFrame.current = 0;
      clearTap(); clearHold(); latest.current.scene.current?.manipulate(null);
    };
  }, [clearTap, hitAt, reset, stagePoint]);
  useEffect(() => { reset(); }, [options.mode, reset]);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    downIds.current.add(event.pointerId);
    if (blocked.current) return;
    const point = { x: event.clientX, y: event.clientY };
    const hit = hitAt(point);
    if (!hit) {
      // 任一指先落透明角，整组输入都等到全松开再恢复，不能让后来的手指冒充单指。
      clearHold(); clearTap(); if (gesture.current) gesture.current = cancelGesture(gesture.current);
      held.current.clear(); pinch.current = null; blocked.current = true; apply(null); return;
    }
    if (!event.isPrimary && latest.current.mode !== 'pinch') {
      clearHold(); clearTap(); gesture.current = null; pinch.current = null; held.current.clear(); apply(null); blocked.current = true; return;
    }
    held.current.set(event.pointerId, { point, hit });
    // 两指缩放只在已选捏脸模式并且确实命中两块脸颊时启用。
    if (held.current.size > 1) {
      clearHold(); clearTap(); apply(null);
      const fingers = [...held.current.values()];
      if (fingers.length !== 2) { blocked.current = true; gesture.current = null; pinch.current = null; apply(null); return; }
      const next = startPinch({ mode: latest.current.mode, regions: [fingers[0].hit.region, fingers[1].hit.region], points: [fingers[0].point, fingers[1].point], at: performance.now() });
      pinch.current = next; gesture.current = null;
      if (next.cancelled) { blocked.current = true; apply(null); return; }
      anchor.current = { region: 'cheek-left', local: { x: 0, y: 0, z: 0.78 } };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    anchor.current = hit;
    gesture.current = startGesture({ mode: latest.current.mode, region: hit.region, start: point, at: performance.now(), pointerType: event.pointerType });
    event.currentTarget.setPointerCapture(event.pointerId);
    // 鼠标沿用原生聚焦以保留正确的focus-visible判断；触屏显式模式才拦截默认动作。
    if (event.pointerType === 'touch' && latest.current.mode !== 'auto') event.preventDefault();
    // 鼠标落下立刻能看见按压，触屏更轻；预览不算确认手势，不触发表情短句。
    apply({ kind: 'poke', hit, dx: 0, dy: 0, strength: event.pointerType === 'touch' ? SETTINGS.touchPressStrength : SETTINGS.mousePressStrength });
    clearHold();
    holdTimer.current = setTimeout(() => { if (gesture.current) { gesture.current = tickGesture(gesture.current, performance.now()); applyState(gesture.current); } }, SETTINGS.longPressMs);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = held.current.get(event.pointerId); if (!current || blocked.current) return;
    current.point = { x: event.clientX, y: event.clientY };
    if (pinch.current) {
      const fingers = [...held.current.values()];
      if (fingers.length !== 2) return;
      pinch.current = movePinch(pinch.current, [fingers[0].point, fingers[1].point], performance.now(), fingers.length); applyState(pinch.current);
    } else if (gesture.current) { gesture.current = moveGesture(gesture.current, current.point, performance.now()); applyState(gesture.current); }
    if (latest.current.mode !== 'auto' && event.cancelable) event.preventDefault();
  }
  function scheduleTap(hit: MascotHit, state: GestureState, point: MascotPoint, at: number) {
    const previousHit = pendingHit.current;
    const update = registerTap(pendingTap.current, { region: hit.region, point, at, kind: state.kind ?? 'poke' });
    if (tapTimer.current) clearTimeout(tapTimer.current);
    pendingTap.current = update.pending; pendingHit.current = update.pending ? hit : null;
    if (update.kind) latest.current.onReact(update.kind, update.kind === 'bounce' ? hit : previousHit ?? hit);
    if (update.pending) tapTimer.current = setTimeout(() => {
      const flushed = flushTap(pendingTap.current, performance.now()); const remembered = pendingHit.current;
      pendingTap.current = flushed.pending;
      if (flushed.kind && remembered) latest.current.onReact(flushed.kind, remembered);
      if (!flushed.pending) pendingHit.current = null;
    }, SETTINGS.doubleTapMaximumMs + SETTINGS.tapFlushPaddingMs);
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    downIds.current.delete(event.pointerId);
    const current = held.current.get(event.pointerId);
    if (blocked.current) { held.current.delete(event.pointerId); if (downIds.current.size === 0) reset(); return; }
    if (!current) return;
    clearHold();
    const hit = anchor.current ?? current.hit;
    if (pinch.current) {
      const done = pinch.current; pinch.current = null; gesture.current = null; held.current.clear(); blocked.current = downIds.current.size > 0;
      apply(null); if (!done.cancelled && done.hasInteraction) latest.current.onReact('pinch', hit); return;
    }
    if (gesture.current) {
      const at = performance.now(); const point = { x: event.clientX, y: event.clientY };
      const done = finishGesture(gesture.current, point, at); gesture.current = null;
      held.current.delete(event.pointerId); apply(null);
      if (!done.cancelled) { if (done.tapPending) scheduleTap(hit, done, point, at); else if (done.hasInteraction && done.kind) latest.current.onReact(done.kind, hit); }
    }
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 浏览器可能已隐式释放指针。 */ }
  }
  function pointerCancel(event: PointerEvent<HTMLButtonElement>) {
    downIds.current.delete(event.pointerId);
    if (gesture.current) gesture.current = cancelGesture(gesture.current);
    held.current.clear(); pinch.current = null; clearHold(); clearTap(); apply(null);
    blocked.current = downIds.current.size > 0;
  }

  // 键盘点击只走原生click；方向键提供拖拽/捏脸等价操作，松键立即回弹。
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0) return;
    const kind = keyboardGesture(latest.current.mode);
    if (kind) { clearTap(); latest.current.onReact(kind, defaultHitForGesture(kind)); }
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { event.preventDefault(); reset(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) { event.preventDefault(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || latest.current.mode === 'auto') return;
    event.preventDefault(); clearTap();
    const kind = keyboardGesture(latest.current.mode); if (!kind) return;
    const previous = keyHeld.current ?? { kind, hit: defaultHitForGesture(kind), dx: 0, dy: 0, strength: SETTINGS.keyboardStrength };
    const step = SETTINGS.keyboardStep;
    const next = { ...previous, dx: clamp(previous.dx + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), SETTINGS.maxPointerDelta), dy: clamp(previous.dy + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), SETTINGS.maxPointerDelta) };
    keyHeld.current = next; apply(next); engage(next.kind, next.hit);
  }
  function keyUp(event: KeyboardEvent<HTMLButtonElement>) { if (event.key.startsWith('Arrow') && keyHeld.current) { const done = keyHeld.current; keyHeld.current = null; apply(null); latest.current.onReact(done.kind, done.hit); } }
  // Tab或外部点击移走焦点即取消当前抓取，不能等待不会再送达此按钮的keyup/up。
  function blur() { if (keyHeld.current || held.current.size > 0) reset(); }
  return { gaze, region, interaction, reset, handlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: pointerCancel, onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => { if (held.current.has(event.pointerId)) pointerCancel(event); }, onClick: click, onKeyDown: keyDown, onKeyUp: keyUp, onBlur: blur, onContextMenu: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(), onDoubleClick: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() } };
}
