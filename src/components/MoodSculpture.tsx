import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MoodScore } from '../types';
import '../sculpture.css';

/** 装置的可调输入集中在这里：体量、材质、表情、色彩和动态均可独立微调。 */
const SCULPTURE = {
  height: 250,
  maxPixelRatio: 1.5,
  viewHeight: 2.6,
  floatAmplitude: 0.025,
  floatFrequency: 0.8,
  pointerRotation: { x: 0.11, y: 0.19 },
  baseRotation: { x: 0.035, y: -0.07 },
  settlingSpeed: 4,
  tapStrength: 0.07,
  body: { width: 1.12, height: 0.98, depth: 0.8, roughness: 0.35, clearcoat: 0.65 },
  face: { eyeX: 0.235, eyeY: 0.13, eyeRadius: 0.033, mouthWidth: 0.26, mouthRadius: 0.011 },
  moods: {
    1: { color: '#d5e2eb', label: '很低落', mouthEnd: -0.23, mouthControl: -0.06 },
    2: { color: '#dce4e5', label: '有点低落', mouthEnd: -0.2, mouthControl: -0.12 },
    3: { color: '#eeefe3', label: '平平静静', mouthEnd: -0.18, mouthControl: -0.18 },
    4: { color: '#dce9d6', label: '还不错', mouthEnd: -0.15, mouthControl: -0.29 },
    5: { color: '#f1d6b5', label: '很愉快', mouthEnd: -0.12, mouthControl: -0.36 },
  },
};

interface MoodSculptureProps { mood: MoodScore | null; className?: string }
interface SculptureController { setMood: (mood: MoodScore) => void }

/** 一颗有表情的真实 WebGL 陶瓷小石；不能创建 WebGL 时保留完整的静态表情。 */
export default function MoodSculpture({ mood, className = '' }: MoodSculptureProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SculptureController | null>(null);
  const currentMood = mood ?? 3;
  const initialMoodRef = useRef(currentMood);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hostNode = hostRef.current;
    if (!hostNode) return;
    const host: HTMLDivElement = hostNode;
    const scene = new THREE.Scene();
    const sculpture = new THREE.Group();
    const camera = new THREE.OrthographicCamera(-2, 2, 1.3, -1.3, 0.1, 30);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: THREE.WebGLRenderer | null = null;
    let environment: THREE.WebGLRenderTarget | null = null;
    let contactTexture: THREE.CanvasTexture | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let frame = 0;
    let disposed = false;
    let inView = true;
    let reducedMotion = media.matches;
    let time = 0;
    let lastFrame = 0;
    let tapEnergy = 0;
    let pointerX = 0;
    let pointerY = 0;
    let shaderFailed = false;
    let activeMood = initialMoodRef.current;
    let bodyMaterial: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
    let body: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial>;
    let mouth: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
    const targetColor = new THREE.Color(SCULPTURE.moods[activeMood].color);

    // 所有释放入口幂等；离开页面不保留渲染循环、GPU 资源或原生事件。
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; lastFrame = 0; };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      media.removeEventListener('change', motionChanged);
      host.removeEventListener('pointermove', pointerMoved);
      host.removeEventListener('pointerleave', pointerLeft);
      host.removeEventListener('pointerdown', touched);
      host.removeEventListener('pointerup', pointerReleased);
      host.removeEventListener('pointercancel', pointerReleased);
      host.removeEventListener('keydown', keyPressed);
      renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
        }
        if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      contactTexture?.dispose();
      environment?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      controllerRef.current = null;
    };
    const fallback = () => { dispose(); setReady(false); setFailed(true); };
    function contextLost(event: Event) { event.preventDefault(); fallback(); }

    // 减少动态、隐藏标签页和离屏状态均停止 RAF；恢复后平滑续播，避免时间跳跃。
    const canAnimate = () => !disposed && !reducedMotion && inView && !document.hidden;
    const draw = () => {
      if (disposed || !renderer || document.hidden || !inView) return;
      try { renderer.render(scene, camera); }
      catch { fallback(); }
    };
    const requestFrame = () => { if (canAnimate() && !frame) frame = requestAnimationFrame(animate); };
    function animate(now: number) {
      frame = 0;
      if (!canAnimate()) return;
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.06) : 1 / 60;
      lastFrame = now;
      time += delta;
      const settle = 1 - Math.exp(-SCULPTURE.settlingSpeed * delta);
      tapEnergy *= Math.exp(-6 * delta);
      sculpture.position.y = Math.sin(time * SCULPTURE.floatFrequency) * SCULPTURE.floatAmplitude;
      sculpture.rotation.x += (SCULPTURE.baseRotation.x + pointerY * SCULPTURE.pointerRotation.x - sculpture.rotation.x) * settle;
      sculpture.rotation.y += (SCULPTURE.baseRotation.y + pointerX * SCULPTURE.pointerRotation.y - sculpture.rotation.y) * settle;
      sculpture.rotation.z = tapEnergy * 0.65;
      sculpture.scale.set(1 + tapEnergy * 0.13, 1 - tapEnergy * 0.24, 1);
      bodyMaterial.color.lerp(targetColor, settle);
      draw();
      requestFrame();
    }
    function visibilityChanged() { if (document.hidden) stop(); else { draw(); requestFrame(); } }
    function motionChanged(event: MediaQueryListEvent) {
      reducedMotion = event.matches;
      stop();
      if (reducedMotion) {
        pointerX = 0; pointerY = 0; tapEnergy = 0;
        sculpture.position.y = 0;
        sculpture.rotation.set(SCULPTURE.baseRotation.x, SCULPTURE.baseRotation.y, 0);
        sculpture.scale.setScalar(1);
        bodyMaterial.color.copy(targetColor);
        draw();
      } else requestFrame();
    }

    // 指针只带来小幅转向；触摸结束即回正，保留浏览器正常的纵向滚动手势。
    function pointerMoved(event: PointerEvent) {
      if (reducedMotion) return;
      const bounds = host.getBoundingClientRect();
      pointerX = THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
      pointerY = THREE.MathUtils.clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
      requestFrame();
    }
    function pointerLeft() { pointerX = 0; pointerY = 0; }
    function pointerReleased(event: PointerEvent) { if (event.pointerType !== 'mouse') pointerLeft(); }
    function touched() { if (!reducedMotion) { tapEnergy = SCULPTURE.tapStrength; requestFrame(); } }
    function keyPressed(event: KeyboardEvent) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); touched(); } }

    try {
      // 透明画布与正交镜头保持实体体量，DPR 上限照顾移动设备的 GPU 与电量。
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SCULPTURE.maxPixelRatio));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.debug.onShaderError = () => { shaderFailed = true; };
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      host.appendChild(renderer.domElement);
      camera.position.set(0, 0.65, 6);
      camera.lookAt(0, -0.04, 0);
      scene.add(sculpture);

      // 环境反射由本地房间几何生成，无网络模型或图片；缺少该效果时仍有完整灯光。
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture; scene.environmentIntensity = 0.45; }
      catch { scene.environment = null; }
      finally { room.dispose(); pmrem.dispose(); }
      scene.add(new THREE.HemisphereLight(0xfffdf5, 0x8b9b85, 2.2));
      const key = new THREE.DirectionalLight(0xfffcf1, 3);
      key.position.set(-3, 5, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.left = -3; key.shadow.camera.right = 3;
      key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
      key.shadow.normalBias = 0.04;
      key.shadow.radius = 4;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xe3ecfa, 0.8);
      fill.position.set(4, 2, 4);
      scene.add(fill);

      // 变形后的球体保留真实深度与细腻法线，形态接近手工打磨的陶瓷卵石。
      const geometry = new THREE.SphereGeometry(1, 64, 48);
      const positions = geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index); const y = positions.getY(index); const z = positions.getZ(index);
        const surface = 1 + 0.055 * Math.sin(x * 2.7 + y * 1.8) * Math.cos(z * 3.1) + 0.025 * Math.sin(y * 4.2 - z * 2.2);
        positions.setXYZ(index, x * SCULPTURE.body.width * surface * (1 - 0.035 * y), y * SCULPTURE.body.height * surface, z * SCULPTURE.body.depth * surface);
      }
      geometry.computeVertexNormals();
      bodyMaterial = new THREE.MeshPhysicalMaterial({ color: targetColor, roughness: SCULPTURE.body.roughness, metalness: 0, clearcoat: SCULPTURE.body.clearcoat, clearcoatRoughness: 0.28, sheen: 0.1, sheenColor: 0xfff8ea });
      body = new THREE.Mesh(geometry, bodyMaterial);
      body.castShadow = true;
      body.receiveShadow = true;
      sculpture.add(body);

      // 五官贴合真实球面，不使用平面贴图；表情随心情而变，嘴型为细小圆管曲线。
      const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x33473d, roughness: 0.65 });
      const raycaster = new THREE.Raycaster();
      const forward = new THREE.Vector3(0, 0, -1);
      // 独立探测体固定在局部原点，表情更新不受装置当前转向和漂浮位置影响。
      const surfaceProbe = new THREE.Mesh(geometry, faceMaterial);
      surfaceProbe.updateMatrixWorld(true);
      const frontPoint = (x: number, y: number, offset = 0.017) => {
        raycaster.set(new THREE.Vector3(x, y, 3), forward);
        const hit = raycaster.intersectObject(surfaceProbe, false)[0];
        return new THREE.Vector3(x, y, (hit?.point.z ?? SCULPTURE.body.depth) + offset);
      };
      const eyeGeometry = new THREE.SphereGeometry(SCULPTURE.face.eyeRadius, 16, 12);
      for (const direction of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeometry, faceMaterial);
        eye.position.copy(frontPoint(direction * SCULPTURE.face.eyeX, SCULPTURE.face.eyeY));
        eye.scale.set(1, 1.3, 0.55);
        sculpture.add(eye);
      }
      const mouthGeometry = (score: MoodScore) => {
        const expression = SCULPTURE.moods[score];
        const points = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          const x = (t - 0.5) * SCULPTURE.face.mouthWidth;
          const y = (1 - t) ** 2 * expression.mouthEnd + 2 * (1 - t) * t * expression.mouthControl + t ** 2 * expression.mouthEnd;
          return frontPoint(x, y, 0.023);
        });
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, SCULPTURE.face.mouthRadius, 8, false);
      };
      mouth = new THREE.Mesh(mouthGeometry(activeMood), faceMaterial);
      sculpture.add(mouth);
      sculpture.rotation.set(SCULPTURE.baseRotation.x, SCULPTURE.baseRotation.y, 0);

      // 真实投影与本地生成的柔和接触阴影叠加，背景仍然完全透明。
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.075 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.015;
      ground.receiveShadow = true;
      scene.add(ground);
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = 128; shadowCanvas.height = 128;
      const context = shadowCanvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 7, 64, 64, 63);
        gradient.addColorStop(0, 'rgba(45, 65, 48, 0.23)');
        gradient.addColorStop(0.4, 'rgba(45, 65, 48, 0.11)');
        gradient.addColorStop(1, 'rgba(45, 65, 48, 0)');
        context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
        contactTexture = new THREE.CanvasTexture(shadowCanvas);
        const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 2.1), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: 0.75 }));
        contact.rotation.x = -Math.PI / 2;
        contact.position.y = -1.009;
        scene.add(contact);
      }

      // 高级物理材质编译失败时改用标准材质；仍不可用才显示静态表情。
      shaderFailed = false;
      renderer.compile(scene, camera);
      if (shaderFailed) {
        bodyMaterial.dispose();
        bodyMaterial = new THREE.MeshStandardMaterial({ color: targetColor, roughness: 0.45, metalness: 0 });
        body.material = bodyMaterial;
        shaderFailed = false;
        renderer.compile(scene, camera);
        if (shaderFailed) throw new Error('当前设备无法渲染装置。');
      }
      const resize = () => {
        if (disposed || !renderer) return;
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight || SCULPTURE.height);
        const halfHeight = SCULPTURE.viewHeight / 2;
        camera.left = -halfHeight * width / height; camera.right = halfHeight * width / height;
        camera.top = halfHeight; camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        draw();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      if ('IntersectionObserver' in window) {
        intersectionObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) { draw(); requestFrame(); } else stop(); }, { threshold: 0.01 });
        intersectionObserver.observe(host);
      }
      controllerRef.current = { setMood(score) {
        if (disposed || score === activeMood) return;
        activeMood = score;
        targetColor.set(SCULPTURE.moods[score].color);
        const oldGeometry = mouth.geometry;
        mouth.geometry = mouthGeometry(score);
        oldGeometry.dispose();
        if (reducedMotion) bodyMaterial.color.copy(targetColor);
        if (inView && !document.hidden) draw();
        requestFrame();
      } };
      document.addEventListener('visibilitychange', visibilityChanged);
      media.addEventListener('change', motionChanged);
      host.addEventListener('pointermove', pointerMoved);
      host.addEventListener('pointerleave', pointerLeft);
      host.addEventListener('pointerdown', touched);
      host.addEventListener('pointerup', pointerReleased);
      host.addEventListener('pointercancel', pointerReleased);
      host.addEventListener('keydown', keyPressed);
      resize();
      if (!disposed) { setReady(true); setFailed(false); requestFrame(); }
    } catch { fallback(); }
    return dispose;
  }, []);

  // React 只传递情绪，不参与逐帧更新，避免整个记录表单随动画重新渲染。
  useEffect(() => { controllerRef.current?.setMood(currentMood); }, [currentMood]);
  const expression = SCULPTURE.moods[currentMood];
  const style = { '--sculpture-color': expression.color } as CSSProperties;
  return <div className={`mood-sculpture ${ready ? 'is-ready' : ''} ${failed ? 'is-fallback' : ''} ${className}`} style={style}>
    <div ref={hostRef} className="mood-sculpture-canvas" role="button" tabIndex={ready ? 0 : -1} aria-hidden={failed || !ready ? true : undefined} aria-label={`情绪小石：${expression.label}。轻触一下。`} />
    {!ready && <div className={`mood-sculpture-fallback mood-sculpture-score-${currentMood}`} role="img" aria-label={expression.label}><div className="mood-sculpture-static-stone"><i /><i /><span /></div></div>}
  </div>;
}
