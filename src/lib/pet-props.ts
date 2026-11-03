import * as THREE from 'three';
import type { PetActivity } from './pet-care';

/** 照顾玩法的尺寸、路径、接触范围和静态姿态参数集中在此。 */
export const PET_RENDER_SETTINGS = {
  radius: { feed: 0.14, tease: 0.16, sleep: 0.23 },
  home: { feed: { x: -0.9, y: -0.87, z: 1.2 }, tease: { x: 0.98, y: -0.85, z: 1.2 }, sleep: { x: 0.88, y: 0.62, z: 1.05 } },
  mouthClearance: 0.23, handClearance: 0.31, dragPlaneClearance: 0.68,
  mouthReach: 0.3, handReach: 0.34,
  deliverySeconds: 0.48, deliveryArc: 0.19,
  stagePaddingPx: 12, minimumTargetRadiusPx: 22,
  sootheTravelPx: 12, moonTravel: 0.23,
  staticResponsePhase: 0.58,
  flight: { catchGraceSeconds: 0.16, catchRadius: 0.23, predictSeconds: 0.16, pursuitStiffness: 90, pursuitDamping: 15, jumpMaximum: 0.32, pickupAfterSeconds: 1.35, returnAfterPhase: 0.54, returnVelocityX: 1.1, returnVelocityY: -1.25, handFollowSpeed: 13 },
  pose: {
    reachFollowSpeed: 14, wakeReleasePhase: 0.4, wakeEyePhase: 0.35, foldedHandFront: 0.72, feedingHandFront: 0.8, playingHandFront: 0.65, sleepTilt: 0.12, chewCycles: 5, fullShake: 0.12, wakeStretch: 0.85 },
};
export interface PetPropRig {
  root: THREE.Group;
  tray: THREE.Group;
  objects: Record<PetActivity, THREE.Group>;
}

/** 所有道具都是预建的真实网格；挂在场景根组，不扩大团子本身的命中框。 */
export function createPetProps(): PetPropRig {
  const root = new THREE.Group(); root.name = 'pet-props';
  const tray = new THREE.Group(); tray.visible = false; root.add(tray);
  const cream = new THREE.MeshStandardMaterial({ color: '#f5f0df', roughness: 0.6 });
  const pastry = new THREE.MeshStandardMaterial({ color: '#d9ad70', roughness: 0.77 });
  const seedMaterial = new THREE.MeshStandardMaterial({ color: '#9d7451', roughness: 0.9 });
  const mint = new THREE.MeshStandardMaterial({ color: '#91b3a5', roughness: 0.7 });
  const moonMaterial = new THREE.MeshStandardMaterial({ color: '#dfc67b', roughness: 0.68, metalness: 0 });
  const sphere = new THREE.SphereGeometry(1, 24, 18);

  // 小托盘与带芝麻的圆点心分离，抓起点心后托盘留在原处。
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.23, 0.045, 32), cream); plate.position.y = -0.12; tray.add(plate);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.017, 8, 32), cream); rim.rotation.x = -Math.PI / 2; rim.position.y = -0.092; tray.add(rim);
  const feed = new THREE.Group(); feed.name = 'snack';
  const bun = new THREE.Mesh(sphere, pastry); bun.scale.set(0.14, 0.11, 0.09); feed.add(bun);
  for (const [x, y, rotation] of [[-0.05, 0.035, -0.5], [0.025, 0.05, 0.5], [0.06, -0.025, 0.3], [-0.025, -0.035, -0.2]]) {
    const seed = new THREE.Mesh(sphere, seedMaterial); seed.scale.set(0.009, 0.023, 0.006); seed.position.set(x, y, 0.084); seed.rotation.z = rotation; feed.add(seed);
  }

  // 软球用实体球和两条浅色环缝表达体积，拖动时可见转向。
  const tease = new THREE.Group(); tease.name = 'soft-ball';
  const ball = new THREE.Mesh(sphere, mint); ball.scale.setScalar(PET_RENDER_SETTINGS.radius.tease); tease.add(ball);
  const seam = new THREE.TorusGeometry(0.158, 0.009, 7, 32);
  for (const rotation of [0, Math.PI / 2]) { const band = new THREE.Mesh(seam, cream); band.rotation.y = rotation; tease.add(band); }

  // 挤出的月牙拥有侧面厚度，旁边的小星点和短绳随月亮一起轻摇。
  const sleep = new THREE.Group(); sleep.name = 'little-moon';
  const shape = new THREE.Shape(); const angle = Math.PI * 0.26; const radius = 0.19;
  shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  shape.absarc(0, 0, radius, angle, Math.PI * 2 - angle, false);
  shape.quadraticCurveTo(-0.055, 0, Math.cos(angle) * radius, Math.sin(angle) * radius);
  const crescent = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, steps: 1, curveSegments: 24 }), moonMaterial);
  crescent.position.z = -0.02; sleep.add(crescent);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), cream); star.position.set(0.19, 0.1, 0.02); star.scale.z = 0.35; sleep.add(star);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 16), moonMaterial); loop.position.set(0, 0.21, 0); sleep.add(loop);
  const objects = { feed, tease, sleep };
  for (const object of Object.values(objects)) { object.visible = false; root.add(object); }
  return { root, tray, objects };
}
