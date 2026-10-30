import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {copyPreset,PRESETS} from '../../src/core/presets';

test('face controls style the paused demo, persist, and keep the diagnostic guide out of exports',async({page})=>{
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/face.worker|face_landmarker/.test(r.url()))requests.push(r.url());});
  const preset=copyPreset(PRESETS[0]);preset.stability=0;preset.outlineStability=0;
  await page.addInitScript(value=>localStorage.setItem('vxl.preset.v1',JSON.stringify(value)),preset);
  await page.goto('/');await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Pause preview'}).click();
  const canvas=page.getByTestId('output-canvas'),before=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.getByRole('tab',{name:'Experimental Settings',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'Face readability',exact:true});await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(page.getByLabel('Face treatment',{exact:true})).toBeDisabled();await toggle.click();
  await expect(page.getByText('Authored demo face · not AI detection',{exact:true})).toBeVisible();
  await expect.poll(()=>canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(before);
  await page.getByLabel('Face treatment',{exact:true}).selectOption('sprite');
  const art=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.getByRole('switch',{name:'Show face region',exact:true}).click();await expect(page.getByTestId('face-overlay')).toBeVisible();
  await expect.poll(()=>page.getByTestId('face-overlay').evaluate(c=>{const canvas=c as HTMLCanvasElement,ctx=canvas.getContext('2d')!;return ctx.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);})).toBe(true);
  expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(art);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Snapshot',exact:true}).click();const png=await download;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const pngBytes=await readFile((await png.path())!);
  const snapshotMatches=await page.evaluate(async({downloaded,expected})=>{
    const a=await createImageBitmap(new Blob([new Uint8Array(downloaded)],{type:'image/png'}));
    const b=await createImageBitmap(await(await fetch(expected)).blob());
    const canvas=new OffscreenCanvas(a.width,a.height),c=canvas.getContext('2d')!;
    c.drawImage(a,0,0);const first=c.getImageData(0,0,a.width,a.height).data;
    c.clearRect(0,0,a.width,a.height);c.drawImage(b,0,0);const second=c.getImageData(0,0,a.width,a.height).data;
    const same=first.every((v,i)=>v===second[i]);a.close();b.close();return same;
  },{downloaded:Array.from(pngBytes),expected:art});
  expect(snapshotMatches).toBe(true);
  await toggle.click();await expect.poll(()=>canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(before);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('vxl.preset.v1')!).face);expect(saved.treatment).toBe('sprite');expect(saved.enabled).toBe(false);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});

test('face rendering isolates masks, preserves palettes, aligns motion and expires stale geometry',async({page})=>{
  test.skip(process.env.VXL_TEST_PREVIEW==='1','Analytic fixtures import source modules.');
  await page.route('**/__face-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Face fixture</title>'}));await page.goto('/__face-fixture');
  const result=await page.evaluate(async()=>{const path='/tests/helpers/face.ts';return(await import(/* @vite-ignore */path)).faceFixture();});
  expect(result).toMatchObject({zero:true,outside:true,changed:true,distinct:true,warped:true,palette:true,aligned:true,invalidMotion:true,missingChain:true,expired:true,frozenOutside:true,frozenOff:true,cachedBaseline:true,glError:0});
  expect(result.modes.every((r:{palette:boolean;outside:boolean;changed:boolean})=>r.palette&&r.outside&&r.changed)).toBe(true);
  expect(result.combined).toEqual({palette:true,outside:true,changed:true});
});

test('real local face worker detects a public-domain portrait offline',async({page,context})=>{
  test.skip(process.env.VXL_TEST_PREVIEW==='1','Real worker fixture imports source modules.');
  test.skip(!existsSync('public/vision/face_landmarker.task'),'Install local face model with pnpm models:setup -- --face.');
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.route('**/__face-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Local face inference</title>'}));await page.goto('/__face-fixture');
  const result=await page.evaluate(async()=>{
    const path='/tests/helpers/face.ts';const {portraitObservation}=await import(/* @vite-ignore */path);
    const {image,observation}=await portraitObservation();image.close();
    return {count:observation.landmarks.length,finite:Array.from(observation.landmarks).every(Number.isFinite),generation:observation.generation,timestamp:observation.timestamp,inferenceMs:observation.inferenceMs};
  });
  expect(result).toMatchObject({count:1434,finite:true,generation:1,timestamp:100});expect(result.inferenceMs).toBeGreaterThan(0);
});

test('missing face models leave camera preview running and retry recovers',async({page,context})=>{
  await context.grantPermissions(['camera']);
  const preset=copyPreset(PRESETS[0]);preset.face.enabled=true;
  await page.addInitScript(value=>localStorage.setItem('vxl.preset.v1',JSON.stringify(value)),preset);
  await page.route('**/vision/face_landmarker.task',r=>r.fulfill({status:404,body:'missing'}));
  await page.goto('/');await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/Webcam/}).click();await page.getByRole('tab',{name:'Experimental Settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry face tracking',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  await page.unroute('**/vision/face_landmarker.task');await page.getByRole('button',{name:'Retry face tracking',exact:true}).click();
  if(existsSync('public/vision/face_landmarker.task'))await expect(page.locator('.face-status')).toHaveText(/No face detected|Tracking one face/);
});

test('portrait camera tracks while paused, records styled art without its guide, and releases on source change',async({page})=>{
  test.setTimeout(90_000);
  test.skip(!existsSync('public/vision/face_landmarker.task'),'Install the optional local face model first.');
  const photo=await readFile('tests/fixtures/astronaut.png');
  await page.route('**/__portrait.png',r=>r.fulfill({contentType:'image/png',body:photo}));
  const preset=copyPreset(PRESETS[0]);preset.resolution=160;preset.face.enabled=true;
  await page.addInitScript(value=>{
    localStorage.setItem('vxl.preset.v1',JSON.stringify(value));
    const state=window as unknown as {faceCamera?:MediaStream;faceFrames?:ReturnType<typeof setInterval>};
    navigator.mediaDevices.getUserMedia=async()=>{
      const image=new Image();image.src='/__portrait.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const c=canvas.getContext('2d')!;
      c.drawImage(image,0,0);const stream=canvas.captureStream(30);state.faceCamera=stream;
      state.faceFrames=setInterval(()=>{if(stream.getTracks()[0].readyState==='ended'){clearInterval(state.faceFrames);return;}c.drawImage(image,0,0);},1000/30);
      return stream;
    };
  },preset);
  await page.goto('/');await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/Webcam/}).click();await page.getByRole('tab',{name:'Experimental Settings',exact:true}).click();
  await expect(page.getByText('CAMERA',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  // Software rendering may exceed the deliberately strict live reuse budget.
  // Freeze an actual camera frame so inference can prove matching-frame behavior.
  await page.getByRole('button',{name:'Pause preview'}).click();
  await expect(page.locator('.face-status')).toHaveText('Tracking one face');
  await page.getByRole('switch',{name:'Show face region',exact:true}).click();
  const guide=page.getByTestId('face-overlay');
  await expect.poll(()=>guide.evaluate(c=>{const canvas=c as HTMLCanvasElement;return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);})).toBe(true);
  // Paused geometry remains usable beyond the live 200 ms reuse budget.
  await page.waitForTimeout(350);await expect(page.locator('.face-status')).toHaveText('Tracking one face');
  const recording=page.waitForEvent('download');await page.getByRole('button',{name:'Record clip',exact:true}).click();await page.waitForTimeout(3000);await page.getByRole('button',{name:/Stop \d/}).click();
  const clip=await recording;const videoBytes=await readFile((await clip.path())!);expect(videoBytes.length).toBeGreaterThan(1000);
  const validation=await page.evaluate(async bytes=>{
    const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/webm'}));
    try {
      await new Promise<void>((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(new Error('Recorded clip did not decode'));});
      const source=document.querySelector('[data-testid="output-canvas"]') as HTMLCanvasElement;
      const guide=document.querySelector('[data-testid="face-overlay"]') as HTMLCanvasElement;
      const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const c=canvas.getContext('2d')!;
      c.drawImage(video,0,0,canvas.width,canvas.height);const recorded=c.getImageData(0,0,canvas.width,canvas.height).data;
      c.drawImage(source,0,0);const art=c.getImageData(0,0,canvas.width,canvas.height).data;
      c.drawImage(guide,0,0);const diagnostic=c.getImageData(0,0,canvas.width,canvas.height).data;
      let artError=0,guideError=0,pixels=0;
      for(let i=0;i<art.length;i+=4)if(Math.abs(art[i]-diagnostic[i])+Math.abs(art[i+1]-diagnostic[i+1])>10){
        for(let j=0;j<3;j++){artError+=(art[i+j]-recorded[i+j])**2;guideError+=(diagnostic[i+j]-recorded[i+j])**2;}pixels++;
      }
      return {pixels,artError,guideError,audio:(video as HTMLVideoElement&{mozHasAudio?:boolean}).mozHasAudio??false};
    }finally{URL.revokeObjectURL(video.src);}
  },Array.from(videoBytes));
  expect(validation.pixels).toBeGreaterThan(0);expect(validation.artError).toBeLessThan(validation.guideError);
  await page.getByRole('button',{name:/Studio scene/}).click();await expect(page.locator('.face-status')).toHaveText('Authored demo face · not AI detection');
  expect(await page.evaluate(()=>(window as unknown as {faceCamera:MediaStream}).faceCamera.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
});
