/**
 * Bloom post-processing.
 *
 * Emissive renders live or die on bloom. Without it a bright accretion disc is
 * just a pale shape; with it, light appears to spill past its own edges the way
 * it does through a real lens, and the disc reads as something genuinely
 * luminous rather than something merely light-coloured.
 *
 * The chain is the standard one, kept deliberately small:
 *
 *   scene ─▶ bright pass (½ res) ─▶ blur H ─▶ blur V ─┐
 *         ─▶ blur again at ¼ res ────────────────────┤
 *   scene ────────────────────────────────────────── ▼ composite
 *
 * Two blur scales rather than one: the tight pass gives the disc its crisp
 * halo, the wide pass gives the whole frame the soft ambient glow that sells
 * the scale of the object.
 *
 * ## Premultiplied alpha
 *
 * The overlay must stay perfectly transparent where nothing is drawn, so every
 * buffer here holds premultiplied colour. Bloom therefore spreads alpha as well
 * as colour, which is correct: a glow should make the pixels around a bright
 * edge partly opaque, otherwise the halo would be invisible over the desktop.
 */

const QUAD_VERTEX = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 v = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = v * 0.5 + 0.5;
  gl_Position = vec4(v, 0.0, 1.0);
}`;

/**
 * Bright pass with a soft knee. A hard threshold makes bloom pop on and off as
 * brightness crosses the line, which flickers badly on a rotating disc; the
 * knee ramps it in over a range instead.
 */
const BRIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 src = texture(uSource, vUv);
  float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));

  float soft = clamp(luma - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contribution = max(soft, luma - uThreshold) / max(luma, 1e-5);

  fragColor = src * clamp(contribution, 0.0, 1.0);
}`;

/**
 * Separable Gaussian, nine taps, sampled at half-texel offsets so hardware
 * bilinear filtering does half the work for free.
 */
const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uDirection;   // texel-sized step, horizontal or vertical
in vec2 vUv;
out vec4 fragColor;

void main() {
  // Weights for a sigma≈2.4 kernel, folded into 5 bilinear taps.
  const float o1 = 1.3846153846;
  const float o2 = 3.2307692308;
  const float w0 = 0.2270270270;
  const float w1 = 0.3162162162;
  const float w2 = 0.0702702703;

  vec4 sum = texture(uSource, vUv) * w0;
  sum += texture(uSource, vUv + uDirection * o1) * w1;
  sum += texture(uSource, vUv - uDirection * o1) * w1;
  sum += texture(uSource, vUv + uDirection * o2) * w2;
  sum += texture(uSource, vUv - uDirection * o2) * w2;
  fragColor = sum;
}`;

/**
 * Final composite. Also where dithering happens: an 8-bit framebuffer cannot
 * represent the smooth falloff of a nebula, and the result is visible banding
 * in exactly the dark areas the eye is most sensitive to. A sub-LSB ordered
 * dither breaks the bands up into noise the eye reads as continuous.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomTight;
uniform sampler2D uBloomWide;
uniform float uBloomStrength;
in vec2 vUv;
out vec4 fragColor;

// Interleaved gradient noise — one cheap hash, no texture lookup.
float dither(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 scene = texture(uScene, vUv);
  vec4 bloom = texture(uBloomTight, vUv) * 0.62 + texture(uBloomWide, vUv) * 0.38;

  vec4 result = scene + bloom * uBloomStrength;

  // Alpha can exceed 1 once bloom is added; colour is premultiplied, so it has
  // to be clamped against the same ceiling to avoid tinting the halo.
  result.a = min(result.a, 1.0);
  result.rgb = min(result.rgb, vec3(result.a));

  result.rgb += (dither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = result;
}`;

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export class BloomPipeline {
  private readonly gl: WebGL2RenderingContext;
  private brightProgram: WebGLProgram | null = null;
  private blurProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;

  private scene: Target | null = null;
  private half: [Target, Target] | null = null;
  private quarter: [Target, Target] | null = null;

  private width = 0;
  private height = 0;
  private ready = false;

  /** 0 disables the whole chain and the effect draws straight to the screen. */
  strength = 1.0;
  threshold = 0.72;
  knee = 0.28;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    try {
      this.brightProgram = this.link(QUAD_VERTEX, BRIGHT_FRAGMENT);
      this.blurProgram = this.link(QUAD_VERTEX, BLUR_FRAGMENT);
      this.compositeProgram = this.link(QUAD_VERTEX, COMPOSITE_FRAGMENT);
      this.ready = !!(this.brightProgram && this.blurProgram && this.compositeProgram);
    } catch (error) {
      console.warn('[BlackHolock] Bloom unavailable, drawing without it:', error);
      this.ready = false;
    }
  }

  get isAvailable(): boolean {
    return this.ready && this.strength > 0;
  }

  /** Allocates or reallocates every buffer for a new drawable size. */
  resize(width: number, height: number): void {
    if (!this.ready) return;
    if (width === this.width && height === this.height) return;

    this.dispose(false);
    this.width = width;
    this.height = height;

    const halfW = Math.max(1, width >> 1);
    const halfH = Math.max(1, height >> 1);
    const quarterW = Math.max(1, width >> 2);
    const quarterH = Math.max(1, height >> 2);

    this.scene = this.createTarget(width, height);
    this.half = [this.createTarget(halfW, halfH), this.createTarget(halfW, halfH)];
    this.quarter = [
      this.createTarget(quarterW, quarterH),
      this.createTarget(quarterW, quarterH),
    ];
  }

  /** Binds the scene buffer so the effect renders into it instead of the screen. */
  beginScene(): boolean {
    const gl = this.gl;
    if (!this.isAvailable || !this.scene) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer);
    gl.viewport(0, 0, this.scene.width, this.scene.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  /** Runs the chain and composites onto the default framebuffer. */
  finish(): void {
    const gl = this.gl;
    if (!this.isAvailable || !this.scene || !this.half || !this.quarter) return;

    // The post passes replace rather than blend; blending is only for the
    // effect itself drawing into the scene buffer.
    gl.disable(gl.BLEND);

    // Release every unit first. The composite at the end of the *previous*
    // frame leaves half[0] and quarter[1] bound to units 1 and 2, and the blur
    // passes below render into those same textures. GL refuses to read and
    // write one texture at once — "feedback loop formed between framebuffer
    // and active texture" — and silently drops the draw, which is what turned
    // the whole overlay black.
    this.unbindAllUnits();

    // Bright pass, downsampling to half resolution in the same step.
    this.pass(this.brightProgram!, this.half[0], (program) => {
      this.bindTexture(program, 'uSource', this.scene!.texture, 0);
      gl.uniform1f(gl.getUniformLocation(program, 'uThreshold'), this.threshold);
      gl.uniform1f(gl.getUniformLocation(program, 'uKnee'), this.knee);
    });

    this.blurInPlace(this.half[0], this.half[1]);        // tight halo → half[0]
    this.downsampleAndBlur(this.half[0], this.quarter);  // wide glow → quarter[1]

    // Composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram!);
    this.bindTexture(this.compositeProgram!, 'uScene', this.scene.texture, 0);
    this.bindTexture(this.compositeProgram!, 'uBloomTight', this.half[0].texture, 1);
    this.bindTexture(this.compositeProgram!, 'uBloomWide', this.quarter[1].texture, 2);
    gl.uniform1f(
      gl.getUniformLocation(this.compositeProgram!, 'uBloomStrength'),
      this.strength,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Leave no texture bound: the effect pass on the next frame binds the
    // desktop capture to unit 0 and must not inherit anything from here.
    this.unbindAllUnits();
    gl.enable(gl.BLEND);
  }

  private unbindAllUnits(): void {
    const gl = this.gl;
    for (let unit = 0; unit < 3; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  // ------------------------------------------------------------------ passes

  /**
   * Separable blur in two passes. The result is left in `target`; `scratch`
   * holds the horizontal intermediate and is not meaningful afterwards.
   */
  private blurInPlace(target: Target, scratch: Target): void {
    const gl = this.gl;
    this.pass(this.blurProgram!, scratch, (program) => {
      this.bindTexture(program, 'uSource', target.texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, 'uDirection'), 1 / target.width, 0);
    });
    this.pass(this.blurProgram!, target, (program) => {
      this.bindTexture(program, 'uSource', scratch.texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, 'uDirection'), 0, 1 / scratch.height);
    });
  }

  /** Halves the resolution again and blurs, leaving the result in `pair[1]`. */
  private downsampleAndBlur(source: Target, pair: [Target, Target]): void {
    const gl = this.gl;
    this.pass(this.blurProgram!, pair[0], (program) => {
      this.bindTexture(program, 'uSource', source.texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, 'uDirection'), 1 / source.width, 0);
    });
    this.pass(this.blurProgram!, pair[1], (program) => {
      this.bindTexture(program, 'uSource', pair[0].texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, 'uDirection'), 0, 1 / pair[0].height);
    });
  }

  private pass(
    program: WebGLProgram,
    target: Target,
    setup: (program: WebGLProgram) => void,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program);
    setup(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTexture(
    program: WebGLProgram,
    name: string,
    texture: WebGLTexture,
    unit: number,
  ): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }

  // ------------------------------------------------------------------ set-up

  private createTarget(width: number, height: number): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error(`[BlackHolock] Bloom target incomplete (0x${status.toString(16)}) at ${width}x${height}`);
      this.ready = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { framebuffer, texture, width, height };
  }

  private link(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    }
    return program;
  }

  dispose(includePrograms = true): void {
    const gl = this.gl;
    const targets = [this.scene, ...(this.half ?? []), ...(this.quarter ?? [])];
    for (const target of targets) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.scene = null;
    this.half = null;
    this.quarter = null;
    this.width = 0;
    this.height = 0;

    if (includePrograms) {
      for (const program of [this.brightProgram, this.blurProgram, this.compositeProgram]) {
        if (program) gl.deleteProgram(program);
      }
      this.brightProgram = null;
      this.blurProgram = null;
      this.compositeProgram = null;
      this.ready = false;
    }
  }
}
