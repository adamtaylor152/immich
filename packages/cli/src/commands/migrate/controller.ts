import type { MigrateStatus, Phase } from 'src/commands/migrate/types';

/**
 * Shared, in-process control + progress surface. The dashboard reads `snapshot()` and
 * calls pause/resume/stop; the pipeline calls `gate()` at each task boundary so a pause
 * takes effect between units of work (never mid-upload).
 */
export class Controller {
  running = false;
  paused = false;
  stopped = false;
  phase: MigrateStatus['phase'] = 'idle';
  message = '';
  error: string | null = null;
  startedAt: string | null = null;
  private waiters: Array<() => void> = [];

  setPhase(phase: Phase) {
    this.phase = phase;
    this.message = '';
  }
  log(message: string) {
    this.message = message;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
  stop() {
    this.stopped = true;
    this.resume(); // release anyone waiting so they can observe `stopped`
  }

  /** Resolves immediately unless paused; while paused, blocks until resume()/stop(). */
  async gate(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
