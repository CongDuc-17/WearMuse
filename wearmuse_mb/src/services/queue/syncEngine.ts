import { ProcessingPoller } from './processingPoller';
import { UploadQueue } from './uploadQueue';

interface Lane {
  running: boolean;
  wakeAgain: boolean;
  run(signal: AbortSignal): Promise<void>;
}
interface Heartbeat {
  start(callback: () => void): ReturnType<typeof setInterval>;
  stop(timer: ReturnType<typeof setInterval>): void;
}

/** Uploads and polling have independent lanes so slow uploads never hold back ready previews. */
export class SyncEngine {
  private foreground = false;
  private connected = false;
  private stopped = false;
  private active: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lanes: Lane[];

  constructor(
    private readonly uploadQueue: UploadQueue,
    private readonly poller: ProcessingPoller,
    private readonly heartbeat: Heartbeat = {
      start: (callback) => setInterval(callback, 2_500),
      stop: (timer) => clearInterval(timer),
    },
  ) {
    this.lanes = [
      { running: false, wakeAgain: false, run: (signal) => uploadQueue.drain(signal) },
      { running: false, wakeAgain: false, run: (signal) => poller.tick(signal) },
    ];
  }

  setForeground(value: boolean) {
    if (this.foreground === value) return;
    this.foreground = value; this.changed();
  }
  setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value; this.changed();
  }
  private get available() { return !this.stopped && this.foreground && this.connected; }

  private changed() {
    if (!this.available) {
      if (this.timer !== null) this.heartbeat.stop(this.timer);
      this.timer = null;
      this.active?.abort();
      return;
    }
    if (!this.active || this.active.signal.aborted) this.active = new AbortController();
    if (this.timer === null) this.timer = this.heartbeat.start(() => this.wake());
    this.wake();
  }

  cancel(localId: string) { this.uploadQueue.cancel(localId); this.poller.cancel(localId); }

  wake() {
    if (!this.available) return;
    for (const lane of this.lanes) this.wakeLane(lane);
  }

  private wakeLane(lane: Lane) {
    if (!this.available || !this.active) return;
    if (lane.running) { lane.wakeAgain = true; return; }
    lane.running = true;
    lane.wakeAgain = false;
    const signal = this.active.signal;
    void Promise.resolve().then(() => lane.run(signal)).catch(() => {
      // Durable row state remains eligible for a later heartbeat after a storage failure.
    }).finally(() => {
      lane.running = false;
      if (lane.wakeAgain && this.available) this.wakeLane(lane);
    });
  }

  stop() {
    this.stopped = true;
    this.changed();
    this.uploadQueue.cancelAll();
    this.poller.cancelAll();
  }
}
