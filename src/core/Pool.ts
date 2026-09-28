/**
 * Minimal object pool. Objects are created on demand up to an optional
 * limit and recycled via release(). Used for obstacles, scenery props,
 * rail chunks and UI fly-outs so that streaming never allocates in the
 * steady state.
 */
export class Pool<T> {
  private free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
    private readonly limit = Infinity,
  ) {}

  acquire(): T | null {
    let item = this.free.pop();
    if (item === undefined) {
      if (this.created >= this.limit) return null;
      item = this.factory();
      this.created++;
    }
    this.onAcquire?.(item);
    return item;
  }

  release(item: T): void {
    this.onRelease?.(item);
    this.free.push(item);
  }

  prewarm(count: number): void {
    const items: T[] = [];
    for (let i = 0; i < count; i++) {
      const it = this.acquire();
      if (it !== null) items.push(it);
    }
    for (const it of items) this.release(it);
  }

  get totalCreated(): number {
    return this.created;
  }

  get freeCount(): number {
    return this.free.length;
  }
}
