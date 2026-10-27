import { expect, test } from '@playwright/test';
import type { OutlineOptions, outlineSequence } from '../helpers/outlines';

test.beforeEach(async({page})=>{
  test.skip(process.env.VXL_TEST_PREVIEW==='1','Analytic renderer fixtures use source modules in development.');
  // Keep the studio idle: the fixture, not a second preview, owns the GPU during measurement.
  await page.route('**/__outline-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Outline fixture</title>'}));
  await page.goto('/__outline-fixture');
});

async function sequence(page:import('@playwright/test').Page, options:OutlineOptions):Promise<Awaited<ReturnType<typeof outlineSequence>>> {
  return page.evaluate(async options=>{
    const path='/tests/helpers/outlines.ts';
    return (await import(/* @vite-ignore */ path)).outlineSequence(options);
  },options);
}

test('one- and two-pixel outlines stay on one side without doubled borders',async({page})=>{
  const thin=await sequence(page,{kind:'rectangle',width:1});
  const thick=await sequence(page,{kind:'rectangle',width:2});
  expect(thin.glError).toBe(0);expect(thick.glError).toBe(0);
  expect(thin.counts).toEqual([132]);expect(thick.counts).toEqual([256]);
  expect(thin.outside).toEqual([0]);expect(thick.outside).toEqual([0]);
});

test('turning off the person outline lets the background own a single outside border',async({page})=>{
  const result=await sequence(page,{kind:'rectangle',backgroundOnly:true});
  expect(result.glError).toBe(0);expect(result.counts).toEqual([140]);expect(result.outside).toEqual([140]);
});

test('uncertain moving masks retain coherent lines without leaving trailing pixels',async({page})=>{
  test.setTimeout(120_000);
  const result=await sequence(page,{kind:'circle',frames:12,step:2,jitter:0.13});
  expect(result.glError).toBe(0);
  expect(result.temporalChange).toBeLessThan(0.20);
  expect(Math.max(...result.outside)).toBe(0);
  expect(Math.min(...result.counts)).toBeGreaterThan(50);
});

test('confident disappearance immediately clears old silhouettes',async({page})=>{
  const result=await sequence(page,{kind:'rectangle',frames:3,disappear:true});
  expect(result.counts).toEqual([132,0,0]);
});

test('fast movement outside the motion search range follows the current mask immediately',async({page})=>{
  const result=await sequence(page,{kind:'rectangle',frames:2,step:24});
  expect(result.counts).toEqual([132,132]);expect(result.outside).toEqual([0,0]);
  expect(result.frames[1]).toEqual(result.frames[0].map(p=>p+24));
});

test('low-rate frames and explicit history resets preserve clean current contours',async({page})=>{
  const result=await sequence(page,{kind:'rectangle',frames:4,step:2,interval:100,resetAt:2});
  expect(result.counts).toEqual([132,132,132,132]);expect(result.outside).toEqual([0,0,0,0]);
});

test('selective outlines are stable under an exact integer translation',async({page})=>{
  const result=await sequence(page,{kind:'circle',frames:6,step:2,mode:'selective'});
  expect(result.temporalChange).toBeLessThan(0.12);
  expect(Math.min(...result.counts)).toBeGreaterThan(15);
});

test('interior edges are thin and outline-off disables them',async({page})=>{
  const result=await sequence(page,{kind:'interior'});
  const columns=new Set(result.frames[0].map(p=>p%96));
  expect(columns.size).toBeLessThanOrEqual(2);expect(columns.size).toBeGreaterThan(0);
  const thick=await sequence(page,{kind:'interior',width:2});
  expect(new Set(thick.frames[0].map(p=>p%96)).size).toBe(columns.size+1);
  const disabled=await sequence(page,{kind:'interior',mode:'off'});
  expect(disabled.counts).toEqual([0]);
});

test('colored outlines remain visible even on a two-color palette',async({page})=>{
  const result=await sequence(page,{kind:'rectangle',mode:'colored'});
  expect(result.counts).toEqual([132]);
});

test('frozen-frame redraw and reset do not accumulate temporal history',async({page})=>{
  const result=await page.evaluate(async()=>{
    const path='/tests/helpers/outlines.ts';return (await import(/* @vite-ignore */ path)).freezeAndReset();
  });
  expect(result).toEqual({same:true,reset:true});
});
