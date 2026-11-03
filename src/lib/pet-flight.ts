import type { PetPoint } from './pet-care';

/** 所有手感参数集中于此；位置为舞台[-1,1]，速度为舞台单位/秒，y向下。 */
export const PET_FLIGHT_SETTINGS = {
  stepSeconds: 1 / 120,
  maxAdvanceSeconds: 0.25,
  gravity: 3.2,
  airDrag: 0.12,
  wallRestitution: 0.64,
  ceilingRestitution: 0.5,
  groundRestitution: 0.46,
  impactHorizontalRetention: 0.76,
  groundFriction: 3.6,
  floorRestSpeed: 0.28,
  stopSpeed: 0.045,
  positionEpsilon: 1e-8,
  maxRadius: 0.95,
  maxReleaseSpeed: 4.5,
  flickThreshold: 0.9,
  releaseWindowMs: 100,
  minimumReleaseSpanMs: 16,
  minimumPairMs: 8,
  stationaryTailMs: 60,
  stationaryDistance: 0.008,
  maximumReleaseSamples: 16,
  velocityNoiseTolerance: 0.35,
  velocityOutlierMad: 3.5,
  velocityRecencyMs: 50,
  velocityDeadZone: 0.06,
  spinPerUnit: 5,
  predictionMaxSeconds: 3,
  predictionIterations: 28,
};

export interface PetFlight { x: number; y: number; vx: number; vy: number; age: number; bounces: number; spin: number }
export interface PetReleaseSample extends PetPoint { at: number }
export interface PetLanding extends PetPoint { time: number }
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const validPoint = (point: PetPoint) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const radiusFor = (radius: PetPoint) => ({ x: clamp(finite(radius.x), 0, PET_FLIGHT_SETTINGS.maxRadius), y: clamp(finite(radius.y), 0, PET_FLIGHT_SETTINGS.maxRadius) });

/** 速度按向量长度限制，斜向甩动不会得到比水平甩动更大的最大速度。 */
function limitVelocity(velocity: PetPoint): PetPoint {
  if (!validPoint(velocity)) return { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);
  const scale = speed > PET_FLIGHT_SETTINGS.maxReleaseSpeed ? PET_FLIGHT_SETTINGS.maxReleaseSpeed / speed : 1;
  return { x: velocity.x * scale, y: velocity.y * scale };
}
export function createPetFlight(point: PetPoint, velocity: PetPoint): PetFlight {
  const release = limitVelocity(velocity);
  return { x: clamp(finite(point.x), -1, 1), y: clamp(finite(point.y), -1, 1), vx: release.x, vy: release.y, age: 0, bounces: 0, spin: 0 };
}

/** 地面支持力与水平摩擦分开处理，静止后不继续被重力制造无限微弹。 */
export function isPetFlightResting(state: PetFlight, boundsRadius: PetPoint): boolean {
  const radius = radiusFor(boundsRadius);
  return state.vx === 0 && state.vy === 0 && Math.abs(state.y - (1 - radius.y)) <= PET_FLIGHT_SETTINGS.positionEpsilon;
}

/** 自由飞行的线性阻力解析步进，比逐帧乘固定衰减更不依赖帧率。 */
function freeStep(state: PetFlight, seconds: number) {
  const damping = Math.exp(-PET_FLIGHT_SETTINGS.airDrag * seconds);
  const travel = (1 - damping) / PET_FLIGHT_SETTINGS.airDrag;
  const terminal = PET_FLIGHT_SETTINGS.gravity / PET_FLIGHT_SETTINGS.airDrag;
  state.x += state.vx * travel;
  state.y += terminal * seconds + (state.vy - terminal) * travel;
  state.vx *= damping;
  state.vy = terminal + (state.vy - terminal) * damping;
}

/** 返回新状态；长帧最多追赶配置时长，避免后台恢复后瞬移；内部每步不超过1/120秒。 */
export function advancePetFlight(state: PetFlight, deltaSeconds: number, boundsRadius: PetPoint): PetFlight {
  const radius = radiusFor(boundsRadius); const wall = 1 - radius.x; const floor = 1 - radius.y;
  const next: PetFlight = { x: clamp(finite(state.x), -wall, wall), y: clamp(finite(state.y), -floor, floor), vx: finite(state.vx), vy: finite(state.vy), age: Math.max(0, finite(state.age)), bounces: Math.max(0, Math.floor(finite(state.bounces))), spin: finite(state.spin) };
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return next;
  const duration = Math.min(deltaSeconds, PET_FLIGHT_SETTINGS.maxAdvanceSeconds);
  let remaining = duration;
  while (remaining > PET_FLIGHT_SETTINGS.positionEpsilon) {
    const step = Math.min(remaining, PET_FLIGHT_SETTINGS.stepSeconds); remaining -= step;
    const previousX = next.x;
    const supported = next.y >= floor - PET_FLIGHT_SETTINGS.positionEpsilon && next.vy >= 0 && next.vy <= PET_FLIGHT_SETTINGS.floorRestSpeed;
    if (supported) {
      next.y = floor; next.vy = 0;
      const friction = Math.exp(-PET_FLIGHT_SETTINGS.groundFriction * step);
      next.x += next.vx * (1 - friction) / PET_FLIGHT_SETTINGS.groundFriction;
      next.vx *= friction;
      if (Math.abs(next.vx) < PET_FLIGHT_SETTINGS.stopSpeed) next.vx = 0;
    } else freeStep(next, step);
    // 墙面按剩余越界距离反射，降低边缘投掷在不同帧率下的位置损失。
    if (next.x > wall) {
      next.x = clamp(wall - (next.x - wall) * PET_FLIGHT_SETTINGS.wallRestitution, -wall, wall);
      if (next.vx > 0) { next.vx *= -PET_FLIGHT_SETTINGS.wallRestitution; next.bounces += 1; }
    } else if (next.x < -wall) {
      next.x = clamp(-wall + (-wall - next.x) * PET_FLIGHT_SETTINGS.wallRestitution, -wall, wall);
      if (next.vx < 0) { next.vx *= -PET_FLIGHT_SETTINGS.wallRestitution; next.bounces += 1; }
    }
    if (next.y < -floor) {
      next.y = clamp(-floor + (-floor - next.y) * PET_FLIGHT_SETTINGS.ceilingRestitution, -floor, floor);
      if (next.vy < 0) { next.vy *= -PET_FLIGHT_SETTINGS.ceilingRestitution; next.bounces += 1; }
    } else if (next.y > floor) {
      next.y = floor;
      if (next.vy > 0) {
        next.vy *= -PET_FLIGHT_SETTINGS.groundRestitution; next.vx *= PET_FLIGHT_SETTINGS.impactHorizontalRetention; next.bounces += 1;
        if (Math.abs(next.vy) < PET_FLIGHT_SETTINGS.floorRestSpeed) next.vy = 0;
      }
    }
    next.spin += (next.x - previousX) * PET_FLIGHT_SETTINGS.spinPerUnit;
  }
  next.age += duration;
  return next;
}

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
function weightedMedian(values: { value: number; weight: number }[]): number {
  const sorted = [...values].sort((a, b) => a.value - b.value); const half = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  let sum = 0; for (const item of sorted) { sum += item.weight; if (sum >= half) return item.value; }
  return 0;
}

/** 调用方应追加release位置及其当前at；末端静止会消除先甩后停留下的旧速度。 */
export function estimatePetRelease(samples: readonly PetReleaseSample[]): PetPoint {
  const ordered: PetReleaseSample[] = [];
  for (const sample of samples) {
    if (!validPoint(sample) || !Number.isFinite(sample.at) || sample.at < 0 || sample.at > Number.MAX_SAFE_INTEGER || (ordered.length && sample.at <= ordered[ordered.length - 1].at)) continue;
    ordered.push(sample);
  }
  if (ordered.length < 2) return { x: 0, y: 0 };
  const last = ordered[ordered.length - 1];
  let stillSince = last.at;
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    if (Math.hypot(ordered[index].x - last.x, ordered[index].y - last.y) > PET_FLIGHT_SETTINGS.stationaryDistance) break;
    stillSince = ordered[index].at;
  }
  if (last.at - stillSince >= PET_FLIGHT_SETTINGS.stationaryTailMs) return { x: 0, y: 0 };
  const recent = ordered.filter(sample => last.at - sample.at <= PET_FLIGHT_SETTINGS.releaseWindowMs);
  if (recent.length < 2 || last.at - recent[0].at < PET_FLIGHT_SETTINGS.minimumReleaseSpanMs) return { x: 0, y: 0 };
  const count = Math.min(recent.length, PET_FLIGHT_SETTINGS.maximumReleaseSamples);
  const reduced = Array.from({ length: count }, (_, index) => recent[Math.round(index * (recent.length - 1) / (count - 1))]);
  const pairs: { x: number; y: number; weight: number }[] = [];
  for (let first = 0; first < reduced.length - 1; first += 1) for (let second = first + 1; second < reduced.length; second += 1) {
    const a = reduced[first]; const b = reduced[second]; const elapsed = b.at - a.at;
    if (elapsed < PET_FLIGHT_SETTINGS.minimumPairMs) continue;
    pairs.push({ x: (b.x - a.x) * 1000 / elapsed, y: (b.y - a.y) * 1000 / elapsed, weight: Math.exp(((a.at + b.at) / 2 - last.at) / PET_FLIGHT_SETTINGS.velocityRecencyMs) });
  }
  if (!pairs.length) return { x: 0, y: 0 };
  // 先以中位数/MAD剔除孤立跳点，再偏重临近松手的速度，保留反向甩出的最终方向。
  const mx = median(pairs.map(pair => pair.x)); const my = median(pairs.map(pair => pair.y));
  const dx = Math.max(PET_FLIGHT_SETTINGS.velocityNoiseTolerance, median(pairs.map(pair => Math.abs(pair.x - mx))) * PET_FLIGHT_SETTINGS.velocityOutlierMad);
  const dy = Math.max(PET_FLIGHT_SETTINGS.velocityNoiseTolerance, median(pairs.map(pair => Math.abs(pair.y - my))) * PET_FLIGHT_SETTINGS.velocityOutlierMad);
  const stable = pairs.filter(pair => Math.abs(pair.x - mx) <= dx && Math.abs(pair.y - my) <= dy);
  const velocity = limitVelocity({ x: weightedMedian(stable.map(pair => ({ value: pair.x, weight: pair.weight }))), y: weightedMedian(stable.map(pair => ({ value: pair.y, weight: pair.weight }))) });
  return { x: Math.abs(velocity.x) < PET_FLIGHT_SETTINGS.velocityDeadZone ? 0 : velocity.x, y: Math.abs(velocity.y) < PET_FLIGHT_SETTINGS.velocityDeadZone ? 0 : velocity.y };
}

export function isPetFlick(velocity: PetPoint): boolean { return Boolean(validPoint(velocity) && Math.hypot(velocity.x, velocity.y) >= PET_FLIGHT_SETTINGS.flickThreshold); }

/** 将椭圆变为单位圆后求线段最近点，低帧率跨过手掌也会接到，不只检查终点。 */
export function sweptPetCatch(previous: PetPoint, next: PetPoint, target: PetPoint, radiusPoint: PetPoint): boolean {
  if (!validPoint(previous) || !validPoint(next) || !validPoint(target) || !validPoint(radiusPoint) || radiusPoint.x <= 0 || radiusPoint.y <= 0) return false;
  const ax = (previous.x - target.x) / radiusPoint.x; const ay = (previous.y - target.y) / radiusPoint.y;
  const dx = (next.x - previous.x) / radiusPoint.x; const dy = (next.y - previous.y) / radiusPoint.y;
  const length = dx * dx + dy * dy; const t = length > 0 ? clamp(-(ax * dx + ay * dy) / length, 0, 1) : 0;
  return (ax + dx * t) ** 2 + (ay + dy * t) ** 2 <= 1 + PET_FLIGHT_SETTINGS.positionEpsilon;
}

/** 预测下一段自由飞行下降到目标高度的位置；不预演墙面反弹，供视线与手臂预备。 */
export function predictFlightLanding(state: PetFlight, targetY: number): PetLanding | null {
  if (![state.x, state.y, state.vx, state.vy, targetY].every(Number.isFinite)) return null;
  const terminal = PET_FLIGHT_SETTINGS.gravity / PET_FLIGHT_SETTINGS.airDrag;
  const apex = state.vy < 0 ? Math.log(1 - state.vy / terminal) / PET_FLIGHT_SETTINGS.airDrag : 0;
  const at = (seconds: number) => { const next = { ...state }; freeStep(next, seconds); return next; };
  let low = apex; let high = PET_FLIGHT_SETTINGS.predictionMaxSeconds;
  if (low > high || targetY < at(low).y - PET_FLIGHT_SETTINGS.positionEpsilon || targetY > at(high).y) return null;
  for (let index = 0; index < PET_FLIGHT_SETTINGS.predictionIterations; index += 1) { const mid = (low + high) / 2; if (at(mid).y < targetY) low = mid; else high = mid; }
  const time = (low + high) / 2; const point = at(time);
  return { x: point.x, y: targetY, time };
}
