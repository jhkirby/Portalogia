// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import type { WeatherState } from '@shared/ipc-contract';

/**
 * Approximate location from the computer's public IP address, tried in order. No key needed for either. ipapi.co
 * rate-limits hard (a shared campus or office address can run out of its free allowance), so a refusal there falls
 * through to ipwho.is. Both answer with numeric `latitude` and `longitude`.
 */
const LOCATION_URLS = ['https://ipapi.co/json/', 'https://ipwho.is/'];
/** Sent with every request: ipapi.co turns away Node's own default User-Agent more readily than a browser's. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Portalogia';
/** Open-Meteo's current conditions. No key needed. */
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** How often, in ms, the temperature is fetched again: Open-Meteo updates its current conditions every 15 minutes. */
const REFRESH_MS = 10 * 60 * 1000;
/** How soon, in ms, a failed fetch (offline, say) is tried again. */
const RETRY_MS = 60 * 1000;
/** How soon, in ms, a failed fetch is tried again while there's no temperature to show at all. */
const FIRST_RETRY_MS = 10 * 1000;
/** How long, in ms, after the network changes before fetching: a fresh connection takes a moment to resolve names. */
const NETWORK_SETTLE_MS = 3000;
/** How long, in ms, a found location is trusted before it is looked up again (a laptop travels). */
const LOCATION_TTL_MS = 60 * 60 * 1000;

/** The most of a reply read: both answers are a few hundred bytes, and a third party mustn't be able to fill memory. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/** The `fetch` the monitor uses; injectable so it can be tested without the network. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Fetches a URL as JSON, reading at most `MAX_RESPONSE_BYTES` of the body (a longer one is dropped unread).
 * @param url The address.
 * @returns Whether it succeeded, and its parsed body.
 */
async function fetchJsonCapped(url: string): Promise<{ ok: boolean; json(): Promise<unknown> }> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) {
    return { ok: false, json: async () => null };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { ok: false, json: async () => null };
    }
    chunks.push(next.value);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return { ok: true, json: async () => JSON.parse(text) as unknown };
}

interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Reads a finite number field off a JSON object of unknown shape.
 * @param value The parsed JSON.
 * @param key The field.
 * @returns The number, or `null` if it is missing or not a number.
 */
function numberField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

/**
 * The outside temperature where the computer is, in whole degrees Fahrenheit,
 * for the titlebar (Portalogia may cover the whole screen, taskbar included).
 * The place comes from the public IP address (ipapi.co, or ipwho.is), which is close enough
 * for weather, and the temperature from Open-Meteo.
 */
export class WeatherMonitor {
  private state: WeatherState = { temperatureF: null };
  private location: { coordinates: Coordinates; foundAt: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private active = false;

  /**
   * @param onChange Called with the new state whenever it changes.
   * @param fetcher Fetches a URL as JSON; `fetchJsonCapped` unless a test supplies one.
   * @param now The current time in ms; injectable for tests.
   */
  public constructor(
    private readonly onChange: (state: WeatherState) => void,
    private readonly fetcher: Fetcher = fetchJsonCapped,
    private readonly now: () => number = Date.now,
  ) {}

  /** The state as last fetched. */
  public get current(): WeatherState {
    return this.state;
  }

  /** Fetches the temperature now, then every `REFRESH_MS` (sooner after a failure) until `stop`. */
  public start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.schedule(0);
  }

  /** Stops fetching. */
  public stop(): void {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The computer joined a network (or another one): looks the location up again, since a new network can mean a new
   * place, and fetches shortly, rather than waiting out a retry left from a fetch the change cut off.
   */
  public networkChanged(): void {
    if (this.location) {
      this.location = { ...this.location, foundAt: Number.NEGATIVE_INFINITY };
    }
    if (this.active) {
      this.schedule(NETWORK_SETTLE_MS);
    }
  }

  /** Fetches after `delay` ms, replacing whatever fetch was waiting. */
  private schedule(delay: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.run(), delay);
  }

  /** Fetches once, then waits for the next, unless `networkChanged` or `stop` has stepped in meanwhile. */
  private async run(): Promise<void> {
    this.timer = null;
    const succeeded = await this.refresh();
    if (this.active && this.timer === null) {
      this.schedule(succeeded ? REFRESH_MS : this.state.temperatureF === null ? FIRST_RETRY_MS : RETRY_MS);
    }
  }

  /**
   * Fetches the temperature once, finding the location first if it isn't known or has gone stale.
   * A failure keeps the last temperature shown: an old reading beats a blank.
   * @returns Whether it succeeded.
   */
  public async refresh(): Promise<boolean> {
    try {
      const coordinates = await this.locate();
      const url =
        `${FORECAST_URL}?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}` +
        '&current=temperature_2m&temperature_unit=fahrenheit';
      const response = await this.fetcher(url);
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      const current = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['current'] : null;
      const temperature = numberField(current, 'temperature_2m');
      if (temperature === null) {
        return false;
      }
      const rounded = Math.round(temperature);
      if (rounded !== this.state.temperatureF) {
        this.state = { temperatureF: rounded };
        this.onChange(this.state);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** The location, looked up again once it is `LOCATION_TTL_MS` old. Throws if it can't be found. */
  private async locate(): Promise<Coordinates> {
    if (this.location && this.now() - this.location.foundAt < LOCATION_TTL_MS) {
      return this.location.coordinates;
    }
    for (const url of LOCATION_URLS) {
      try {
        const response = await this.fetcher(url);
        const body: unknown = response.ok ? await response.json() : null;
        const latitude = numberField(body, 'latitude');
        const longitude = numberField(body, 'longitude');
        if (latitude !== null && longitude !== null) {
          this.location = { coordinates: { latitude, longitude }, foundAt: this.now() };
          return this.location.coordinates;
        }
      } catch {
        // Unreachable: try the next one.
      }
    }
    // Keep using a stale location rather than none: the computer rarely moves far.
    if (this.location) {
      return this.location.coordinates;
    }
    throw new Error('Location lookup failed');
  }
}
