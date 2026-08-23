import { BALL_ORDER, BallType } from "./economy";

export interface Point {
  x: number;
  y: number;
}

export function clampPull(anchor: Point, pointer: Point, maxPull: number): Point {
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0 || length <= maxPull) return { x: dx, y: dy };

  const scale = maxPull / length;
  return { x: dx * scale, y: dy * scale };
}

export function launchSpeedMul(length: number, maxPull: number, minSpeed: number, maxSpeed: number): number {
  const t = maxPull > 0 ? Math.max(0, Math.min(1, length / maxPull)) : 0;
  return minSpeed + (maxSpeed - minSpeed) * t;
}

export function shouldLaunch(length: number, minPull: number): boolean {
  return length >= minPull;
}

export function nextBallType(
  owned: Record<BallType, number>,
  spawned: Record<BallType, number>,
): BallType | null {
  for (const type of BALL_ORDER) {
    if ((owned[type] ?? 0) - (spawned[type] ?? 0) > 0) return type;
  }
  return null;
}
