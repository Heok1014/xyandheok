import { getCropStatus } from './engine.js?v=2';

export const RETREAT_PLOTS = Object.freeze(Array.from({ length: 6 }, (_, i) =>
  Object.freeze({ x: i % 2 ? -4.5 : -7, z: Math.floor(i / 2) * 2.5 })));
export const RETREAT_START = Object.freeze({ x: 0, z: 6 });
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function canWalk(point) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  if (Math.abs(point.x) > 10 || point.z < -1.2 || point.z > 9) return false;
  if (distance(point, { x: 7, z: 2 }) < 3.2) return false;
  return !RETREAT_PLOTS.some(plot => Math.abs(point.x - plot.x) < 1 && Math.abs(point.z - plot.z) < .85);
}

export function movePlayer(point, direction, seconds) {
  const length = Math.hypot(direction.x, direction.z);
  if (!Number.isFinite(length) || !length || !Number.isFinite(seconds)) return { ...point };
  const step = clamp(seconds, 0, .05) * 3.8;
  const x = point.x + direction.x / length * step, z = point.z + direction.z / length * step;
  if (canWalk({ x, z })) return { x, z };
  if (canWalk({ x, z: point.z })) return { x, z: point.z };
  if (canWalk({ x: point.x, z })) return { x: point.x, z };
  return { ...point };
}

export function walkRoute(start, goal) {
  if (!canWalk(start) || !canWalk(goal)) return [];
  const clear = (a, b) => {
    const steps = Math.max(1, Math.ceil(distance(a, b) / .1));
    for (let i = 0; i <= steps; i++) {
      const point = { x: a.x + (b.x - a.x) * i / steps, z: a.z + (b.z - a.z) * i / steps };
      if (!canWalk(point)) return false;
    }
    return true;
  };
  if (clear(start, goal)) return [{ ...goal }];
  // A small fixed grid routes around the pond and raised beds, not through them.
  const nodes = new Map();
  for (let x = -40; x <= 40; x++) for (let z = -4; z <= 36; z++) {
    const point = { x: x / 4, z: z / 4 };
    if (canWalk(point)) nodes.set(`${x},${z}`, { ...point, key: `${x},${z}`, gx: x, gz: z });
  }
  const anchor = point => [...nodes.values()].sort((a, b) => distance(a, point) - distance(b, point))
    .find(node => distance(node, point) < .8 && clear(point, node));
  const first = anchor(start), last = anchor(goal);
  if (!first || !last) return [];
  const queue = [first], parents = new Map([[first.key, null]]);
  for (let i = 0; i < queue.length && !parents.has(last.key); i++) {
    const current = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = nodes.get(`${current.gx + dx},${current.gz + dz}`);
      if (next && !parents.has(next.key) && clear(current, next)) { parents.set(next.key, current.key); queue.push(next); }
    }
  }
  if (!parents.has(last.key)) return [];
  const path = [{ ...goal }];
  for (let key = last.key; key !== null; key = parents.get(key)) {
    const node = nodes.get(key); path.unshift({ x: node.x, z: node.z });
  }
  const result = []; let from = start;
  while (path.length) {
    let index = path.length - 1;
    while (index > 0 && !clear(from, path[index])) index--;
    from = path[index]; result.push(from); path.splice(0, index + 1);
  }
  return result;
}

export function plotInteraction(plot, index, crop, at) {
  const state = getCropStatus(plot, at);
  if (state.empty) return { label: '种下', action: { type: 'plant', index, crop }, state };
  if (state.ready) return { label: '收获', action: { type: 'harvest', index }, state };
  return { label: state.watered ? `生长中 ${Math.ceil(state.remaining / 1000)}s` : '浇水',
    action: state.watered ? null : { type: 'water', index }, state };
}

export function nearestInteraction(point, pet) {
  const candidates = [{ kind: 'pet', label: '猫咪', point: pet },
    ...RETREAT_PLOTS.map((plot, index) => ({ kind: 'plot', label: `菜地 ${index + 1}`, index, point: plot }))];
  const nearest = candidates.sort((a, b) => distance(point, a.point) - distance(point, b.point))[0];
  return distance(point, nearest.point) <= 2.25 ? nearest : null;
}

export function furnitureFromGround(point, item) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  // Keep the legacy percentage coordinates; both views share the same server save.
  if (Math.abs(point.x) > 2.85 || point.z < -5.65 || point.z > -2.25) return null;
  return { type: 'place', item, x: clamp(50 + point.x / 2.85 * 42, 8, 92),
    y: item === 'painting' ? 38 : clamp(65 + (point.z + 5.65) / 3.4 * 25, 65, 90) };
}

export function throwPower(elapsed, round) {
  const phase = (Math.max(0, elapsed) / (1600 - clamp(round, 0, 5) * 130)) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export function throwTarget(round) {
  return { power: [.48, .72, .35, .62, .81, .42][clamp(round, 0, 5)],
    tolerance: Math.max(.065, .16 - round * .018) };
}

export function scoreThrow(power, round) {
  const target = throwTarget(round);
  // Compare against displayed interval edges to avoid subtraction rounding at a valid edge.
  const hit = Number.isFinite(power) && power >= target.power - target.tolerance && power <= target.power + target.tolerance;
  const perfect = hit && power >= target.power - target.tolerance * .32 && power <= target.power + target.tolerance * .32;
  return { hit, perfect, points: hit ? (perfect ? 150 : 100) : 0 };
}
