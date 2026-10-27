import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..'), baseline='f50a2ce';
const output=resolve(root,process.argv[2]??'.cache/outline-comparison.png');
const base='http://127.0.0.1:5181';
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve(root,'.cache/playwright');
const {chromium}=await import('@playwright/test');

// Reference renderer is kept in ignored cache; comparing does not change source files.
for(const file of ['src/render/renderer.ts','src/render/shaders.ts','src/core/types.ts','src/core/presets.ts']) {
  const result=spawnSync('git',['show',`${baseline}:${file}`],{cwd:root,encoding:'utf8',windowsHide:true});
  if(result.status!==0) throw new Error(`Baseline ${baseline} is unavailable. Fetch repository history before running this optional comparison.`);
  const target=resolve(root,'.cache/outline-baseline',file);
  await mkdir(dirname(target),{recursive:true});await writeFile(target,result.stdout);
}
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5181'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
try {
  let available=false;
  for(let i=0;i<50;i++) { try { await fetch(base);available=true;break; } catch { await new Promise(r=>setTimeout(r,200)); } }
  if(!available) throw new Error('The local comparison server could not start on port 5181.');
  browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();
  await page.route('**/__fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Contour comparison</title>'}));
  await page.goto(`${base}/__fixture`);
  const results=await page.evaluate(async()=>{
    const path='/tests/helpers/outlines.ts';const {outlineSequence}=await import(path);
    const results={};
    for(const [name,options] of Object.entries({rectangle:{kind:'rectangle'},moving:{kind:'circle',frames:12,step:2,jitter:0.13},stationary:{kind:'circle',frames:12,jitter:0.13}})) {
      results[name]={};
      for(const legacy of [true,false]) {
        const value=await outlineSequence({...options,legacy,capture:true});
        results[name][legacy?'before':'after']={counts:value.counts,outside:value.outside,temporalChange:value.temporalChange,image:value.image};
      }
    }
    return results;
  });
  const metadata=JSON.parse(JSON.stringify(results));
  for(const result of Object.values(metadata)) for(const value of Object.values(result)) delete value.image;
  const sheet=await page.evaluate(async results=>{
    const c=document.createElement('canvas');c.width=1088;c.height=1280;const ctx=c.getContext('2d');
    ctx.fillStyle='#151b13';ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='#d8e9c8';ctx.font='bold 26px Arial';ctx.fillText('VXL · contour regression comparison',32,43);
    ctx.font='14px Arial';ctx.fillStyle='#a0b38f';ctx.fillText('Analytic masks and generated RGB. This is not a neural segmentation benchmark.',32,72);
    ctx.font='bold 17px Arial';ctx.fillText('Before · prototype f50a2ce',32,110);ctx.fillText('After · motion-aware contours',576,110);
    let y=135;
    for(const [name,result] of Object.entries(results)) {
      for(const [column,key] of ['before','after'].entries()) {
        const image=new Image();image.src=result[key].image;await image.decode();const x=32+column*544;
        ctx.imageSmoothingEnabled=false;ctx.drawImage(image,x,y,480,320);
        ctx.fillStyle='#b7cda4';ctx.font='13px Arial';const value=result[key];
        ctx.fillText(`${name} · ${value.counts.at(-1)} ink pixels · ${(value.temporalChange*100).toFixed(1)}% aligned change`,x,y+343);
      }
      y+=375;
    }
    return c.toDataURL('image/png');
  },results);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,Buffer.from(sheet.split(',')[1],'base64'));
  await writeFile(output.replace(/\.png$/i,'')+'.json',JSON.stringify({baseline,fixtures:metadata},null,2));
  console.log(JSON.stringify(metadata,null,2));console.log(`Comparison saved to ${output}`);
} finally { await browser?.close();server.kill(); }
