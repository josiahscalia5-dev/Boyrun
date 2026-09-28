export type InputAction = 'left' | 'right' | 'pause' | 'confirm';

/**
 * Phase 1 controls: the on-screen left/right buttons (reference layout)
 * and keyboard arrows / A-D for desktop testing. Buttons fire on press,
 * not release, so rail changes feel instant.
 */
export class Input {
  private queue: InputAction[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(buttons: { left: HTMLElement; right: HTMLElement; pause: HTMLElement }) {
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const press = (action: InputAction) => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.queue.push(action);
    };
    on(buttons.left, 'pointerdown', press('left'));
    on(buttons.right, 'pointerdown', press('right'));
    on(buttons.pause, 'pointerdown', press('pause'));
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          this.queue.push('left');
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.queue.push('right');
          break;
        case 'Escape':
        case 'KeyP':
          this.queue.push('pause');
          break;
        case 'Space':
        case 'Enter':
          this.queue.push('confirm');
          break;
        default:
          return;
      }
      e.preventDefault();
    });
    // Block page gestures (pinch/scroll/double-tap zoom) inside the game.
    on(document, 'touchmove', (e: TouchEvent) => e.preventDefault(), { passive: false });
    on(document, 'contextmenu', (e: MouseEvent) => e.preventDefault());
  }

  /** Inject an action (debug autopilot / tests). */
  push(action: InputAction): void {
    this.queue.push(action);
  }

  drain(): InputAction[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}
