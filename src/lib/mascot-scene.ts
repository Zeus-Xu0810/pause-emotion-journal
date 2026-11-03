import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MASCOT_SETTINGS as SETTINGS } from '../mascot-content';
import type { MascotExpression, MascotReply } from '../mascot-content';
import type { MoodScore } from '../types';
import type { MascotSceneController, MascotSceneOptions, MascotManipulation, MascotHit, MascotGesture } from './mascot-interaction-types';
import { deformMascotLayers } from './mascot-deformation';
import { advanceMascotSpring, mascotSoftLimit, MASCOT_DYNAMICS as DYNAMICS } from './mascot-dynamics';
import type { MascotDeformation, MascotResidualField } from './mascot-deformation';
import { createPetProps, PET_RENDER_SETTINGS as PET } from './pet-props';
import type { PetPropRig } from './pet-props';
import { clampPetPointer, petArcPoint, petSafeZoom, petTargetContains } from './pet-scene-math';
import type { PetActivity, PetEventKind, PetInput, PetPoint, PetResponse } from './pet-care';

/** 直接操纵的可修改输入集中在此；形变上限保持曲面连续，避免捏拉翻面。 */
const INTERACTION = {
  eyeTravelX: 0.052, eyeTravelY: 0.037,
  nearEyeHeight: 0.92, farEyeHeight: 1.08,
  reactionDurations: { poke: 620, pinch: 920, drag: 1150, pat: 1050, tickle: 1100, wave: 950, bounce: 1100, shake: 1450 } as Record<MascotGesture, number>,
  reactionDurationMs: 950,
  particleCount: 10, particleLifetime: 0.95,
  residualSeconds: 0.24, maximumResiduals: 2,
  idleActions: ['tilt', 'look', 'swing', 'stretch', 'shy', 'nod'] as MascotReply['action'][],
};
const GESTURE_EXPRESSION: Record<MascotGesture, MascotExpression> = { poke: 'curious', pinch: 'shy', drag: 'curious', pat: 'sleepy', tickle: 'happy', wave: 'happy', bounce: 'happy', shake: 'curious' };

/** 场景仅消费交互意图；日记评分仍由记录表单管理。 */
const baseExpression = (mood: MoodScore | null): MascotExpression => mood !== null && mood <= 3 ? 'soft' : 'happy';
const bodyColor = (mood: MoodScore | null) => mood === null ? SETTINGS.neutralColor : SETTINGS.moodColors[mood];

/** 创建独立场景；失败时返回安全空控制器，让 HTML 表情和回复继续可用。 */
export function createMascotScene(host: HTMLDivElement, options: MascotSceneOptions): MascotSceneController {
    let controller: MascotSceneController = { setMood() {}, play() {}, look() {}, hitTest: () => null, manipulate() {}, react() {}, setPetActivity() {}, petInput() {}, petRespond() {}, dispose() {} };
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
    let currentMood = options.mood;
    let expression = baseExpression(currentMood);
    let active: { reply: MascotReply; elapsed: number } | null = null;
    let staticTimer: ReturnType<typeof setTimeout> | null = null;
    let bodyMaterial: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
    let bodyGeometry: THREE.SphereGeometry;
    let bodyRest: Float32Array;
    let mouth: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
    const mouthGeometries = new Map<MascotExpression, THREE.TubeGeometry>();
    const mouthRest = new Map<THREE.BufferGeometry, Float32Array>();
    const eyes: THREE.Group[] = []; const arms: THREE.Group[] = []; const feet: THREE.Mesh[] = [];
    const pupils: THREE.Mesh[] = []; const highlights: THREE.Mesh[] = [];
    const brows: THREE.Group[] = [];
    let laughMouth: THREE.Group;
    let contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    const particles: { mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>; velocity: THREE.Vector3; age: number; spin: number }[] = [];
    const effects = new THREE.Group(); scene.add(effects);
    const faceAttachments: { object: THREE.Object3D; rest: THREE.Vector3; tangentX: THREE.Vector3; tangentY: THREE.Vector3 }[] = [];
    const hitTargets: THREE.Object3D[] = [];
    let blushMaterial: THREE.MeshStandardMaterial;
    const color = new THREE.Color(bodyColor(currentMood));
    let held: MascotManipulation | null = null;
    let fieldKind: MascotGesture = 'poke';
    const fieldAnchor = new THREE.Vector3(0, -0.05, SETTINGS.body.depth);
    const pull = new THREE.Vector3(); const pullVelocity = new THREE.Vector3(); const pullTarget = new THREE.Vector3();
    // 身体重心和脸颊软肉各有弹簧，松手后再戳脸不会把悬挂中的身体瞬移回去。
    const grab = new THREE.Vector3(); const grabVelocity = new THREE.Vector3(); const grabTarget = new THREE.Vector3();
    let pressure = 0; let pressureVelocity = 0; let pressureTarget = 0;
    let pinch = 0; let pinchVelocity = 0; let pinchTarget = 0;
    let reaction: { kind: MascotGesture; hit: MascotHit | undefined; elapsed: number; duration: number } | null = null;
    let impulse = 0;
    // 角色保留短时兴奋和注意力；自主动作只在手离开后发生，不争抢当前手势。
    let energy = 0; let lastContact = 0; let nextBlink = 1.5 + Math.random() * 2;
    let blinkStarted = -10; let blinkAmount = 0;
    let nextIdle = DYNAMICS.idleMinimumSeconds; let idle: { action: MascotReply['action']; elapsed: number; duration: number } | null = null;
    let idleLookX = 0; let idleLookY = 0; let wake = 0;
    const springAxis = { value: 0, velocity: 0 };
    const effectOrigin = new THREE.Vector3();
    let hasLook = false;
    let eyeLookX = 0; let eyeLookY = 0; let eyeProximity = 0;
    let previousDeformed = false;
    let mouthDirty = true;
    let lastBounds = '';
    const residuals: (MascotResidualField & { remaining: number })[] = [];
    const residualScratch = new THREE.Vector3();
    const scratch = new THREE.Vector3(); const mapped = new THREE.Vector3();
    const normal = new THREE.Vector3(); const tangentX = new THREE.Vector3(); const tangentY = new THREE.Vector3();
    const axisZ = new THREE.Vector3(0, 0, 1);
    const faceProjection = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const bounds = new THREE.Box3();
    const deformation: MascotDeformation = { kind: fieldKind, anchor: fieldAnchor, pull, pressure: 0, pinch: 0, impulse: 0, time: 0 };

    // 照顾状态只属于当前场景；同一时刻最多一个递送/回应，睡姿单独锁存。
    let petProps: PetPropRig | null = null; let petActivity: PetActivity | null = null;
    let petAction: { response: PetResponse; elapsed: number; start: THREE.Vector3 } | null = null;
    let petResting: 'drowsy' | 'asleep' | null = null;
    let petWakeFrom: 'drowsy' | 'asleep' | null = null; let petReach = 0; let lastPetResponseId: number | null = null;
    let petAwaiting = false; let petDragging = false; let petPointer: PetPoint | null = null;
    let petLastPointer: PetPoint | null = null; let petTravel = 0;
    let petDelivery: { kind: 'bite' | 'catch'; elapsed: number; start: THREE.Vector3 } | null = null;
    let petStaticTimer: ReturnType<typeof setTimeout> | null = null; let petStaticStarted: number | null = null;
    const petMouthWorld = new THREE.Vector3(); const petHandWorld = new THREE.Vector3();
    const petMouthReceive = new THREE.Vector3(); const petHandReceive = new THREE.Vector3();
    const petHome = new THREE.Vector3(); const petEnd = new THREE.Vector3();
    const petProjection = new THREE.Vector3(); const petProjectedRadius = new THREE.Vector3();
    const petCameraFront = new THREE.Vector3(); const petCameraRight = new THREE.Vector3();
    const petSurfaceNormal = new THREE.Vector3(); const petDragOrigin = new THREE.Vector3();
    const petDragPlane = new THREE.Plane(); const petLookPoint = new THREE.Vector3();

    // 每条释放路径均幂等，清除 RAF、观察器、定时器、几何、材质、纹理和 WebGL 上下文。
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; lastFrame = 0; };
    const dispose = () => {
      if (disposed) return;
      disposed = true; stop();
      if (staticTimer) clearTimeout(staticTimer);
      if (petStaticTimer) clearTimeout(petStaticTimer);
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
    };
    const fallback = () => { dispose(); options.onReady(false); };
    function contextLost(event: Event) { event.preventDefault(); fallback(); }
    const canAnimate = () => !disposed && !reduced && inView && !document.hidden;
    const draw = () => { if (!disposed && renderer && inView && !document.hidden) { try { renderer.render(scene, camera); publishBounds(); publishPetTargets(); } catch { fallback(); } } };
    const requestFrame = () => { if (canAnimate() && !frame) frame = requestAnimationFrame(animate); };
    const setExpression = (next: MascotExpression) => { expression = next; if (mouth && mouth.geometry !== mouthGeometries.get(next)) { mouth.geometry = mouthGeometries.get(next)!; mouthDirty = true; } };

    // 对身体、五官附着点和嘴部顶点使用同一个局部位移场，不能让脸停在变形前的表面。
    function deformPoint(point: THREE.Vector3, output: THREE.Vector3): THREE.Vector3 {
      deformMascotLayers(point, deformation, residuals, output, residualScratch);
      return output;
    }

    function updateDeformation() {
      if (!bodyGeometry) return;
      deformation.kind = fieldKind; deformation.pull = fieldKind === 'drag' ? grab : pull; deformation.pressure = pressure; deformation.pinch = pinch; deformation.impulse = impulse; deformation.time = time;
      const deformed = residuals.some(item => item.weight > 0) || (fieldKind === 'drag' ? grab : pull).lengthSq() > 0.0000001 || Math.abs(pressure) + Math.abs(pinch) + Math.abs(impulse) > 0.0001;
      if (deformed || previousDeformed) {
        const positions = bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index += 1) {
          scratch.fromArray(bodyRest, index * 3); deformPoint(scratch, mapped); positions.setXYZ(index, mapped.x, mapped.y, mapped.z);
        }
        positions.needsUpdate = true;
        bodyGeometry.computeVertexNormals(); bodyGeometry.computeBoundingBox();
      }
      // 当前嘴型使用缓存的休息顶点重算；切换表情后不会继承上一个形变的误差。
      if (deformed || previousDeformed || mouthDirty) {
        const mouthPositions = mouth.geometry.getAttribute('position') as THREE.BufferAttribute;
        const rest = mouthRest.get(mouth.geometry)!;
        for (let index = 0; index < mouthPositions.count; index += 1) {
          scratch.fromArray(rest, index * 3); deformPoint(scratch, mapped); mouthPositions.setXYZ(index, mapped.x, mapped.y, mapped.z);
        }
        mouthPositions.needsUpdate = true; mouth.geometry.computeVertexNormals(); mouthDirty = false;
      }
      for (const attachment of faceAttachments) {
        deformPoint(attachment.rest, attachment.object.position);
        deformPoint(attachment.tangentX, tangentX).sub(attachment.object.position);
        deformPoint(attachment.tangentY, tangentY).sub(attachment.object.position);
        normal.crossVectors(tangentX, tangentY).normalize();
        attachment.object.quaternion.setFromUnitVectors(axisZ, normal);
      }
      for (const part of arms) { deformPoint(part.position, mapped); part.position.copy(mapped); }
      for (const part of feet) { deformPoint(part.position, mapped); part.position.copy(mapped); }
      previousDeformed = deformed;
    }

    /** 嘴和手从当前贴面节点取得世界坐标；所有接收点都留在网格表面前方。 */
    function petObject() { return petActivity && petProps ? petProps.objects[petActivity] : null; }
    function petReceivers() {
      if (!laughMouth || arms.length < 2) return;
      scene.updateMatrixWorld(true); camera.getWorldDirection(petCameraFront).negate();
      laughMouth.getWorldPosition(petMouthWorld);
      petSurfaceNormal.set(0, 0, 1).transformDirection(laughMouth.matrixWorld);
      petMouthReceive.copy(petMouthWorld).addScaledVector(petSurfaceNormal, PET.mouthClearance);
      petHandWorld.set(0.13, -0.17, 0.12); arms[1].localToWorld(petHandWorld);
      petHandReceive.copy(petHandWorld).addScaledVector(petCameraFront, PET.handClearance);
    }
    function petPixel(point: THREE.Vector3): PetPoint {
      petProjection.copy(point).project(camera);
      return { x: (petProjection.x + 1) * host.clientWidth / 2, y: (1 - petProjection.y) * host.clientHeight / 2 };
    }
    function petRadiusPixels(object: THREE.Group): number {
      if (!petActivity) return 0;
      camera.updateMatrixWorld(true); petCameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
      petProjection.copy(object.position).project(camera);
      petProjectedRadius.copy(object.position).addScaledVector(petCameraRight, PET.radius[petActivity] * object.scale.x).project(camera);
      return Math.max(1, Math.hypot((petProjectedRadius.x - petProjection.x) * host.clientWidth / 2, (petProjectedRadius.y - petProjection.y) * host.clientHeight / 2));
    }
    function publishPetTargets() {
      if (!options.onPetTargets || !laughMouth) return;
      petReceivers(); const object = petObject();
      options.onPetTargets({
        prop: object?.visible && object.scale.x > 0.03 ? { ...petPixel(object.position), radius: petRadiusPixels(object) } : null,
        mouth: petPixel(petMouthWorld), hand: petPixel(petHandWorld),
      });
    }
    function petHomePoint(output: THREE.Vector3) {
      if (!petActivity) return output.setScalar(0);
      const home = PET.home[petActivity]; output.set(home.x, home.y, home.z);
      // 点心托盘和静止小球落在脚边，不跟着身体被拖到空中；月亮仍跟随头部。
      return petActivity === 'sleep' ? rig.localToWorld(output) : output;
    }
    function petDirectPoint(point: PetPoint, output: THREE.Vector3) {
      const object = petObject(); if (!object || !petActivity) return output;
      const clamped = clampPetPointer(point, host.clientWidth, host.clientHeight, Math.max(PET.minimumTargetRadiusPx, petRadiusPixels(object)), PET.stagePaddingPx);
      petHomePoint(petHome);
      petDragOrigin.copy(petActivity === 'sleep' ? petHome : petMouthWorld).addScaledVector(petCameraFront, petActivity === 'sleep' ? 0 : PET.dragPlaneClearance);
      petDragPlane.setFromNormalAndCoplanarPoint(petCameraFront, petDragOrigin);
      ndc.set(clamped.x, -clamped.y); raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(petDragPlane, output)) output.copy(petHome);
      if (petActivity === 'sleep') { output.sub(petHome).clampLength(0, PET.moonTravel).add(petHome); }
      return output;
    }
    function petIsBusy() { return Boolean(held) || petAwaiting || Boolean(petDelivery) || Boolean(petAction && !['drowsy', 'asleep'].includes(petAction.response.kind) && petAction.elapsed < petAction.response.durationMs); }
    function petPhase() {
      if (!petAction) return 1;
      return reduced ? petResting ? 1 : PET.staticResponsePhase : Math.min(1, petAction.elapsed / Math.max(1, petAction.response.durationMs));
    }

    /** 静态回应也按“可见时间”结束；后台和离屏不会提前耗掉一轮反馈。 */
    function pausePetTimer() {
      if (petStaticTimer) clearTimeout(petStaticTimer);
      petStaticTimer = null;
      if (petStaticStarted !== null && petAction) petAction.elapsed += Math.max(0, performance.now() - petStaticStarted);
      petStaticStarted = null;
    }
    function resumePetTimer() {
      pausePetTimer();
      if (!reduced || disposed || !inView || document.hidden || !petAction) return;
      const remaining = Math.max(0, petAction.response.durationMs - petAction.elapsed);
      if (!remaining) return;
      petStaticStarted = performance.now();
      petStaticTimer = setTimeout(() => {
        petStaticTimer = null; petStaticStarted = null;
        if (disposed || !petAction) return;
        petAction.elapsed = petAction.response.durationMs;
        if (!petResting) { petAction = null; if (!held && !reaction) setExpression(baseExpression(currentMood)); }
        renderDirect();
      }, remaining);
    }
    function emitPetEvent(kind: PetEventKind) {
      if (disposed || petAwaiting || !options.onPetEvent) return;
      // 先锁再回调，React稍后给回应或null ACK，碰撞不会每帧重复发送。
      petAwaiting = true; options.onPetEvent({ kind, at: performance.now() });
    }
    function petSoothing(kind: MascotGesture, hit?: MascotHit) { return petActivity === 'sleep' && (kind === 'pat' || kind === 'poke' && hit?.region === 'head'); }
    function interruptPet(kind: MascotGesture, hit?: MascotHit) {
      petDragging = false; petPointer = null; petLastPointer = null; petDelivery = null; petAwaiting = false;
      if (petSoothing(kind, hit)) return;
      pausePetTimer(); const wasSleeping = petResting === 'asleep';
      petAction = null; petResting = null;
      if (wasSleeping) emitPetEvent('wake');
    }
    /** 小手先追上接触动作再慢慢收回，不能在回应首尾一帧跳到脸前。 */
    function updatePetReach(delta: number) {
      const eating = petAction?.response.kind === 'eat';
      const target = eating ? 1 - THREE.MathUtils.smoothstep(petPhase(), 0.82, 1) : petActivity === 'feed' && (petDragging || petDelivery || petAwaiting) ? 1 : 0;
      petReach += (target - petReach) * (reduced ? 1 : 1 - Math.exp(-PET.pose.reachFollowSpeed * delta));
    }
    function advancePet(delta: number) {
      if (petAction) {
        petAction.elapsed = Math.min(petAction.response.durationMs, petAction.elapsed + delta * 1000);
        if (petAction.elapsed >= petAction.response.durationMs && !petResting) { petAction = null; if (!held && !reaction) setExpression(baseExpression(currentMood)); }
      }
      if (petDelivery) {
        petDelivery.elapsed += delta;
        if (petDelivery.elapsed >= PET.deliverySeconds) {
          const kind = petDelivery.kind; petDelivery = null; emitPetEvent(kind);
        }
      }
      updatePetReach(delta);
    }

    /** 先叠加重心和短手姿态，再计算局部贴面；吃饭、玩球和睡觉互不叠播。 */
    function applyPetPose() {
      if (held && !petSoothing(held.kind, held.hit)) return;
      const kind = petAction?.response.kind; const phase = petPhase();
      const variant = Math.abs(Math.floor(petAction?.response.variant ?? 0)) % 3;
      const pulse = reduced ? 0.85 : Math.sin(Math.PI * phase);
      if (petReach > 0.001) arms.forEach((arm, index) => { const side = index === 0 ? -1 : 1; arm.position.x = THREE.MathUtils.lerp(arm.position.x, side * 0.39, petReach * 0.8); arm.position.y -= petReach * 0.1; arm.position.z = THREE.MathUtils.lerp(arm.position.z, PET.pose.feedingHandFront, petReach); arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, -side * 0.4, petReach); });
      if (kind === 'eat') { rig.rotation.x += (reduced ? 0.025 : Math.sin(phase * Math.PI * (PET.pose.chewCycles + variant % 2) * 2) * 0.025) * pulse; blushMaterial.opacity += 0.12 * pulse; }
      if (kind === 'full') {
        rig.rotation.y += reduced ? -0.07 : Math.sin(phase * Math.PI * (4 + variant)) * PET.pose.fullShake * pulse;
        arms.forEach((arm, index) => { arm.position.x = THREE.MathUtils.lerp(arm.position.x, (index === 0 ? -1 : 1) * 0.43, pulse); arm.position.y = THREE.MathUtils.lerp(arm.position.y, -0.23, pulse); arm.position.z = THREE.MathUtils.lerp(arm.position.z, 0.78, pulse); arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, (index === 0 ? 1 : -1) * 0.5, pulse); });
        rig.scale.x *= 1 + pulse * 0.025;
      }
      if (petActivity === 'tease' && (petDragging || petDelivery || kind === 'play' || kind === 'excited')) {
        const right = arms[1]; const reaching = petDragging || petDelivery ? 1 : pulse; right.position.z = THREE.MathUtils.lerp(right.position.z, PET.pose.playingHandFront, reaching); right.position.y += 0.08 * reaching; right.rotation.z += (0.35 + variant * 0.04) * reaching;
        if (!reduced) { rig.rotation.z += eyeLookX * 0.035; rig.rotation.y += eyeLookX * 0.045; }
        if (kind === 'excited' && !reduced) { rig.position.y += Math.abs(Math.sin(phase * Math.PI * 3)) * pulse * 0.075; feet.forEach((foot, index) => { foot.rotation.z += (index === 0 ? -1 : 1) * pulse * 0.12; }); }
      }
      if (kind === 'tired') { rig.rotation.x += 0.1 * pulse; arms.forEach(arm => { arm.rotation.z *= 0.4; }); }
      if (petResting || kind === 'wake' && petWakeFrom) {
        const resting = petResting ?? petWakeFrom;
        const settle = kind === 'wake' ? 1 - THREE.MathUtils.smoothstep(phase, 0, PET.pose.wakeReleasePhase) : petAction ? THREE.MathUtils.smoothstep(phase, 0, 0.8) : 1;
        rig.rotation.z -= settle * (resting === 'asleep' ? PET.pose.sleepTilt : PET.pose.sleepTilt * 0.46); rig.position.y -= settle * 0.025;
        arms.forEach((arm, index) => { arm.position.x = THREE.MathUtils.lerp(arm.position.x, (index === 0 ? -1 : 1) * 0.57, settle); arm.position.z = THREE.MathUtils.lerp(arm.position.z, PET.pose.foldedHandFront, settle); arm.rotation.z += (index === 0 ? -1 : 1) * settle * 0.38; });
      }
      if (kind === 'wake') { arms[0].rotation.z -= pulse * PET.pose.wakeStretch; arms[1].rotation.z += pulse * PET.pose.wakeStretch; rig.scale.y *= 1 + pulse * 0.055; rig.scale.x *= 1 - pulse * 0.025; }
    }
    function applyPetFace() {
      laughMouth.scale.setScalar(1);
      if (held && !petSoothing(held.kind, held.hit)) return;
      const kind = petAction?.response.kind; const phase = petPhase();
      const chewing = kind === 'eat' && phase < 0.82;
      const anticipating = petActivity === 'feed' && (petDragging || petDelivery || petAwaiting);
      if (chewing || anticipating) {
        laughMouth.visible = true; mouth.visible = false;
        const cycles = PET.pose.chewCycles + Math.abs(Math.floor(petAction?.response.variant ?? 0)) % 2;
        const chew = reduced ? 0.65 : 0.55 + Math.abs(Math.sin(phase * Math.PI * cycles * 2)) * 0.65;
        laughMouth.scale.set(chewing ? 0.9 : 1.25, chewing ? chew : 1.25, 1);
      } else if (kind === 'play' || kind === 'excited') { laughMouth.visible = kind === 'excited'; mouth.visible = !laughMouth.visible; }
    }
    function updatePetProps(delta = 0) {
      if (!petProps || !petActivity) return;
      petReceivers(); const object = petProps.objects[petActivity]; petHomePoint(petHome);
      object.scale.setScalar(1); object.visible = true;
      petProps.tray.visible = petActivity === 'feed';
      if (petActivity === 'feed') petProps.tray.position.copy(petHome);
      if (petDragging && petPointer) petDirectPoint(petPointer, object.position);
      else if (petDelivery) {
        petEnd.copy(petDelivery.kind === 'bite' ? petMouthReceive : petHandReceive);
        petArcPoint(petDelivery.start, petEnd, petDelivery.elapsed / PET.deliverySeconds, PET.deliveryArc, object.position);
      } else if (petAction?.response.kind === 'eat') {
        const phase = petPhase();
        petArcPoint(petAction.start, petMouthReceive, Math.min(1, phase / 0.33), PET.deliveryArc * 0.5, object.position);
        const scale = 1 - THREE.MathUtils.smoothstep(phase, 0.25, 0.48); object.scale.setScalar(scale); object.visible = scale > 0.015;
      } else if (petAction && ['play', 'excited'].includes(petAction.response.kind)) {
        const phase = petPhase();
        if (phase < 0.5) petArcPoint(petAction.start, petHandReceive, Math.min(1, phase / 0.28), PET.deliveryArc, object.position);
        else petArcPoint(petHandReceive, petHome, (phase - 0.5) / 0.5, PET.deliveryArc * 0.6, object.position);
        object.rotation.z = reduced ? -0.15 : Math.sin(petPhase() * Math.PI * 3) * 0.25;
      } else if (!petAwaiting) {
        object.position.lerp(petHome, reduced || !delta ? 1 : 1 - Math.exp(-10 * delta));
      }
      if (petActivity === 'sleep') object.rotation.z = reduced ? -0.12 : -0.12 + (petDragging ? Math.sin(time * 8) * 0.08 : Math.sin(time * 1.4) * 0.035);
      if (petActivity === 'tease' && petDragging && !reduced) { object.rotation.x += delta * 1.2; object.rotation.y += delta * 1.8; }
    }
    function petInput(input: PetInput) {
      if (disposed || !petActivity || !petProps) return;
      const object = petObject()!;
      if (input.type === 'cancel') {
        pausePetTimer(); petDragging = false; petPointer = null; petLastPointer = null; petDelivery = null; petAwaiting = false;
        if (!petResting) petAction = null;
        refreshPet(); return;
      }
      if (input.type === 'activate') {
        if (petIsBusy()) return;
        lastContact = time; idle = null;
        if (petActivity === 'sleep') { emitPetEvent('soothe'); refreshPet(); return; }
        if (reduced) { emitPetEvent(petActivity === 'feed' ? 'bite' : 'catch'); refreshPet(); return; }
        petDelivery = { kind: petActivity === 'feed' ? 'bite' : 'catch', elapsed: 0, start: object.position.clone() }; requestFrame(); return;
      }
      if (input.type === 'start') {
        if (petIsBusy() || !input.point) return;
        petDragging = true; petPointer = input.point; petLastPointer = input.point; petTravel = 0;
        active = null; reaction = null; idle = null; lastContact = time; refreshPet(); return;
      }
      if (!petDragging) return;
      if (input.point) {
        if (petLastPointer) petTravel += Math.hypot((input.point.x - petLastPointer.x) * host.clientWidth / 2, (input.point.y - petLastPointer.y) * host.clientHeight / 2);
        petLastPointer = input.point; petPointer = input.point;
      }
      lastContact = time;
      if (input.type === 'move') { refreshPet(); return; }
      if (input.type === 'release') {
        updatePetProps(0); petDragging = false; petPointer = null; petLastPointer = null; petReceivers();
        if (petActivity === 'sleep') { if (petTravel >= PET.sootheTravelPx) emitPetEvent('soothe'); }
        else {
          const target = petActivity === 'feed' ? petMouthWorld : petHandWorld;
          const reach = petActivity === 'feed' ? PET.mouthReach : PET.handReach;
          const radius = Math.max(PET.minimumTargetRadiusPx, reach * camera.zoom * host.clientHeight / (camera.top - camera.bottom));
          if (petTargetContains(petPixel(object.position), petPixel(target), radius)) emitPetEvent(petActivity === 'feed' ? 'bite' : 'catch');
        }
        refreshPet();
      }
    }
    function refreshPet() { if (reduced) { renderDirect(); resumePetTimer(); } else { updatePetProps(1 / 60); draw(); requestFrame(); } }
    function petRespond(response: PetResponse | null) {
      if (disposed) return;
      petAwaiting = false;
      if (!response) { refreshPet(); return; }
      if (response.id === lastPetResponseId) return;
      const family = response.kind === 'eat' || response.kind === 'full' ? 'feed' : ['play', 'excited', 'tired'].includes(response.kind) ? 'tease' : response.kind === 'drowsy' || response.kind === 'asleep' ? 'sleep' : null;
      if (family && family !== petActivity) return;
      lastPetResponseId = response.id; pausePetTimer(); petDragging = false; petPointer = null; petDelivery = null;
      if (response.kind === 'wake') { petWakeFrom = petResting ?? petWakeFrom; petResting = null; }
      else if (response.kind === 'asleep' || response.kind === 'drowsy') petResting = response.kind;
      else petResting = null;
      if (held && !petSoothing(held.kind, held.hit)) { petAction = null; return; }
      active = null; reaction = null; idle = null; lastContact = time; energy = Math.min(1, energy + response.intensity * 0.2);
      petAction = { response, elapsed: 0, start: petObject()?.position.clone() ?? petMouthWorld.clone() };
      setExpression(response.kind === 'asleep' || response.kind === 'drowsy' || response.kind === 'tired' ? 'sleepy' : response.kind === 'full' ? 'soft' : 'happy');
      refreshPet();
    }

    // 眼球和高光独立移动，靠近时眯眼、远处时略睁大；不是仅转动整颗团子。
    function updateEyes(delta: number) {
      const settle = reduced ? 1 : 1 - Math.exp(-18 * delta);
      const faceCenter = faceProjection.set(0, SETTINGS.face.eyeY, SETTINGS.body.depth).applyMatrix4(rig.matrixWorld).project(camera);
      const distance = Math.hypot(pointerX - faceCenter.x, pointerY + faceCenter.y);
      const proximity = hasLook ? 1 - THREE.MathUtils.clamp(distance / 0.62, 0, 1) : 0;
      const attentive = hasLook && time - lastContact < 4;
      const object = petObject(); const watchingProp = object?.visible && !held && !petResting && petActivity !== 'sleep';
      if (watchingProp) petLookPoint.copy(object.position).project(camera);
      const targetX = watchingProp ? THREE.MathUtils.clamp((petLookPoint.x - faceCenter.x) * 1.8, -1, 1) : attentive ? THREE.MathUtils.clamp((pointerX - faceCenter.x) * 1.8, -1, 1) : idle ? idleLookX : 0;
      const targetY = watchingProp ? THREE.MathUtils.clamp((-petLookPoint.y + faceCenter.y) * 1.8, -1, 1) : attentive ? THREE.MathUtils.clamp((pointerY + faceCenter.y) * 1.8, -1, 1) : idle ? idleLookY : 0;
      eyeLookX += (targetX - eyeLookX) * settle; eyeLookY += (targetY - eyeLookY) * settle;
      eyeProximity += (proximity - eyeProximity) * settle;
      const gesture = held?.kind ?? reaction?.kind;
      const gesturePulse = held ? Math.max(0.35, pressure) : reaction ? Math.sin(Math.PI * reaction.elapsed / reaction.duration) : 0;
      for (let index = 0; index < eyes.length; index += 1) {
        const dizzy = gesture === 'shake' && !reduced ? gesturePulse : 0;
        const dx = eyeLookX * INTERACTION.eyeTravelX + Math.cos(time * 12 + index) * dizzy * 0.011;
        const dy = -eyeLookY * INTERACTION.eyeTravelY + Math.sin(time * 12 + index) * dizzy * 0.011;
        pupils[index].position.set(dx, dy, 0);
        highlights[index].position.set(-0.018 + dx * 1.18, 0.027 + dy * 0.85, 0.034);
        const interest = hasLook ? THREE.MathUtils.lerp(INTERACTION.farEyeHeight, INTERACTION.nearEyeHeight, eyeProximity) : 1;
        eyes[index].scale.y *= interest;
        if (gesture === 'pat' || gesture === 'tickle') eyes[index].scale.y *= Math.max(0.12, 1 - gesturePulse * 0.8);
        if (gesture === 'pinch' && (held?.hit.region ?? reaction?.hit?.region) === (index === 0 ? 'cheek-left' : 'cheek-right')) eyes[index].scale.y *= 0.55;
        const sleepy = !held && !reaction && !active ? THREE.MathUtils.smoothstep(time - lastContact, DYNAMICS.sleepAfterSeconds, DYNAMICS.sleepAfterSeconds + 8) : 0;
        eyes[index].scale.y *= (1 - blinkAmount * 0.94) * (1 - sleepy * 0.7);
        eyes[index].scale.x = 1 + wake * 0.1 + (gesture === 'drag' ? 0.1 : 0);
        // 眉毛与眼球分层：拉脸一高一低，摸头放松，提起来时先抬眉。
        brows[index]?.rotateZ((index === 0 ? -1 : 1) * (gesture === 'pinch' ? 0.22 + pull.x * 0.5 : gesture === 'drag' ? -0.22 : -eyeLookY * 0.12));
        if (!held || petSoothing(held.kind, held.hit)) {
          if (petResting) { const amount = petAction ? THREE.MathUtils.smoothstep(petPhase(), 0, 0.8) : 1; eyes[index].scale.y = THREE.MathUtils.lerp(eyes[index].scale.y, petResting === 'asleep' ? 0.045 : 0.3, amount); }
          else if (petAction?.response.kind === 'eat') eyes[index].scale.y *= 0.78;
          else if (petAction?.response.kind === 'full' || petAction?.response.kind === 'tired') eyes[index].scale.y *= 0.65;
          else if (petAction?.response.kind === 'excited') eyes[index].scale.y *= 1.12;
          else if (petAction?.response.kind === 'wake' && petWakeFrom) eyes[index].scale.y *= THREE.MathUtils.lerp(petWakeFrom === 'asleep' ? 0.045 : 0.3, 1, THREE.MathUtils.smoothstep(petPhase(), 0, PET.pose.wakeEyePhase));
        }
      }
    }

    // 对外公布模型在画布中的实际像素框，触摸区可以紧贴角色而不覆盖空白舞台。
    function publishBounds() {
      if (!bodyGeometry || !host.clientWidth || !host.clientHeight) return;
      scene.updateMatrixWorld(true); bounds.setFromObject(floating);
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        scratch.set(x, y, z).project(camera);
        const px = (scratch.x + 1) * host.clientWidth / 2; const py = (1 - scratch.y) * host.clientHeight / 2;
        left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
      left = Math.max(0, left); top = Math.max(0, top); right = Math.min(host.clientWidth, right); bottom = Math.min(host.clientHeight, bottom);
      const key = [left, top, right, bottom].map(value => Math.round(value * 2) / 2).join(',');
      if (key !== lastBounds) { lastBounds = key; options.onBounds({ left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }); }
    }

    function hitTest(x: number, y: number): MascotHit | null {
      if (disposed || !bodyGeometry) return null;
      scene.updateMatrixWorld(true); ndc.set(x, -y); raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(hitTargets, false)[0];
      if (!hit) return null;
      const local = rig.worldToLocal(hit.point.clone());
      const region = hit.object.userData.region ?? (local.y > 0.48 ? 'head' : Math.abs(local.x) > 0.3 && local.y > -0.32 && local.y < 0.35 ? local.x < 0 ? 'cheek-left' : 'cheek-right' : local.y < -0.2 && Math.abs(local.x) < 0.64 ? 'belly' : 'body');
      return { region, local: { x: local.x, y: local.y, z: local.z } };
    }

    function resetSpring() { residuals.length = 0; grab.setScalar(0); grabVelocity.setScalar(0); grabTarget.setScalar(0); pull.setScalar(0); pullVelocity.setScalar(0); pullTarget.setScalar(0); pressure = 0; pressureVelocity = 0; pressureTarget = 0; pinch = 0; pinchVelocity = 0; pinchTarget = 0; }
    /** 换部位时将旧局部形变留在原处短暂消退，重心弹簧继续独立运行。 */
    function switchField(kind: MascotGesture, local: MascotHit['local']) {
      const nextKind = kind === 'shake' ? 'drag' : kind;
      if (nextKind !== fieldKind || fieldAnchor.distanceToSquared(local as THREE.Vector3) > 0.08) {
        const source = fieldKind === 'drag' ? grab : pull;
        if (!reduced && source.lengthSq() + Math.abs(pressure) + Math.abs(pinch) + Math.abs(impulse) > 0.002) {
          residuals.push({ field: { kind: fieldKind, anchor: { x: fieldAnchor.x, y: fieldAnchor.y, z: fieldAnchor.z }, pull: { x: source.x, y: source.y, z: source.z }, pressure, pinch, impulse, time }, weight: 1, remaining: INTERACTION.residualSeconds });
          if (residuals.length > INTERACTION.maximumResiduals) residuals.shift();
        }
        pull.setScalar(0); pullVelocity.setScalar(0); pressure = 0; pressureVelocity = 0; pinch = 0; pinchVelocity = 0; impulse = 0;
      }
      fieldKind = nextKind; fieldAnchor.set(local.x, local.y, local.z);
    }
    function stepSpring(delta: number) {
      for (const item of residuals) { item.remaining = Math.max(0, item.remaining - delta); const phase = item.remaining / INTERACTION.residualSeconds; item.weight = phase * phase * (3 - 2 * phase); }
      const stiffness = held ? DYNAMICS.heldStiffness : DYNAMICS.releaseStiffness;
      const damping = held ? DYNAMICS.heldDamping : DYNAMICS.releaseDamping;
      for (const axis of ['x', 'y', 'z'] as const) {
        springAxis.value = pull[axis]; springAxis.velocity = pullVelocity[axis];
        advanceMascotSpring(springAxis, pullTarget[axis], delta, stiffness, damping);
        pull[axis] = springAxis.value; pullVelocity[axis] = springAxis.velocity;
        springAxis.value = grab[axis]; springAxis.velocity = grabVelocity[axis];
        advanceMascotSpring(springAxis, grabTarget[axis], delta, stiffness, damping); grab[axis] = springAxis.value; grabVelocity[axis] = springAxis.velocity;
      }
      springAxis.value = pressure; springAxis.velocity = pressureVelocity;
      advanceMascotSpring(springAxis, pressureTarget, delta, held ? DYNAMICS.pressureStiffness : stiffness, held ? DYNAMICS.pressureDamping : damping);
      pressure = springAxis.value; pressureVelocity = springAxis.velocity;
      springAxis.value = pinch; springAxis.velocity = pinchVelocity;
      advanceMascotSpring(springAxis, pinchTarget, delta, stiffness, damping);
      pinch = springAxis.value; pinchVelocity = springAxis.velocity;
    }

    /** 不规则眨眼、目光停留与重心小动作，让静置的角色也有自己的节奏。 */
    function updateLife(delta: number) {
      energy *= Math.exp(-delta / 4.5); wake *= Math.exp(-delta * 4);
      if (time >= nextBlink) { blinkStarted = time; nextBlink = time + DYNAMICS.blinkMinimumSeconds + Math.random() * DYNAMICS.blinkRangeSeconds; }
      const blinkPhase = (time - blinkStarted) / DYNAMICS.blinkSeconds;
      blinkAmount = blinkPhase >= 0 && blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) ** 2 : 0;
      if (held || reaction || active || petAction || petResting || petDragging || petDelivery) { idle = null; nextIdle = time + 3; return; }
      if (!idle && time >= nextIdle) {
        idle = { action: INTERACTION.idleActions[Math.floor(Math.random() * INTERACTION.idleActions.length)], elapsed: 0, duration: 1.7 + Math.random() * 1.2 };
        idleLookX = (Math.random() - 0.5) * 0.65; idleLookY = (Math.random() - 0.5) * 0.3;
        nextIdle = time + DYNAMICS.idleMinimumSeconds + Math.random() * DYNAMICS.idleRangeSeconds;
      }
      if (idle) { idle.elapsed += delta; if (idle.elapsed >= idle.duration) idle = null; }
    }

    /** 少量反馈粒子按需复用，不进入命中框，也不为每次互动分配GPU资源。 */
    function emitFeeling(kind: MascotGesture, hit?: MascotHit) {
      if (reduced) return;
      scene.updateMatrixWorld(true);
      effectOrigin.set(hit?.local.x ?? 0, hit?.local.y ?? 0.4, hit?.local.z ?? 0.85); rig.localToWorld(effectOrigin);
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]; const angle = index / particles.length * Math.PI * 2;
        particle.age = -index * 0.018; particle.mesh.visible = true;
        particle.mesh.position.copy(effectOrigin); particle.mesh.position.z += 0.12;
        particle.velocity.set(Math.cos(angle) * (0.12 + Math.random() * 0.18), 0.22 + Math.sin(angle) * 0.14, 0);
        particle.spin = (Math.random() - 0.5) * 2;
        particle.mesh.material.color.set(kind === 'pat' || kind === 'pinch' ? '#d4a4a0' : '#c7af72');
      }
    }
    function updateFeeling(delta: number) {
      for (const particle of particles) {
        if (!particle.mesh.visible) continue;
        particle.age += delta;
        if (reduced || particle.age >= INTERACTION.particleLifetime) { particle.mesh.visible = false; continue; }
        const phase = Math.max(0, particle.age / INTERACTION.particleLifetime);
        particle.mesh.position.addScaledVector(particle.velocity, delta); particle.velocity.y -= delta * 0.19;
        particle.mesh.rotation.z += particle.spin * delta;
        particle.mesh.material.opacity = Math.sin(Math.PI * phase) * 0.7;
        particle.mesh.scale.setScalar(0.5 + Math.sin(Math.PI * phase) * 0.6);
      }
    }

    // 部件始终从休息姿势计算动作，避免连续互动导致缩放或转向不断累积。
    function pose(progress: number, action: MascotReply['action'] | null) {
      const pulse = Math.sin(Math.PI * progress);
      const wiggle = Math.sin(progress * Math.PI * 4) * pulse;
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
      arms.forEach((arm, index) => { arm.position.set((index === 0 ? -1 : 1) * 0.86, 0.03, 0.02); arm.rotation.z = index === 0 ? -0.12 : 0.12; });
      feet.forEach((foot, index) => { foot.position.set((index === 0 ? -1 : 1) * 0.33, -0.89, 0.35); foot.rotation.set(0, 0, 0); });
      const eyeHeight = expression === 'sleepy' ? 0.26 : expression === 'soft' ? 0.85 : 1;
      eyes[0].scale.y = expression === 'wink' ? 0.12 : eyeHeight; eyes[1].scale.y = eyeHeight;
      if (!reduced) { const breath = Math.sin(time * (2.1 + energy * 0.35)); rig.scale.set(1 - breath * 0.007, 1 + breath * 0.01, 1); rig.rotation.z = Math.sin(time * 0.67) * 0.008; }
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
    function applyPhysicalPose() {
      const kind = held?.kind ?? reaction?.kind ?? (Math.abs(pressure) + pull.length() > 0.001 ? fieldKind : null);
      const progress = reaction ? THREE.MathUtils.clamp(reaction.elapsed / reaction.duration, 0, 1) : 0;
      const releasePulse = Math.sin(Math.min(1, progress * 2.4) * Math.PI) * Math.exp(-progress * 1.7);
      const pulse = Math.min(1, Math.max(0, pressure, held ? 0.12 : reaction ? releasePulse : 0));
      impulse = reaction && ['poke', 'pat', 'tickle'].includes(reaction.kind) ? pulse * 0.65 : 0;
      const springMotion = reduced ? 0 : THREE.MathUtils.clamp((grabVelocity.x + pullVelocity.x) * 0.05 + pressureVelocity * 0.025, -0.22, 0.22);
      if (kind === 'poke') { rig.rotation.z -= fieldAnchor.x * pulse * 0.08; rig.scale.x *= 1 + pulse * 0.035; rig.scale.y *= 1 - pulse * 0.04; }
      if (kind === 'pinch' || fieldKind === 'pinch' && pull.lengthSq() > 0.0001) {
        rig.rotation.z -= pull.x * 0.14;
        // 两只短手伸向被捏的脸，脸颊放开后小手稍晚归位。
        arms.forEach((arm, index) => { const side = index === 0 ? -1 : 1; arm.rotation.z -= side * (Math.abs(pull.x) * 0.6 + pulse * 0.2); arm.position.z += pulse * 0.2; });
      }
      if (kind === 'pat') { rig.rotation.x += pulse * 0.11; rig.position.y -= pressure * 0.05; arms.forEach((arm, index) => { arm.rotation.z += (index === 0 ? -1 : 1) * pulse * 0.3; }); }
      if (kind === 'tickle' && !reduced) {
        const giggle = Math.sin(time * 21) * pulse;
        rig.rotation.z += giggle * 0.065; rig.position.y += Math.abs(giggle) * 0.045;
        rig.scale.y *= 1 - pulse * 0.045; rig.scale.x *= 1 + pulse * 0.05;
        arms.forEach((arm, index) => { arm.rotation.z += (index === 0 ? -1 : 1) * pulse * (0.6 + Math.sin(time * 15) * 0.18); });
      }
      if (kind === 'wave') { const index = (held?.hit.region ?? reaction?.hit?.region) === 'hand-left' ? 0 : 1; arms[index].rotation.z += (index === 0 ? -1 : 1) * pulse * (0.95 + Math.sin(progress * Math.PI * 7) * 0.32); }
      if (kind === 'bounce' && !reduced) {
        // 蹦起之前先蹲一下，落地后再有一次小回弹。
        const hop = progress < 0.18 ? -Math.sin(progress / 0.18 * Math.PI) * 0.045 : Math.max(0, Math.sin((progress - 0.18) / 0.82 * Math.PI * 1.6)) * 0.25 * (1 - progress * 0.6);
        rig.position.y += hop; rig.scale.x *= 1 - hop * 0.13; rig.scale.y *= 1 + hop * 0.2;
      }
      if (kind === 'shake' && !reduced) rig.rotation.z += Math.sin(progress * Math.PI * 7) * Math.exp(-progress * 3) * 0.16;
      if (grab.lengthSq() + grabVelocity.lengthSq() > 0.000001) {
        // 身体真正离开原位；局部软肉、重心、四肢三层保留不同的跟随节奏。
        rig.position.x += grab.x; rig.position.y += grab.y;
        rig.rotation.z -= grab.x * 0.24 + springMotion;
        const stretch = Math.max(0, grab.y) * 0.22;
        rig.scale.y *= 1 + stretch; rig.scale.x *= 1 / Math.sqrt(1 + stretch);
        arms.forEach((arm, index) => { const side = index === 0 ? -1 : 1; arm.rotation.z += side * (Math.abs(grab.y) * 0.6 + Math.sin(time * 9 + index) * Math.abs(grab.y) * 0.25) + springMotion * 1.8; });
        feet.forEach((foot, index) => { foot.rotation.z += Math.sin(time * 10 + index * 1.4) * Math.abs(grab.y) * 0.65 + springMotion; });
      }
      if (!reduced) { arms.forEach((arm, index) => { arm.rotation.z += Math.sin(time * 1.7 + index * 1.8) * 0.025 + springMotion * (index === 0 ? 0.8 : 1.1); }); feet.forEach((foot, index) => { foot.rotation.x += Math.sin(time * 1.4 + index) * energy * 0.06; }); }
      applyPetPose(); updateDeformation();
      if (laughMouth) { laughMouth.visible = kind === 'tickle' || kind === 'bounce' && pulse > 0.3; mouth.visible = !laughMouth.visible; }
      if (laughMouth) applyPetFace();
      if (contactShadow) { const lift = Math.max(0, rig.position.y); contactShadow.position.x = rig.position.x * 0.7; contactShadow.scale.setScalar(1 - Math.min(0.3, lift * 0.5)); contactShadow.material.opacity = 0.75 - Math.min(0.4, lift * 0.7); }
      scene.updateMatrixWorld(true);
    }

    /** 同一取景逻辑用于动画、低动态直接操纵与尺寸变化，最大抓取仍完整留在舞台内。 */
    function fitCamera(delta = 0) {
      const verticalSpace = camera.top / (1.15 + Math.abs(rig.position.y) + Math.abs(grab.y) * 0.15);
      const horizontalSpace = camera.right / (1.25 + Math.abs(rig.position.x) + (fieldKind === 'pinch' ? Math.abs(pull.x) : 0));
      let targetZoom = Math.min(1, verticalSpace, horizontalSpace);
      // 道具单独参与镜头安全边界，不进入团子命中框；拖动中的道具按屏幕边界夹紧。
      if (petProps && petActivity && !petDragging) {
        const object = petProps.objects[petActivity];
        if (object.visible) {
          petProjection.copy(object.position).project(camera);
          targetZoom = petSafeZoom({ x: petProjection.x, y: petProjection.y, zoom: camera.zoom, base: targetZoom, halfWidth: camera.right, halfHeight: camera.top, width: host.clientWidth, height: host.clientHeight, worldRadius: petActivity === 'feed' ? 0.28 : PET.radius[petActivity], hitRadius: PET.minimumTargetRadiusPx });
        }
      }
      const zoom = reduced || delta === 0 ? targetZoom : camera.zoom + (targetZoom - camera.zoom) * (1 - Math.exp(-12 * delta));
      if (Math.abs(camera.zoom - zoom) > 0.0001) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
    }
    function renderDirect() {
      if (disposed || !bodyGeometry) return;
      pose(0, null); if (reduced) updatePetReach(1); applyPhysicalPose(); updatePetProps(); updateEyes(1); fitCamera(); updatePetProps(); draw();
    }

    function animate(now: number) {
      frame = 0; if (!canAnimate()) return;
      const visibleElapsed = lastFrame ? Math.max(0, (now - lastFrame) / 1000) : 1 / 60;
      const delta = Math.min(visibleElapsed, 0.04);
      lastFrame = now; time += delta;
      const settle = 1 - Math.exp(-SETTINGS.settlingSpeed * delta);
      const object = petObject(); const tracking = object?.visible && !held && !petResting && petActivity !== 'sleep';
      if (tracking) petLookPoint.copy(object.position).project(camera);
      gaze.rotation.x += (SETTINGS.baseRotation.x + (tracking ? -petLookPoint.y * 0.5 : pointerY) * SETTINGS.pointerRotation.x - gaze.rotation.x) * settle;
      gaze.rotation.y += (SETTINGS.baseRotation.y + (tracking ? petLookPoint.x * 0.5 : pointerX) * SETTINGS.pointerRotation.y - gaze.rotation.y) * settle;
      floating.position.y = Math.sin(time * SETTINGS.floatFrequency) * SETTINGS.floatAmplitude * (petResting === 'asleep' ? 0.3 : 1);
      bodyMaterial.color.lerp(color, settle);
      if (active) {
        active.elapsed += delta * 1000;
        if (active.elapsed >= active.reply.durationMs) { active = null; if (!held && !reaction) setExpression(baseExpression(currentMood)); }
      }
      if (reaction) {
        reaction.elapsed += delta * 1000;
        if (reaction.elapsed >= reaction.duration) { reaction = null; if (!held) setExpression(active?.reply.expression ?? baseExpression(currentMood)); }
      }
      // 弹簧仍小步积分；照顾回应按实际可见时间推进，与按钮解锁时刻保持一致。
      updateLife(delta); stepSpring(delta); advancePet(visibleElapsed);
      pose(active ? active.elapsed / active.reply.durationMs : idle ? idle.elapsed / idle.duration : 0, active?.reply.action ?? idle?.action ?? null);
      applyPhysicalPose(); updatePetProps(delta); updateEyes(delta); updateFeeling(delta);
      // 快速变形时放宽镜头，保留一整颗团子与小手小脚。
      fitCamera(delta);
      if (petDragging) updatePetProps(delta);
      draw(); requestFrame();
    }
    function visibilityChanged() { if (document.hidden) { stop(); pausePetTimer(); } else { draw(); resumePetTimer(); requestFrame(); } }
    function motionChanged(event: MediaQueryListEvent) {
      pausePetTimer(); reduced = event.matches; stop();
      if (reduced) { residuals.length = 0; blinkAmount = 0; idle = null; updateFeeling(0); active = null; reaction = null; if (!held) resetSpring(); setExpression(baseExpression(currentMood)); floating.position.y = 0; gaze.rotation.set(SETTINGS.baseRotation.x, SETTINGS.baseRotation.y, 0); bodyMaterial.color.copy(color); renderDirect(); }
      resumePetTimer(); if (!reduced) requestFrame();
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
      bodyGeometry = geometry; bodyRest = new Float32Array(positions.array);
      // 保守射线球不随拉伸遗漏命中；真实包围盒在几何变化后更新。
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.8);
      bodyMaterial = new THREE.MeshPhysicalMaterial({ color, roughness: SETTINGS.body.roughness, clearcoat: SETTINGS.body.clearcoat, clearcoatRoughness: 0.32, metalness: 0 });
      const body = new THREE.Mesh(geometry, bodyMaterial); body.castShadow = true; body.receiveShadow = true; rig.add(body);
      hitTargets.push(body);
      const limbGeometry = new THREE.SphereGeometry(1, 20, 16);
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group(); pivot.position.set(side * 0.86, 0.03, 0.02);
        const hand = new THREE.Mesh(limbGeometry, bodyMaterial); hand.position.set(side * 0.13, -0.17, 0.12); hand.scale.set(0.14, 0.22, 0.15); hand.castShadow = true; hand.userData.region = side < 0 ? 'hand-left' : 'hand-right'; hitTargets.push(hand); pivot.add(hand); rig.add(pivot); arms.push(pivot);
        const foot = new THREE.Mesh(limbGeometry, bodyMaterial); foot.position.set(side * 0.33, -0.89, 0.35); foot.scale.set(0.19, 0.12, 0.26); foot.castShadow = true; foot.userData.region = 'body'; hitTargets.push(foot); rig.add(foot); feet.push(foot);
      }

      // 大眼、高光、腮红与嘴型贴合局部曲面；全部表情预建并复用，不随回复分配 GPU 对象。
      const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x33473d, roughness: 0.55 });
      const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfffdf5 });
      blushMaterial = new THREE.MeshStandardMaterial({ color: 0xdba79e, transparent: true, opacity: 0.27, depthWrite: false, roughness: 0.9 });
      const probe = new THREE.Mesh(geometry, faceMaterial); probe.updateMatrixWorld(true);
      const forward = new THREE.Vector3(0, 0, -1);
      const front = (x: number, y: number, offset = 0.02) => { raycaster.set(new THREE.Vector3(x, y, 3), forward); return new THREE.Vector3(x, y, (raycaster.intersectObject(probe, false)[0]?.point.z ?? SETTINGS.body.depth) + offset); };
      const attach = (object: THREE.Object3D, x: number, y: number, offset: number) => {
        const rest = front(x, y, offset); object.position.copy(rest);
        faceAttachments.push({ object, rest, tangentX: front(x + 0.006, y, offset), tangentY: front(x, y + 0.006, offset) });
      };
      const eyeGeometry = new THREE.SphereGeometry(SETTINGS.face.eyeRadius * 1.16, 20, 16);
      const glowGeometry = new THREE.SphereGeometry(0.019, 12, 10);
      const cheekGeometry = new THREE.SphereGeometry(0.12, 20, 12);
      for (const side of [-1, 1]) {
        const eye = new THREE.Group(); attach(eye, side * SETTINGS.face.eyeX, SETTINGS.face.eyeY, 0.025);
        const pupil = new THREE.Mesh(eyeGeometry, faceMaterial); pupil.scale.set(1, 1.35, 0.55); eye.add(pupil);
        const glow = new THREE.Mesh(glowGeometry, highlightMaterial); glow.position.set(-0.018, 0.027, 0.033); eye.add(glow); rig.add(eye); eyes.push(eye); pupils.push(pupil); highlights.push(glow);
        const cheek = new THREE.Mesh(cheekGeometry, blushMaterial); attach(cheek, side * 0.43, -0.055, 0.018); cheek.scale.set(1, 0.48, 0.13); rig.add(cheek);
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
        const mouthGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), 32, SETTINGS.face.mouthRadius, 8, closed);
        mouthGeometries.set(face, mouthGeometry); mouthRest.set(mouthGeometry, new Float32Array(mouthGeometry.getAttribute('position').array));
      }
      mouth = new THREE.Mesh(mouthGeometries.get(expression)!, faceMaterial); rig.add(mouth);
      const browGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.055, 0, 0), new THREE.Vector3(0, 0.018, 0), new THREE.Vector3(0.055, 0, 0)]), 10, 0.009, 5, false);
      for (const side of [-1, 1]) { const brow = new THREE.Group(); attach(brow, side * SETTINGS.face.eyeX, 0.35, 0.03); brow.add(new THREE.Mesh(browGeometry, faceMaterial)); rig.add(brow); brows.push(brow); }
      laughMouth = new THREE.Group(); attach(laughMouth, 0, -0.235, 0.04);
      const openMouth = new THREE.Mesh(limbGeometry, faceMaterial); openMouth.scale.set(0.115, 0.095, 0.025); laughMouth.add(openMouth);
      const tongue = new THREE.Mesh(limbGeometry, new THREE.MeshStandardMaterial({ color: '#d59c98', roughness: 0.7 })); tongue.scale.set(0.065, 0.026, 0.013); tongue.position.set(0, -0.035, 0.024); laughMouth.add(tongue); rig.add(laughMouth); laughMouth.visible = false;
      const sparkleGeometry = new THREE.CircleGeometry(0.018, 4);
      for (let index = 0; index < INTERACTION.particleCount; index += 1) { const mesh = new THREE.Mesh(sparkleGeometry, new THREE.MeshBasicMaterial({ color: '#c7af72', transparent: true, depthWrite: false, opacity: 0 })); mesh.visible = false; effects.add(mesh); particles.push({ mesh, velocity: new THREE.Vector3(), age: 10, spin: 0 }); }
      petProps = createPetProps(); scene.add(petProps.root);

      // 只保留边缘渐隐的接触柔影，避免拖到舞台旁边时方向投影被裁成矩形。
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 7, 64, 64, 63); gradient.addColorStop(0, 'rgba(45,65,48,.23)'); gradient.addColorStop(0.4, 'rgba(45,65,48,.11)'); gradient.addColorStop(1, 'rgba(45,65,48,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
        shadowTexture = new THREE.CanvasTexture(canvas); const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.75 })); contact.rotation.x = -Math.PI / 2; contact.position.y = -1.044; scene.add(contact); contactShadow = contact;
      }
      let shaderFailed = false; renderer.debug.onShaderError = () => { shaderFailed = true; }; renderer.compile(scene, camera);
      if (shaderFailed) {
        const previous = bodyMaterial; bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
        rig.traverse(object => { if (object instanceof THREE.Mesh && object.material === previous) object.material = bodyMaterial; }); previous.dispose(); shaderFailed = false; renderer.compile(scene, camera); if (shaderFailed) throw new Error('WebGL材质不可用');
      }
      const resize = () => {
        if (disposed || !renderer) return;
        const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight);
        // 短屏优先用满纵向空间；窄屏仍为向外挥动的小手保留横向边界。
        const aspect = width / height; const halfHeight = Math.max(1.13, 1.28 / aspect) * SETTINGS.viewPadding;
        camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); if (reduced) renderDirect(); else { fitCamera(); draw(); }
      };
      controller = {
        dispose,
        hitTest,
        // 切玩法释放输入锁；唤醒伸展可以接到新玩法，其余姿态不跨模式混播。
        setPetActivity(activity) {
          if (disposed || activity === petActivity) return;
          pausePetTimer(); petActivity = activity; petDragging = false; petPointer = null; petLastPointer = null;
          petDelivery = null; petAwaiting = false; if (petResting) petWakeFrom = petResting; petResting = null;
          if (petAction?.response.kind !== 'wake') petAction = null;
          active = null; idle = null; lastContact = time;
          if (petProps) {
            for (const [key, object] of Object.entries(petProps.objects)) { object.visible = key === activity; object.scale.setScalar(1); object.rotation.set(0, 0, 0); }
            petProps.tray.visible = activity === 'feed';
            if (activity) { scene.updateMatrixWorld(true); petHomePoint(petProps.objects[activity].position); }
          }
          if (!petAction && !held && !reaction) setExpression(baseExpression(currentMood));
          refreshPet();
        },
        petInput,
        petRespond,
        // 连续手势只修改目标值；松手后目标归零，阻尼弹簧负责平滑恢复到最新基础表情。
        manipulate(value) {
          if (disposed) return;
          if (value) interruptPet(value.kind, value.hit);
          const starting = value && (!held || held.kind !== value.kind);
          held = value;
          if (value) { lastContact = time; wake = 1; idle = null; if (starting) energy = Math.min(1, energy + 0.2); }
          if (!value) {
            pullTarget.setScalar(0); grabTarget.setScalar(0); pressureTarget = 0; pinchTarget = 0;
            if (!reaction && !active) setExpression(baseExpression(currentMood));
            if (reduced) { resetSpring(); renderDirect(); }
            else requestFrame();
            return;
          }
          if (staticTimer) { clearTimeout(staticTimer); staticTimer = null; }
          active = null; reaction = null; switchField(value.kind, value.hit.local);
          if (starting && value.kind === 'poke') pressure = Math.max(pressure, 0.16);
          setExpression(petSoothing(value.kind, value.hit) && petResting ? 'sleepy' : GESTURE_EXPRESSION[value.kind]);
          const amount = THREE.MathUtils.clamp(value.strength, 0, 1);
          const worldX = value.dx * (camera.right - camera.left) / 2;
          const worldY = -value.dy * (camera.top - camera.bottom) / 2;
          const grabbing = value.kind === 'drag' || value.kind === 'shake';
          grabTarget.set(grabbing ? mascotSoftLimit(worldX, DYNAMICS.dragLimitX) : 0, grabbing ? mascotSoftLimit(worldY, worldY >= 0 ? DYNAMICS.dragLimitUp : DYNAMICS.dragLimitDown) : 0, 0);
          pullTarget.set(value.kind === 'pinch' ? mascotSoftLimit(worldX, DYNAMICS.cheekLimitX) : 0, value.kind === 'pinch' ? mascotSoftLimit(worldY, DYNAMICS.cheekLimitY) : 0, 0);
          pressureTarget = ['poke', 'pinch', 'pat', 'tickle'].includes(value.kind) ? amount : 0;
          pinchTarget = value.kind === 'pinch' ? THREE.MathUtils.clamp((value.pinchScale ?? 1) - 1, -0.5, 0.5) : 0;
          if (reduced) { grab.copy(grabTarget); grabVelocity.setScalar(0); pull.copy(pullTarget); pullVelocity.setScalar(0); pressure = pressureTarget; pinch = pinchTarget; renderDirect(); }
          else requestFrame();
        },
        // 区域戳按的几何和表情优先于随机动作，文字仍由 React 层独立展示。
        react(kind, hit) {
          if (disposed) return;
          interruptPet(kind, hit);
          if (staticTimer) { clearTimeout(staticTimer); staticTimer = null; }
          held = null; active = null;
          // 松手仅改变目标和反应，不清空当前位移/速度，新的触摸可以直接接住余振。
          switchField(kind, hit?.local ?? { x: 0, y: kind === 'pat' ? 0.65 : kind === 'tickle' ? -0.4 : 0, z: kind === 'pat' ? 0.5 : SETTINGS.body.depth });
          lastContact = time; wake = 1; energy = Math.min(1, energy + 0.22); idle = null;
          emitFeeling(kind, hit);
          pullTarget.setScalar(0); grabTarget.setScalar(0); pressureTarget = 0; pinchTarget = 0;
          setExpression(petSoothing(kind, hit) && petResting ? 'sleepy' : GESTURE_EXPRESSION[kind]);
          if (reduced) {
            resetSpring();
            reaction = { kind, hit, elapsed: INTERACTION.reactionDurationMs / 2, duration: INTERACTION.reactionDurationMs };
            renderDirect();
            staticTimer = setTimeout(() => { if (!disposed) { reaction = null; impulse = 0; setExpression(baseExpression(currentMood)); renderDirect(); } }, INTERACTION.reactionDurationMs);
          } else {
            reaction = { kind, hit, elapsed: 0, duration: INTERACTION.reactionDurations[kind] * (0.94 + Math.random() * 0.12) };
            requestFrame();
          }
        },
        setMood(score) { if (disposed) return; currentMood = score; color.set(bodyColor(score)); if (!active && !held && !reaction && !petAction && !petResting) setExpression(baseExpression(score)); if (reduced) { bodyMaterial.color.copy(color); renderDirect(); } else { draw(); requestFrame(); } },
        play(next) {
          if (disposed || held || petIsBusy() || petResting) return;
          if (staticTimer) clearTimeout(staticTimer);
          if (!reaction) setExpression(next.expression);
          if (reduced) { active = null; renderDirect(); staticTimer = setTimeout(() => { if (!disposed) { setExpression(baseExpression(currentMood)); renderDirect(); } }, next.durationMs); }
          else { active = { reply: next, elapsed: 0 }; requestFrame(); }
        },
        look(x, y) {
          if (disposed || reduced || petResting) return;
          if (Math.hypot(x - pointerX, y - pointerY) > 0.025) {
            if (time - lastContact > DYNAMICS.sleepAfterSeconds) wake = 1;
            lastContact = time; idle = null; nextIdle = time + DYNAMICS.idleMinimumSeconds;
          }
          pointerX = THREE.MathUtils.clamp(x, -1, 1); pointerY = THREE.MathUtils.clamp(y, -1, 1);
          hasLook = Math.abs(x) + Math.abs(y) > 0.00001; requestFrame();
        },
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
      if ('IntersectionObserver' in window) { observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) { draw(); resumePetTimer(); requestFrame(); } else { stop(); pausePetTimer(); } }, { threshold: 0.01 }); observer.observe(host); }
      document.addEventListener('visibilitychange', visibilityChanged); media.addEventListener('change', motionChanged);
      gaze.rotation.set(SETTINGS.baseRotation.x, SETTINGS.baseRotation.y, 0); pose(0, null); updateDeformation(); scene.updateMatrixWorld(true); updateEyes(0); resize();
      if (!disposed) { options.onReady(true); requestFrame(); }
    } catch { fallback(); }

    return controller;
}
