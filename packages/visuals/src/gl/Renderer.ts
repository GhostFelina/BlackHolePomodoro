import { FRAGMENT_PREAMBLE, type EffectFrameContext, type FocusEffect } from '../effects/types.js';
import { BloomPipeline } from './postfx.js';

/**
 * The WebGL 2 renderer behind every effect.
 *
 * Performance decisions worth knowing about:
 *
 * - One full-screen triangle, no vertex buffer. The vertices are generated in
 *   the vertex shader from `gl_VertexID`, so a frame is a single draw call with
 *   zero attribute setup.
 * - The drawing buffer is capped on its long edge (`maxRenderEdge`). On a 5K
 *   panel that turns ~15 M shaded pixels into ~4 M with no visible difference,
 *   because the effect is all smooth gradients.
 * - Programs are compiled once per effect and cached, so switching effects at
 *   runtime costs nothing after the first use.
 * - `requestAnimationFrame` is left unthrottled by default, which is what lets
 *   the effect run at the panel's true refresh rate — 120 Hz ProMotion
 *   included. A cap is applied only if the user asks for one.
 * - The loop stops itself the moment the host says there is nothing to draw,
 *   so an idle focus period costs no GPU at all.
 */

const VERTEX_SOURCE = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Oversized triangle covering the viewport: (-1,-1), (3,-1), (-1,3).
  vec2 v = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = vec2(v.x * 0.5 + 0.5, 1.0 - (v.y * 0.5 + 0.5)); // top-left origin
  gl_Position = vec4(v, 0.0, 1.0);
}`;

const UNIFORM_NAMES = [
  'uResolution',
  'uCenter',
  'uRadius',
  'uTime',
  'uGrowth',
  'uIntensity',
  'uBlackout',
  'uHasScreen',
  'uAccent',
  'uReducedMotion',
  'uScreen',
  'uDiscBrightness',
  'uDiscSpeed',
  'uInclination',
  'uDoppler',
  'uStarDensity',
  'uNebula',
  'uSuction',
  'uStyle',
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];
type UniformMap = Partial<Record<UniformName, WebGLUniformLocation | null>>;

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: UniformMap;
}

export interface RendererOptions {
  /** Long-edge cap for the drawing buffer, in device pixels. */
  maxRenderEdge?: number;
  /** Called when the GL context is lost and the effect can no longer draw. */
  onContextLost?: () => void;
  /** Called once if WebGL 2 is unavailable at all. */
  onUnavailable?: (reason: string) => void;
  /** Bloom intensity. 0 disables the post chain entirely. */
  bloom?: number;
}

export interface RendererStats {
  fps: number;
  /** CPU time spent issuing draw commands. Near zero even when the GPU is busy. */
  frameMs: number;
  /** Time the GPU actually spent on the frame, where the extension exists. */
  gpuMs: number;
  /** Current adaptive resolution factor, 0.4–1. */
  scale: number;
  droppedFrames: number;
  renderWidth: number;
  renderHeight: number;
}

export class EffectRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;
  private readonly options: Required<Pick<RendererOptions, 'maxRenderEdge'>> & RendererOptions;

  private programs = new Map<string, CompiledProgram>();
  private current: CompiledProgram | null = null;
  private currentEffectId: string | null = null;

  private screenTexture: WebGLTexture | null = null;
  private screenSource: HTMLVideoElement | null = null;

  private rafHandle = 0;
  private running = false;
  private startedAt = 0;
  private lastFrameAt = 0;
  private frameInterval = 0; // 0 = uncapped

  private frameTimes: number[] = [];
  private droppedFrames = 0;

  private provider: (() => EffectFrameContext | null) | null = null;
  private bloom: BloomPipeline | null = null;

  // Real GPU timing. `frameMs` measured with performance.now() around the draw
  // call only counts the time spent *issuing* commands — the GPU runs
  // asynchronously, so that number stays near zero however heavy the shader
  // is. It was reporting 0.1 ms while the shader was in fact the bottleneck.
  // EXT_disjoint_timer_query_webgl2 measures what the GPU actually spends.
  private timerExt: any = null;
  private timerQuery: WebGLQuery | null = null;
  private timerPending = false;
  private gpuMs = 0;

  // Adaptive resolution. The ray march costs wildly different amounts
  // depending on how much of the screen the hole covers — a small hole exits
  // early for almost every pixel, a large one marches all of them. Rather than
  // pick one resolution that is either wasteful when small or unusable when
  // large, the buffer is scaled to hit a frame-time budget. Dropping to 60 %
  // scale is barely perceptible on a soft gradient; dropping frames is not.
  private renderScaleFactor = 1;
  private budgetMs = 26;
  private lastAdaptAt = 0;
  private scaleDirty = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.options = { maxRenderEdge: 2880, ...options };

    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,          // the shader is already smooth; MSAA is wasted fill rate
      depth: false,
      stencil: false,
      desynchronized: true,      // lower latency path where the browser supports it
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    if (!this.gl) {
      options.onUnavailable?.('WebGL 2 context could not be created');
      return;
    }

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.enable(this.gl.BLEND);
    // Source is premultiplied, so the classic (ONE, 1-SRC_ALPHA) pairing.
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.clearColor(0, 0, 0, 0);

    this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');

    this.bloom = new BloomPipeline(this.gl);
    this.bloom.strength = options.bloom ?? 1.0;

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
  }

  get isAvailable(): boolean {
    return this.gl !== null;
  }

  // ------------------------------------------------------------------ effects

  setEffect(effect: FocusEffect): boolean {
    if (!this.gl) return false;
    if (this.currentEffectId === effect.id && this.current) return true;

    // Keyed by shader source rather than by effect id. The black-hole styles
    // are variations of one shader driven by a uniform, so they must share a
    // single compiled program instead of each paying for its own.
    const key = effect.fragmentSource;
    const cached = this.programs.get(key);
    if (cached) {
      this.current = cached;
      this.currentEffectId = effect.id;
      this.styleId = effect.styleId ?? 0;
      return true;
    }

    const compiled = this.compile(effect);
    if (!compiled) return false;

    this.programs.set(key, compiled);
    this.current = compiled;
    this.currentEffectId = effect.id;
    this.styleId = effect.styleId ?? 0;
    return true;
  }

  private styleId = 0;

  private compile(effect: FocusEffect): CompiledProgram | null {
    const gl = this.gl!;
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = this.compileShader(
      gl.FRAGMENT_SHADER,
      `${FRAGMENT_PREAMBLE}\n${effect.fragmentSource}`,
    );
    if (!vertex || !fragment) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(`[BlackHolock] Link failed for "${effect.id}":`, gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    const uniforms: UniformMap = {};
    for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
      console.error('[BlackHolock] Shader compile failed:', log);
      console.error(numberLines(source));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // ------------------------------------------------------------ screen source

  /**
   * Binds a live desktop stream. Passing `null` releases it, which also frees
   * the texture — the app does this the moment the effect leaves the screen so
   * nothing keeps capturing in the background.
   */
  setScreenSource(video: HTMLVideoElement | null): void {
    const gl = this.gl;
    if (!gl) return;

    this.screenSource = video;
    if (!video) {
      if (this.screenTexture) {
        gl.deleteTexture(this.screenTexture);
        this.screenTexture = null;
      }
      return;
    }

    if (!this.screenTexture) {
      this.screenTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.screenTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
  }

  private uploadScreenFrame(): boolean {
    const gl = this.gl!;
    const video = this.screenSource;
    if (!video || !this.screenTexture) return false;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    if (video.videoWidth === 0 || video.videoHeight === 0) return false;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.screenTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    return true;
  }

  // ------------------------------------------------------------------- sizing

  /** Returns the drawing-buffer size actually used, in device pixels. */
  resize(cssWidth: number, cssHeight: number, dpr: number): [number, number] {
    const gl = this.gl;
    if (!gl) return [0, 0];

    const target = Math.max(cssWidth * dpr, cssHeight * dpr);
    const cap = this.options.maxRenderEdge;
    const scale = (target > cap ? cap / target : 1) * this.renderScaleFactor;

    const width = Math.max(1, Math.round(cssWidth * dpr * scale));
    const height = Math.max(1, Math.round(cssHeight * dpr * scale));

    if (this.canvas.width !== width || this.canvas.height !== height || this.scaleDirty) {
      this.scaleDirty = false;
      this.canvas.width = width;
      this.canvas.height = height;
      gl.viewport(0, 0, width, height);
      this.bloom?.resize(width, height);
    }
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    return [width, height];
  }

  /** Device pixels per CSS pixel actually in use, after the cap. */
  get renderScale(): number {
    const cssWidth = parseFloat(this.canvas.style.width) || this.canvas.clientWidth || 1;
    return this.canvas.width / cssWidth;
  }

  // --------------------------------------------------------------- frame loop

  /** `maxFps` of 0 follows the display, 120 Hz included. */
  setFpsCap(maxFps: number): void {
    this.frameInterval = maxFps > 0 ? 1000 / maxFps : 0;
  }

  start(provider: () => EffectFrameContext | null): void {
    if (!this.gl || this.running) return;
    this.provider = provider;
    this.running = true;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.frameTimes = [];
    this.droppedFrames = 0;
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.clear();
  }

  clear(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draws a single frame synchronously. Used by the preview harness and by
   * tests; the live overlay always goes through `start()`.
   */
  renderOnce(context: EffectFrameContext): void {
    if (!this.gl || !this.current) return;
    this.draw(context, performance.now());
    this.gl.finish();
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    if (this.frameInterval > 0 && now - this.lastFrameAt < this.frameInterval - 0.5) return;

    const delta = this.lastFrameAt === 0 ? 0 : now - this.lastFrameAt;
    this.lastFrameAt = now;

    const context = this.provider?.() ?? null;
    if (!context) {
      this.clear();
      return;
    }

    const drawStart = performance.now();
    this.draw(context, now);
    const drawMs = performance.now() - drawStart;

    // A frame that took longer than two display intervals is a dropped frame.
    if (delta > 0 && this.frameTimes.length > 8) {
      const median = this.medianFrameTime();
      if (delta > median * 1.9) this.droppedFrames += 1;
    }
    this.frameTimes.push(delta || 16.7);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.lastDrawMs = drawMs;
  };

  private lastDrawMs = 0;

  private draw(context: EffectFrameContext, now: number): void {
    const gl = this.gl!;
    const compiled = this.current;
    if (!compiled) return;

    // Collect the previous query before starting another; a GPU query is only
    // readable a frame or two after it was issued.
    if (this.timerExt && this.timerPending && this.timerQuery) {
      const available = gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        this.gpuMs = gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT) / 1e6;
        this.timerPending = false;
      } else if (disjoint) {
        this.timerPending = false;
      }
    }
    if (this.timerExt && !this.timerPending) {
      if (!this.timerQuery) this.timerQuery = gl.createQuery();
      if (this.timerQuery) {
        gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.timerQuery);
        this.timerPending = true;
      }
    }

    // With bloom on, the effect renders into an offscreen buffer first; the
    // chain then composites it, plus its glow, onto the screen.
    const offscreen = this.bloom?.beginScene() ?? false;
    if (!offscreen) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.useProgram(compiled.program);

    const hasScreen = context.hasScreenTexture && this.uploadScreenFrame();
    const u = compiled.uniforms;

    if (u.uResolution) gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    if (u.uCenter) gl.uniform2f(u.uCenter, context.center[0], context.center[1]);
    if (u.uRadius) gl.uniform1f(u.uRadius, context.radius);
    if (u.uTime) gl.uniform1f(u.uTime, (now - this.startedAt) / 1000);
    if (u.uGrowth) gl.uniform1f(u.uGrowth, context.growth);
    if (u.uIntensity) gl.uniform1f(u.uIntensity, context.intensity);
    if (u.uBlackout) gl.uniform1f(u.uBlackout, context.blackout);
    if (u.uHasScreen) gl.uniform1f(u.uHasScreen, hasScreen ? 1 : 0);
    if (u.uAccent) gl.uniform3fv(u.uAccent, context.accent);
    if (u.uReducedMotion) gl.uniform1f(u.uReducedMotion, context.reducedMotion ? 1 : 0);
    if (u.uScreen) gl.uniform1i(u.uScreen, 0);

    const p = context.params;
    if (u.uDiscBrightness) gl.uniform1f(u.uDiscBrightness, p.discBrightness);
    if (u.uDiscSpeed) gl.uniform1f(u.uDiscSpeed, p.discSpeed);
    if (u.uInclination) gl.uniform1f(u.uInclination, p.inclination);
    if (u.uDoppler) gl.uniform1f(u.uDoppler, p.doppler);
    if (u.uStarDensity) gl.uniform1f(u.uStarDensity, p.starDensity);
    if (u.uNebula) gl.uniform1f(u.uNebula, p.nebula);
    if (u.uSuction) gl.uniform1f(u.uSuction, p.suction);
    if (u.uStyle) gl.uniform1f(u.uStyle, this.styleId);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (offscreen) this.bloom!.finish();

    if (this.timerExt && this.timerPending) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    }

    this.adaptResolution(now);
  }

  /**
   * Nudges the render scale toward the frame-time budget.
   *
   * Deliberately slow to react — at most one step every 400 ms, and never more
   * than 12 % at a time — because a resolution that visibly pumps up and down
   * is more distracting than one that is simply a little soft.
   */
  private adaptResolution(now: number): void {
    if (!this.timerExt || this.gpuMs <= 0) return;
    if (now - this.lastAdaptAt < 400) return;
    this.lastAdaptAt = now;

    const previous = this.renderScaleFactor;
    if (this.gpuMs > this.budgetMs * 1.25) {
      // Never drop below 0.72: a soft-but-sharp-enough frame beats a mushy one.
      this.renderScaleFactor = Math.max(0.68, this.renderScaleFactor * 0.9);
    } else if (this.gpuMs < this.budgetMs * 0.55) {
      this.renderScaleFactor = Math.min(1, this.renderScaleFactor * 1.06);
    }
    // Ask the next resize() to rebuild at the new scale. Setting canvas.width
    // to 0 would also have worked but leaves one frame at zero width, which
    // shows up as a flash.
    if (previous !== this.renderScaleFactor) this.scaleDirty = true;
  }

  /** Frame-time target in milliseconds. Lower means softer but smoother. */
  setFrameBudget(ms: number): void {
    this.budgetMs = Math.max(4, ms);
  }

  /** Adjusts bloom at runtime; 0 turns the post chain off. */
  setBloom(strength: number): void {
    if (this.bloom) this.bloom.strength = Math.max(0, strength);
  }

  private medianFrameTime(): number {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 16.7;
  }

  getStats(): RendererStats {
    const median = this.medianFrameTime();
    return {
      fps: median > 0 ? Math.round(1000 / median) : 0,
      frameMs: Math.round(this.lastDrawMs * 100) / 100,
      gpuMs: Math.round(this.gpuMs * 100) / 100,
      scale: Math.round(this.renderScaleFactor * 100) / 100,
      droppedFrames: this.droppedFrames,
      renderWidth: this.canvas.width,
      renderHeight: this.canvas.height,
    };
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.running = false;
    this.programs.clear();
    this.current = null;
    this.currentEffectId = null;
    console.warn('[BlackHolock] WebGL context lost');
    this.options.onContextLost?.();
  };

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    const gl = this.gl;
    if (!gl) return;
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    this.programs.clear();
    if (this.screenTexture) gl.deleteTexture(this.screenTexture);
    this.screenTexture = null;
    this.bloom?.dispose();
    this.bloom = null;
  }
}

function numberLines(source: string): string {
  return source
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
}
