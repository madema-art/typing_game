/** Minimal strongly typed event emitter used to decouple game logic from audio/visual feedback. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => {
      const list = this.handlers[type];
      if (list) this.handlers[type] = list.filter((f) => f !== fn);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const fn of list) fn(payload);
  }
}
