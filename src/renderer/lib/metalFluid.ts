// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

/** The canvas is drawn at its CSS size (one buffer pixel per CSS pixel), so the fine ripples stay sharp, not blocky. */
const RENDER_SCALE = 1;

/** Past this many buffer pixels (a very large window) it's drawn smaller and stretched, to keep the GPU's load bounded. */
const MAX_PIXELS = 1_200_000;

/** Frames drawn per second at most: it moves slowly, so this is plenty and keeps the GPU mostly idle. */
const MAX_FPS = 20;


const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * A metal surface poured slowly over the background: a height field from
 * fractal noise warped by itself twice (so it folds and spreads like a fluid),
 * drifting with time, and lit like polished metal — a soft diffuse light, a
 * tight highlight, and a little sky reflected in whatever faces up.
 */
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic easing between the lattice points: smooth in its slope too, so the lit surface shows no grid.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = turn * p;
    amplitude *= 0.5;
  }
  return value;
}

float field(vec2 p) {
  float t = u_time;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.030)), fbm(p + vec2(5.2, 1.3) - t * 0.024));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.018), fbm(p + 3.5 * q + vec2(8.3, 2.8) - t * 0.015));
  return fbm(p + 3.5 * r);
}

void main() {
  float scale = 2.6 / u_resolution.y;
  vec2 p = gl_FragCoord.xy * scale;
  float e = 1.5 * scale;
  float h = field(p);
  float slopeX = (field(p + vec2(e, 0.0)) - h) / e;
  float slopeY = (field(p + vec2(0.0, e)) - h) / e;
  vec3 normal = normalize(vec3(-slopeX * 0.035, -slopeY * 0.035, 1.0));

  vec3 light = normalize(vec3(-0.45, 0.6, 0.75));
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(normal, light), 0.0);
  float highlight = pow(max(dot(normal, halfway), 0.0), 28.0);
  float sky = 0.5 + 0.5 * normal.y;

  vec3 darkMetal = mix(vec3(0.085, 0.090, 0.100), vec3(0.215, 0.225, 0.245), h);
  vec3 lightMetal = mix(vec3(0.780, 0.790, 0.810), vec3(0.955, 0.960, 0.970), h);
  vec3 base = mix(lightMetal, darkMetal, u_dark);
  vec3 color = base * (0.72 + 0.38 * diffuse);
  color += highlight * mix(0.30, 0.22, u_dark);
  color += (sky - 0.5) * mix(0.10, 0.07, u_dark);
  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Compiles one shader stage.
 * @param gl The context.
 * @param type `gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`.
 * @param source Its GLSL.
 * @returns The shader, or `null` if it wouldn't compile.
 */
function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Draws a slowly flowing metallic fluid into a canvas, in light or dark metal
 * as it's told (`setDark`; `MetalBackground` covers it while it changes, so
 * it switches at once). Nothing interacts with it: it only flows on its own. Draws
 * nothing (the canvas stays clear) where WebGL isn't available.
 *
 * Call `stop` when the canvas goes away.
 */
export class MetalFluid {
  private readonly gl: WebGLRenderingContext | null;
  private readonly program: WebGLProgram | null = null;
  private readonly uniforms: { resolution: WebGLUniformLocation | null; time: WebGLUniformLocation | null; dark: WebGLUniformLocation | null } = {
    resolution: null,
    time: null,
    dark: null,
  };
  private frame = 0;
  private lastDrawn = 0;
  private dark: number;
  /** Holding still: no frames are drawn (the last one stays), until released. */
  private held = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * @param canvas The canvas to draw into; it is sized to its own CSS box.
   * @param dark Whether to start in dark metal.
   */
  public constructor(
    private readonly canvas: HTMLCanvasElement,
    dark: boolean,
  ) {
    this.dark = dark ? 1 : 0;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    const gl = this.gl;
    if (gl) {
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = gl.createProgram();
      if (vertex && fragment && program) {
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
          this.program = program;
          gl.useProgram(program);
          // One triangle pair covering the whole canvas.
          const buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          const position = gl.getAttribLocation(program, 'a_position');
          gl.enableVertexAttribArray(position);
          gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
          this.uniforms.resolution = gl.getUniformLocation(program, 'u_resolution');
          this.uniforms.time = gl.getUniformLocation(program, 'u_time');
          this.uniforms.dark = gl.getUniformLocation(program, 'u_dark');
        }
      }
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  /**
   * Switches between light and dark metal at once, drawing the new one straight away.
   * @param dark Whether the metal is dark.
   */
  public setDark(dark: boolean): void {
    this.dark = dark ? 1 : 0;
    this.draw();
  }

  /**
   * Holds the surface still (it keeps its last frame), or lets it flow on again.
   * @param held Whether to hold it.
   */
  public hold(held: boolean): void {
    this.held = held;
    if (!held) {
      this.schedule();
    }
  }

  /** Stops drawing and lets go of the canvas. */
  public stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Matches the drawing buffer to the canvas's CSS size (at `RENDER_SCALE`), and redraws at once. */
  private resize(): void {
    const area = this.canvas.clientWidth * this.canvas.clientHeight * RENDER_SCALE * RENDER_SCALE;
    const scale = RENDER_SCALE * Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, area)));
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.draw();
    }
  }

  private readonly onVisibility = (): void => {
    if (!document.hidden) {
      this.schedule();
    }
  };

  /** Asks for the next frame, unless the window is hidden (it starts again when shown). */
  private schedule(): void {
    if (this.frame === 0 && !document.hidden && !this.held && this.program) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (this.held) {
      return;
    }
    if (now - this.lastDrawn >= 1000 / MAX_FPS) {
      this.lastDrawn = now;
      this.draw();
    }
    // With reduced motion asked for, the surface holds still once drawn.
    if (!this.reducedMotion.matches) {
      this.schedule();
    }
  };

  /** Draws one frame, at the wall clock's time. */
  private draw(): void {
    const gl = this.gl;
    if (!gl || !this.program) {
      return;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    // Wall-clock based, so it carries on from where it would be rather than from where the page last drew it.
    gl.uniform1f(this.uniforms.time, (this.reducedMotion.matches ? 0 : Date.now() % 10_000_000) / 1000);
    gl.uniform1f(this.uniforms.dark, this.dark);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
