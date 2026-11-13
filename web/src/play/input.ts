import type { Controls } from './physics';

const KEYS: Record<string, 'left' | 'right' | 'up' | 'down' | 'boost'> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'boost',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

const block = (event: Event) => event.preventDefault();
const STICK_RADIUS = 58;

function guard(event: Event): void {
  const target = event.target;
  if (target instanceof Element && target.closest('.gp-panel, .gp-tools')) return;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export class Input {
  readonly controls: Controls = { steer: 0, throttle: 0, brake: 0, boost: false };
  autoThrottle: boolean;
  boostEdge = false;
  private held = { left: false, right: false, up: false, down: false, boost: false };
  private steer = 0;
  private stick: number | null = null;
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement, touch: boolean) {
    this.autoThrottle = touch;
    const onKey = (down: boolean) => (event: KeyboardEvent) => {
      const action = KEYS[event.code];
      if (!action) return;
      const target = event.target;
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      if (action === 'up' && down) this.autoThrottle = false;
      this.set(action, down);
    };
    const keydown = onKey(true);
    const keyup = onKey(false);
    const blur = () => {
      this.stick = null;
      this.held = { left: false, right: false, up: false, down: false, boost: false };
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    });
    for (const type of ['selectstart', 'contextmenu', 'dblclick', 'gesturestart'])
      root.addEventListener(type, guard, { passive: false });
    const stage = root.querySelector<HTMLElement>('[data-hud="stage"]');
    stage?.addEventListener('touchstart', guard, { passive: false });
    this.cleanup.push(() => {
      for (const type of ['selectstart', 'contextmenu', 'dblclick', 'gesturestart'])
        root.removeEventListener(type, guard);
      stage?.removeEventListener('touchstart', guard);
    });
    const zone = root.querySelector<HTMLElement>('[data-stick]');
    if (zone) {
      let pointer: number | null = null;
      let origin = 0;
      const place = (x: number | null, y: number | null, knob: number) => {
        if (x === null || y === null) {
          zone.style.removeProperty('--bx');
          zone.style.removeProperty('--by');
        } else {
          zone.style.setProperty('--bx', `${x}px`);
          zone.style.setProperty('--by', `${y}px`);
        }
        zone.style.setProperty('--kx', `${knob}px`);
        zone.classList.toggle('held', x !== null);
      };
      const down = (event: PointerEvent) => {
        if (pointer !== null) return;
        event.preventDefault();
        pointer = event.pointerId;
        zone.setPointerCapture(event.pointerId);
        const rect = zone.getBoundingClientRect();
        origin = event.clientX;
        this.stick = 0;
        place(event.clientX - rect.left, Math.max(rect.height - 120, event.clientY - rect.top), 0);
      };
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        event.preventDefault();
        const offset = Math.max(-STICK_RADIUS, Math.min(STICK_RADIUS, event.clientX - origin));
        origin = event.clientX - offset;
        const raw = offset / STICK_RADIUS;
        this.stick = Math.abs(raw) < 0.08 ? 0 : -raw;
        const rect = zone.getBoundingClientRect();
        zone.style.setProperty('--bx', `${origin - rect.left}px`);
        zone.style.setProperty('--kx', `${offset}px`);
      };
      const up = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        pointer = null;
        this.stick = null;
        place(null, null, 0);
      };
      zone.addEventListener('pointerdown', down);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
      zone.addEventListener('lostpointercapture', up);
      zone.addEventListener('touchstart', block, { passive: false });
      zone.addEventListener('touchmove', block, { passive: false });
      zone.addEventListener('contextmenu', block);
      this.cleanup.push(() => {
        zone.removeEventListener('pointerdown', down);
        zone.removeEventListener('pointermove', move);
        zone.removeEventListener('pointerup', up);
        zone.removeEventListener('pointercancel', up);
        zone.removeEventListener('lostpointercapture', up);
        zone.removeEventListener('touchstart', block);
        zone.removeEventListener('touchmove', block);
        zone.removeEventListener('contextmenu', block);
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>('[data-control]')) {
      const action = button.dataset.control;
      if (action !== 'left' && action !== 'right' && action !== 'down' && action !== 'boost') continue;
      const press = (down: boolean) => (event: PointerEvent) => {
        event.preventDefault();
        if (down) button.setPointerCapture(event.pointerId);
        button.classList.toggle('held', down);
        this.set(action, down);
      };
      const start = press(true);
      const end = press(false);
      button.addEventListener('pointerdown', start);
      button.addEventListener('pointerup', end);
      button.addEventListener('pointercancel', end);
      button.addEventListener('lostpointercapture', end);
      button.addEventListener('contextmenu', block);
      button.addEventListener('touchstart', block, { passive: false });
      button.addEventListener('touchend', block, { passive: false });
      this.cleanup.push(() => {
        button.removeEventListener('pointerdown', start);
        button.removeEventListener('pointerup', end);
        button.removeEventListener('pointercancel', end);
        button.removeEventListener('lostpointercapture', end);
        button.removeEventListener('contextmenu', block);
        button.removeEventListener('touchstart', block);
        button.removeEventListener('touchend', block);
      });
    }
  }

  private set(action: keyof Input['held'], down: boolean): void {
    if (down && !this.held[action] && (action === 'boost' || action === 'up')) this.boostEdge = true;
    this.held[action] = down;
  }

  update(dt: number): Controls {
    const keys = (this.held.left ? 1 : 0) - (this.held.right ? 1 : 0);
    const target = this.stick ?? keys;
    const rate = this.stick !== null ? 14 : target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) ? 11 : 5.5;
    const delta = target - this.steer;
    this.steer += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
    this.controls.steer = this.steer;
    this.controls.brake = this.held.down ? 1 : 0;
    this.controls.throttle = this.held.down ? 0 : this.held.up || this.autoThrottle ? 1 : 0;
    this.controls.boost = this.held.boost;
    return this.controls;
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }
}
