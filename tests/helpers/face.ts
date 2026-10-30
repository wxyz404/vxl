import { PixelRenderer } from '../../src/render/renderer';
import { copyPreset,PRESETS } from '../../src/core/presets';
import type { FramePacket, FaceObservation } from '../../src/core/types';
import { authoredFace, rasterFace } from '../../src/vision/face-geometry';
import type { FaceResponse } from '../../src/vision/face-protocol';

export async function portraitObservation() {
  const image=await createImageBitmap(await(await fetch('/tests/fixtures/astronaut.png')).blob());
  const worker=new Worker(new URL('../../src/vision/face.worker.ts',import.meta.url),{type:'module'});
  try {
    return await new Promise<{image:ImageBitmap;observation:FaceObservation}>((resolve,reject)=>{
      const timeout=setTimeout(()=>{reject(new Error('Local face inference timed out'));},30_000);
      worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message));};
      worker.onmessage=(event:MessageEvent<FaceResponse>)=>{
        const result=event.data;
        if(result.type==='error'){clearTimeout(timeout);reject(new Error(result.message));}
        if(result.type==='ready')void createImageBitmap(image).then(copy=>worker.postMessage({type:'track',id:1,timestamp:100,generation:1,clock:100,image:copy},[copy]));
        if(result.type==='result'){
          clearTimeout(timeout);
          if(!result.landmarks){reject(new Error('No face detected in portrait fixture'));return;}
          resolve({image,observation:{landmarks:result.landmarks,timestamp:result.timestamp,generation:result.generation,inferenceMs:result.inferenceMs}});
        }
      };
      worker.postMessage({type:'initialize',baseUrl:location.origin+'/'});
    });
  }catch(error){image.close();throw error;}finally{worker.terminate();}
}

export async function faceFixture() {
  const sw=256,sh=192,w=160,h=120,source=new OffscreenCanvas(sw,sh),c=source.getContext('2d')!;
  c.fillStyle='#52776a';c.fillRect(0,0,sw,sh);
  const gradient=c.createLinearGradient(sw*.25,0,sw*.75,0);gradient.addColorStop(0,'#805341');gradient.addColorStop(.55,'#dda385');gradient.addColorStop(1,'#b37b61');
  c.fillStyle=gradient;c.beginPath();c.ellipse(sw*.5,sh*.5,sw*.25,sh*.4,0,0,Math.PI*2);c.fill();
  c.fillStyle='#302b35';
  for(const x of [.385,.615]){c.fillRect(sw*x-7,sh*.476-2,14,4);c.fillRect(sw*x-9,sh*.40,18,3);}
  c.fillStyle='#75454c';c.fillRect(sw*.42,sh*.70,sw*.16,5);
  c.fillStyle='#b4755d';c.fillRect(sw*.49,sh*.50,3,sh*.16);
  for(let i=0;i<100;i++){c.fillStyle=i%2?'#ffffff0b':'#0000000b';c.fillRect(sw*.3+(i*17)%100,sh*.2+(i*23)%110,1,1);}
  const canvas=document.createElement('canvas'),renderer=new PixelRenderer(canvas),preset=copyPreset(PRESETS[0]);
  preset.resolution=160;
  const observation=authoredFace(.5,.5,.5,.8,100,1);
  const frame:FramePacket={image:await createImageBitmap(source),timestamp:100,generation:1,face:{observation,strength:1,allowWarp:true}};
  const tiny=new OffscreenCanvas(w,h),ctx=tiny.getContext('2d')!;
  function read(){renderer.resetHistory();renderer.render(frame,preset);ctx.drawImage(canvas,0,0,w,h);return new Uint8Array(ctx.getImageData(0,0,w,h).data);}
  const baseline=read();preset.face.enabled=true;const portrait=read();preset.face.treatment='sprite';const sprite=read();
  const mask=rasterFace(observation,w,h,0).bytes;
  const same=(a:Uint8Array,b:Uint8Array)=>a.every((v,i)=>v===b[i]);
  const paletteOnly=(data:Uint8Array)=>{
    const allowed=new Set([...preset.foreground.palette,...preset.background.palette].map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',')));
    return data.every((_,i)=>i%4!==0||allowed.has(`${data[i]},${data[i+1]},${data[i+2]}`));
  };
  const outside=portrait.every((value,i)=>mask[Math.floor(i/4)*4]>0||value===baseline[i]);
  preset.face.exaggeration=1;const exaggerated=read();
  preset.face.strength=0;const zero=same(read(),baseline);preset.face.strength=.65;
  const both=()=>{preset.face.enabled=false;const off=read();preset.face.enabled=true;const on=read();return {palette:paletteOnly(on),outside:on.every((v,i)=>mask[Math.floor(i/4)*4]>0||v===off[i]),changed:!same(off,on)};};
  const modes=[];
  for(const mode of ['nearest','mood','correspondence','ramp'] as const){preset.foreground.colorMapping.mode=mode;modes.push(both());}
  preset.segmentation=true;frame.mask=Float32Array.from({length:w*h},(_,i)=>i%w<w/2?0:1);frame.maskWidth=w;frame.maskHeight=h;
  preset.depth.enabled=true;frame.depth={values:Float32Array.from({length:w*h},(_,i)=>i%w/w),width:w,height:h,timestamp:100,generation:1};
  const combined=both();
  // Motion history: use an unchanged source (confident zero motion) across several rendered frames.
  preset.segmentation=false;preset.depth.enabled=false;preset.face.exaggeration=0;
  frame.mask=undefined;frame.timestamp=100;renderer.resetHistory();renderer.render(frame,preset);
  for(const timestamp of [133,166,199]){frame.timestamp=timestamp;renderer.render(frame,preset);}
  const overlay=document.createElement('canvas');renderer.drawFaceOverlay(overlay);
  const coverage=()=>{const data=overlay.getContext('2d')!.getImageData(0,0,overlay.width,overlay.height).data;return data.some((v,i)=>i%4===3&&v>0);};
  const aligned=coverage();
  renderer.resetHistory();frame.timestamp=230;renderer.render(frame,preset);renderer.drawFaceOverlay(overlay);const invalidMotion=!coverage();
  frame.timestamp=301;renderer.render(frame,preset);renderer.drawFaceOverlay(overlay);const expired=!coverage();
  const isolated=new PixelRenderer(document.createElement('canvas'));
  frame.timestamp=150;isolated.render(frame,preset);const missingChainOutput=isolated.canvas.toDataURL();
  const noFace={...frame,face:undefined};isolated.resetHistory();isolated.render(noFace,preset);
  const missingChain=missingChainOutput===isolated.canvas.toDataURL();isolated.dispose();
  const frozen=new PixelRenderer(document.createElement('canvas')),frozenPreset=copyPreset(preset);
  frozenPreset.face.enabled=false;
  const frozenFrame={...frame,timestamp:100,face:{observation,strength:1,allowWarp:true}};
  frozen.render({...frozenFrame,face:undefined},frozenPreset);ctx.drawImage(frozen.canvas,0,0,w,h);
  const frozenBaseline=new Uint8Array(ctx.getImageData(0,0,w,h).data),gpu=frozen.canvas.getContext('webgl2')!;
  const draw=gpu.drawArrays.bind(gpu);let drawCount=0;
  gpu.drawArrays=(...args)=>{drawCount++;draw(...args);};
  const facePreset={...frozenPreset,face:{...frozenPreset.face,enabled:true}};
  frozen.render(frozenFrame,facePreset);ctx.drawImage(frozen.canvas,0,0,w,h);
  const frozenStyled=ctx.getImageData(0,0,w,h).data,faceDraws=drawCount;
  const frozenOutside=frozenStyled.every((v,i)=>mask[Math.floor(i/4)*4]>0||v===frozenBaseline[i]);
  drawCount=0;frozen.render({...frozenFrame,face:undefined},frozenPreset);ctx.drawImage(frozen.canvas,0,0,w,h);
  const frozenOff=same(new Uint8Array(ctx.getImageData(0,0,w,h).data),frozenBaseline),cachedBaseline=faceDraws===4&&drawCount===1;
  frozen.dispose();
  const glError=canvas.getContext('webgl2')!.getError();frame.image.close();renderer.dispose();
  return {zero,outside,changed:!same(portrait,baseline),distinct:!same(portrait,sprite),warped:!same(sprite,exaggerated),palette:[portrait,sprite,exaggerated].every(paletteOnly),modes,combined,aligned,invalidMotion,missingChain,expired,frozenOutside,frozenOff,cachedBaseline,glError};
}
