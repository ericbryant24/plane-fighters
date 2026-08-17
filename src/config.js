// Central tuning table. World units are roughly "feet"; y grows downward,
// so altitude is (GROUND - y). The world wraps horizontally.

export const CFG = {
  world: {
    width: 3600,      // wraps at this x
    groundY: 1520,    // mean ground line
    ceiling: 150,     // above this the engine starves
    topY: 40,         // hard clamp
  },

  view: {
    height: 820,      // world units visible vertically (drives the zoom)
    minWidth: 420,    // never show less horizontal world than this
  },

  // Flight model. Speed and path angle are integrated directly (see plane.js):
  // lift bends the flight path without doing work, and turning is charged as
  // induced drag. Cruise is the level-flight equilibrium sqrt(thrust/dragK).
  plane: {
    thrust: 115,      // engine accel along the nose
    gravity: 220,
    dragK: 0.001278,  // quadratic drag => level cruise ~300, terminal dive ~470
    align: 7,         // how fast the flight path swings onto the nose
    inducedK: 0.03,   // speed lost per radian of turning
    turn: 2.9,        // rad/s (a loop takes ~2.2s and stands ~155 units tall)
    stallSpeed: 70,   // below this the wings stop biting
    stallDroop: 0.9,  // how hard a stalled nose falls through
    radius: 19,
    hp: 100,
    cruise: 300,
  },

  gun: {
    speed: 620,
    life: 0.9,
    dmg: 9,           // player rounds
    dmgEnemy: 6,      // enemy rounds hit softer, and their guns cycle slower
    enemyFireRate: 0.6,
    spread: 0.012,
    cooldown: 0.11,
    muzzle: 22,
  },

  bomb: {
    radius: 7,
    gravity: 240,
    dragK: 0.0012,
    dmg: 70,
    blast: 105,
    max: 8,
  },

  flak: {
    speed: 420,
    dmg: 11,
    blast: 78,
    life: 3.2,
  },

  enemy: {
    hp: 54,
    maxAlive: 5,
    spawnGap: 1.5,
  },

  score: {
    plane: 150,
    ace: 300,
    aa: 90,
    depot: 120,
    balloon: 60,
    wave: 250,
  },
};

// Per-wave difficulty knobs, interpolated/extrapolated from wave number.
export function waveSpec(wave) {
  const w = Math.max(1, wave);
  return {
    total: 2 + Math.floor(w * 0.9),               // planes to shoot down
    aces: w < 3 ? 0 : Math.floor((w - 1) / 3),
    aim: Math.min(0.85, 0.34 + w * 0.055),        // firing cone tightness
    lead: Math.min(1, 0.35 + w * 0.09),           // how well they lead shots
    agility: Math.min(1.15, 0.74 + w * 0.045),
    speed: Math.min(1.12, 0.86 + w * 0.03),
    reaction: Math.max(0.16, 0.62 - w * 0.05),
    maxAlive: Math.min(CFG.enemy.maxAlive, 2 + Math.floor(w / 2)),
  };
}
