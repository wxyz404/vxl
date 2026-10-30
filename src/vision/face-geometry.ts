import type { FaceObservation } from '../core/types';

// MediaPipe face-mesh contour indices; no skin-color thresholds are involved.
export const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export const EYES = [[33,160,158,133,153,144], [362,385,387,263,373,380]];
export const BROWS = [[70,63,105,66,107], [336,296,334,293,300]];
export const MOUTH = [61,40,37,0,267,270,291,321,314,17,84,91];
export const NOSE = [168,6,197,195,5,4,1,2];
type Point = [number, number];
export interface FaceGeometry { oval: Point[]; eyes: Point[][]; brows: Point[][]; mouth: Point[]; nose: Point[]; width: number; sideView: boolean }
const used = [...OVAL, ...EYES.flat(), ...BROWS.flat(), ...MOUTH, ...NOSE];

export function faceGeometry(landmarks: Float32Array, width: number, height: number): FaceGeometry | undefined {
  if (landmarks.length !== 478 * 3 || width < 1 || height < 1) return;
  for (const i of used) {
    const x = landmarks[i * 3], y = landmarks[i * 3 + 1], z = landmarks[i * 3 + 2];
    if (![x, y, z].every(Number.isFinite) || x < -0.2 || x > 1.2 || y < -0.2 || y > 1.2) return;
  }
  const points = (indices: number[]) => indices.map(i => [landmarks[i * 3] * width, landmarks[i * 3 + 1] * height] as Point);
  const oval = points(OVAL), eyes = EYES.map(points), brows = BROWS.map(points), mouth = points(MOUTH), nose = points(NOSE);
  const xs = oval.map(p => p[0]), ys = oval.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  if (w <= 0 || h <= 0 || w / h < 0.25 || w / h > 1.8 || w > width * 1.4 || h > height * 1.6) return;
  const a = center(eyes[0]), b = center(eyes[1]), mouthCenter = center(mouth);
  const eyeDistance = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (eyeDistance < w * 0.12 || eyeDistance > w * 0.85 || mouthCenter[1] < Math.min(a[1], b[1]) - h * 0.15) return;
  const nosePoint = nose[nose.length - 2];
  const eyeMid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const along = ((nosePoint[0] - eyeMid[0]) * (b[0] - a[0]) + (nosePoint[1] - eyeMid[1]) * (b[1] - a[1])) / (eyeDistance * eyeDistance);
  return { oval, eyes, brows, mouth, nose, width: w, sideView: Math.abs(along) > 0.28 || eyeDistance < w * 0.28 };
}
function center(points: Point[]): Point { return [points.reduce((s,p) => s+p[0],0)/points.length, points.reduce((s,p) => s+p[1],0)/points.length]; }
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function pathDistance(p: Point, points: Point[], closed: boolean) {
  let distance = Infinity;
  for(let i=0;i<points.length-(closed?0:1);i++) distance=Math.min(distance,segmentDistance(p,points[i],points[(i+1)%points.length]));
  return distance;
}
function inside(p: Point, polygon: Point[]) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
}
const ease = (value: number) => { const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };

/** Local inverse scale. Feature centers and the support boundary are fixed. */
export function featureWarp(p: Point, points: Point[], amount: number): Point {
  if (amount === 0) return [0,0];
  return warpField(points,amount)(p);
}
function warpField(points:Point[],amount:number) {
  const c=center(points),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const rx=Math.max(1,(Math.max(...xs)-Math.min(...xs))*0.85),ry=Math.max(rx*0.6,(Math.max(...ys)-Math.min(...ys))*1.3);
  return (p:Point):Point=>{
    const dx=p[0]-c[0],dy=p[1]-c[1],r=Math.hypot(dx/rx,dy/ry);
    const weight=1-ease(r),scale=1/(1+amount*weight)-1;
    return [dx*scale,dy*scale];
  };
}

/** RGBA8: coverage, semantic importance, signed inverse-UV displacement (1/16 px). */
export function rasterFace(observation: FaceObservation, width: number, height: number, exaggeration: number) {
  const bytes=new Uint8Array(width*height*4),g=faceGeometry(observation.landmarks,width,height);
  for(let i=0;i<width*height;i++) { bytes[i*4+2]=128;bytes[i*4+3]=128; }
  if(!g || g.width<12) return { bytes, geometry:g };
  const full=g.width>=24,warp=g.width>=32&&!g.sideView?Math.max(0,Math.min(1,exaggeration)):0;
  const warpFields=warp?[...g.eyes.map(points=>warpField(points,0.12*warp)),warpField(g.mouth,0.08*warp)]:[];
  const xs=g.oval.map(p=>p[0]),ys=g.oval.map(p=>p[1]);
  for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<Math.min(height,Math.ceil(Math.max(...ys)));y++)
    for(let x=Math.max(0,Math.floor(Math.min(...xs)));x<Math.min(width,Math.ceil(Math.max(...xs)));x++) {
      const p:Point=[x+0.5,y+0.5];
      if(!inside(p,g.oval)) continue;
      // Entire transition is inside the oval; inset avoids a halo outside the face.
      const coverage=ease(pathDistance(p,g.oval,true)-0.5);
      if(!coverage) continue;
      let displacement:Point=[0,0];
      if(warp) {
        // Supports are local; bound overlap and taper at the face boundary.
        for(const field of warpFields) {const f=field(p);displacement[0]+=f[0]*coverage;displacement[1]+=f[1]*coverage; }
      }
      const q:Point=[p[0]+displacement[0],p[1]+displacement[1]];
      let importance=0;
      for(const eye of g.eyes) importance=Math.max(importance,inside(q,eye)?1:1-ease(pathDistance(q,eye,true)/1.25));
      for(const brow of g.brows) importance=Math.max(importance,1-ease(pathDistance(q,brow,false)/1.2));
      importance=Math.max(importance,inside(q,g.mouth)?1:1-ease(pathDistance(q,g.mouth,true)/1.2),0.35*(1-ease(pathDistance(q,g.nose,false)/1.3)));
      const offset=(y*width+x)*4;
      bytes[offset]=Math.round(coverage*255);bytes[offset+1]=Math.round(importance*(full?1:0.45)*255);
      bytes[offset+2]=Math.round(128+Math.max(-7.9,Math.min(7.9,displacement[0]))*16);
      bytes[offset+3]=Math.round(128+Math.max(-7.9,Math.min(7.9,displacement[1]))*16);
    }
  return { bytes, geometry:g };
}

export function continuousFace(previous:FaceObservation,current:FaceObservation) {
  if(previous.generation!==current.generation)return false;
  const a=faceGeometry(previous.landmarks,1,1),b=faceGeometry(current.landmarks,1,1);
  if(!a||!b)return false;
  const ca=center(a.oval),cb=center(b.oval),height=Math.max(...a.oval.map(p=>p[1]))-Math.min(...a.oval.map(p=>p[1]));
  return Math.hypot((ca[0]-cb[0])/a.width,(ca[1]-cb[1])/height)<0.8&&b.width/a.width>0.55&&b.width/a.width<1.8;
}

/** Authored illustration geometry for the demo and deterministic renderer tests. */
export function authoredFace(cx:number,cy:number,w:number,h:number,timestamp=0,generation=1):FaceObservation {
  const landmarks=new Float32Array(478*3);
  for(let i=0;i<478;i++) { landmarks[i*3]=cx;landmarks[i*3+1]=cy; }
  const ellipse=(indices:number[],x:number,y:number,rx:number,ry:number,start=-Math.PI/2) => indices.forEach((index,i)=>{
    const a=start+i/indices.length*Math.PI*2;landmarks[index*3]=x+Math.cos(a)*rx;landmarks[index*3+1]=y+Math.sin(a)*ry;
  });
  ellipse(OVAL,cx,cy,w/2,h/2);
  ellipse(EYES[0],cx-w*.23,cy-h*.03,w*.09,h*.025,Math.PI);
  ellipse(EYES[1],cx+w*.23,cy-h*.03,w*.09,h*.025,Math.PI);
  BROWS.forEach((indices,j)=>indices.forEach((index,i)=>{landmarks[index*3]=cx+w*((j?0.23:-0.23)+(i-2)*.045);landmarks[index*3+1]=cy-h*.10-Math.sin(i/4*Math.PI)*h*.018;}));
  ellipse(MOUTH,cx,cy+h*.27,w*.16,h*.035,Math.PI);
  NOSE.forEach((index,i)=>{landmarks[index*3]=cx;landmarks[index*3+1]=cy-h*.01+i/NOSE.length*h*.20;});
  return {landmarks,timestamp,generation,inferenceMs:0};
}
