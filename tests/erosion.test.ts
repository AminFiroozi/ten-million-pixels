import { describe, expect, it } from "vitest";
import { CELL, World } from "../src/world";
import {
  FRACTURE_MAX_CELLS,
  FRACTURE_MAX_DEPTH,
  resolveFracture,
} from "../src/erosion";

function emptyWorld(): World {
  const world = World.generate(7);
  world.cells.fill(CELL.EMPTY);
  return world;
}

describe("fracture erosion", () => {
  it("damages connected ordinary terrain but never auto-mines protected cells", () => {
    const world = emptyWorld();
    world.cells[world.idx(10, 10)] = CELL.HARD;
    world.cells[world.idx(11, 10)] = CELL.SOFT;
    world.cells[world.idx(12, 10)] = CELL.GOLD;

    const result = resolveFracture(world, 10, 10, 1, 123);

    expect(result.processed).toContainEqual({ x: 11, y: 10, depth: 1 });
    expect(world.get(12, 10)).toBe(CELL.GOLD);
  });

  it("does not process empty cells or special cells", () => {
    const world = emptyWorld();
    world.cells[world.idx(10, 10)] = CELL.TREASURE;
    world.cells[world.idx(11, 10)] = CELL.UPGRADE;

    const result = resolveFracture(world, 10, 10, 1, 123);

    expect(result.processed).toEqual([]);
    expect(world.get(11, 10)).toBe(CELL.UPGRADE);
  });

  it("uses the seed to choose a deterministic processing order", () => {
    const makeWorld = () => {
      const world = emptyWorld();
      world.cells[world.idx(10, 10)] = CELL.HARD;
      world.cells[world.idx(11, 10)] = CELL.SOFT;
      world.cells[world.idx(9, 10)] = CELL.SOFT;
      world.cells[world.idx(10, 11)] = CELL.SOFT;
      world.cells[world.idx(10, 9)] = CELL.SOFT;
      return world;
    };

    const first = resolveFracture(makeWorld(), 10, 10, 1, 123);
    const repeat = resolveFracture(makeWorld(), 10, 10, 1, 123);
    const different = resolveFracture(makeWorld(), 10, 10, 1, 456);

    expect(repeat.processed).toEqual(first.processed);
    expect(different.processed).not.toEqual(first.processed);
  });

  it("decays fracture energy as a cascade travels deeper", () => {
    const world = emptyWorld();
    world.cells[world.idx(10, 10)] = CELL.HARD;
    world.cells[world.idx(11, 10)] = CELL.SOFT;
    world.cells[world.idx(12, 10)] = CELL.HARD;

    const result = resolveFracture(world, 10, 10, 3, 123);

    expect(result.processed).toContainEqual({ x: 11, y: 10, depth: 1 });
    expect(result.processed).toContainEqual({ x: 12, y: 10, depth: 2 });
    expect(world.damageAt(12, 10)).toBe(1);
  });

  it("keeps each coordinate unique and respects depth and cell budgets", () => {
    const world = emptyWorld();
    for (let y = 1; y < 20; y++) {
      for (let x = 1; x < 20; x++) world.cells[world.idx(x, y)] = CELL.SOFT;
    }

    const result = resolveFracture(world, 10, 10, 1, 123);
    const coordinates = result.processed.map(({ x, y }) => `${x},${y}`);

    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(result.processed.every(({ depth }) => depth <= FRACTURE_MAX_DEPTH)).toBe(true);
    expect(result.processed.length).toBeLessThanOrEqual(FRACTURE_MAX_CELLS);
  });
});
