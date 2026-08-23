import { CELL, World } from "./world";
import { mulberry32 } from "./rng";

export const FRACTURE_MAX_DEPTH = 2;
export const FRACTURE_MAX_CELLS = 24;
export const FRACTURE_DAMAGE = 1;
export const FRACTURE_ENERGY_DECAY = 0.5;

export interface FractureCell {
  x: number;
  y: number;
  depth: number;
}

export interface FractureResult {
  processed: FractureCell[];
}

interface FractureQueueCell extends FractureCell {
  energy: number;
}

function isFracturable(cell: number): boolean {
  return cell === CELL.SOFT || cell === CELL.MED || cell === CELL.HARD;
}

export function resolveFracture(
  world: World,
  originX: number,
  originY: number,
  energy: number,
  seed: number
): FractureResult {
  const processed: FractureCell[] = [];
  const queue: FractureQueueCell[] = [{ x: originX, y: originY, depth: 0, energy }];
  const visited = new Set<string>();
  const rng = mulberry32(seed);

  while (queue.length > 0 && processed.length < FRACTURE_MAX_CELLS) {
    const current = queue.shift() as FractureQueueCell;
    if (current.depth === 0) {
      for (const [dx, dy] of shuffledDirections(rng)) {
        queue.push({
          x: current.x + dx,
          y: current.y + dy,
          depth: 1,
          energy: current.energy * FRACTURE_ENERGY_DECAY,
        });
      }
      continue;
    }
    const key = `${current.x},${current.y}`;
    if (visited.has(key) || current.depth > FRACTURE_MAX_DEPTH || energy <= 0) continue;
    visited.add(key);
    if (!isFracturable(world.get(current.x, current.y))) continue;
    const destroyed = world.hit(current.x, current.y, Math.max(FRACTURE_DAMAGE, current.energy));
    processed.push({ x: current.x, y: current.y, depth: current.depth });
    if (destroyed && current.depth < FRACTURE_MAX_DEPTH) {
      for (const [dx, dy] of shuffledDirections(rng)) {
        queue.push({
          x: current.x + dx,
          y: current.y + dy,
          depth: current.depth + 1,
          energy: current.energy * FRACTURE_ENERGY_DECAY,
        });
      }
    }
  }
  return { processed };
}

function shuffledDirections(rng: () => number): Array<[number, number]> {
  const directions: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = directions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }
  return directions;
}
