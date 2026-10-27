import { expect,it } from 'vitest';
import { rgbToOklab } from '../src/render/color';

it('caches standard Oklab palette coordinates without changing the color transform',()=>{
  expect(rgbToOklab([0,0,0])).toEqual([0,0,0]);
  const white=rgbToOklab([1,1,1]);
  expect(white[0]).toBeCloseTo(1,6);expect(white[1]).toBeCloseTo(0,6);expect(white[2]).toBeCloseTo(0,6);
  const red=rgbToOklab([1,0,0]);
  expect(red[0]).toBeCloseTo(0.627955,5);expect(red[1]).toBeCloseTo(0.224863,5);expect(red[2]).toBeCloseTo(0.125846,5);
});
