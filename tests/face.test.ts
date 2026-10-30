import { describe,expect,it } from 'vitest';
import { authoredFace, continuousFace, EYES, faceGeometry, featureWarp, OVAL, rasterFace } from '../src/vision/face-geometry';
import { DEFAULT_FACE,parsePreset,PRESETS } from '../src/core/presets';

describe('face settings and geometry',()=>{
  it('loads older presets disabled and rejects invalid controls',()=>{
    const {face:_,...legacy}=PRESETS[0];
    expect(parsePreset(JSON.stringify(legacy)).face).toEqual(DEFAULT_FACE);
    for(const face of [{strength:2},{exaggeration:-1},{treatment:'identity'},{featureEmphasis:NaN}])
      expect(()=>parsePreset(JSON.stringify({...legacy,face}))).toThrow();
  });
  it('rejects malformed, impossible, nonfinite and missing landmark geometry',()=>{
    const face=authoredFace(.5,.5,.4,.6);
    expect(faceGeometry(face.landmarks,100,100)?.width).toBeCloseTo(40);
    expect(faceGeometry(new Float32Array(9),100,100)).toBeUndefined();
    for(const value of [NaN,Infinity,-3,4]){
      const points=face.landmarks.slice();points[OVAL[0]*3]=value;expect(faceGeometry(points,100,100)).toBeUndefined();
    }
    expect(faceGeometry(authoredFace(.5,.5,.01,.9).landmarks,100,100)).toBeUndefined();
  });
  it('insets the oval, protects features, obeys pixel budgets and has zero-warp identity',()=>{
    const face=authoredFace(.5,.5,.5,.7),map=rasterFace(face,100,100,0).bytes;
    expect(map[0]).toBe(0);
    expect(map[(15*100+50)*4]).toBe(0);
    expect(map[(45*100+45)*4]).toBeGreaterThan(200);
    expect([...map].filter((_,i)=>i%4===1).some(x=>x>200)).toBe(true);
    expect([...map].every((v,i)=>i%4<2||v===128)).toBe(true);
    expect([...rasterFace(authoredFace(.5,.5,.11,.18),100,100,1).bytes].every((v,i)=>i%4!==0||v===0)).toBe(true);
    const small=rasterFace(authoredFace(.5,.5,.2,.3),100,100,1).bytes;
    expect([...small].every((v,i)=>i%4<2||v===128)).toBe(true);
  });
  it('bounds local exaggeration and keeps feature centers and support boundaries fixed',()=>{
    const geometry=faceGeometry(authoredFace(.5,.5,.6,.8).landmarks,100,100)!;
    const eye=geometry.eyes[0],c:[number,number]=[eye.reduce((s,p)=>s+p[0],0)/eye.length,eye.reduce((s,p)=>s+p[1],0)/eye.length];
    expect(featureWarp(c,eye,.12)).toEqual([expect.closeTo(0),expect.closeTo(0)]);
    expect(featureWarp([0,0],eye,.12)).toEqual([expect.closeTo(0),expect.closeTo(0)]);
    expect(featureWarp([c[0]+1,c[1]],eye,0)).toEqual([0,0]);
    const warped=rasterFace(authoredFace(.5,.5,.6,.8),100,100,1).bytes;
    expect([...warped].some((v,i)=>i%4>=2&&v!==128)).toBe(true);
    for(let i=0;i<warped.length;i+=4)if(warped[i]===0)expect([warped[i+2],warped[i+3]]).toEqual([128,128]);
    const side=authoredFace(.5,.5,.6,.8);side.landmarks[1*3]+=.2;
    expect(faceGeometry(side.landmarks,100,100)?.sideView).toBe(true);
    expect([...rasterFace(side,100,100,1).bytes].every((v,i)=>i%4<2||v===128)).toBe(true);
  });
  it('preserves independently authored eye shapes and mouth opening in feature maps',()=>{
    const face=authoredFace(.5,.5,.6,.8),original=rasterFace(face,100,100,0).bytes;
    for(const index of EYES[0])face.landmarks[index*3+1]=.47;
    const blink=rasterFace(face,100,100,0).bytes;
    expect(blink).not.toEqual(original);
    for(let y=0;y<100;y++)for(let x=55;x<100;x++)expect(blink[(y*100+x)*4+1]).toBe(original[(y*100+x)*4+1]);
  });
  it('breaks spatial continuity on a jump, large scale change, or source change',()=>{
    const face=authoredFace(.3,.5,.25,.4);
    expect(continuousFace(face,authoredFace(.32,.51,.26,.41))).toBe(true);
    expect(continuousFace(face,authoredFace(.8,.5,.25,.4))).toBe(false);
    expect(continuousFace(face,authoredFace(.3,.5,.5,.8))).toBe(false);
    expect(continuousFace(face,{...face,generation:2})).toBe(false);
  });
});
