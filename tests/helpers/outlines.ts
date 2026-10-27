import { PixelRenderer } from '../../src/render/renderer';
import { copyPreset, PRESETS, type Preset } from '../../src/core/presets';
import type { FramePacket } from '../../src/core/types';

export interface OutlineOptions {
  kind: 'rectangle' | 'circle' | 'interior';
  frames?: number;
  width?: 1 | 2;
  step?: number;
  jitter?: number;
  stability?: number;
  smoothing?: number;
  mode?: 'dark' | 'selective' | 'colored' | 'off';
  backgroundOnly?: boolean;
  disappear?: boolean;
  resetAt?: number;
  interval?: number;
  capture?: boolean;
  legacy?: boolean;
}

/** Analytic RGB/mask sequence; independent of neural model accuracy and wall-clock FPS. */
export async function outlineSequence(options: OutlineOptions) {
  const w=96,h=64,canvas=document.createElement('canvas');
  const source=new OffscreenCanvas(w,h), context=source.getContext('2d')!;
  const preset=copyPreset(PRESETS[0]);
  preset.segmentation=options.kind!=='interior';
  preset.outlineStability=options.stability??0.8; preset.contourSmoothing=options.smoothing??0.55;
  for(const style of [preset.foreground,preset.background]) Object.assign(style, {
    palette:['#000000','#ffffff'],simplify:0,clusters:0,outline:options.mode??'dark',
    outlineWidth:options.width??1,internalEdges:options.kind==='interior'?0.5:0,
    antialias:false,dither:0,texture:'off',contrast:1,saturation:1,
  });
  if(options.backgroundOnly) preset.foreground.outline='off';
  let Renderer=PixelRenderer;
  if(options.legacy) {
    const path='/.cache/outline-baseline/src/render/renderer.ts';
    Renderer=(await import(/* @vite-ignore */ path)).PixelRenderer;
  }
  const renderer=new Renderer(canvas), frames:number[][]=[], counts:number[]=[], outside:number[]=[];
  try {
    for(let f=0;f<(options.frames??1);f++) {
      context.fillStyle='#ffffff'; context.fillRect(0,0,w,h);
      const dx=(options.step??0)*f;
      if(options.kind==='interior') { context.fillStyle='#888888'; context.fillRect(48+dx,0,w,h); }
      const mask=new Float32Array(w*h);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
        let confidence:number;
        if(options.kind==='circle') confidence=Math.max(0,Math.min(1,0.5+(15-Math.hypot(x+0.5-(48+dx),y+0.5-32))/1.5));
        else confidence=x>=28+dx&&x<68+dx&&y>=18&&y<46?1:0;
        if(options.kind==='circle'&&confidence>0&&confidence<1) confidence=Math.max(0,Math.min(1,confidence+(options.jitter??0)*Math.sin(x*1.7+y*2.3+f*2.4)));
        if(options.disappear&&f>0) confidence=0;
        mask[y*w+x]=confidence;
      }
      const frame:FramePacket={image:await createImageBitmap(source),mask,maskWidth:w,maskHeight:h,timestamp:f*(options.interval??(1000/30)),generation:0};
      if(options.resetAt===f) renderer.resetHistory();
      try { renderer.render(frame,preset); } finally { frame.image.close(); }
      const gl=canvas.getContext('webgl2')!, rgba=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      const scale=canvas.width/w, blacks:number[]=[]; let outsideCount=0;
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
        const px=x*scale+Math.floor(scale/2), py=canvas.height-1-(y*scale+Math.floor(scale/2)), offset=(py*canvas.width+px)*4;
        if(rgba[offset]<20&&rgba[offset+1]<20&&rgba[offset+2]<20) {
          blacks.push(y*w+x);
          if(mask[y*w+x]<0.01) outsideCount++;
        }
      }
      counts.push(blacks.length); outside.push(outsideCount); frames.push(blacks);
    }
    let changed=0,compared=0;
    for(let f=2;f<frames.length;f++) {
      const previous=new Set(frames[f-1].map(p=>p+(options.step??0)));
      const current=new Set(frames[f]);
      for(const p of previous) if(!current.has(p)) changed++;
      for(const p of current) if(!previous.has(p)) changed++;
      compared+=previous.size+current.size;
    }
    return { counts,outside,frames,temporalChange:compared?changed/compared:0,
      image:options.capture?canvas.toDataURL():undefined,glError:canvas.getContext('webgl2')!.getError() };
  } finally { renderer.dispose(); }
}

export async function freezeAndReset() {
  const source=new OffscreenCanvas(96,64), c=source.getContext('2d')!;
  c.fillStyle='white';c.fillRect(0,0,96,64);
  const renderer=new PixelRenderer(document.createElement('canvas'));
  const preset:Preset={...copyPreset(PRESETS[0]),segmentation:true};
  const mask=new Float32Array(96*64);
  for(let y=0;y<64;y++) for(let x=0;x<96;x++) mask[y*96+x]=Math.max(0,Math.min(1,0.5+(15-Math.hypot(x+0.5-48,y+0.5-32))/1.5));
  const frame:FramePacket={image:await createImageBitmap(source),timestamp:33,generation:0,mask,maskWidth:96,maskHeight:64};
  try {
    renderer.render(frame,preset);const first=renderer.canvas.toDataURL();
    renderer.render(frame,preset);const repeat=renderer.canvas.toDataURL();
    renderer.resetHistory();renderer.render(frame,preset);const reset=renderer.canvas.toDataURL();
    const fresh=new PixelRenderer(document.createElement('canvas'));
    try { fresh.render(frame,preset);return {same:first===repeat,reset:reset===fresh.canvas.toDataURL()}; }
    finally { fresh.dispose(); }
  } finally {frame.image.close();renderer.dispose();}
}
