import { CELL } from "./world";

export type BallType = "white" | "blue" | "red" | "green" | "orange" | "yellow" | "purple";

export const BALL_ORDER: BallType[] = ["white", "blue", "red", "green", "orange", "yellow", "purple"];

export interface EconomyState {
  currency: number;
  upgradePoints: number;
  ballsOwned: Record<BallType, number>;
  upgrades: Record<string, number>;
}

const BASE: Record<BallType, number> = {
  white: 10,
  blue: 50,
  red: 120,
  green: 200,
  orange: 350,
  yellow: 600,
  purple: 1000,
};

const START_OWNED: Record<BallType, number> = {
  white: 1,
  blue: 0,
  red: 0,
  green: 0,
  orange: 0,
  yellow: 0,
  purple: 0,
};

export interface UpgradeNode {
  id: string;
  name: string;
  desc: string;
  cost: number;
  max: number;
  requires?: string;
  stat?: string;
  amount?: number;
  unlocksBall?: BallType;
}

export const UPGRADE_TREE: UpgradeNode[] = [
  { id: "unlock_blue", name: "Unlock Blue", desc: "Unlocks the blue ball", cost: 2, max: 1, unlocksBall: "blue" },
  { id: "unlock_red", name: "Unlock Red", desc: "Unlocks the red ball", cost: 3, max: 1, unlocksBall: "red" },
  { id: "unlock_green", name: "Unlock Green", desc: "Unlocks the green ball", cost: 4, max: 1, unlocksBall: "green" },
  { id: "unlock_orange", name: "Unlock Orange", desc: "Unlocks the orange ball", cost: 5, max: 1, unlocksBall: "orange" },
  { id: "unlock_yellow", name: "Unlock Yellow", desc: "Unlocks the yellow ball", cost: 6, max: 1, unlocksBall: "yellow" },
  { id: "unlock_purple", name: "Unlock Purple", desc: "Unlocks the purple ball", cost: 8, max: 1, unlocksBall: "purple" },
  { id: "speed_1", name: "Speed I", desc: "Increases ball speed", cost: 5, max: 5, stat: "speed", amount: 0.08 },
  { id: "speed_2", name: "Speed II", desc: "Further increases ball speed", cost: 10, max: 5, requires: "speed_1", stat: "speed", amount: 0.08 },
  { id: "damage_1", name: "Damage I", desc: "Increases ball damage", cost: 5, max: 5, stat: "damage", amount: 0.1 },
  { id: "damage_2", name: "Damage II", desc: "Further increases ball damage", cost: 10, max: 5, requires: "damage_1", stat: "damage", amount: 0.1 },
  { id: "smashRadius", name: "Smash Radius", desc: "Increases red ball smash radius", cost: 8, max: 3, requires: "unlock_red", stat: "smashRadius", amount: 1 },
  { id: "poisonSpread", name: "Poison Spread", desc: "Increases green ball poison spread", cost: 8, max: 3, requires: "unlock_green", stat: "poisonSpread", amount: 1 },
  { id: "splitCount", name: "Split Count", desc: "Increases orange ball split count", cost: 10, max: 2, requires: "unlock_orange", stat: "splitCount", amount: 1 },
  { id: "pierceDepth", name: "Pierce Depth", desc: "Increases yellow ball pierce depth", cost: 8, max: 3, requires: "unlock_yellow", stat: "pierceDepth", amount: 1 },
  { id: "launch_wave", name: "Bigger Waves", desc: "Launch more balls per click", cost: 3, max: 3, stat: "launchWave", amount: 10 },
  { id: "launch_speed", name: "Launch Speed", desc: "Increases ball launch speed", cost: 2, max: 3, stat: "launchSpeed", amount: 0.1 },
  { id: "treasure_hunter", name: "Treasure Hunter", desc: "Reveals nearby gold deposits", cost: 3, max: 1, stat: "treasureHunter" },
  { id: "reveal_radius_1", name: "Wider Reveal I", desc: "Increases dig reveal radius", cost: 2, max: 3, stat: "revealRadius", amount: 2 },
  { id: "reveal_radius_2", name: "Wider Reveal II", desc: "Further increases dig reveal radius", cost: 3, max: 3, requires: "reveal_radius_1", stat: "revealRadius", amount: 2 },
  { id: "radar", name: "Radar", desc: "Highlights hidden objects nearby", cost: 4, max: 1, stat: "radar" },
  { id: "dark_speed", name: "Dark Speed", desc: "Increases ball speed in dark zones", cost: 3, max: 3, stat: "darkSpeed", amount: 0.15 },
];

export const NODE_LAYOUT: Record<string, { col: number; row: number; branch: "ball" | "launcher" | "discovery" | "survival" }> = {
  unlock_blue: { col: 1, row: 0, branch: "ball" },
  unlock_red: { col: 2, row: 0, branch: "ball" },
  unlock_green: { col: 3, row: 0, branch: "ball" },
  unlock_orange: { col: 4, row: 0, branch: "ball" },
  unlock_yellow: { col: 5, row: 0, branch: "ball" },
  unlock_purple: { col: 6, row: 0, branch: "ball" },
  smashRadius: { col: 2, row: 1, branch: "ball" },
  poisonSpread: { col: 3, row: 1, branch: "ball" },
  splitCount: { col: 4, row: 1, branch: "ball" },
  pierceDepth: { col: 5, row: 1, branch: "ball" },
  speed_1: { col: 0, row: 1, branch: "ball" },
  speed_2: { col: 0, row: 2, branch: "ball" },
  damage_1: { col: 0, row: 3, branch: "ball" },
  damage_2: { col: 0, row: 4, branch: "ball" },
  launch_wave: { col: 7, row: 0, branch: "launcher" },
  launch_speed: { col: 7, row: 1, branch: "launcher" },
  reveal_radius_1: { col: 8, row: 0, branch: "discovery" },
  reveal_radius_2: { col: 8, row: 1, branch: "discovery" },
  radar: { col: 8, row: 2, branch: "discovery" },
  treasure_hunter: { col: 8, row: 3, branch: "discovery" },
  dark_speed: { col: 9, row: 0, branch: "survival" },
};

export function newEconomy(): EconomyState {
  const ballsOwned = {} as Record<BallType, number>;
  for (const t of BALL_ORDER) ballsOwned[t] = START_OWNED[t];
  return {
    currency: 0,
    upgradePoints: 0,
    ballsOwned,
    upgrades: {},
  };
}

export function ballCost(type: BallType, owned: number): number {
  return Math.ceil(BASE[type] * 1.15 ** owned);
}

export function nextBallCost(s: EconomyState, t: BallType): number {
  return ballCost(t, s.ballsOwned[t] - START_OWNED[t]);
}

export function isUnlocked(s: EconomyState, t: BallType): boolean {
  if (t === "white") return true;
  return (s.upgrades[`unlock_${t}`] ?? 0) > 0;
}

export function buyBall(s: EconomyState, t: BallType): boolean {
  if (!isUnlocked(s, t)) return false;
  const cost = nextBallCost(s, t);
  if (s.currency < cost) return false;
  s.currency -= cost;
  s.ballsOwned[t] += 1;
  return true;
}

export function pixelValue(cell: number): number {
  switch (cell) {
    case CELL.SOFT:
      return 1;
    case CELL.MED:
      return 2;
    case CELL.HARD:
      return 4;
    case CELL.OBJECT:
      return 3;
    case CELL.UPGRADE:
      return 2;
    case CELL.GOLD:
      return 0;
    default:
      return 0;
  }
}

export function buyUpgrade(s: EconomyState, id: string): boolean {
  const node = UPGRADE_TREE.find(n => n.id === id);
  if (!node) return false;
  const level = s.upgrades[id] ?? 0;
  if (level >= node.max) return false;
  if (node.requires && (s.upgrades[node.requires] ?? 0) <= 0) return false;
  if (s.upgradePoints < node.cost) return false;
  s.upgradePoints -= node.cost;
  s.upgrades[id] = level + 1;
  return true;
}

export function statMul(s: EconomyState, stat: string): number {
  let total = 0;
  for (const node of UPGRADE_TREE) {
    if (node.stat === stat) {
      const level = s.upgrades[node.id] ?? 0;
      total += level * (node.amount ?? 0);
    }
  }
  return 1 + total;
}

export function abilityLevel(s: EconomyState, stat: string): number {
  let total = 0;
  for (const node of UPGRADE_TREE) {
    if (node.stat === stat) total += s.upgrades[node.id] ?? 0;
  }
  return total;
}
