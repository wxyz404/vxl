import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,process.argv[2]??'docs/face-comparison.png'),base='http://127.0.0.1:5184';
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve(root,'.cache/playwright');
const {chromium}=await import('@playwright/test');
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5184'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
try {
  let ready=false;for(let i=0;i<50;i++){try{await fetch(base);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
  if(!ready)throw new Error('Could not start face comparison preview.');
  browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  await page.route('**/__comparison',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Face readability comparison</title>'}));await page.goto(`${base}/__comparison`);
  const result=await page.evaluate(async()=>{
    const {portraitObservation}=await import('/tests/helpers/face.ts');
    const {PixelRenderer}=await import('/src/render/renderer.ts');
    const {copyPreset,PRESETS}=await import('/src/core/presets.ts');
    const {faceGeometry}=await import('/src/vision/face-geometry.ts');
    const {image,observation}=await portraitObservation();
    const canvas=document.createElement('canvas'),renderer=new PixelRenderer(canvas),preset=copyPreset(PRESETS[0]);
    const sheet=document.createElement('canvas');sheet.width=1220;sheet.height=1190;const c=sheet.getContext('2d');
    c.fillStyle='#151b13';c.fillRect(0,0,sheet.width,sheet.height);c.fillStyle='#d8e9c8';c.font='bold 26px Arial';c.fillText('VXL / experimental face readability',24,38);
    c.fillStyle='#a8ba98';c.font='14px Arial';c.fillText('NASA portrait / actual local MediaPipe landmarks / DawnBringer 32 / one shared pixel grid',24,66);
    c.fillText('Face crops enlarged without smoothing. Static comparison, not a live-camera benchmark. Strength 65%, feature emphasis 50%.',24,88);
    const g=faceGeometry(observation.landmarks,image.width,image.height),xs=g.oval.map(p=>p[0]),ys=g.oval.map(p=>p[1]);
    const left=Math.max(0,Math.min(...xs)-15),top=Math.max(0,Math.min(...ys)-12),width=Math.max(...xs)-left+15,height=Math.max(...ys)-top+12;
    const metrics=[];
    for(const [row,resolution] of [160,240,320,480].entries()){
      preset.resolution=resolution;
      c.fillStyle='#c8dfb3';c.font='bold 15px Arial';c.fillText(`${resolution} px scene / face ~${Math.round(g.width*resolution/image.width)} px across`,24,121+row*255);
      for(const [column,[label,enabled,treatment,exaggeration]] of [['Face off',false,'portrait',0],['Readable portrait',true,'portrait',0],['Sprite portrait',true,'sprite',0],['Sprite + exaggeration 100%',true,'sprite',1]].entries()){
        Object.assign(preset.face,{enabled,treatment,exaggeration});renderer.resetHistory();
        const start=performance.now();renderer.render({image,timestamp:100,generation:1,face:{observation,strength:1,allowWarp:true}},preset);
        metrics.push({resolution,treatment:label,cpuSubmissionMs:performance.now()-start});
        const x=24+column*300,y=154+row*255,scale=canvas.width/image.width;
        c.fillStyle='#b7cda4';c.font='14px Arial';c.fillText(label,x,y-10);c.imageSmoothingEnabled=false;
        c.drawImage(canvas,left*scale,top*scale,width*scale,height*scale,x,y,267,211);
      }
    }
    c.fillStyle='#94a785';c.font='12px Arial';c.fillText('NASA / Eileen Collins; public-domain sample distributed by scikit-image. Geometry preserves asymmetry and samples the recorded features.',24,1170);
    const glError=canvas.getContext('webgl2').getError();image.close();renderer.dispose();
    return {png:sheet.toDataURL(),metrics,inferenceMs:observation.inferenceMs,glError};
  });
  if(result.glError)throw new Error(`Face comparison GL error: ${result.glError}`);
  await mkdir(dirname(output),{recursive:true});await writeFile(output,Buffer.from(result.png.split(',')[1],'base64'));
  await writeFile(output.replace(/\.png$/i,'.json'),JSON.stringify({fixture:'NASA/scikit-image astronaut',environment:'Headless Chromium with SwiftShader; CPU submission includes first-use setup; not physical GPU/laptop timing',inferenceMs:result.inferenceMs,metrics:result.metrics},null,2));
  await page.goto(base);await page.getByRole('button',{name:'Snapshot',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Pause preview'}).click();await page.getByRole('tab',{name:'Experimental Settings',exact:true}).click();
  await page.getByRole('switch',{name:'Face readability',exact:true}).click();await page.getByRole('switch',{name:'Show face region',exact:true}).click();
  await page.screenshot({path:output.replace(/\.png$/i,'-controls.png')});
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'Face readability',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:output.replace(/\.png$/i,'-mobile.png')});
  console.log(`Face comparison and controls saved to ${output}`);
}finally{await browser?.close();server.kill();}
