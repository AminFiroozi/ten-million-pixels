export interface GridHit {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  t: number;
}

export type SolidCell = (x: number, y: number) => boolean;

const EPSILON = 1e-10;

function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function cellAt(x: number, y: number, width: number, height: number): { x: number; y: number } | null {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return {
    x: Math.min(width - 1, Math.floor(x)),
    y: Math.min(height - 1, Math.floor(y)),
  };
}

function boundaryHit(
  x: number,
  y: number,
  normalX: number,
  normalY: number,
  t: number,
): GridHit {
  return { x, y, normalX, normalY, t: Math.max(0, Math.min(1, t)) };
}

/**
 * Traverses the cells crossed by a line segment using deterministic 2D DDA.
 * Grid boundaries are treated as solid on exit, while an outside start point
 * is clipped to the grid and allowed to enter it.
 */
export function sweepGrid(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isSolid: SolidCell,
  width: number,
  height: number,
): GridHit | null {
  if (
    !finitePoint(x0, y0) ||
    !finitePoint(x1, y1) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  const startCell = cellAt(x0, y0, width, height);
  if (dx === 0 && dy === 0) {
    if (!startCell || !isSolid(startCell.x, startCell.y)) return null;
    return boundaryHit(startCell.x, startCell.y, 0, 0, 0);
  }

  let entry = 0;
  let exit = 1;
  const clipAxis = (start: number, delta: number, max: number): boolean => {
    if (delta === 0) return start >= 0 && start <= max;
    const a = (0 - start) / delta;
    const b = (max - start) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    return entry <= exit;
  };

  if (!clipAxis(x0, dx, width) || !clipAxis(y0, dy, height) || entry > 1 || exit < 0) {
    return null;
  }

  const insideStart = startCell !== null;
  if (insideStart) {
    const outwardX = (x0 === 0 && dx < 0) || (x0 === width && dx > 0);
    const outwardY = (y0 === 0 && dy < 0) || (y0 === height && dy > 0);
    if (outwardX || outwardY) {
      return boundaryHit(
        startCell.x,
        startCell.y,
        outwardX ? (dx < 0 ? 1 : -1) : 0,
        outwardY ? (dy < 0 ? 1 : -1) : 0,
        0,
      );
    }
  }

  const sampleT = Math.min(exit, entry + EPSILON);
  const sampleX = x0 + dx * sampleT;
  const sampleY = y0 + dy * sampleT;
  const initial = cellAt(sampleX, sampleY, width, height);
  if (!initial) return null;

  let cellX = initial.x;
  let cellY = initial.y;
  if (isSolid(cellX, cellY)) {
    return boundaryHit(cellX, cellY, 0, 0, entry);
  }

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const deltaX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
  const nextBoundaryX = stepX > 0 ? cellX + 1 : cellX;
  const nextBoundaryY = stepY > 0 ? cellY + 1 : cellY;
  let maxX = dx === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - x0) / dx;
  let maxY = dy === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - y0) / dy;
  if (maxX < entry) maxX = entry;
  if (maxY < entry) maxY = entry;

  let currentT = entry;
  while (currentT <= exit + EPSILON && currentT <= 1 + EPSILON) {
    if (maxX <= maxY + EPSILON) {
      currentT = maxX;
      if (currentT > exit + EPSILON || currentT > 1 + EPSILON) return null;
      const nextX = cellX + stepX;
      if (nextX < 0 || nextX >= width) {
        return boundaryHit(cellX, cellY, -stepX, 0, currentT);
      }
      cellX = nextX;
      maxX += deltaX;
      if (isSolid(cellX, cellY)) {
        return boundaryHit(cellX, cellY, -stepX, 0, currentT);
      }
    } else {
      currentT = maxY;
      if (currentT > exit + EPSILON || currentT > 1 + EPSILON) return null;
      const nextY = cellY + stepY;
      if (nextY < 0 || nextY >= height) {
        return boundaryHit(cellX, cellY, 0, -stepY, currentT);
      }
      cellY = nextY;
      maxY += deltaY;
      if (isSolid(cellX, cellY)) {
        return boundaryHit(cellX, cellY, 0, -stepY, currentT);
      }
    }
  }

  return null;
}
