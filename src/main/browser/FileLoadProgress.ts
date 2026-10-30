// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

/** How long a file's load must run before its progress shows: most notes and PDFs open at once, and would only flash. */
const SHOW_AFTER_MS = 150;

/** The timer functions it uses, injectable so tests can drive the clock. */
export interface ProgressTimers {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const REAL_TIMERS: ProgressTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * How far a PDF or a note has got opening, for the file bar's progress fill
 * and percentage — the address bar's progress for a web page, for a file.
 * One per tab, reused for each file it opens.
 *
 * A load that finishes within `SHOW_AFTER_MS` never shows at all; one that
 * runs longer shows from then on, rises with each `update`, and once
 * finished holds at 100% for `holdMs` before going, as a web page's does.
 */
export class FileLoadProgress {
  private active = false;
  private shown = false;
  private percent = 0;
  private showTimer: unknown = null;
  private clearTimer: unknown = null;

  /**
   * @param report Called with the percentage to show, or `null` once there's none.
   * @param holdMs How long 100% stays up once the load is done.
   * @param timers The timer functions; the real ones by default.
   */
  public constructor(
    private readonly report: (percent: number | null) => void,
    private readonly holdMs: number,
    private readonly timers: ProgressTimers = REAL_TIMERS,
  ) {}

  /** A load starts, replacing any still under way or still holding at 100%. */
  public begin(): void {
    this.stopTimers();
    if (this.shown) {
      this.report(null);
    }
    this.active = true;
    this.shown = false;
    this.percent = 0;
    this.showTimer = this.timers.setTimeout(() => {
      this.showTimer = null;
      this.shown = true;
      this.report(this.percent);
    }, SHOW_AFTER_MS);
  }

  /**
   * The load has got further. Only a rise to a new whole percent is reported.
   * @param percent How far, 0-100.
   */
  public update(percent: number): void {
    const whole = Math.min(100, Math.max(0, Math.floor(percent)));
    if (!this.active || whole <= this.percent) {
      return;
    }
    this.percent = whole;
    if (this.shown) {
      this.report(whole);
    }
  }

  /** The load is done: 100% shows for `holdMs`, if the progress was showing at all. */
  public finish(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.stopTimers();
    if (!this.shown) {
      return;
    }
    this.report(100);
    this.clearTimer = this.timers.setTimeout(() => {
      this.clearTimer = null;
      this.shown = false;
      this.report(null);
    }, this.holdMs);
  }

  /** The load failed or was abandoned: the progress goes at once, without reaching 100%. */
  public cancel(): void {
    this.active = false;
    this.stopTimers();
    if (this.shown) {
      this.shown = false;
      this.report(null);
    }
  }

  private stopTimers(): void {
    if (this.showTimer !== null) {
      this.timers.clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.clearTimer !== null) {
      this.timers.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }
}
