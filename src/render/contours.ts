// Contours are separate from palette/dither output: patterns must never create edges.
const header = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D uInput;
uniform vec2 uSize;
`;

export const prepare = header + `
uniform sampler2D uMask;
uniform bool uSplit;
uniform float uContourSmoothing;
vec3 rgb(vec2 p) { return texture(uInput, vec2(p.x,1.0-p.y)).rgb; }
float mask(vec2 p) { return texture(uMask,vec2(p.x,1.0-p.y)).r; }
void main() {
  vec3 center=rgb(uv), color=vec3(0.0); float weight=0.0;
  // A small bilateral footprint suppresses camera grain without washing across edges.
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec3 value=rgb(uv+vec2(x,y)*0.35/uSize);
    float w=float((x==0?2:1)*(y==0?2:1))*exp(-dot(value-center,value-center)*45.0);
    color+=value*w; weight+=w;
  }
  float alpha=1.0;
  if(uSplit) {
    float sum=0.0;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
      sum+=mask(uv+vec2(x,y)/uSize)*float((x==0?2:1)*(y==0?2:1));
    }
    alpha=mix(mask(uv),sum/16.0,uContourSmoothing);
  }
  outColor=vec4(color/max(weight,0.001),alpha);
}`;

export const motion = header + `
uniform sampler2D uPrevious;
uniform bool uReset;
uniform bool uSplit;
uniform float uStability;
uniform float uOutlineStability;
float cost(vec2 p,vec2 offset) {
  float result=0.0;
  for(int i=0;i<5;i++) {
    vec2 tap=i==0?vec2(0):i==1?vec2(-2,0):i==2?vec2(2,0):i==3?vec2(0,-2):vec2(0,2);
    vec4 a=texture(uInput,p+tap/uSize);
    vec4 b=texture(uPrevious,p+(tap+offset)/uSize);
    result+=dot(abs(a.rgb-b.rgb),vec3(0.333333));
    if(uSplit) result+=abs(a.a-b.a)*0.30;
  }
  return result/5.0;
}
void main() {
  if(uReset||max(uStability,uOutlineStability)==0.0) { outColor=vec4(vec2(128.0/255.0),0,1); return; }
  // A quarter-resolution, coarse-to-fine block search. Offsets point into history.
  vec2 bestOffset=vec2(0); float best=cost(uv,vec2(0));
  if(best<0.004) { outColor=vec4(vec2(128.0/255.0),1,1);return; }
  for(int y=-6;y<=6;y+=2) for(int x=-6;x<=6;x+=2) {
    vec2 d=vec2(x,y); float score=cost(uv,d)+length(d)*0.0005;
    if(score<best) { best=score; bestOffset=d; }
  }
  vec2 coarse=bestOffset;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 d=coarse+vec2(x,y); float score=cost(uv,d)+length(d)*0.0005;
    if(score<best) { best=score; bestOffset=d; }
  }
  vec2 historyUV=uv+bestOffset/uSize;
  float valid=step(0.0,historyUV.x)*step(historyUV.x,1.0)*step(0.0,historyUV.y)*step(historyUV.y,1.0);
  float confidence=(1.0-smoothstep(0.025,0.11,best))*valid;
  // Integer offset packing avoids a nonzero bias accumulating in flat stationary areas.
  outColor=vec4((bestOffset+128.0)/255.0,confidence,1.0);
}`;

export const geometry = header + `
uniform int uOutline[2];
uniform int uWidth[2];
uniform float uContourSmoothing;
uniform bool uSplit;
uniform vec2 uLight;
float luma(vec3 c) { return dot(c,vec3(0.2126,0.7152,0.0722)); }
void main() {
  vec4 center=texture(uInput,uv); bool person=center.a>=0.5;
  int region=person?0:1;
  float distance=10.0;
  vec2 maskGradient=vec2(0),wideMaskGradient=vec2(0);
  vec3 colorX=vec3(0),colorY=vec3(0),wideX=vec3(0),wideY=vec3(0),across=vec3(0); float acrossWeight=0.0;
  for(int y=-3;y<=3;y++) for(int x=-3;x<=3;x++) {
    if(x==0&&y==0) continue;
    if(!uSplit&&(abs(x)>2||abs(y)>2)) continue;
    vec4 n=texture(uInput,uv+vec2(x,y)/uSize);
    if(uSplit&&(n.a>=0.5)!=person) {
      float d=length(vec2(x,y)); distance=min(distance,d-0.5);
      float w=1.0/(d*d); across+=n.rgb*w; acrossWeight+=w;
    }
    if(abs(x)<=1&&abs(y)<=1) {
      float wx=float(x*(y==0?2:1)),wy=float(y*(x==0?2:1));
      maskGradient+=vec2(wx,wy)*n.a;
      colorX+=n.rgb*wx; colorY+=n.rgb*wy;
    }
    if(abs(x)<=2&&abs(y)<=2) {
      float dx=x==0?0.0:float(x>0?1:-1)*float(abs(x)==1?2:1);
      float dy=y==0?0.0:float(y>0?1:-1)*float(abs(y)==1?2:1);
      float gx=x==0?6.0:abs(x)==1?4.0:1.0,gy=y==0?6.0:abs(y)==1?4.0:1.0;
      wideX+=n.rgb*dx*gy;wideY+=n.rgb*dy*gx;
      wideMaskGradient+=vec2(dx*gy,dy*gx)*n.a;
    }
  }
  // One owner, one side. Enabling both region styles never doubles the silhouette.
  bool owner=person ? uOutline[0]>0 : uOutline[0]==0&&uOutline[1]>0;
  float selection=1.0;
  if(uOutline[region]==3) {
    vec2 normal=(person?-1.0:1.0)*mix(maskGradient/8.0,wideMaskGradient/96.0,uContourSmoothing);
    float facing=dot(normal/max(length(normal),0.0001),uLight);
    selection=1.0-smoothstep(-0.20,0.65,facing);
    float contrast=acrossWeight>0.0?abs(luma(center.rgb)-luma(across/acrossWeight)):0.0;
    // Ease omissions over a range instead of toggling at a quantized palette color.
    selection*=1.0-smoothstep(0.55,0.85,contrast);
  }
  bool band=owner&&distance<float(uWidth[region]);
  float silhouette=band?0.1+0.9*selection:0.0;
  // The wider derivative uses samples already fetched for the distance band.
  // Smoothing therefore also controls whole-frame interior edges, without a blur pass.
  vec3 derivativeX=mix(colorX/8.0,wideX/96.0,uContourSmoothing);
  vec3 derivativeY=mix(colorY/8.0,wideY/96.0,uContourSmoothing);
  vec2 gradient=vec2(luma(derivativeX),luma(derivativeY));
  // Keep chromatic edges even if their two colors have similar luminance.
  for(int c=0;c<3;c++) {
    vec2 candidate=vec2(derivativeX[c],derivativeY[c])*0.666667;
    if(length(candidate)>length(gradient)) gradient=candidate;
  }
  float magnitude=clamp(length(gradient)*2.0,0.0,1.0);
  bool nearSilhouette=(uOutline[0]>0||uOutline[1]>0)&&distance<float(max(uWidth[0],uWidth[1])+1);
  if(nearSilhouette) magnitude=0.0;
  vec2 direction=gradient/max(length(gradient),0.0001);
  outColor=vec4(silhouette,magnitude,direction*0.5+0.5);
}`;

export const stabilize = header + `
uniform sampler2D uMotion;
uniform sampler2D uPrevious;
uniform sampler2D uSource;
uniform sampler2D uPreviousSource;
uniform bool uReset;
uniform float uOutlineStability;
uniform float uHistoryStep;
uniform float uInternal[2];
uniform int uOutline[2];
void main() {
  vec4 edge=texture(uInput,uv), flow=texture(uMotion,uv);
  vec2 historyUV=uv+(round(flow.rg*255.0)-128.0)/uSize;
  vec4 previous=texture(uPrevious,historyUV);
  float region=texture(uSource,uv).a>=0.5?0.0:1.0;
  float oldRegion=texture(uPreviousSource,historyUV).a>=0.5?0.0:1.0;
  float valid=uReset||region!=oldRegion?0.0:flow.b;
  float weight=pow(uOutlineStability*0.70,max(uHistoryStep,0.25))*valid;
  bool band=edge.r>0.0;
  float strength=band?(edge.r-0.1)/0.9:0.0;
  // A matching object region is not necessarily a matching boundary. Do not borrow
  // a zero from an old object's interior and erase a newly exposed silhouette.
  bool priorBand=previous.r>0.0;
  float oldStrength=max(0.0,(previous.r-0.1)/0.9);
  float smoothed=band?mix(strength,oldStrength,priorBand?weight:0.0):0.0;
  float threshold=valid>0.4&&priorBand?(previous.a>0.5?0.40:0.60):0.5;
  float silhouette=band?step(threshold,smoothed):0.0;
  vec2 direction=edge.ba*2.0-1.0;
  // Directional nonmaximum suppression gives a consistent single-pixel interior line.
  float forward=texture(uInput,uv+direction/uSize).g;
  float backward=texture(uInput,uv-direction/uSize).g;
  bool peak=edge.g>forward+0.001&&edge.g>=backward-0.001;
  int index=int(region);
  float strong=mix(0.45,0.07,uInternal[index]);
  float weak=strong*0.65;
  float nearby=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) nearby=max(nearby,texture(uInput,uv+vec2(x,y)/uSize).g);
  float stableMagnitude=mix(edge.g,previous.g,weight*0.5);
  bool linked=valid>0.4&&previous.b>0.5;
  bool connected=nearby>strong*1.05;
  bool internal=uOutline[index]>0&&uInternal[index]>0.0&&peak&&edge.g>weak&&
    (stableMagnitude>=strong||((linked||connected)&&stableMagnitude>weak));
  // Never retain a line outside the current edge/band: history cannot create a trail.
  outColor=vec4(band?0.1+0.9*smoothed:0.0,stableMagnitude,internal?1.0:0.0,silhouette);
}`;
