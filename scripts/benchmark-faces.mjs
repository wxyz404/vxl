import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,process.argv[2]??'.cache/face-performance.json'),base='http://127.0.0.1:5185';
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve(root,'.cache/playwright');
const {chromium}=await import('@playwright/test');
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5185'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
try {
  let ready=false;for(let i=0;i<50;i++){try{await fetch(base);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
  if(!ready)throw new Error('Could not start face benchmark preview.');
  browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.route('**/__benchmark',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Face benchmark</title>'}));await page.goto(`${base}/__benchmark`);
  const result=await page.evaluate(async()=>{
    const {Studio}=await import('/src/core/studio.ts');
    const {copyPreset,PRESETS}=await import('/src/core/presets.ts');
    const photo=await createImageBitmap(await(await fetch('/tests/fixtures/astronaut.png')).blob());
    const results=[];
    const percentile=(array,p)=>{const sorted=array.slice().sort((a,b)=>a-b);return sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]:null;};
    for(const mode of ['baseline','face','face+person','face+person+authored-depth']){
      const preset=copyPreset(PRESETS[0]);preset.resolution=320;preset.face.enabled=mode!=='baseline';preset.segmentation=mode.includes('person');preset.depth.enabled=mode.includes('depth');
      const canvas=document.createElement('canvas'),original=document.createElement('canvas');document.body.append(canvas);
      const source=new OffscreenCanvas(512,512),c=source.getContext('2d');c.drawImage(photo,0,0);
      const errors=[],states=[],times=[],submission=[],inference=[],watched=new WeakSet();
      let measuring=false,faceFrames=0,lastTimestamp=-1;
      const studio=new Studio(canvas,original,preset,{onStats(){},onError(message){errors.push(message);},onVision(){},onSource(){},onEnded(){},onFace(status,message){states.push(status);if(status==='error')errors.push(message||status);}});
      // The last case isolates renderer coexistence; no neural depth speed is claimed.
      if(preset.depth.enabled){const values=Float32Array.from({length:32*32},(_,i)=>(i%32)/31);studio.depth.update=frame=>({values,width:32,height:32,timestamp:frame.timestamp,generation:frame.generation});}
      const render=studio.renderer.render.bind(studio.renderer);
      studio.renderer.render=(frame,settings)=>{
        const start=performance.now(),result=render(frame,settings),end=performance.now();
        if(measuring&&frame.timestamp!==lastTimestamp){times.push(end);submission.push(end-start);if(frame.face)faceFrames++;}
        lastTimestamp=frame.timestamp;
        const worker=studio.face.worker;
        if(worker&&!watched.has(worker)){
          watched.add(worker);const receive=worker.onmessage;
          worker.onmessage=event=>{if(measuring&&event.data.type==='result')inference.push(event.data.inferenceMs);receive.call(worker,event);};
        }
        return result;
      };
      try {
        await studio.setSource({kind:'camera',label:'Synthetic NASA portrait source',async start(){},async capture(timestamp,generation){return {image:await createImageBitmap(source),timestamp,generation};},stop(){}});
        const warmupStart=performance.now();
        while(preset.face.enabled&&studio.face.inferenceMs===0&&errors.length===0&&performance.now()-warmupStart<30_000)await new Promise(r=>setTimeout(r,100));
        if(preset.face.enabled&&studio.face.inferenceMs===0)errors.push('No face inference completed during model warm-up.');
        await new Promise(r=>setTimeout(r,2000));
        const droppedStart=studio.dropped,start=performance.now();measuring=true;
        await new Promise(r=>setTimeout(r,4000));measuring=false;const duration=performance.now()-start;
        const intervals=times.slice(1).map((time,i)=>time-times[i]);
        results.push({mode,source:'512x512 static public-domain portrait, repeated frames',logicalResolution:320,warmupSeconds:(start-warmupStart)/1000,seconds:duration/1000,newFrames:times.length,fps:times.length*1000/duration,
          frameIntervalMs:{p50:percentile(intervals,.5),p95:percentile(intervals,.95)},cpuRenderSubmissionMs:{p50:percentile(submission,.5),p95:percentile(submission,.95)},
          faceInferenceMs:{samples:inference.length,p50:percentile(inference,.5),p95:percentile(inference,.95)},framesWithUsableFace:faceFrames,skippedCaptureSlots:studio.dropped-droppedStart,states:[...new Set(states)],errors});
      }finally{studio.dispose();canvas.remove();}
    }
    photo.close();
    return {environment:navigator.userAgent,graphics:'Chromium SwiftShader software GPU; synthetic input; no physical camera/laptop claim',depth:'Authored relative field in final case; neural depth inference not benchmarked',warmup:'First real face inference, then 2 seconds settling; baseline 2 seconds',sampleSeconds:4,results};
  });
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));
  for(const resultCase of result.results)console.log(`${resultCase.mode}: ${resultCase.fps.toFixed(1)} FPS; interval p95 ${resultCase.frameIntervalMs.p95?.toFixed(1)} ms; errors ${resultCase.errors.length}`);
  console.log(`Synthetic measurements saved to ${output}`);
  if(result.results.some(value=>value.errors.length))throw new Error('Benchmark recorded errors; inspect the saved report.');
}finally{await browser?.close();server.kill();}
