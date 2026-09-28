/**
 * Typed game-wide events. Systems communicate through the bus so later
 * features can listen in without modifying the systems that emit them.
 */
export interface GameEvents {
  coinCollected: { value: number; x: number; y: number; z: number };
  railChanged: { dir: -1 | 1 };
  railChangeBlocked: { dir: -1 | 1 };
  boost: Record<string, never>;
  crashed: Record<string, never>;
  levelComplete: Record<string, never>;
  zoneChanged: { label: string };
  hint: { text: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}
