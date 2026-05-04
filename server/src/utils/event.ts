import { ArgOf, EmitEvent } from 'src/repositories/event.repository';

export class PendingEvents<T extends { [T in EmitEvent]: ArgOf<T> extends { error?: string } ? T : never }[EmitEvent]> {
  private pending = new Map<string, { completers: PromiseWithResolvers<ArgOf<T>>[]; timeout: NodeJS.Timeout }>();

  constructor(private timeoutMs: number) {}

  wait(key: string): Promise<ArgOf<T>> {
    const completer = Promise.withResolvers<ArgOf<T>>();
    const existing = this.pending.get(key);
    if (existing) {
      existing.completers.push(completer);
      return completer.promise;
    }

    const timeout = setTimeout(() => this.complete(key, { error: 'Request timed out' }), this.timeoutMs);
    this.pending.set(key, { completers: [completer], timeout });
    return completer.promise;
  }

  complete(key: string, value: ArgOf<T> | { error: string }) {
    const pending = this.pending.get(key);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(key);
    for (const completer of pending.completers) {
      if ('error' in value) {
        completer.reject(new Error(value.error));
      } else {
        completer.resolve(value);
      }
    }
  }

  rejectByPrefix(prefix: string, error: string) {
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) {
        this.complete(key, { error });
      }
    }
  }
}
