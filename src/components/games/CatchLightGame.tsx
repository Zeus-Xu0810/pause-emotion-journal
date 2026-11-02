import { useEffect, useRef, useState } from 'react';
import { LIGHT_SETTINGS } from '../../play-content';
import { clamp, distance, pointInBoard } from '../../lib/play';

interface LightPoint { x: number; y: number; vx: number; vy: number; radius: number; caughtAt: number | null }
/** 微光没有失败边界；触碰后只是暂时散开，再慢慢回来。 */
export default function CatchLightGame({ active, onInteract }: { active: boolean; onInteract: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef({ x: LIGHT_SETTINGS.width / 2, y: LIGHT_SETTINGS.height / 2 });
  const engagedRef = useRef(false);
  const interactRef = useRef(onInteract);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncement = useRef(0);
  const brightnessRef = useRef(0);
  const visibleBrightness = useRef(0);
  const lightsRef = useRef<LightPoint[]>(Array.from({ length: LIGHT_SETTINGS.count }, (_, index) => ({ x: 90 + index * 79 % 820, y: 30 + index * 137 % 510, vx: Math.cos(index * 2.3) * 9, vy: LIGHT_SETTINGS.minimumSpeed + index % 3 * LIGHT_SETTINGS.speedSpread, radius: 4 + index % 4 * 1.2, caughtAt: null })));
  interactRef.current = onInteract;

  /** RAF只负责本地画面；暂停、卸载与减少动态模式都不产生后台追逐。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0; let previous: number | null = null; let disposed = false;
    const resize = () => { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); paint(performance.now(), 0); };
    function paint(now: number, delta: number) {
      if (!canvas || !context) return;
      const scaleX = canvas.width / LIGHT_SETTINGS.width;
      const scaleY = canvas.height / LIGHT_SETTINGS.height;
      // 世界坐标仍铺满整个舞台，角色和圆形光效单独补偿纵向比例。
      const roundY = scaleX / scaleY;
      context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      visibleBrightness.current += (brightnessRef.current - visibleBrightness.current) * (reducedMotion.matches ? 1 : Math.min(1, delta * 2));
      const brightness = visibleBrightness.current;
      const night = Number.parseInt(LIGHT_SETTINGS.background.slice(1), 16); const dawn = Number.parseInt(LIGHT_SETTINGS.litBackground.slice(1), 16);
      const channels = [16, 8, 0].map(shift => Math.round(((night >> shift) & 255) * (1 - brightness) + ((dawn >> shift) & 255) * brightness));
      context.fillStyle = `rgb(${channels.join(',')})`; context.fillRect(0, 0, LIGHT_SETTINGS.width, LIGHT_SETTINGS.height);
      // 接住光点只会逐渐照亮天空，不显示数量或成绩，也不设置终点。
      for (let index = 0; index < 24; index += 1) { const x = (index * 137 + 46) % LIGHT_SETTINGS.width; const y = (index * 83 + 25) % LIGHT_SETTINGS.height; const radius = 1 + index % 3 * 0.35; context.fillStyle = `rgba(226,232,208,${0.06 + brightness * 0.38})`; context.beginPath(); context.ellipse(x, y, radius, radius * roundY, 0, 0, Math.PI * 2); context.fill(); }
      const target = targetRef.current;
      for (const light of lightsRef.current) {
        if (light.caughtAt !== null) {
          const fraction = (now - light.caughtAt) / LIGHT_SETTINGS.respawnMilliseconds;
          if (fraction < 1) { context.save(); context.translate(light.x, light.y); context.scale(1, roundY); context.beginPath(); context.arc(0, 0, 12 + fraction * 33, 0, Math.PI * 2); context.strokeStyle = `rgba(235,215,173,${(1 - fraction) * 0.35})`; context.lineWidth = 1; context.stroke(); context.restore(); continue; }
          light.x = 60 + Math.random() * (LIGHT_SETTINGS.width - 120); light.y = reducedMotion.matches ? 50 + Math.random() * (LIGHT_SETTINGS.height - 100) : -25; light.caughtAt = null;
        }
        if (active && !reducedMotion.matches) { light.x += light.vx * delta; light.y += light.vy * delta; if (light.x < 35 || light.x > LIGHT_SETTINGS.width - 35) { light.vx *= -1; light.x = clamp(light.x, 35, LIGHT_SETTINGS.width - 35); } if (light.y > LIGHT_SETTINGS.height + 30) { light.y = -25; light.x = 60 + Math.random() * (LIGHT_SETTINGS.width - 120); } }
        const captureDistance = Math.hypot(light.x - target.x, (light.y - target.y) / roundY);
        if (active && engagedRef.current && captureDistance < LIGHT_SETTINGS.catcherRadius + light.radius) { light.caughtAt = now; brightnessRef.current = Math.min(1, brightnessRef.current + LIGHT_SETTINGS.brightnessPerCatch); if (now - lastAnnouncement.current > 1600) { lastAnnouncement.current = now; setAnnouncement('天空又亮了一点'); } continue; }
        context.save(); context.translate(light.x, light.y); context.scale(1, roundY);
        const glow = context.createRadialGradient(0, 0, 0, 0, 0, light.radius * 6); glow.addColorStop(0, '#ead4a680'); glow.addColorStop(1, '#ead4a600'); context.fillStyle = glow; context.beginPath(); context.arc(0, 0, light.radius * 6, 0, Math.PI * 2); context.fill();
        context.fillStyle = LIGHT_SETTINGS.lightColor; context.beginPath(); context.arc(0, 0, light.radius, 0, Math.PI * 2); context.fill(); context.restore();
      }
      // 奶白小团子的手脚、眼睛和微笑均在本地画布绘制，不依赖外部素材。
      context.save(); context.translate(target.x, target.y); context.scale(LIGHT_SETTINGS.playerScale, LIGHT_SETTINGS.playerScale * roundY); context.lineCap = 'round'; context.lineWidth = 9; context.strokeStyle = '#e8e5d2';
      context.beginPath(); context.moveTo(-29, 8); context.lineTo(-46, 18); context.moveTo(29, 8); context.lineTo(46, 18); context.moveTo(-13, 28); context.lineTo(-16, 39); context.moveTo(13, 28); context.lineTo(16, 39); context.stroke();
      const body = context.createRadialGradient(-12, -18, 3, 0, 0, 48); body.addColorStop(0, '#fffef0'); body.addColorStop(1, '#e5e3cf'); context.fillStyle = body; context.beginPath(); context.ellipse(0, 0, 37, 32, 0, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#456354'; context.beginPath(); context.ellipse(-11, -4, 2.2, 3, 0, 0, Math.PI * 2); context.ellipse(11, -4, 2.2, 3, 0, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#456354'; context.lineWidth = 2; context.beginPath(); context.moveTo(-7, 8); context.quadraticCurveTo(0, 15, 7, 8); context.stroke(); context.fillStyle = '#d8aaa780'; context.beginPath(); context.ellipse(-22, 5, 5, 3, 0, 0, Math.PI * 2); context.ellipse(22, 5, 5, 3, 0, 0, Math.PI * 2); context.fill(); context.restore();
    }
    function animate(now: number) { if (disposed) return; const delta = previous === null ? 0 : Math.min(LIGHT_SETTINGS.maximumDeltaSeconds, (now - previous) / 1000); previous = now; paint(now, delta); if (active) frame = requestAnimationFrame(animate); }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); frame = requestAnimationFrame(animate);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [active]);

  function move(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
    if (!active) return;
    const raw = pointInBoard(clientX, clientY, canvas.getBoundingClientRect(), LIGHT_SETTINGS.width, LIGHT_SETTINGS.height);
    const point = { x: clamp(raw.x, LIGHT_SETTINGS.catcherRadius + 10, LIGHT_SETTINGS.width - LIGHT_SETTINGS.catcherRadius - 10), y: clamp(raw.y, LIGHT_SETTINGS.catcherRadius, LIGHT_SETTINGS.height - LIGHT_SETTINGS.catcherRadius) };
    if (distance(point, targetRef.current) > 1.5) { engagedRef.current = true; interactRef.current(); targetRef.current = point; }
  }
  return <div className="light-game"><div className="light-board"><canvas ref={canvasRef} tabIndex={0} role="application" aria-label="移动小团子接住缓缓飘落的光点；可以移动鼠标、拖动手指或按方向键。没有计分或失败。" onPointerDown={event => { if (!active) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); engagedRef.current = true; interactRef.current(); move(event.clientX, event.clientY, event.currentTarget); }} onPointerMove={event => { if (event.pointerType === 'touch' && !event.currentTarget.hasPointerCapture(event.pointerId)) return; move(event.clientX, event.clientY, event.currentTarget); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={event => {
      if (!active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); engagedRef.current = true; interactRef.current(); const current = targetRef.current;
      targetRef.current = { x: clamp(current.x + (event.key === 'ArrowLeft' ? -LIGHT_SETTINGS.keyboardStep : event.key === 'ArrowRight' ? LIGHT_SETTINGS.keyboardStep : 0), LIGHT_SETTINGS.catcherRadius, LIGHT_SETTINGS.width - LIGHT_SETTINGS.catcherRadius), y: clamp(current.y + (event.key === 'ArrowUp' ? -LIGHT_SETTINGS.keyboardStep : event.key === 'ArrowDown' ? LIGHT_SETTINGS.keyboardStep : 0), LIGHT_SETTINGS.catcherRadius, LIGHT_SETTINGS.height - LIGHT_SETTINGS.catcherRadius) };
    }} /></div><p className="light-caption">光会慢慢回来，不必追赶。</p><span className="visually-hidden" aria-live="polite">{announcement}</span></div>;
}
