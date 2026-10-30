import type { FramePacket } from '../core/types';
import { hexRgb, logicalSize, type Preset } from '../core/presets';
import * as shaders from './shaders';
import * as contours from './contours';
import { rgbToOklab } from './color';
import { usableDepth } from '../vision/depth-field';
import { mappingParameters, regionSamples, type Color } from './palette-mapping';
import * as faceShaders from './face-shaders';
import { rasterFace } from '../vision/face-geometry';

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
type Program = { handle: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> };

/** GPU image effects with a tiny, held CPU color reference for opt-in recoloring. */
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
  private lastFace?: FramePacket['face'];
  private faceTargets: Target[] = [];
  private faceFlows: { from: number; to: number; target: Target }[] = [];
  private alignedFace?: Target;
  private alignedTime = -1;
  private faceKey = '';
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
  private referenceKey = '';
  private referenceSamples: [Color[] | undefined, Color[] | undefined] = [undefined, undefined];
  private referenceCanvas?: OffscreenCanvas;
  private lastReferenceAttempt = -Infinity;
  private mappingKey = '';
  private anchorCounts = new Int32Array(2);
  private sourceRanges = new Float32Array([0, 1, 0, 1]);
  private mappingValues = {
    SourceMean: new Float32Array(6), SourceSpread: new Float32Array(6),
    TargetMean: new Float32Array(6), TargetSpread: new Float32Array(6),
    SourceAnchors: new Float32Array(30), TargetAnchors: new Float32Array(30), Ramp: new Float32Array(30),
  };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('VXL needs WebGL2. Enable graphics acceleration in Chrome or Edge, then reload.');
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const effects = { ...shaders, ...contours, ...faceShaders };
    for (const name of ['prepare', 'motion', 'sample', 'quantize', 'clusters', 'patterns', 'geometry', 'stabilize', 'finish', 'display', 'faceAlign', 'faceSample', 'faceQuantize', 'faceComposite'] as const) {
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
  private target(width: number, height: number): Target {
    const gl=this.gl,texture=this.texture(gl.NEAREST),framebuffer=gl.createFramebuffer()!;
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Could not allocate face rendering surface.');
    return {texture,framebuffer,width,height};
  }
  private deleteTarget(target:Target) {this.gl.deleteFramebuffer(target.framebuffer);this.gl.deleteTexture(target.texture);}
  private clearFaceHistory() {
    this.faceFlows.forEach(f=>this.deleteTarget(f.target));this.faceFlows=[];this.faceKey='';this.alignedFace=undefined;this.alignedTime=-1;
  }
  private rememberFaceMotion(frame:FramePacket,motion:Target) {
    if(frame.timestamp===this.lastTimestamp)return;
    const gl=this.gl;
    if(this.lastTimestamp>=0&&frame.generation===this.lastGeneration&&frame.timestamp>this.lastTimestamp&&frame.timestamp-this.lastTimestamp<=200) {
      const target=this.target(motion.width,motion.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,motion.framebuffer);gl.bindTexture(gl.TEXTURE_2D,target.texture);
      gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,motion.width,motion.height);
      this.faceFlows.push({from:this.lastTimestamp,to:frame.timestamp,target});
    }
    while(this.faceFlows.length&&(this.faceFlows[0].to<frame.timestamp-200||this.faceFlows.length>12))this.deleteTarget(this.faceFlows.shift()!.target);
  }
  private facePass(name:keyof typeof faceShaders,target:Target,input:WebGLTexture,extra:[string,WebGLTexture][],preset:Preset,field:NonNullable<FramePacket['face']>,history=false) {
    const gl=this.gl,program=this.programs[name];gl.useProgram(program.handle);
    gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);gl.viewport(0,0,target.width,target.height);
    this.bind(program,'uInput',input,0);extra.forEach(([key,texture],i)=>this.bind(program,key,texture,i+1));
    this.bind(program,'uDepth',this.depth,7);this.settings(program,preset);
    gl.uniform1i(this.location(program,'uFaceTreatment'),Number(preset.face.treatment==='sprite'));
    gl.uniform1f(this.location(program,'uFaceEmphasis'),preset.face.featureEmphasis);
    gl.uniform1f(this.location(program,'uFaceStrength'),preset.face.strength*field.strength);
    gl.uniform1i(this.location(program,'uFaceWarp'),Number(field.allowWarp));
    gl.uniform1i(this.location(program,'uFaceHistory'),Number(history));
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  private renderFace(frame:FramePacket,preset:Preset,regions:Target,motion:Target):WebGLTexture {
    const field=frame.face;
    if(!preset.face.enabled||preset.face.strength===0||!field||field.strength<=0||field.observation.generation!==frame.generation)return this.noFace();
    const age=frame.timestamp-field.observation.timestamp;
    if(age<0||age>=200)return this.noFace();
    if(!this.faceTargets.length)for(let i=0;i<6;i++)this.faceTargets.push(this.target(this.width,this.height));
    const key=`${field.observation.generation}:${field.observation.timestamp}:${preset.face.exaggeration}:${field.allowWarp}`;
    const previousAligned=this.alignedTime;
    if(key!==this.faceKey) {
      const {bytes,geometry}=rasterFace(field.observation,this.width,this.height,field.allowWarp?preset.face.exaggeration:0);
      if(!geometry||geometry.width<12)return this.noFace();
      // CPU rows are top-left; WebGL intermediate maps are bottom-left.
      const flipped=new Uint8Array(bytes.length),stride=this.width*4;
      for(let y=0;y<this.height;y++)flipped.set(bytes.subarray(y*stride,(y+1)*stride),(this.height-y-1)*stride);
      const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.faceTargets[0].texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,this.width,this.height,0,gl.RGBA,gl.UNSIGNED_BYTE,flipped);
      this.alignedFace=this.faceTargets[0];this.alignedTime=field.observation.timestamp;this.faceKey=key;
    }
    while(this.alignedTime<frame.timestamp) {
      const flow=this.faceFlows.find(f=>f.from===this.alignedTime&&f.to<=frame.timestamp);
      if(!flow||!this.alignedFace)return this.noFace();
      const target=this.alignedFace===this.faceTargets[0]?this.faceTargets[1]:this.faceTargets[0];
      this.facePass('faceAlign',target,this.alignedFace.texture,[['uFlow',flow.target.texture]],preset,field);
      this.alignedFace=target;this.alignedTime=flow.to;
    }
    if(!this.alignedFace)return this.noFace();
    const map=this.alignedFace.texture,sample=this.faceTargets[2],art=this.faceTargets[3+((this.history+1)%2)],previous=this.faceTargets[3+this.history],composite=this.faceTargets[5];
    this.facePass('faceSample',sample,this.image,[['uFace',map]],preset,field);
    this.facePass('faceQuantize',art,sample.texture,[['uFace',map],['uRegions',regions.texture],['uPreviousFace',previous.texture],['uFlow',motion.texture]],preset,field,!this.reset&&previousAligned===this.lastTimestamp&&frame.timestamp!==this.lastTimestamp&&field.observation.continuity===this.lastFace?.observation.continuity);
    this.facePass('faceComposite',composite,this.targets[6].texture,[['uFace',map],['uArt',art.texture],['uRegions',regions.texture]],preset,field);
    return composite.texture;
  }
  private noFace() {this.faceKey='';this.alignedFace=undefined;this.alignedTime=-1;return this.targets[6].texture;}
  drawFaceOverlay(canvas:HTMLCanvasElement) {
    canvas.width=this.canvas.width;canvas.height=this.canvas.height;
    const context=canvas.getContext('2d')!;context.clearRect(0,0,canvas.width,canvas.height);
    if(!this.alignedFace)return;
    const bytes=new Uint8Array(this.width*this.height*4),gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.alignedFace.framebuffer);gl.readPixels(0,0,this.width,this.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    const surface=new OffscreenCanvas(this.width,this.height),ctx=surface.getContext('2d')!,pixels=ctx.createImageData(this.width,this.height);
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++) {
      const source=(y*this.width+x)*4,target=((this.height-y-1)*this.width+x)*4;
      if(bytes[source]>0){pixels.data.set([105,255,190,bytes[source+1]>80?125:50],target);}
    }
    ctx.putImageData(pixels,0,0);context.imageSmoothingEnabled=false;context.drawImage(surface,0,0,canvas.width,canvas.height);
  }
  private location(program: Program, name: string) {
    if (!program.locations.has(name)) program.locations.set(name, this.gl.getUniformLocation(program.handle, name));
    return program.locations.get(name)!;
  }
  private bind(program: Program, name: string, texture: WebGLTexture, slot: number) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + slot); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(this.location(program, name), slot);
  }
  /** References stay fixed until refresh, source/region changes, or a detected scene cut. */
  refreshColorReference() {
    this.referenceSamples = [undefined, undefined]; this.lastReferenceAttempt = -Infinity;
    this.mappingKey = ''; this.resetHistory();
  }
  private updateMapping(frame: FramePacket, preset: Preset, split: boolean) {
    const referenceKey = `${frame.generation}|${split}|${frame.image.width}x${frame.image.height}`;
    if (referenceKey !== this.referenceKey) { this.refreshColorReference(); this.referenceKey = referenceKey; }
    const styles = [preset.foreground, preset.background];
    const needsReference = styles.map((style, region) => (region === 0 || split) &&
      style.colorMapping.mode !== 'nearest' && !this.referenceSamples[region]);
    if (needsReference.some(Boolean) && (preset !== this.lastPreset || frame.timestamp < this.lastReferenceAttempt || frame.timestamp - this.lastReferenceAttempt >= 500)) {
      this.referenceCanvas ??= new OffscreenCanvas(48, 32);
      const context = this.referenceCanvas.getContext('2d', { willReadFrequently: true })!;
      context.clearRect(0, 0, 48, 32); context.drawImage(frame.image, 0, 0, 48, 32);
      const samples = regionSamples(context.getImageData(0, 0, 48, 32).data, 48, 32,
        split ? frame.mask : undefined, frame.maskWidth, frame.maskHeight);
      for (let region = 0; region < 2; region++) if (needsReference[region] && samples[region].length) {
        this.referenceSamples[region] = samples[region]; this.mappingKey = '';
      }
      this.lastReferenceAttempt = frame.timestamp;
    }
    const key = JSON.stringify(styles.map(s => [s.palette, s.contrast, s.saturation, s.colorMapping.ramp]));
    if (key === this.mappingKey) return;
    styles.forEach((style, region) => {
      const p = mappingParameters(this.referenceSamples[region] ?? [], style), offset = region * 3;
      this.anchorCounts[region] = p.source.length;
      this.sourceRanges.set(p.range, region * 2);
      this.mappingValues.SourceMean.set(p.sourceStats.mean, offset);
      this.mappingValues.SourceSpread.set(p.sourceStats.spread, offset);
      this.mappingValues.TargetMean.set(p.targetStats.mean, offset);
      this.mappingValues.TargetSpread.set(p.targetStats.spread, offset);
      for (const [key, values] of [['SourceAnchors', p.source], ['TargetAnchors', p.target], ['Ramp', p.ramp]] as const) {
        this.mappingValues[key].fill(0, region * 15, (region + 1) * 15);
        values.forEach((color, i) => this.mappingValues[key].set(color, region * 15 + i * 3));
      }
    });
    this.mappingKey = key;
  }
  private settings(program: Program, preset: Preset) {
    const gl = this.gl, styles = [preset.foreground, preset.background];
    gl.uniform3fv(this.location(program, 'uPalette[0]'), this.paletteRgb);
    gl.uniform3fv(this.location(program, 'uPaletteLab[0]'), this.paletteLab);
    gl.uniform1iv(this.location(program, 'uCounts[0]'), styles.map(s => s.palette.length));
    gl.uniform1iv(this.location(program, 'uMapping[0]'), styles.map(s => ['nearest', 'mood', 'correspondence', 'ramp'].indexOf(s.colorMapping.mode)));
    gl.uniform1fv(this.location(program, 'uMappingStrength[0]'), styles.map(s => s.colorMapping.strength));
    gl.uniform1iv(this.location(program, 'uAnchorCount[0]'), this.anchorCounts);
    gl.uniform2fv(this.location(program, 'uSourceRange[0]'), this.sourceRanges);
    for (const [key, values] of Object.entries(this.mappingValues)) gl.uniform3fv(this.location(program, `u${key}[0]`), values);
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
    const sameSceneStyle=preset===this.lastPreset||Boolean(this.lastPreset&&JSON.stringify({...this.lastPreset,face:undefined})===JSON.stringify({...preset,face:undefined}));
    if (!this.reset && frame.timestamp===this.lastTimestamp && frame.generation===this.lastGeneration && sameSceneStyle && frame.depth===this.lastDepth) {
      if(frame.face!==this.lastFace||preset!==this.lastPreset) {
        // A late face result or face-only control must not advance the frozen scene's history.
        const input=this.renderFace(frame,preset,this.targets[this.history],this.targets[9]),program=this.programs.display;
        gl.useProgram(program.handle);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
        this.bind(program,'uInput',input,0);this.bind(program,'uDepth',this.depth,7);this.settings(program,preset);gl.drawArrays(gl.TRIANGLES,0,3);
        this.lastFace=frame.face;this.lastPreset=preset;
      }
      return {width:this.width,height:this.height};
    }
    const elapsed=frame.timestamp-this.lastTimestamp;
    if(frame.generation!==this.lastGeneration||elapsed>200||elapsed<0)this.clearFaceHistory();
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
    this.updateMapping(frame, preset, split);
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
      const displayInput=name==='display'?this.renderFace(frame,preset,base,motion):input;
      // The face branch changes the active program/framebuffer; restore the display state.
      gl.useProgram(program.handle);gl.bindFramebuffer(gl.FRAMEBUFFER,target?.framebuffer??null);
      gl.viewport(0,0,target?target.width:this.canvas.width,target?target.height:this.canvas.height);
      this.bind(program, 'uInput', displayInput, 0); extra.forEach(([key, texture], i) => this.bind(program, key, texture, i + 1));
      this.bind(program, 'uDepth', this.depth, 7);
      this.settings(program, preset); gl.uniform1i(this.location(program, 'uSplit'), Number(split));
      gl.uniform1i(this.location(program, 'uDepthCleanupOnly'), Number(name === 'clusters' && input === this.targets[5].texture));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if(name==='motion'&&preset.face.enabled&&preset.face.strength>0)this.rememberFaceMotion(frame,motion);
    }
    this.history = next; this.reset = false;
    this.lastTimestamp=frame.timestamp; this.lastGeneration=frame.generation; this.lastPreset=preset;
    this.lastDepth=frame.depth;
    this.lastFace=frame.face;
    return { width, height };
  }
  resetHistory() { this.reset = true; this.history = 0; }
  private releaseTargets() { this.targets.forEach(t => this.deleteTarget(t)); this.targets = [];this.clearFaceHistory();this.faceTargets.forEach(t=>this.deleteTarget(t));this.faceTargets=[]; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.releaseTargets();
    Object.values(this.programs).forEach(program => this.gl.deleteProgram(program.handle));
    this.gl.deleteTexture(this.image); this.gl.deleteTexture(this.mask); this.gl.deleteTexture(this.depth); this.gl.deleteVertexArray(this.vao);
  }
}
