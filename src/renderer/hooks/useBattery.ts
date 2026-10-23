// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

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
}

/** How the battery's fill is colored: green while charging, orange when low, red when nearly empty. */
export type BatteryLevel = 'charging' | 'critical' | 'low' | 'normal';

/**
 * Which color a battery reading's fill takes.
 * @param status The reading.
 * @returns `charging` whenever plugged in; otherwise `critical` at 10% or less, `low` at 30% or less.
 */
export function batteryLevel(status: BatteryStatus): BatteryLevel {
  if (status.charging) {
    return 'charging';
  }
  return status.percent <= 10 ? 'critical' : status.percent <= 30 ? 'low' : 'normal';
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
 * The battery's charge and whether it is charging, kept current from
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
    const update = (): void => {
      if (!battery) {
        return;
      }
      const hasBattery = present ?? !isNoBattery(battery);
      setStatus(hasBattery ? { percent: Math.round(battery.level * 100), charging: battery.charging } : null);
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
