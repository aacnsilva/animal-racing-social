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

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export class Input {
  readonly controls: Controls = { steer: 0, throttle: 0, brake: 0, boost: false };
  autoThrottle: boolean;
  boostEdge = false;
  private held = { left: false, right: false, up: false, down: false, boost: false };
  private steer = 0;
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
    const guard = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.gp-panel, .gp-tools')) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    };
    for (const type of ['selectstart', 'contextmenu', 'dblclick', 'gesturestart'])
      root.addEventListener(type, guard, { passive: false });
    const stage = root.querySelector<HTMLElement>('[data-hud="stage"]');
    stage?.addEventListener('touchstart', guard, { passive: false });
    this.cleanup.push(() => {
      for (const type of ['selectstart', 'contextmenu', 'dblclick', 'gesturestart'])
        root.removeEventListener(type, guard);
      stage?.removeEventListener('touchstart', guard);
    });
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
    const target = (this.held.left ? 1 : 0) - (this.held.right ? 1 : 0);
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) ? 11 : 5.5;
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
