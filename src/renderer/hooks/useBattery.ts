// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useState } from 'react';

/** The parts of Chromium's `BatteryManager` read here; TypeScript's DOM types leave the Battery Status API out. */
interface BatteryManagerLike extends EventTarget {
  readonly charging: boolean;
  readonly chargingTime: number;
  readonly dischargingTime: number;
  /** 0-1. */
  readonly level: number;
}

/** The battery, for the titlebar. */
export interface BatteryStatus {
  /** Whole percent remaining, 0-100. */
  readonly percent: number;
  readonly charging: boolean;
  /**
   * Seconds until the battery runs out (on battery) or until it is full (charging); `null` when full on the charger
   * or not yet estimated.
   */
  readonly secondsLeft: number | null;
}

/** A reading of the charge, taken the moment it changed while charging: where the charge rate is measured from. */
export interface ChargeSample {
  /** When, in ms. */
  readonly at: number;
  /** 0-1. */
  readonly level: number;
}

/**
 * How long until the battery is full, from how fast it has charged since `since`. Chromium on Windows rarely knows
 * the charging time itself, so this fills in. Charging slows near full, so it errs short, as Windows' own does.
 * @param since The charge when it first changed in this charging run (a change, so its percent isn't part-way through).
 * @param now The charge now.
 * @returns Seconds to full, or `null` until the charge has risen past `since`.
 */
export function estimateSecondsToFull(since: ChargeSample | null, now: ChargeSample): number | null {
  if (!since || now.level <= since.level || now.at <= since.at) {
    return null;
  }
  const perSecond = (now.level - since.level) / ((now.at - since.at) / 1000);
  return (1 - now.level) / perSecond;
}

/** How the battery's fill is colored: green while charging, orange when low, red when nearly empty. */
export type BatteryLevel = 'charging' | 'critical' | 'low' | 'normal';

/**
 * Which color a battery reading's fill takes.
 * @param status The reading.
 * @returns `charging` whenever plugged in; otherwise `critical` at 10% or less, `low` at 30% or less.
 */
export function batteryLevel(status: Pick<BatteryStatus, 'charging' | 'percent'>): BatteryLevel {
  if (status.charging) {
    return 'charging';
  }
  return status.percent <= 10 ? 'critical' : status.percent <= 30 ? 'low' : 'normal';
}

/**
 * The time left on battery, as the titlebar shows it beside the percent.
 * Rounded down, so the estimate never promises more than Windows does.
 * @param secondsLeft Seconds until the battery runs out, or `null` when there's no estimate.
 * @returns Whole hours ("3 h") from an hour up, whole minutes ("42 m") below; `null` with no estimate.
 */
export function formatBatteryTimeLeft(secondsLeft: number | null): string | null {
  if (secondsLeft === null || !Number.isFinite(secondsLeft) || secondsLeft < 0) {
    return null;
  }
  if (secondsLeft >= 3600) {
    return `${Math.floor(secondsLeft / 3600)} h`;
  }
  // Under a minute still reads "1 m" rather than "0 m", which would look like it had already run out.
  return `${Math.max(1, Math.floor(secondsLeft / 60))} m`;
}

/** The events a `BatteryManager` fires as the battery changes. */
const BATTERY_EVENTS = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'];

/**
 * Whether a `BatteryManager` reading is the one Chromium gives a computer with no battery at all (a desktop):
 * full, charging, done charging, and never running down.
 * @param battery The reading.
 */
export function isNoBattery(battery: Pick<BatteryManagerLike, 'charging' | 'chargingTime' | 'dischargingTime' | 'level'>): boolean {
  return battery.charging && battery.level === 1 && battery.chargingTime === 0 && battery.dischargingTime === Infinity;
}

/**
 * The battery's charge, whether it is charging and the time left on it, kept current from
 * Chromium's own change events (no polling). Read in the renderer, where the
 * Battery Status API lives; main has no battery level to offer.
 * @returns The battery, or `null` on a computer without one (or where the API isn't there).
 */
export function useBattery(): BatteryStatus | null {
  const [status, setStatus] = useState<BatteryStatus | null>(null);

  useEffect(() => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
    if (!getBattery) {
      return;
    }
    let battery: BatteryManagerLike | null = null;
    let cancelled = false;
    // Whether Windows says there's a battery (`null` until it has answered). A full, plugged-in laptop reads to the
    // page's API just like a desktop with none, so the guess from the reading is only used until then.
    let present: boolean | null = null;
    // The charging run's rate is measured from its first change of charge; `lastLevel` spots that change.
    let chargingSince: ChargeSample | null = null;
    let lastLevel: number | null = null;
    const update = (): void => {
      if (!battery) {
        return;
      }
      const hasBattery = present ?? !isNoBattery(battery);
      const now: ChargeSample = { at: Date.now(), level: battery.level };
      if (!battery.charging) {
        chargingSince = null;
      } else if (!chargingSince && lastLevel !== null && battery.level !== lastLevel) {
        chargingSince = now;
      }
      lastLevel = battery.charging ? battery.level : null;
      // Chromium reports `Infinity` for a time it doesn't know: on battery until Windows has an estimate after
      // unplugging, and while charging nearly always, so then the charge rate seen here stands in.
      let secondsLeft: number | null = null;
      if (!battery.charging) {
        secondsLeft = Number.isFinite(battery.dischargingTime) ? battery.dischargingTime : null;
      } else if (battery.level < 1) {
        secondsLeft =
          Number.isFinite(battery.chargingTime) && battery.chargingTime > 0
            ? battery.chargingTime
            : estimateSecondsToFull(chargingSince, now);
      }
      setStatus(
        hasBattery ? { percent: Math.round(battery.level * 100), charging: battery.charging, secondsLeft } : null,
      );
    };
    void window.northstar.getBatteryPresent().then((answer) => {
      if (!cancelled && answer !== null) {
        present = answer;
        update();
      }
    });
    void getBattery.call(navigator).then((manager) => {
      if (cancelled) {
        return;
      }
      battery = manager;
      update();
      for (const name of BATTERY_EVENTS) {
        manager.addEventListener(name, update);
      }
    });
    return () => {
      cancelled = true;
      for (const name of BATTERY_EVENTS) {
        battery?.removeEventListener(name, update);
      }
    };
  }, []);

  return status;
}
