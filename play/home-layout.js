export const HOME_ITEMS = Object.freeze(['rug', 'sofa', 'plant', 'lamp', 'bookshelf', 'painting', 'table', 'bed']);

export function placement3D(piece) {
  const x = Math.max(8, Math.min(92, Number(piece.x) || 50));
  const y = Math.max(25, Math.min(90, Number(piece.y) || 75));
  if (piece.id === 'painting') return { x: (x - 50) / 42 * 2.9, y: 3.1 - (y - 25) / 65 * 1.9, z: -2.86 };
  return { x: (x - 50) / 42 * 2.85, y: 0, z: (Math.max(65, y) - 65) / 25 * 3.4 - 1.65 };
}

export function homeSignature(state) {
  return JSON.stringify([state.adventure.theme, state.placed.map(piece => [piece.id, piece.x, piece.y])]);
}

export const HOME_LIGHTS = Object.freeze({
  morning: { background: 0xf5eddf, light: 0xffefcd, intensity: 3.2, ambient: 2.5 },
  sunset: { background: 0xf1d5bd, light: 0xffb67b, intensity: 3.6, ambient: 2 },
  night: { background: 0x253c46, light: 0xa7c8ef, intensity: 2, ambient: 1.25 },
});
