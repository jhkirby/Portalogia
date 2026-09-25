// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `h` in degrees (0–360), `s`/`v` as fractions (0–1). */
export interface HSV {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/** Rounds and clamps a single channel to a valid 0–255 byte. */
export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (channel: number) => clampChannel(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Parses a hex color, 3 or 6 digits, with or without a leading "#".
 * @returns The parsed color, or `null` for anything that isn't a complete, valid hex triplet — callers leave an in-progress typed value alone rather than force-correct it (see `ColorPicker`'s `hexDraft`).
 */
export function hexToRgb(hex: string): RGB | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    return {
      r: parseInt(cleaned.charAt(0) + cleaned.charAt(0), 16),
      g: parseInt(cleaned.charAt(1) + cleaned.charAt(1), 16),
      b: parseInt(cleaned.charAt(2) + cleaned.charAt(2), 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    return {
      r: parseInt(cleaned.slice(0, 2), 16),
      g: parseInt(cleaned.slice(2, 4), 16),
      b: parseInt(cleaned.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }
  if (h < 0) {
    h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    [rp, gp, bp] = [c, x, 0];
  } else if (h < 120) {
    [rp, gp, bp] = [x, c, 0];
  } else if (h < 180) {
    [rp, gp, bp] = [0, c, x];
  } else if (h < 240) {
    [rp, gp, bp] = [0, x, c];
  } else if (h < 300) {
    [rp, gp, bp] = [x, 0, c];
  } else {
    [rp, gp, bp] = [c, 0, x];
  }

  return {
    r: clampChannel((rp + m) * 255),
    g: clampChannel((gp + m) * 255),
    b: clampChannel((bp + m) * 255),
  };
}

/** The pure, fully-saturated color for a given hue (`s`/`v` both 1) — `ColorPicker`'s square gradient is painted against this, as the color its bottom-right corner would be. */
export function hueToRgb(h: number): RGB {
  return hsvToRgb({ h, s: 1, v: 1 });
}

export function rgbEquals(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
