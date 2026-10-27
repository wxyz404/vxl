import type { FramePacket } from '../core/types';
import { hexRgb, logicalSize, type Preset } from '../core/presets';
import * as shaders from './shaders';
import * as contours from './contours';
import { rgbToOklab } from './color';
import { usableDepth } from '../vision/depth-field';

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
type Program = { handle: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> };

/** GPU-only image effects. No camera, React, or model dependencies. */
export class PixelRenderer {
  private gl: WebGL2RenderingContext;
  private programs: Record<string, Program> = {};
  private targets: Target[] = [];
  private image: WebGLTexture;
  private mask: WebGLTexture;
  private depth: WebGLTexture;
  private depthEnabled = false;
  private depthMix = 1;
  private lastDepth?: FramePacket['depth'];
  private vao: WebGLVertexArrayObject;
  private width = 0;
  private height = 0;
  private history = 0;
  private reset = true;
  private disposed = false;
  private lastTimestamp = -1;
  private lastGeneration = -1;
  private lastPreset?: Preset;
  private historyStep = 1;
  private paletteKey = '';
  private paletteRgb = new Float32Array(64*3);
  private paletteLab = new Float32Array(64*3);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('VXL needs WebGL2. Enable graphics acceleration in Chrome or Edge, then reload.');
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const effects = { ...shaders, ...contours };
    for (const name of ['prepare', 'motion', 'sample', 'quantize', 'clusters', 'patterns', 'geometry', 'stabilize', 'finish', 'display'] as const) {
      const handle = gl.createProgram()!;
      const vertex = this.compile(gl.VERTEX_SHADER, shaders.vertex);
      const fragment = this.compile(gl.FRAGMENT_SHADER, effects[name]);
      gl.attachShader(handle, vertex); gl.attachShader(handle, fragment); gl.linkProgram(handle);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) { const reason = gl.getProgramInfoLog(handle); gl.deleteProgram(handle); throw new Error(`Could not prepare ${name} effect: ${reason}`); }
      this.programs[name] = { handle, locations: new Map() };
    }
    this.image = this.texture(gl.LINEAR);
    this.mask = this.texture(gl.LINEAR);
    this.depth = this.texture(gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private compile(type: number, source: string) {
    const gl = this.gl, shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Could not prepare the pixel renderer: ${reason}`); }
    return shader;
  }
  private texture(filter: number) {
    const gl = this.gl, texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  private resize(width: number, height: number) {
    const gl = this.gl;
    if (this.width === width && this.height === height) return;
    this.releaseTargets(); this.width = width; this.height = height;
    // Output is an integer enlargement. CSS fits it into the available space.
    const scale = Math.max(1, Math.floor(Math.min(1280 / width, 720 / height)));
    this.canvas.width = width * scale; this.canvas.height = height * scale;
    for (let i = 0; i < 13; i++) {
      const w=i===9?Math.ceil(width/4):width, h=i===9?Math.ceil(height/4):height;
      const texture = this.texture(i===7||i===8||i===10?gl.LINEAR:gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('The graphics device could not allocate the pixel canvas.');
      this.targets.push({ texture, framebuffer, width: w, height: h });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.resetHistory();
  }
  private location(program: Program, name: string) {
    if (!program.locations.has(name)) program.locations.set(name, this.gl.getUniformLocation(program.handle, name));
    return program.locations.get(name)!;
  }
  private bind(program: Program, name: string, texture: WebGLTexture, slot: number) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + slot); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(this.location(program, name), slot);
  }
  private settings(program: Program, preset: Preset) {
    const gl = this.gl, styles = [preset.foreground, preset.background];
    gl.uniform3fv(this.location(program, 'uPalette[0]'), this.paletteRgb);
    gl.uniform3fv(this.location(program, 'uPaletteLab[0]'), this.paletteLab);
    gl.uniform1iv(this.location(program, 'uCounts[0]'), styles.map(s => s.palette.length));
    const floats = { uSimplify: 'simplify', uContrast: 'contrast', uSaturation: 'saturation', uStrength: 'clusters', uDither: 'dither', uTextureStrength: 'textureStrength', uInternal: 'internalEdges' } as const;
    for (const [uniform, field] of Object.entries(floats)) gl.uniform1fv(this.location(program, `${uniform}[0]`), styles.map(s => s[field as typeof floats[keyof typeof floats]]));
    gl.uniform1iv(this.location(program, 'uOutline[0]'), styles.map(s => ['off', 'dark', 'colored', 'selective'].indexOf(s.outline)));
    gl.uniform1iv(this.location(program, 'uWidth[0]'), styles.map(s => s.outlineWidth));
    gl.uniform1iv(this.location(program, 'uAA[0]'), styles.map(s => Number(s.antialias)));
    gl.uniform1iv(this.location(program, 'uTexture[0]'), styles.map(s => ['off', 'stipple', 'hatch'].indexOf(s.texture)));
    gl.uniform1f(this.location(program, 'uStability'), preset.stability);
    gl.uniform1f(this.location(program, 'uOutlineStability'), preset.outlineStability);
    gl.uniform1f(this.location(program, 'uContourSmoothing'), preset.contourSmoothing);
    gl.uniform1f(this.location(program, 'uHistoryStep'), this.historyStep);
    gl.uniform1i(this.location(program, 'uDepthEnabled'), Number(this.depthEnabled));
    gl.uniform1f(this.location(program, 'uDepthMix'), this.depthMix);
    gl.uniform1f(this.location(program, 'uDepthFocus'), preset.depth.focus);
    gl.uniform1f(this.location(program, 'uDepthHaze'), preset.depth.haze);
    gl.uniform1f(this.location(program, 'uDepthDesaturation'), preset.depth.desaturation);
    gl.uniform1f(this.location(program, 'uDepthContrast'), preset.depth.contrast);
    gl.uniform1f(this.location(program, 'uDepthDetail'), preset.depth.detail);
    gl.uniform3fv(this.location(program, 'uAtmosphere'), hexRgb(preset.depth.atmosphere));
    gl.uniform1i(this.location(program, 'uDepthPreview'), ['art', 'depth', 'planes'].indexOf(preset.depth.preview));
    gl.uniform1i(this.location(program, 'uReset'), Number(this.reset));
    gl.uniform2f(this.location(program, 'uSize'), this.width, this.height);
    const angle = preset.lightAngle * Math.PI / 180;
    gl.uniform2f(this.location(program, 'uLight'), Math.cos(angle), -Math.sin(angle));
  }

  render(frame: FramePacket, preset: Preset): { width: number; height: number } {
    if (this.disposed || this.gl.isContextLost()) throw new Error('The graphics device was reset. Reload the renderer to continue.');
    const gl = this.gl;
    if (!this.reset && frame.timestamp===this.lastTimestamp && frame.generation===this.lastGeneration && preset===this.lastPreset && frame.depth===this.lastDepth) return { width: this.width, height: this.height };
    const elapsed=frame.timestamp-this.lastTimestamp;
    if (frame.generation!==this.lastGeneration || elapsed>250 || elapsed<0) this.resetHistory();
    this.historyStep=Math.max(0.25,elapsed/(1000/30));
    const paletteKey=preset.foreground.palette.join(',')+'|'+preset.background.palette.join(',');
    if(paletteKey!==this.paletteKey) {
      this.paletteRgb.fill(0);this.paletteLab.fill(0);
      [preset.foreground,preset.background].forEach((style,region)=>style.palette.forEach((color,i)=>{
        const rgb=hexRgb(color),offset=(region*32+i)*3;
        this.paletteRgb.set(rgb,offset);this.paletteLab.set(rgbToOklab(rgb),offset);
      }));
      this.paletteKey=paletteKey;this.resetHistory();
    }
    const [width, height] = logicalSize(frame.image.width, frame.image.height, preset.resolution);
    this.resize(width, height); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame.image);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    const split = Boolean(preset.segmentation && frame.mask && frame.maskWidth && frame.maskHeight);
    if (split) {
      const bytes = new Uint8Array(frame.mask!.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, frame.mask![i])) * 255);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, frame.maskWidth!, frame.maskHeight!, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.depthMix = Math.max(0, Math.min(1, frame.depth?.strength ?? 1));
    this.depthEnabled = preset.depth.enabled && this.depthMix > 0 && usableDepth(frame.depth, frame.timestamp, frame.generation);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
    if (this.depthEnabled) {
      const field = frame.depth!;
      const bytes = Uint8Array.from(field.values, value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 255) : 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, field.width, field.height, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    const next = 1 - this.history;
    const base = this.targets[next], previousBase = this.targets[this.history];
    const quant = this.targets[2 + next], previousQuant = this.targets[2 + this.history];
    const prepared = this.targets[7 + next], previousPrepared = this.targets[7 + this.history];
    const motion = this.targets[9], geometry = this.targets[10];
    const stroke = this.targets[11 + next], previousStroke = this.targets[11 + this.history];
    const passes: [string, Target | null, WebGLTexture, [string, WebGLTexture][]][] = [
      ['prepare', prepared, this.image, [['uMask', this.mask]]],
      ['motion', motion, prepared.texture, [['uPrevious', previousPrepared.texture]]],
      ['sample', base, prepared.texture, [['uMotion', motion.texture], ['uPrevious', previousBase.texture], ['uPreviousPrepared', previousPrepared.texture]]],
      ['quantize', quant, base.texture, [['uPrevious', previousQuant.texture], ['uMotion', motion.texture]]],
      ['clusters', this.targets[4], quant.texture, [['uSource', base.texture]]],
      ['patterns', this.targets[5], this.targets[4].texture, [['uSource', base.texture]]],
      ['geometry', geometry, base.texture, []],
      ['stabilize', stroke, geometry.texture, [['uMotion', motion.texture], ['uPrevious', previousStroke.texture], ['uSource', base.texture], ['uPreviousSource', previousBase.texture]]],
      ['finish', this.targets[6], this.depthEnabled && preset.depth.detail > 0 ? this.targets[4].texture : this.targets[5].texture, [['uSource', base.texture], ['uContours', stroke.texture], ['uGeometry', geometry.texture]]],
      ['display', null, this.targets[6].texture, []],
    ];
    // Dither can create fresh orphan pixels; clean distant clusters again after patterns.
    if (this.depthEnabled && preset.depth.detail > 0) passes.splice(passes.length - 2, 0, ['clusters', this.targets[4], this.targets[5].texture, [['uSource', base.texture]]]);
    for (const [name, target, input, extra] of passes) {
      const program = this.programs[name]; gl.useProgram(program.handle);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
      this.bind(program, 'uInput', input, 0); extra.forEach(([key, texture], i) => this.bind(program, key, texture, i + 1));
      this.bind(program, 'uDepth', this.depth, 7);
      this.settings(program, preset); gl.uniform1i(this.location(program, 'uSplit'), Number(split));
      gl.uniform1i(this.location(program, 'uDepthCleanupOnly'), Number(name === 'clusters' && input === this.targets[5].texture));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.history = next; this.reset = false;
    this.lastTimestamp=frame.timestamp; this.lastGeneration=frame.generation; this.lastPreset=preset;
    this.lastDepth=frame.depth;
    return { width, height };
  }
  resetHistory() { this.reset = true; this.history = 0; }
  private releaseTargets() { this.targets.forEach(t => { this.gl.deleteFramebuffer(t.framebuffer); this.gl.deleteTexture(t.texture); }); this.targets = []; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.releaseTargets();
    Object.values(this.programs).forEach(program => this.gl.deleteProgram(program.handle));
    this.gl.deleteTexture(this.image); this.gl.deleteTexture(this.mask); this.gl.deleteTexture(this.depth); this.gl.deleteVertexArray(this.vao);
  }
}
