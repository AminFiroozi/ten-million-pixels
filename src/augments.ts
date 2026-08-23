import { mulberry32 } from "./rng";

export type AugmentStat =
  | "speed"
  | "damage"
  | "smashRadius"
  | "poisonSpread"
  | "splitCount"
  | "pierceDepth"
  | "pixelValueMul"
  | "treasureMul"
  | "bossMul"
  | "revealRadius"
  | "launchWave";

export interface AugmentDef {
  id: string;
  name: string;
  desc: string;
  stat: AugmentStat;
  amount: number;
}

export const AUGMENT_POOL: AugmentDef[] = [
  { id: "aug_momentum", name: "Momentum", desc: "+20% ball speed", stat: "speed", amount: 0.2 },
  { id: "aug_heavy", name: "Heavy Hitters", desc: "+20% damage", stat: "damage", amount: 0.2 },
  { id: "aug_blast", name: "Wide Blast", desc: "Smash radius +1", stat: "smashRadius", amount: 1 },
  { id: "aug_toxic", name: "Toxic Bloom", desc: "Poison spread +1", stat: "poisonSpread", amount: 1 },
  { id: "aug_split", name: "Splitting Frenzy", desc: "Split count +1", stat: "splitCount", amount: 1 },
  { id: "aug_pierce", name: "Deep Pierce", desc: "Pierce depth +1", stat: "pierceDepth", amount: 1 },
  { id: "aug_prospector", name: "Prospector", desc: "+20% currency from mining", stat: "pixelValueMul", amount: 0.2 },
  { id: "aug_treasure", name: "Treasure Nose", desc: "+30% treasure payout", stat: "treasureMul", amount: 0.3 },
  { id: "aug_slayer", name: "Boss Slayer", desc: "+30% boss payout", stat: "bossMul", amount: 0.3 },
  { id: "aug_eyes", name: "Wide Eyes", desc: "Reveal radius +3", stat: "revealRadius", amount: 3 },
  { id: "aug_overcharge", name: "Overcharge", desc: "Launch wave +10 balls", stat: "launchWave", amount: 10 },
  { id: "aug_swift", name: "Swift Draw", desc: "+15% ball speed", stat: "speed", amount: 0.15 },
];

export interface AugmentState {
  picked: string[];
  rngState: number;
}

export function newAugmentState(seed: number): AugmentState {
  return { picked: [], rngState: seed + 8 };
}

export function augmentMul(state: AugmentState, stat: string): number {
  let total = 0;
  for (const def of AUGMENT_POOL) {
    if (def.stat === stat && state.picked.includes(def.id)) total += def.amount;
  }
  return 1 + total;
}

export function augmentBonus(state: AugmentState, stat: string): number {
  let total = 0;
  for (const def of AUGMENT_POOL) {
    if (def.stat === stat && state.picked.includes(def.id)) total += def.amount;
  }
  return total;
}

export function pickAugment(state: AugmentState, id: string): void {
  if (state.picked.includes(id)) return;
  if (!AUGMENT_POOL.some(d => d.id === id)) return;
  state.picked.push(id);
}

function advanceSeed(seed: number): number {
  return (seed + 0x9e3779b9) | 0;
}

export function rollChoices(state: AugmentState, count: number): AugmentDef[] {
  const available = AUGMENT_POOL.filter(d => !state.picked.includes(d.id));
  const rng = mulberry32(state.rngState);
  state.rngState = advanceSeed(state.rngState);
  const pool = available.slice();
  const result: AugmentDef[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}
