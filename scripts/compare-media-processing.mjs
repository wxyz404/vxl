import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root=resolve(import.meta.dirname,'..'), base='http://127.0.0.1:5188';
const output=resolve(root,process.argv[2]??'docs/media-processing-comparison.png');
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve(root,'.cache/playwright');
const { chromium }=await import('@playwright/test');
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5188'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
try {
  let ready=false;for(let i=0;i<50;i++){try{await fetch(base);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
  if(!ready)throw new Error('Could not start the comparison server.');
  browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  await page.route('**/__comparison',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Uploaded media processing</title>'}));
  await page.goto(`${base}/__comparison`);
  const result=await page.evaluate(async()=>{
    const {refinementComparison}=await import('/tests/helpers/media.ts');
    const {outputs,...metrics}=await refinementComparison();
    const sheet=document.createElement('canvas');sheet.width=1260;sheet.height=625;const c=sheet.getContext('2d');
    c.fillStyle='#151b13';c.fillRect(0,0,sheet.width,sheet.height);
    c.fillStyle='#d8e9c8';c.font='bold 25px Arial';c.fillText('VXL / extra processing per frame',24,38);
    c.font='14px Arial';c.fillStyle='#a8ba98';c.fillText('Same NASA portrait, 160 px logical grid, DawnBringer 32, no face/depth models. Only spatial effort changes.',24,66);
    c.fillText('Smoothing can quiet texture or erase detail. This is a comparison, not an aesthetic quality score.',24,89);
    for(let level=0;level<5;level++) {
      const image=new Image();image.src=outputs[level];await image.decode();const x=24+level*246;
      c.fillStyle='#d8e9c8';c.font='bold 16px Arial';c.fillText(level===0?'Off / ordinary output':`Effort ${level} / ${level} extra passes`,x,125);
      c.imageSmoothingEnabled=false;c.drawImage(image,x,141,228,228);
      c.drawImage(image,image.width*.30,image.height*.07,image.width*.31,image.height*.31,x,385,228,190);
      c.font='13px Arial';c.fillStyle='#a8ba98';c.fillText(`${(metrics.changed[level]/(image.width*image.height)*100).toFixed(1)}% pixels differ from Off`,x,598);
    }
    c.font='11px Arial';c.fillText('Public-domain NASA / Eileen Collins sample distributed by scikit-image. Static rendering; no hardware FPS or motion-quality claim.',24,620);
    return {png:sheet.toDataURL(),...metrics};
  });
  if(result.glError)throw new Error(`WebGL error ${result.glError}`);
  await mkdir(dirname(output),{recursive:true});await writeFile(output,Buffer.from(result.png.split(',')[1],'base64'));
  const {png,...metrics}=result;await writeFile(output.replace(/\.png$/i,'.json'),JSON.stringify({fixture:'Public-domain NASA astronaut portrait',conditions:'Same frame and preset; 160 logical pixels; face/depth off; headless Chromium/SwiftShader. Pixel differences are not quality scores.',...metrics},null,2));
  await page.goto(base);await page.getByLabel('Open image file',{exact:true}).setInputFiles(resolve(root,'tests/fixtures/astronaut.png'));
  await page.getByRole('button',{name:'Snapshot',exact:true}).waitFor({state:'visible'});
  await page.getByRole('tab',{name:'Experimental Settings',exact:true}).click();
  await page.getByRole('slider',{name:'Extra processing per frame',exact:true}).fill('3');
  await page.waitForTimeout(1000);await page.screenshot({path:output.replace(/\.png$/i,'-controls.png')});
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'Uploaded media processing',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:output.replace(/\.png$/i,'-mobile.png')});
  console.log(JSON.stringify({output,...metrics}));
} finally {await browser?.close();server.kill();}
