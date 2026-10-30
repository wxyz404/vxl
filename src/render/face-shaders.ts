import { header, paletteFunctions } from './shaders';

// Face maps use the same bottom-left convention as intermediate render targets.
export const faceAlign = header + `
uniform sampler2D uFlow;
void main() {
  vec4 flow=texture(uFlow,uv);
  vec2 p=uv+(round(flow.rg*255.0)-128.0)/uSize;
  if(flow.b<0.4||any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1)))) {outColor=vec4(0,0,128.0/255.0,128.0/255.0);return;}
  outColor=texture(uInput,p);
}`;

export const faceSample = header + `
uniform sampler2D uFace;
uniform float uFaceEmphasis;
uniform int uFaceTreatment;
uniform bool uFaceWarp;
vec3 source(vec2 p) {return texture(uInput,vec2(p.x,1.0-p.y)).rgb;}
float luma(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
void main(){
  vec4 field=texture(uFace,uv);
  vec2 offset=(round(field.ba*255.0)-128.0)/16.0/uSize;
  // Displacement was authored in top-left pixels.
  vec2 p=uv+(uFaceWarp?vec2(offset.x,-offset.y):vec2(0));
  vec3 center=source(p),sum=vec3(0);float total=0.0;
  float feature=field.g;
  float radius=mix(uFaceTreatment==1?1.25:0.85,0.22,feature);
  float low=1.0,high=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 q=p+vec2(x,y)*radius/uSize;
    vec3 c=source(q);float weight=exp(-dot(c-center,c-center)*45.0);
    // Do not smooth neighboring material into the face boundary.
    weight*=texture(uFace,uv+vec2(x,y)*radius/uSize).r;
    if(x==0&&y==0)weight+=0.01;
    sum+=c*weight;total+=weight;low=min(low,luma(c));high=max(high,luma(c));
  }
  vec3 color=sum/max(total,0.001);
  // Dark/light feature evidence comes from the image, never an authored eye stamp.
  float light=luma(color),span=high-low;
  float contrast=(uFaceTreatment==1?0.65:0.35)*uFaceEmphasis*feature*smoothstep(0.025,0.12,span);
  float target=clamp((light-(low+high)*0.5)*(1.0+contrast)+(low+high)*0.5,0.0,1.0);
  color+=vec3(target-light);
  outColor=vec4(clamp(color,0.0,1.0),field.g);
}`;

export const faceQuantize = header + paletteFunctions + `
uniform sampler2D uFace;
uniform sampler2D uRegions;
uniform sampler2D uPreviousFace;
uniform sampler2D uFlow;
uniform bool uFaceHistory;
uniform int uFaceTreatment;
void main(){
  vec4 raw=texture(uInput,uv);int region=texture(uRegions,uv).a>=0.5?0:1;
  vec3 color=styledColor(raw.rgb,region);
  vec3 perceptual=lab(color);
  float bands=uFaceTreatment==1?3.0:4.0;
  float banded=floor(perceptual.x*bands+0.5)/bands;
  // Features retain continuous tone; broad surfaces receive the posterized shading.
  perceptual.x=mix(perceptual.x,banded,(uFaceTreatment==1?0.7:0.45)*(1.0-raw.a));
  color=mappedRgb(perceptual);
  vec3 chosen=nearest(color,region);
  vec4 flow=texture(uFlow,uv);
  vec2 p=uv+(round(flow.rg*255.0)-128.0)/uSize;
  vec4 old=texture(uPreviousFace,p);
  // Palette hysteresis only; never blend an old expression into the current source.
  if(uFaceHistory&&flow.b>0.4&&old.a>0.5){
    vec3 prior=nearest(old.rgb,region);
    if(distanceColor(color,prior)<distanceColor(color,chosen)+0.00035)chosen=prior;
  }
  outColor=vec4(chosen,texture(uFace,uv).r);
}`;

export const faceComposite = header + paletteFunctions + `
uniform sampler2D uFace;
uniform sampler2D uArt;
uniform sampler2D uRegions;
uniform float uFaceStrength;
void main(){
  vec4 field=texture(uFace,uv);vec3 baseline=texture(uInput,uv).rgb;
  float coverage=field.r*uFaceStrength;
  if(coverage<=0.0){outColor=vec4(baseline,1);return;}
  int region=texture(uRegions,uv).a>=0.5?0:1;
  vec3 candidate=texture(uArt,uv).rgb;
  // Small orphan removal on surfaces only. Feature pixels remain protected.
  if(field.g<0.15){
    vec3 best=candidate;int countBest=0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 p=uv+vec2(x,y)/uSize;vec4 neighbor=texture(uFace,p);
      if(neighbor.r<0.9||neighbor.g>0.15||(texture(uRegions,p).a>=0.5)!=(region==0))continue;
      vec3 c=texture(uArt,p).rgb;int count=0;
      for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
        vec2 q=uv+vec2(i,j)/uSize;
        if(texture(uFace,q).r>0.9&&length(texture(uArt,q).rgb-c)<0.004)count++;
      }
      if(count>countBest){countBest=count;best=c;}
    }
    if(countBest>=6)candidate=best;
  }
  outColor=vec4(nearest(mix(baseline,candidate,coverage),region),1);
}`;
