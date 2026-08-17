// Input: on-screen buttons (pointer events, multi-touch friendly) + keyboard.
// Exposes a stable `state` object the player plane samples each frame.

export const state = {
  pitch: 0,       // -1 = push (nose down), +1 = pull (nose up)
  fire: false,
  bomb: false,    // edge-triggered: consume with takeBomb()
};

let bombLatch = false;
const held = { up: false, down: false, kUp: false, kDown: false };

function refreshPitch() {
  const up = held.up || held.kUp;
  const down = held.down || held.kDown;
  state.pitch = (up ? 1 : 0) - (down ? 1 : 0);
}

/** True once per bomb press. */
export function takeBomb() {
  if (!bombLatch) return false;
  bombLatch = false;
  return true;
}

export function resetInput() {
  held.up = held.down = held.kUp = held.kDown = false;
  state.pitch = 0;
  state.fire = false;
  bombLatch = false;
  for (const el of document.querySelectorAll('.ctl.down')) el.classList.remove('down');
}

/** Wire a DOM button as a press-and-hold control. */
function holdButton(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.add('down');
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    el.classList.remove('down');
    onUp?.();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function initInput() {
  holdButton(
    document.getElementById('ctl-up'),
    () => { held.up = true; refreshPitch(); },
    () => { held.up = false; refreshPitch(); },
  );
  holdButton(
    document.getElementById('ctl-down'),
    () => { held.down = true; refreshPitch(); },
    () => { held.down = false; refreshPitch(); },
  );
  holdButton(
    document.getElementById('ctl-fire'),
    () => { state.fire = true; },
    () => { state.fire = false; },
  );
  holdButton(
    document.getElementById('ctl-bomb'),
    () => { bombLatch = true; },
  );

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': held.kUp = true; refreshPitch(); break;
      case 'ArrowDown': case 'KeyS': held.kDown = true; refreshPitch(); break;
      case 'Space': state.fire = true; break;
      case 'KeyB': if (!e.repeat) bombLatch = true; break;
      default: return;
    }
    e.preventDefault();
  });

  addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': held.kUp = false; refreshPitch(); break;
      case 'ArrowDown': case 'KeyS': held.kDown = false; refreshPitch(); break;
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
