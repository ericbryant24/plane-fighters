// Mission (level) definitions. Every level has an objective, a way to make
// progress toward it, and optionally a clock. The rotation repeats, escalating
// each time round, so the run keeps going as long as the pilot does.

import { CFG } from './config.js';

const ROTATION = [
  'sweep',      // shoot down fighters
  'balloons',   // pop the observation balloons before the clock runs out
  'sweep',
  'raid',       // bomb depots and hangars
  'flak',       // silence the AA emplacements
  'intercept',  // stop bombers crossing the sector
  'duel',       // kill the aces
  'survive',    // hold the sector for a while
];

const SPECS = {
  sweep: (c) => ({
    title: 'AIR SUPERIORITY',
    brief: (g) => `Shoot down ${g} aircraft`,
    label: 'PLANES',
    goal: 3 + c * 2,
    fighters: 0,                       // the objective pool *is* the opposition
    aces: c,
  }),

  balloons: (c) => ({
    title: 'BALLOON BUST',
    brief: (g) => `Destroy ${g} observation balloons`,
    label: 'BALLOONS',
    goal: 3 + c,
    timeLimit: 80 + c * 10,
    fighters: 1 + Math.min(2, c),      // light standing patrol
    needs: { balloon: 3 + c },
  }),

  raid: (c) => ({
    title: 'BOMBING RAID',
    brief: (g) => `Flatten ${g} ground installations`,
    label: 'TARGETS',
    goal: 3 + c,
    fighters: 1 + Math.min(2, c),
    needs: { depot: 2 + c, hangar: 2 },
  }),

  flak: (c) => ({
    title: 'FLAK SUPPRESSION',
    brief: (g) => `Silence ${g} anti-aircraft guns`,
    label: 'AA GUNS',
    goal: 3 + c,
    fighters: 1 + Math.min(2, c),
    needs: { aa: 3 + c },
  }),

  intercept: (c) => ({
    title: 'INTERCEPT',
    brief: (g) => `Down ${g} bombers before they cross`,
    label: 'BOMBERS',
    goal: 2 + c,
    allowEscape: c > 0 ? 1 : 0,        // later cycles are less forgiving
    bombers: 2 + c,
    fighters: Math.min(2, c),          // escorts arrive in later cycles
  }),

  duel: (c) => ({
    title: 'ACE DUEL',
    brief: (g) => (g > 1 ? `Defeat ${g} enemy aces` : 'Defeat the enemy ace'),
    label: 'ACES',
    goal: 1 + c,
    fighters: 0,
    aces: 1 + c,
  }),

  survive: (c) => ({
    title: 'HOLD THE SECTOR',
    brief: (g) => `Stay airborne for ${g} seconds`,
    label: 'HOLD',
    goal: 45 + c * 15,
    isTimed: true,                     // progress is the clock itself
    fighters: 2 + Math.min(2, c),
  }),
};

/** Enemy skill curve — flying ability, not objective. */
export function skillFor(level) {
  const w = Math.max(1, level);
  return {
    aim: Math.min(0.85, 0.34 + w * 0.055),
    lead: Math.min(1, 0.35 + w * 0.09),
    agility: Math.min(1.15, 0.74 + w * 0.045),
    speed: Math.min(1.12, 0.86 + w * 0.03),
    reaction: Math.max(0.16, 0.62 - w * 0.05),
    maxAlive: Math.min(CFG.enemy.maxAlive, 2 + Math.floor(w / 2)),
  };
}

/** Full descriptor for a level, including its escalation tier. */
export function missionFor(level) {
  const i = (Math.max(1, level) - 1) % ROTATION.length;
  const cycle = Math.floor((Math.max(1, level) - 1) / ROTATION.length);
  const type = ROTATION[i];
  const base = SPECS[type](cycle);
  return {
    type,
    level,
    cycle,
    title: base.title,
    label: base.label,
    goal: base.goal,
    brief: base.brief(base.goal),
    timeLimit: base.timeLimit ?? 0,
    isTimed: !!base.isTimed,
    fighters: base.fighters ?? 0,
    aces: base.aces ?? 0,
    bombers: base.bombers ?? 0,
    allowEscape: base.allowEscape ?? 0,
    needs: base.needs ?? null,
    skill: skillFor(level),
  };
}

export const MISSION_COUNT = ROTATION.length;
