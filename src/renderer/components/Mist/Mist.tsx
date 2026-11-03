// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface MistProps {
  /**
   * Which area it fills: the tab row (`row`, wisps drifting along it), the workspace sidebar (`rail`, up and down
   * it) or the Tools sidebar (`tools`, up and down it too, on timings of its own).
   */
  readonly variant: 'row' | 'rail' | 'tools';
}

/** How many wisps each area has: enough to never look empty, few enough to stay faint. */
const WISP_COUNT = 3;

/**
 * Mist drifting slowly across an area's background — the tab row's or the
 * sidebar's — under everything in it, like fog moving past a window. A few
 * large, soft wisps of light grey, each on its own slow path and
 * timing, so the two areas never move in step (mist.css). Purely decoration:
 * hidden from assistive technology and from the pointer, and still under
 * reduced motion.
 */
export function Mist({ variant }: MistProps) {
  return (
    <div className={`mist mist--${variant}`} aria-hidden="true">
      {Array.from({ length: WISP_COUNT }, (_, index) => (
        <span key={index} className={`mist__wisp mist__wisp--${index + 1}`} />
      ))}
    </div>
  );
}
