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
    hp: 18,           // two hits from the player's 9-damage rounds
    maxAlive: 5,
    spawnGap: 1.5,
    aceHp: 1.5,       // aces take three
    bomberHp: 2.5,    // bombers soak a five-round burst
  },

  score: {
    plane: 150,
    ace: 300,
    bomber: 260,
    aa: 90,
    depot: 120,
    balloon: 60,
    mission: 250,      // base objective bonus, plus 25 per level
  },
};
