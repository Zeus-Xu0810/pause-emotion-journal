import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MASCOT_REPLIES, MASCOT_SETTINGS as SETTINGS } from '../mascot-content';
import type { MascotExpression, MascotReply } from '../mascot-content';
import { createMascotDeck, isMascotTap } from '../lib/mascot-deck';
import type { MoodScore } from '../types';
import '../sculpture.css';

interface MoodSculptureProps { mood?: MoodScore | null; className?: string }
interface SculptureController { setMood: (mood: MoodScore | null) => void; play: (reply: MascotReply) => void; look: (x: number, y: number) => void }

/** 团子默认开心只是角色外观；空评分仍然是 null，互动不会写入日记。 */
const baseExpression = (mood: MoodScore | null): MascotExpression => mood !== null && mood <= 3 ? 'soft' : 'happy';
const bodyColor = (mood: MoodScore | null) => mood === null ? SETTINGS.neutralColor : SETTINGS.moodColors[mood];

export default function MoodSculpture({ mood = null, className = '' }: MoodSculptureProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SculptureController | null>(null);
  const initialMood = useRef(mood);
  const latestMood = useRef(mood);
  const deckRef = useRef<ReturnType<typeof createMascotDeck> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownUntil = useRef(0);
  const pointerDown = useRef<{ x: number; y: number; at: number; cancelled: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [reply, setReply] = useState<MascotReply | null>(null);
  const [fallbackExpression, setFallbackExpression] = useState<MascotExpression>(baseExpression(mood));
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 原生按钮统一处理触摸和键盘；超过移动阈值的滚动不触发回复，也不阻止浏览器手势。
  const activate = (event: MouseEvent<HTMLButtonElement>) => {
    const now = performance.now();
    const down = pointerDown.current;
    pointerDown.current = null;
    if (!isMascotTap({ keyboard: event.detail === 0, cancelled: down?.cancelled ?? false, travelPixels: down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0, durationMs: down ? now - down.at : 0 })) return;
    if (now < cooldownUntil.current) return;
    cooldownUntil.current = now + SETTINGS.cooldownMs;
    deckRef.current ??= createMascotDeck(MASCOT_REPLIES);
    const next = deckRef.current.draw();
    setReply(next);
    setFallbackExpression(next.expression);
    controllerRef.current?.play(next);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => setFallbackExpression(baseExpression(latestMood.current)), next.durationMs);
  };
  const trackPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const down = pointerDown.current;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > SETTINGS.maximumTapTravel) down.cancelled = true;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const rect = event.currentTarget.getBoundingClientRect();
    controllerRef.current?.look((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
  };

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const host: HTMLDivElement = node;
    const scene = new THREE.Scene();
    const floating = new THREE.Group();
    const gaze = new THREE.Group();
    const rig = new THREE.Group();
    floating.add(gaze); gaze.add(rig); scene.add(floating);
    const camera = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 30);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = media.matches;
    let inView = true;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let environment: THREE.WebGLRenderTarget | null = null;
    let shadowTexture: THREE.CanvasTexture | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let observer: IntersectionObserver | null = null;
    let frame = 0; let lastFrame = 0; let time = 0;
    let pointerX = 0; let pointerY = 0;
    let currentMood = initialMood.current;
    let expression = baseExpression(currentMood);
    let active: { reply: MascotReply; elapsed: number } | null = null;
    let staticTimer: ReturnType<typeof setTimeout> | null = null;
    let bodyMaterial: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
    let mouth: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
    const mouthGeometries = new Map<MascotExpression, THREE.TubeGeometry>();
    const eyes: THREE.Group[] = []; const arms: THREE.Group[] = []; const feet: THREE.Mesh[] = [];
    let blushMaterial: THREE.MeshStandardMaterial;
    const color = new THREE.Color(bodyColor(currentMood));

    // 每条释放路径均幂等，清除 RAF、观察器、定时器、几何、材质、纹理和 WebGL 上下文。
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; lastFrame = 0; };
    const dispose = () => {
      if (disposed) return;
      disposed = true; stop();
      if (staticTimer) clearTimeout(staticTimer);
      resizeObserver?.disconnect(); observer?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      media.removeEventListener('change', motionChanged);
      renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set<THREE.BufferGeometry>(mouthGeometries.values());
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material)); }
        if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
      shadowTexture?.dispose(); environment?.dispose();
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
      controllerRef.current = null;
    };
    const fallback = () => { dispose(); setReady(false); };
    function contextLost(event: Event) { event.preventDefault(); fallback(); }
    const canAnimate = () => !disposed && !reduced && inView && !document.hidden;
    const draw = () => { if (!disposed && renderer && inView && !document.hidden) { try { renderer.render(scene, camera); } catch { fallback(); } } };
    const requestFrame = () => { if (canAnimate() && !frame) frame = requestAnimationFrame(animate); };
    const setExpression = (next: MascotExpression) => { expression = next; if (mouth) mouth.geometry = mouthGeometries.get(next)!; };

    // 部件始终从休息姿势计算动作，避免连续互动导致缩放或转向不断累积。
    function pose(progress: number, action: MascotReply['action'] | null) {
      const pulse = Math.sin(Math.PI * progress);
      const wiggle = Math.sin(progress * Math.PI * 4) * pulse;
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
      arms.forEach((arm, index) => { arm.position.set((index === 0 ? -1 : 1) * 0.86, 0.03, 0.02); arm.rotation.z = index === 0 ? -0.12 : 0.12; });
      feet.forEach(foot => foot.rotation.set(0, 0, 0));
      const eyeHeight = expression === 'sleepy' ? 0.26 : expression === 'soft' ? 0.85 : 1;
      eyes[0].scale.y = expression === 'wink' ? 0.12 : eyeHeight; eyes[1].scale.y = eyeHeight;
      blushMaterial.opacity = expression === 'shy' ? 0.46 : 0.27;
      if (action === 'blink') eyes.forEach(eye => { eye.scale.y *= 1 - Math.sin(progress * Math.PI * 2) ** 2 * 0.92; });
      else if (action === 'nod') rig.rotation.x = pulse * 0.15;
      else if (action === 'tilt') rig.rotation.z = pulse * 0.16;
      else if (action === 'wave') arms[1].rotation.z += pulse * (0.9 + Math.sin(progress * Math.PI * 6) * 0.24);
      else if (action === 'hug') {
        // 小手沿身体前侧收拢，不能只在侧面转动，否则掌心会埋进圆团内部。
        arms.forEach((arm, index) => { const side = index === 0 ? -1 : 1; arm.position.x = side * (0.86 - pulse * 0.22); arm.position.z = 0.02 + pulse * 0.58; arm.rotation.z -= side * pulse * 0.7; });
      }
      else if (action === 'stretch') { arms[0].rotation.z -= pulse * 0.8; arms[1].rotation.z += pulse * 0.8; rig.scale.set(1 - pulse * 0.015, 1 + pulse * 0.045, 1); }
      else if (action === 'tiptoe') { rig.position.y = pulse * 0.085; feet.forEach(foot => { foot.rotation.x = -pulse * 0.14; }); }
      else if (action === 'squish') rig.scale.set(1 + pulse * 0.065, 1 - pulse * 0.075, 1 + pulse * 0.02);
      else if (action === 'look') rig.rotation.y = wiggle * 0.15;
      else if (action === 'swing') { feet[0].rotation.z = wiggle * 0.2; feet[1].rotation.z = -wiggle * 0.2; rig.rotation.z = wiggle * 0.035; }
      else if (action === 'shy') { rig.rotation.x = pulse * 0.09; rig.rotation.z = pulse * 0.08; blushMaterial.opacity += pulse * 0.16; }
      else if (action === 'doze') rig.rotation.z = -pulse * 0.08;
    }
    function animate(now: number) {
      frame = 0; if (!canAnimate()) return;
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.06) : 1 / 60;
      lastFrame = now; time += delta;
      const settle = 1 - Math.exp(-SETTINGS.settlingSpeed * delta);
      gaze.rotation.x += (SETTINGS.baseRotation.x + pointerY * SETTINGS.pointerRotation.x - gaze.rotation.x) * settle;
      gaze.rotation.y += (SETTINGS.baseRotation.y + pointerX * SETTINGS.pointerRotation.y - gaze.rotation.y) * settle;
      floating.position.y = Math.sin(time * SETTINGS.floatFrequency) * SETTINGS.floatAmplitude;
      bodyMaterial.color.lerp(color, settle);
      if (active) {
        active.elapsed += delta * 1000;
        if (active.elapsed >= active.reply.durationMs) { active = null; setExpression(baseExpression(currentMood)); }
      }
      pose(active ? active.elapsed / active.reply.durationMs : 0, active?.reply.action ?? null);
      draw(); requestFrame();
    }
    function visibilityChanged() { if (document.hidden) stop(); else { draw(); requestFrame(); } }
    function motionChanged(event: MediaQueryListEvent) {
      reduced = event.matches; stop();
      if (reduced) { active = null; setExpression(baseExpression(currentMood)); floating.position.y = 0; gaze.rotation.set(SETTINGS.baseRotation.x, SETTINGS.baseRotation.y, 0); bodyMaterial.color.copy(color); pose(0, null); draw(); }
      else requestFrame();
    }

    try {
      // 场景由父容器分配大小；镜头同时检查横向手臂和纵向脚尖的安全边界。
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, SETTINGS.maxPixelRatio)); renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute('aria-hidden', 'true'); renderer.domElement.addEventListener('webglcontextlost', contextLost);
      host.appendChild(renderer.domElement);
      camera.position.set(0, 0.6, 6); camera.lookAt(0, -0.06, 0);
      const room = new RoomEnvironment(); const pmrem = new THREE.PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture; scene.environmentIntensity = 0.45; } catch { scene.environment = null; } finally { room.dispose(); pmrem.dispose(); }
      scene.add(new THREE.HemisphereLight(0xfffdf4, 0x8b9b85, 2));
      const key = new THREE.DirectionalLight(0xfffcf1, 2.8); key.position.set(-3, 5, 5); key.castShadow = true;
      key.shadow.mapSize.set(512, 512); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3; key.shadow.normalBias = 0.04; key.shadow.radius = 4; scene.add(key);
      const fill = new THREE.DirectionalLight(0xe3ecfa, 0.75); fill.position.set(4, 2, 4); scene.add(fill);

      // 奶白圆团保留轻微手工起伏，小手和小脚均为同材质实体，避免塑料玩具感。
      const geometry = new THREE.SphereGeometry(1, 64, 48); const positions = geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index); const y = positions.getY(index); const z = positions.getZ(index);
        const surface = 1 + 0.022 * Math.sin(x * 2.7 + y * 1.8) * Math.cos(z * 3.1);
        positions.setXYZ(index, x * SETTINGS.body.width * surface, y * SETTINGS.body.height * surface, z * SETTINGS.body.depth * surface);
      }
      geometry.computeVertexNormals();
      bodyMaterial = new THREE.MeshPhysicalMaterial({ color, roughness: SETTINGS.body.roughness, clearcoat: SETTINGS.body.clearcoat, clearcoatRoughness: 0.32, metalness: 0 });
      const body = new THREE.Mesh(geometry, bodyMaterial); body.castShadow = true; body.receiveShadow = true; rig.add(body);
      const limbGeometry = new THREE.SphereGeometry(1, 20, 16);
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group(); pivot.position.set(side * 0.86, 0.03, 0.02);
        const hand = new THREE.Mesh(limbGeometry, bodyMaterial); hand.position.set(side * 0.13, -0.17, 0.12); hand.scale.set(0.14, 0.22, 0.15); hand.castShadow = true; pivot.add(hand); rig.add(pivot); arms.push(pivot);
        const foot = new THREE.Mesh(limbGeometry, bodyMaterial); foot.position.set(side * 0.33, -0.89, 0.35); foot.scale.set(0.19, 0.12, 0.26); foot.castShadow = true; rig.add(foot); feet.push(foot);
      }

      // 大眼、高光、腮红与嘴型贴合局部曲面；全部表情预建并复用，不随回复分配 GPU 对象。
      const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x33473d, roughness: 0.55 });
      const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfffdf5 });
      blushMaterial = new THREE.MeshStandardMaterial({ color: 0xdba79e, transparent: true, opacity: 0.27, depthWrite: false, roughness: 0.9 });
      const probe = new THREE.Mesh(geometry, faceMaterial); probe.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster(); const forward = new THREE.Vector3(0, 0, -1);
      const front = (x: number, y: number, offset = 0.02) => { raycaster.set(new THREE.Vector3(x, y, 3), forward); return new THREE.Vector3(x, y, (raycaster.intersectObject(probe, false)[0]?.point.z ?? SETTINGS.body.depth) + offset); };
      const eyeGeometry = new THREE.SphereGeometry(SETTINGS.face.eyeRadius, 20, 16);
      const glowGeometry = new THREE.SphereGeometry(0.016, 12, 10);
      const cheekGeometry = new THREE.SphereGeometry(0.12, 20, 12);
      for (const side of [-1, 1]) {
        const eye = new THREE.Group(); eye.position.copy(front(side * SETTINGS.face.eyeX, SETTINGS.face.eyeY, 0.025));
        const pupil = new THREE.Mesh(eyeGeometry, faceMaterial); pupil.scale.set(1, 1.35, 0.55); eye.add(pupil);
        const glow = new THREE.Mesh(glowGeometry, highlightMaterial); glow.position.set(-0.018, 0.027, 0.033); eye.add(glow); rig.add(eye); eyes.push(eye);
        const cheek = new THREE.Mesh(cheekGeometry, blushMaterial); cheek.position.copy(front(side * 0.43, -0.055, 0.018)); cheek.scale.set(1, 0.48, 0.13); rig.add(cheek);
      }
      for (const face of ['happy', 'soft', 'wink', 'curious', 'shy', 'sleepy'] as const) {
        const closed = face === 'curious';
        const points = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          if (closed) return front(Math.cos(t * Math.PI * 2) * 0.055, -0.19 + Math.sin(t * Math.PI * 2) * 0.065, 0.026);
          const end = face === 'sleepy' || face === 'soft' ? -0.2 : -0.15;
          const control = face === 'sleepy' ? -0.2 : face === 'soft' ? -0.25 : -0.36;
          return front((t - 0.5) * SETTINGS.face.mouthWidth, (1 - t) ** 2 * end + 2 * (1 - t) * t * control + t ** 2 * end, 0.026);
        });
        mouthGeometries.set(face, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), 32, SETTINGS.face.mouthRadius, 8, closed));
      }
      mouth = new THREE.Mesh(mouthGeometries.get(expression)!, faceMaterial); rig.add(mouth);

      // 透明背景上的真实投影叠加程序化柔影，轻浮时仍有稳定接触感。
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.07 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1.05; ground.receiveShadow = true; scene.add(ground);
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 7, 64, 64, 63); gradient.addColorStop(0, 'rgba(45,65,48,.23)'); gradient.addColorStop(0.4, 'rgba(45,65,48,.11)'); gradient.addColorStop(1, 'rgba(45,65,48,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
        shadowTexture = new THREE.CanvasTexture(canvas); const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.75 })); contact.rotation.x = -Math.PI / 2; contact.position.y = -1.044; scene.add(contact);
      }
      let shaderFailed = false; renderer.debug.onShaderError = () => { shaderFailed = true; }; renderer.compile(scene, camera);
      if (shaderFailed) {
        const previous = bodyMaterial; bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
        rig.traverse(object => { if (object instanceof THREE.Mesh && object.material === previous) object.material = bodyMaterial; }); previous.dispose(); shaderFailed = false; renderer.compile(scene, camera); if (shaderFailed) throw new Error('WebGL材质不可用');
      }
      const resize = () => {
        if (disposed || !renderer) return;
        const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight);
        const aspect = width / height; const halfHeight = Math.max(1.23, 1.3 / aspect) * SETTINGS.viewPadding;
        camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); draw();
      };
      controllerRef.current = {
        setMood(score) { currentMood = score; color.set(bodyColor(score)); if (!active) setExpression(baseExpression(score)); if (reduced) { bodyMaterial.color.copy(color); pose(0, null); } draw(); requestFrame(); },
        play(next) {
          if (staticTimer) clearTimeout(staticTimer);
          setExpression(next.expression);
          if (reduced) { active = null; pose(0, null); draw(); staticTimer = setTimeout(() => { if (!disposed) { setExpression(baseExpression(currentMood)); pose(0, null); draw(); } }, next.durationMs); }
          else { active = { reply: next, elapsed: 0 }; requestFrame(); }
        },
        look(x, y) { if (!reduced) { pointerX = THREE.MathUtils.clamp(x, -1, 1); pointerY = THREE.MathUtils.clamp(y, -1, 1); requestFrame(); } },
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
      if ('IntersectionObserver' in window) { observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) { draw(); requestFrame(); } else stop(); }, { threshold: 0.01 }); observer.observe(host); }
      document.addEventListener('visibilitychange', visibilityChanged); media.addEventListener('change', motionChanged);
      gaze.rotation.set(SETTINGS.baseRotation.x, SETTINGS.baseRotation.y, 0); pose(0, null); resize();
      if (!disposed) { setReady(true); requestFrame(); }
    } catch { fallback(); }
    return dispose;
  }, []);

  // 情绪更新与独立互动均不经过日志仓库；卸载取消气泡和静态表情的到期回调。
  useEffect(() => { latestMood.current = mood; controllerRef.current?.setMood(mood); setFallbackExpression(baseExpression(mood)); }, [mood]);
  useEffect(() => {
    if (!reply) return;
    // 五秒按实际可见时间计算；离屏和隐藏时不保留轮询计时器。
    let remaining = SETTINGS.replyVisibleMs;
    let startedAt: number | null = null;
    let inView = true;
    const pause = () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      bubbleTimer.current = null;
      if (startedAt !== null) remaining = Math.max(0, remaining - (performance.now() - startedAt));
      startedAt = null;
    };
    const resume = () => {
      pause();
      if (document.hidden || !inView) return;
      if (!remaining) { setReply(null); return; }
      startedAt = performance.now();
      bubbleTimer.current = setTimeout(() => setReply(null), remaining);
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; resume(); }, { threshold: 0.01 }) : null;
    if (rootRef.current) observer?.observe(rootRef.current);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => { pause(); observer?.disconnect(); document.removeEventListener('visibilitychange', resume); };
  }, [reply]);
  useEffect(() => () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); if (fallbackTimer.current) clearTimeout(fallbackTimer.current); }, []);
  const style = { '--sculpture-color': bodyColor(mood) } as CSSProperties;
  return <div ref={rootRef} className={`mood-sculpture ${ready ? 'is-ready' : 'is-fallback'} ${className}`} style={style}>
    <div className="mascot-reply-space"><p className={`mascot-reply ${reply ? 'is-visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">{reply?.text ?? ''}</p></div>
    <div className="mascot-visual-stage">
      <div ref={hostRef} className="mood-sculpture-canvas" aria-hidden="true" />
      {!ready && <div className={`mascot-fallback mascot-face-${fallbackExpression}`} aria-hidden="true"><div className="mascot-static-body"><i className="mascot-static-hand left" /><i className="mascot-static-hand right" /><i className="mascot-static-foot left" /><i className="mascot-static-foot right" /><i className="mascot-static-cheek left" /><i className="mascot-static-cheek right" /><i className="mascot-static-eye left" /><i className="mascot-static-eye right" /><span className="mascot-static-mouth" /></div></div>}
      <button className="mascot-touch-target" type="button" aria-label="和小团子玩一下" onClick={activate} onPointerDown={event => { pointerDown.current = { x: event.clientX, y: event.clientY, at: performance.now(), cancelled: !event.isPrimary }; }} onPointerMove={trackPointer} onPointerLeave={() => { if (pointerDown.current) pointerDown.current.cancelled = true; controllerRef.current?.look(0, 0); }} onPointerCancel={() => { if (pointerDown.current) pointerDown.current.cancelled = true; controllerRef.current?.look(0, 0); }} onPointerUp={event => { if (event.pointerType !== 'mouse') controllerRef.current?.look(0, 0); }} onKeyDown={event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); if (event.key === 'Escape') { setReply(null); if (bubbleTimer.current) clearTimeout(bubbleTimer.current); } }} />
    </div>
  </div>;
}
