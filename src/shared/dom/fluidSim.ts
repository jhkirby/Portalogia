// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

/**
 * The fluid that fills an empty tab (a note or PDF tab with nothing open, and the new-tab page): a small
 * stable-fluids simulation on the GPU (WebGL 2), carrying coloured dye. Moving the pointer over it stirs the fluid;
 * a left click blasts the smoke outward; holding the right button down draws it in toward the pointer, swirling like a
 * drain; the wheel turns it around the pointer (up clockwise, down anticlockwise). Only plain pointer moves add smoke:
 * the buttons and the wheel just move what's there. Left alone, it only drifts and fades: it never stirs itself.
 *
 * Plain DOM and WebGL with no imports, so the note and PDF pages (`FluidBackground`) and a web tab's preload (for
 * the new-tab page, `tabHomeFluid.ts`) can both run it.
 */

/** An RGB colour, each channel 0–1. */
export type FluidColor = readonly [number, number, number];

/**
 * The dye's colours for an accent: the accent alone, so the fluid is the app's own colour.
 * @param accent The accent, each channel 0–1.
 * @returns The palette for `FluidOptions.palette`.
 */
export function accentFluidPalette(accent: FluidColor): readonly FluidColor[] {
  return [accent];
}

/** How `startFluid` is set up. */
export interface FluidOptions {
  /** The dye's colours, one picked at random for each stir; asked each time, so it follows an accent change. */
  readonly palette: () => readonly FluidColor[];
  /** What takes the pointer (moves and clicks); the canvas's own host when left out. */
  readonly events?: EventTarget;
}

/** Simulation grid (velocity, pressure) along the short side: low, as the fluid's motion is smooth anyway. */
const SIM_RESOLUTION = 128;
/** Dye grid along the short side: higher, as the dye is what's seen. */
const DYE_RESOLUTION = 512;
/** How fast the dye fades (it halves in about 3.5s), and the motion dies down (per second, roughly). */
const DYE_DISSIPATION = 0.2;
const VELOCITY_DISSIPATION = 0.25;
/** How much last frame's pressure carries into this one's solve, and the solve's iterations. */
const PRESSURE_CARRY = 0.8;
const PRESSURE_ITERATIONS = 20;
/** Swirl kept in the flow (vorticity confinement): higher curls the dye into more eddies. */
const CURL = 22;
/** A stir's size, as a fraction of the area; and how hard the pointer's own motion pushes the fluid. */
const SPLAT_RADIUS = 0.0025;
const SPLAT_FORCE = 5000;
/** How much dye a plain pointer move puts in. */
const MOVE_DYE = 0.12;
/**
 * A left click's blast: how far the smoke is driven out from the pointer (a fraction of the area per second, at its
 * start), how long it lasts (ms, easing off), and from how far off it reaches; and the rings of push it sends through
 * the fluid itself (how many, how far apart in ms, how hard).
 */
const BLAST_PUSH = 2.4;
const BLAST_MS = 450;
const BLAST_RADIUS = 0.03;
const RIPPLE_RINGS = 3;
const RIPPLE_GAP_MS = 110;
const RIPPLE_FORCE = 2200;
/**
 * Holding the right button: how far the smoke is drawn in toward the pointer (a fraction of the area per second), how
 * hard the fluid is spun around it (per second), and from how far off both reach.
 */
const SUCTION_PULL = 1.6;
const SUCTION_SWIRL = 420;
const SUCTION_RADIUS = 0.03;
/** The wheel: how hard one notch (100 of `deltaY`) turns the fluid around the pointer, and from how far off. */
const WHEEL_SWIRL = 220;
const WHEEL_RADIUS = 0.05;

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 texelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/** Every fragment shader's opening: the varyings from `VERTEX_SHADER` and the output. */
const FRAGMENT_HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
`;

/**
 * Adds `color` around `point`: a soft spot, or (with `ring` above 0) a soft ring that far out. With `cap` above 0 the
 * result is held to it, so dye never piles up past what shows (and a blast can thin it visibly).
 */
const SPLAT_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
uniform float ring;
uniform float cap;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float d = length(p) - ring;
  vec3 value = texture(uTarget, vUv).xyz + exp(-d * d / radius) * color;
  // Scaled down as a whole, not channel by channel, so the colour keeps its hue at full strength.
  float peak = max(value.r, max(value.g, value.b));
  fragColor = vec4(cap > 0.0 && peak > cap ? value * (cap / peak) : value, 1.0);
}`;

/**
 * Pushes the velocity outward from `point`, strongest on a ring `ring` out: a click's ripple. With `turn` at 1 it
 * pushes around `point` instead (anticlockwise), which the solver keeps where it cancels a push straight in or out.
 */
const RADIAL_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec2 point;
uniform float radius;
uniform float ring;
uniform float strength;
uniform float turn;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float len = length(p);
  vec2 dir = len > 0.0001 ? p / len : vec2(0.0);
  dir = mix(dir, vec2(-dir.y, dir.x), turn);
  dir.x /= aspectRatio;
  float d = len - ring;
  vec2 push = dir * strength * exp(-d * d / radius);
  fragColor = vec4(texture(uTarget, vUv).xy + push, 0.0, 1.0);
}`;

/**
 * Moves the dye `amount` of the way in toward `point` (less further off; out from it, for a negative `amount`): the
 * right button's suction and a left click's blast.
 */
const PULL_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uSource;
uniform float aspectRatio;
uniform vec2 point;
uniform float radius;
uniform float amount;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float len = length(p);
  vec2 dir = len > 0.0001 ? p / len : vec2(0.0);
  float shift = amount * exp(-len * len / radius);
  // Never past the point itself, either way.
  shift = clamp(shift, -len, len);
  vec2 offset = dir * shift;
  offset.x /= aspectRatio;
  // Smoke drawn in piles up (denser), smoke driven out thins (so the middle empties): the map's change of area.
  float slope = 1.0 - 2.0 * len * shift / radius;
  float density = len > 0.0001 ? ((len + shift) / len) * slope : 0.0;
  vec4 value = texture(uSource, vUv + offset) * clamp(density, 0.0, 3.0);
  // Piled up no further than full strength (as the splat shader caps it), keeping its hue.
  float peak = max(value.r, max(value.g, value.b));
  fragColor = peak > 1.0 ? value / peak : value;
}`;

const ADVECTION_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 velocityTexelSize;
uniform float dt;
uniform float dissipation;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velocityTexelSize;
  fragColor = texture(uSource, coord) / (1.0 + dissipation * dt);
}`;

const DIVERGENCE_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  fragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy + force * dt;
  fragColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}`;

const PRESSURE_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  fragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const SCALE_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uTexture;
uniform float value;
void main() {
  fragColor = value * texture(uTexture, vUv);
}`;

const GRADIENT_SUBTRACT_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}`;

/** The dye, drawn over the page: as opaque as it is bright, premultiplied. */
const DISPLAY_SHADER = `${FRAGMENT_HEAD}
uniform sampler2D uTexture;
void main() {
  vec3 c = min(texture(uTexture, vUv).rgb, vec3(1.0));
  float a = max(c.r, max(c.g, c.b));
  fragColor = vec4(c, a);
}`;

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Record<string, WebGLUniformLocation>;
}

interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

interface DoubleTarget {
  read: Target;
  write: Target;
}

/**
 * Fills `host` with the fluid (a canvas covering it, which takes no pointer events itself) until the returned
 * function is called. Does nothing where WebGL 2 or float render targets aren't available.
 * @param host The element to fill; it should be positioned, as the canvas is placed absolutely over it.
 * @param options The dye's colours, and what to take the pointer from.
 * @returns Stops it and takes the canvas away.
 */
export function startFluid(host: HTMLElement, options: FluidOptions): () => void {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
  });
  host.prepend(canvas);

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    canvas.remove();
    return () => {};
  }

  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('fluid: no shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`fluid: ${gl.getShaderInfoLog(shader) ?? 'shader failed'}`);
    }
    return shader;
  };
  const vertexShader = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const makeProgram = (fragmentSource: string): Program => {
    const program = gl.createProgram();
    if (!program) {
      throw new Error('fluid: no program');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`fluid: ${gl.getProgramInfoLog(program) ?? 'link failed'}`);
    }
    const uniforms: Record<string, WebGLUniformLocation> = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i += 1) {
      const name = gl.getActiveUniform(program, i)?.name;
      const location = name ? gl.getUniformLocation(program, name) : null;
      if (name && location) {
        uniforms[name] = location;
      }
    }
    return { program, uniforms };
  };

  let programs: Record<
    | 'splat'
    | 'radial'
    | 'pull'
    | 'advection'
    | 'divergence'
    | 'curl'
    | 'vorticity'
    | 'pressure'
    | 'scale'
    | 'gradientSubtract'
    | 'display',
    Program
  >;
  try {
    programs = {
      splat: makeProgram(SPLAT_SHADER),
      radial: makeProgram(RADIAL_SHADER),
      pull: makeProgram(PULL_SHADER),
      advection: makeProgram(ADVECTION_SHADER),
      divergence: makeProgram(DIVERGENCE_SHADER),
      curl: makeProgram(CURL_SHADER),
      vorticity: makeProgram(VORTICITY_SHADER),
      pressure: makeProgram(PRESSURE_SHADER),
      scale: makeProgram(SCALE_SHADER),
      gradientSubtract: makeProgram(GRADIENT_SUBTRACT_SHADER),
      display: makeProgram(DISPLAY_SHADER),
    };
  } catch {
    canvas.remove();
    return () => {};
  }

  // One quad over the whole target, drawn by every pass.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  const createTarget = (
    width: number,
    height: number,
    internalFormat: number,
    format: number,
    filter: number,
  ): Target => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error('fluid: no target');
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height };
  };
  const deleteTarget = (target: Target): void => {
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  };
  const createDouble = (width: number, height: number, internalFormat: number, format: number, filter: number) => ({
    read: createTarget(width, height, internalFormat, format, filter),
    write: createTarget(width, height, internalFormat, format, filter),
  });
  const swap = (target: DoubleTarget): void => {
    const read = target.read;
    target.read = target.write;
    target.write = read;
  };

  /** A grid `resolution` cells along the canvas's short side, keeping its shape. */
  const gridSize = (resolution: number): { width: number; height: number } => {
    const shape = canvas.width / Math.max(1, canvas.height);
    const long = Math.round(resolution * (shape < 1 ? 1 / shape : shape));
    return shape >= 1 ? { width: long, height: resolution } : { width: resolution, height: long };
  };

  let velocity: DoubleTarget;
  let dye: DoubleTarget;
  let pressure: DoubleTarget;
  let divergence: Target;
  let curl: Target;
  const allocate = (): void => {
    const sim = gridSize(SIM_RESOLUTION);
    const dyeSize = gridSize(DYE_RESOLUTION);
    velocity = createDouble(sim.width, sim.height, gl.RG16F, gl.RG, gl.LINEAR);
    dye = createDouble(dyeSize.width, dyeSize.height, gl.RGBA16F, gl.RGBA, gl.LINEAR);
    pressure = createDouble(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
    divergence = createTarget(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
    curl = createTarget(sim.width, sim.height, gl.R16F, gl.RED, gl.NEAREST);
  };
  const release = (): void => {
    [velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write, divergence, curl].forEach(
      deleteTarget,
    );
  };

  const fitCanvas = (): boolean => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(host.clientWidth * ratio));
    const height = Math.max(1, Math.round(host.clientHeight * ratio));
    if (canvas.width === width && canvas.height === height) {
      return false;
    }
    canvas.width = width;
    canvas.height = height;
    return true;
  };
  fitCanvas();
  allocate();

  const use = (program: Program): Record<string, WebGLUniformLocation> => {
    gl.useProgram(program.program);
    return program.uniforms;
  };
  const bind = (unit: number, target: Target): number => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    return unit;
  };
  const draw = (target: Target | null): void => {
    if (target) {
      // Into the simulation's own buffers it replaces what's there; only the screen blends (`render`).
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
  const aspect = (): number => canvas.width / Math.max(1, canvas.height);
  /** A stir's radius, widened on a wide canvas so it stays round. */
  const radiusFor = (base: number): number => (aspect() > 1 ? base * aspect() : base);

  const splatInto = (
    target: DoubleTarget,
    x: number,
    y: number,
    value: FluidColor,
    radius: number,
    ring: number,
    cap = 0,
  ): void => {
    const u = use(programs.splat);
    gl.uniform2f(u['texelSize']!, 1 / target.read.width, 1 / target.read.height);
    gl.uniform1i(u['uTarget']!, bind(0, target.read));
    gl.uniform1f(u['aspectRatio']!, aspect());
    gl.uniform2f(u['point']!, x, y);
    gl.uniform3f(u['color']!, value[0], value[1], value[2]);
    gl.uniform1f(u['radius']!, radius);
    gl.uniform1f(u['ring']!, ring);
    gl.uniform1f(u['cap']!, cap);
    draw(target.write);
    swap(target);
  };

  const pickColor = (amount: number): FluidColor => {
    const palette = options.palette();
    const color = palette[Math.floor(Math.random() * palette.length)] ?? [0.1, 0.45, 0.9];
    return [color[0] * amount, color[1] * amount, color[2] * amount];
  };

  /** A stir: the fluid pushed by (dx, dy) at (x, y), with dye unless `color` is `null`. 0–1 from the bottom left. */
  const splat = (x: number, y: number, dx: number, dy: number, color: FluidColor | null): void => {
    splatInto(velocity, x, y, [dx, dy, 0], radiusFor(SPLAT_RADIUS), 0);
    if (color) {
      splatInto(dye, x, y, color, radiusFor(SPLAT_RADIUS), 0, 1);
    }
  };

  /** Pushes the fluid straight out from (x, y), strongest `ring` out; or around it (anticlockwise), with `around`. */
  const pushRadially = (x: number, y: number, ring: number, radius: number, strength: number, around = false): void => {
    const u = use(programs.radial);
    gl.uniform2f(u['texelSize']!, 1 / velocity.read.width, 1 / velocity.read.height);
    gl.uniform1i(u['uTarget']!, bind(0, velocity.read));
    gl.uniform1f(u['aspectRatio']!, aspect());
    gl.uniform2f(u['point']!, x, y);
    gl.uniform1f(u['radius']!, radius);
    gl.uniform1f(u['ring']!, ring);
    gl.uniform1f(u['strength']!, strength);
    gl.uniform1f(u['turn']!, around ? 1 : 0);
    draw(velocity.write);
    swap(velocity);
  };

  /** Moves the smoke `amount` of the way in toward (x, y) (out from it, for a negative `amount`). */
  const pullDye = (x: number, y: number, radius: number, amount: number): void => {
    const u = use(programs.pull);
    gl.uniform2f(u['texelSize']!, 1 / dye.read.width, 1 / dye.read.height);
    gl.uniform1i(u['uSource']!, bind(0, dye.read));
    gl.uniform1f(u['aspectRatio']!, aspect());
    gl.uniform2f(u['point']!, x, y);
    gl.uniform1f(u['radius']!, radius);
    gl.uniform1f(u['amount']!, amount);
    draw(dye.write);
    swap(dye);
  };

  /** The right button's suction, for one frame: the fluid spun into a whirlpool around (x, y), its smoke drawn in. */
  const suck = (x: number, y: number, dt: number): void => {
    pushRadially(x, y, 0, SUCTION_RADIUS, SUCTION_SWIRL * dt, true);
    pullDye(x, y, SUCTION_RADIUS, SUCTION_PULL * dt);
  };

  const step = (dt: number): void => {
    gl.disable(gl.BLEND);
    const simTexel = (): [number, number] => [1 / velocity.read.width, 1 / velocity.read.height];

    let u = use(programs.curl);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uVelocity']!, bind(0, velocity.read));
    draw(curl);

    u = use(programs.vorticity);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uVelocity']!, bind(0, velocity.read));
    gl.uniform1i(u['uCurl']!, bind(1, curl));
    gl.uniform1f(u['curl']!, CURL);
    gl.uniform1f(u['dt']!, dt);
    draw(velocity.write);
    swap(velocity);

    u = use(programs.divergence);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uVelocity']!, bind(0, velocity.read));
    draw(divergence);

    u = use(programs.scale);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uTexture']!, bind(0, pressure.read));
    gl.uniform1f(u['value']!, PRESSURE_CARRY);
    draw(pressure.write);
    swap(pressure);

    u = use(programs.pressure);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uDivergence']!, bind(0, divergence));
    for (let i = 0; i < PRESSURE_ITERATIONS; i += 1) {
      gl.uniform1i(u['uPressure']!, bind(1, pressure.read));
      draw(pressure.write);
      swap(pressure);
    }

    u = use(programs.gradientSubtract);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform1i(u['uPressure']!, bind(0, pressure.read));
    gl.uniform1i(u['uVelocity']!, bind(1, velocity.read));
    draw(velocity.write);
    swap(velocity);

    u = use(programs.advection);
    gl.uniform2f(u['texelSize']!, ...simTexel());
    gl.uniform2f(u['velocityTexelSize']!, ...simTexel());
    gl.uniform1i(u['uVelocity']!, bind(0, velocity.read));
    gl.uniform1i(u['uSource']!, bind(0, velocity.read));
    gl.uniform1f(u['dt']!, dt);
    gl.uniform1f(u['dissipation']!, VELOCITY_DISSIPATION);
    draw(velocity.write);
    swap(velocity);

    gl.uniform2f(u['texelSize']!, 1 / dye.read.width, 1 / dye.read.height);
    gl.uniform1i(u['uVelocity']!, bind(0, velocity.read));
    gl.uniform1i(u['uSource']!, bind(1, dye.read));
    gl.uniform1f(u['dissipation']!, DYE_DISSIPATION);
    draw(dye.write);
    swap(dye);
  };

  const render = (): void => {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const u = use(programs.display);
    gl.uniform2f(u['texelSize']!, 1 / dye.read.width, 1 / dye.read.height);
    gl.uniform1i(u['uTexture']!, bind(0, dye.read));
    draw(null);
  };

  let disposed = false;

  // ── The pointer ──
  // `plain`: no button held through the moves since the last frame, so they add smoke.
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, plain: true, inside: false };
  const toUv = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      y: 1 - (event.clientY - rect.top) / Math.max(1, rect.height),
    };
  };
  const onMove = (event: Event): void => {
    const { x, y } = toUv(event as PointerEvent);
    if (pointer.inside) {
      pointer.dx += (x - pointer.x) * SPLAT_FORCE * Math.max(1, aspect());
      pointer.dy += (y - pointer.y) * SPLAT_FORCE * Math.max(1, 1 / aspect());
      if (!pointer.moved) {
        pointer.plain = true;
      }
      pointer.plain &&= (event as PointerEvent).buttons === 0;
      pointer.moved = true;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    // The right button let go somewhere this never heard of it (off the page).
    if (sucking && ((event as PointerEvent).buttons & 2) === 0) {
      sucking = false;
    }
  };
  const onLeave = (): void => {
    pointer.inside = false;
    sucking = false;
  };
  /** Whether the right button is held over the fluid, pulling it in toward the pointer. */
  let sucking = false;
  const onUp = (event: Event): void => {
    if ((event as PointerEvent).button === 2) {
      sucking = false;
    }
  };
  // The right button pulls the fluid instead of opening a menu.
  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  const rippleTimers = new Set<number>();
  /** Left clicks' blasts still driving the smoke out: where, and when each began. */
  const blasts: { x: number; y: number; start: number }[] = [];
  const onDown = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    const { x, y } = toUv(pointerEvent);
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return;
    }
    if (pointerEvent.button === 2) {
      pointer.x = x;
      pointer.y = y;
      sucking = true;
      return;
    }
    if (pointerEvent.button !== 0) {
      return;
    }
    // The smoke there is driven out, and rings of push go through the fluid; no new smoke.
    blasts.push({ x, y, start: performance.now() });
    for (let i = 0; i < RIPPLE_RINGS; i += 1) {
      const timer = window.setTimeout(() => {
        rippleTimers.delete(timer);
        if (!disposed) {
          pushRadially(x, y, 0.015 + i * 0.03, SPLAT_RADIUS * 0.6, RIPPLE_FORCE * (1 - i * 0.25));
        }
      }, i * RIPPLE_GAP_MS);
      rippleTimers.add(timer);
    }
  };
  // The wheel turns the fluid around the pointer: up clockwise, down anticlockwise. Ctrl+wheel is the page's zoom.
  const onWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    if (wheel.ctrlKey) {
      return;
    }
    const { x, y } = toUv(wheel);
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return;
    }
    // A line or page of scrolling counts as one notch (100).
    const notches = wheel.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? wheel.deltaY / 100 : Math.sign(wheel.deltaY);
    // Positive turns anticlockwise (`pushRadially`), so a scroll down (positive `deltaY`) does.
    pushRadially(x, y, 0, WHEEL_RADIUS, Math.max(-3, Math.min(3, notches)) * WHEEL_SWIRL, true);
  };
  const events = options.events ?? host;
  events.addEventListener('pointermove', onMove, { passive: true });
  events.addEventListener('pointerdown', onDown, { passive: true });
  events.addEventListener('pointerleave', onLeave, { passive: true });
  events.addEventListener('pointerup', onUp, { passive: true });
  events.addEventListener('contextmenu', onContextMenu);
  events.addEventListener('wheel', onWheel, { passive: true });

  // ── The loop ──
  let frame = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (fitCanvas()) {
      release();
      allocate();
    }
    if (pointer.moved) {
      pointer.moved = false;
      splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.plain ? pickColor(MOVE_DYE) : null);
      pointer.dx = 0;
      pointer.dy = 0;
    }
    if (sucking) {
      suck(pointer.x, pointer.y, dt);
    }
    for (let i = blasts.length - 1; i >= 0; i -= 1) {
      const blast = blasts[i]!;
      const progress = (now - blast.start) / BLAST_MS;
      if (progress >= 1) {
        blasts.splice(i, 1);
      } else {
        pullDye(blast.x, blast.y, BLAST_RADIUS, -BLAST_PUSH * (1 - progress) * dt);
      }
    }
    step(dt);
    render();
  };
  frame = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    rippleTimers.forEach((timer) => window.clearTimeout(timer));
    events.removeEventListener('pointermove', onMove);
    events.removeEventListener('pointerdown', onDown);
    events.removeEventListener('pointerleave', onLeave);
    events.removeEventListener('pointerup', onUp);
    events.removeEventListener('contextmenu', onContextMenu);
    events.removeEventListener('wheel', onWheel);
    release();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  };
}
