// Input: an analog drag anywhere on the playfield for pitch, plus FIRE/BOMB
// buttons and keyboard equivalents. Exposes a stable `state` the player plane
// samples each frame.

import { clamp } from './util.js';

export const state = {
  pitch: 0,       // -1 = push forward .. +1 = pull back, analog
  fire: false,
  bomb: false,    // edge-triggered: consume with takeBomb()
};

const TRAVEL = 84;   // px of drag for full deflection
const DEADZONE = 7;  // px of slop before anything registers

let bombLatch = false;
const keys = { up: false, down: false };
const drag = { id: null, originY: 0, value: 0 };

let stick = null;
let knob = null;

function refreshPitch() {
  if (drag.id !== null) {
    state.pitch = drag.value;
    return;
  }
  state.pitch = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
}

/** True once per bomb press. */
export function takeBomb() {
  if (!bombLatch) return false;
  bombLatch = false;
  return true;
}

export function resetInput() {
  keys.up = keys.down = false;
  drag.id = null;
  drag.value = 0;
  state.pitch = 0;
  state.fire = false;
  bombLatch = false;
  hideStick();
  for (const el of document.querySelectorAll('.ctl.down')) el.classList.remove('down');
}

// ── Stick indicator ──────────────────────────────────────────

function showStick(x, y) {
  if (!stick) return;
  stick.style.left = `${x}px`;
  stick.style.top = `${y}px`;
  stick.classList.add('on');
  moveKnob(0);
}

function moveKnob(dy) {
  if (!knob) return;
  knob.style.transform = `translate(-50%, -50%) translateY(${dy}px)`;
  knob.classList.toggle('pull', dy < -DEADZONE);
  knob.classList.toggle('push', dy > DEADZONE);
}

function hideStick() {
  if (stick) stick.classList.remove('on');
}

// ── Drag handling ────────────────────────────────────────────

/** Buttons and overlay panels keep their own taps. */
function isReserved(target) {
  return !!(target.closest && (target.closest('button') || target.closest('.screen')));
}

function onDown(e) {
  if (drag.id !== null || isReserved(e.target)) return;
  drag.id = e.pointerId;
  drag.originY = e.clientY;
  drag.value = 0;
  showStick(e.clientX, e.clientY);
  refreshPitch();
}

function onMove(e) {
  if (e.pointerId !== drag.id) return;
  let dy = e.clientY - drag.originY;

  // Re-anchor at full deflection so easing back off responds immediately
  // instead of needing the whole travel back.
  if (dy > TRAVEL) { drag.originY = e.clientY - TRAVEL; dy = TRAVEL; }
  else if (dy < -TRAVEL) { drag.originY = e.clientY + TRAVEL; dy = -TRAVEL; }

  const mag = Math.max(0, Math.abs(dy) - DEADZONE) / (TRAVEL - DEADZONE);
  drag.value = clamp(mag, 0, 1) * (dy < 0 ? 1 : -1);   // up = pull back
  moveKnob(dy);
  refreshPitch();
}

function onUp(e) {
  if (e.pointerId !== drag.id) return;
  drag.id = null;
  drag.value = 0;
  hideStick();
  refreshPitch();
}

/** Wire a DOM button as a press-and-hold control. */
function holdButton(el, onPress, onRelease) {
  if (!el) return;
  const press = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.add('down');
    onPress();
  };
  const release = (e) => {
    e.preventDefault();
    el.classList.remove('down');
    onRelease?.();
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function initInput() {
  stick = document.getElementById('stick');
  knob = document.getElementById('stick-knob');

  holdButton(
    document.getElementById('ctl-fire'),
    () => { state.fire = true; },
    () => { state.fire = false; },
  );
  holdButton(
    document.getElementById('ctl-bomb'),
    () => { bombLatch = true; },
  );

  // Pitch: drag anywhere that isn't a button or an overlay.
  const app = document.getElementById('app');
  app.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': keys.up = true; refreshPitch(); break;
      case 'ArrowDown': case 'KeyS': keys.down = true; refreshPitch(); break;
      case 'Space': state.fire = true; break;
      case 'KeyB': if (!e.repeat) bombLatch = true; break;
      default: return;
    }
    e.preventDefault();
  });

  addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': keys.up = false; refreshPitch(); break;
      case 'ArrowDown': case 'KeyS': keys.down = false; refreshPitch(); break;
      case 'Space': state.fire = false; break;
      default: return;
    }
    e.preventDefault();
  });

  // Never let the page itself scroll or zoom under the controls.
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  addEventListener('blur', resetInput);
}
