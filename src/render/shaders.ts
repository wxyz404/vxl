export const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const header = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D uInput;
uniform vec2 uSize;
uniform sampler2D uDepth;
uniform bool uDepthEnabled;
uniform float uDepthMix;
uniform float uDepthFocus;
uniform float uDepthHaze;
uniform float uDepthDesaturation;
uniform float uDepthContrast;
uniform float uDepthDetail;
uniform vec3 uAtmosphere;
uniform int uDepthPreview;
// Depth fields are top-left-origin, unlike intermediate render targets.
float distanceAt(vec2 p) { return uDepthEnabled ? texture(uDepth,vec2(p.x,1.0-p.y)).r : 0.0; }
float recession(vec2 p) { return uDepthEnabled ? smoothstep(uDepthFocus,1.0,distanceAt(p))*uDepthMix : 0.0; }
vec3 atmosphere(vec3 color, vec2 p) {
  float far = recession(p);
  float value = dot(color,vec3(0.2126,0.7152,0.0722));
  color = mix(color,vec3(value),far*uDepthDesaturation);
  color = mix(color,vec3(0.5),far*uDepthContrast*0.65);
  // Converge toward airlight rather than adding white: dark mist and warm haze work too.
  return mix(color,uAtmosphere,far*uDepthHaze);
}
`;

export const sample = header + `
uniform sampler2D uMotion;
uniform sampler2D uPrevious;
uniform sampler2D uPreviousPrepared;
uniform bool uSplit;
uniform bool uReset;
uniform float uStability;
uniform float uOutlineStability;
uniform float uHistoryStep;
uniform float uSimplify[2];
vec3 source(vec2 p) { return texture(uInput,p).rgb; }
float maskAt(vec2 p) { return uSplit ? texture(uInput,p).a : 1.0; }
float lum(vec3 c) { return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main() {
  vec3 center = source(uv);
  vec4 flow=texture(uMotion,uv);
  vec2 historyUV=uv+(round(flow.rg*255.0)-128.0)/uSize;
  vec4 previous = texture(uPrevious, historyUV);
  float valid=uReset?0.0:flow.b;
  float rawMask = maskAt(uv);
  float mask = rawMask;
  if (!uReset && uSplit) {
    float uncertainty=1.0-smoothstep(0.12,0.42,abs(rawMask-0.5));
    float stable=pow(uOutlineStability*0.80,max(uHistoryStep,0.25))*valid*uncertainty;
    // Blend unshifted evidence, not last frame's hysteresis-biased classification.
    // Feeding that bias back into confidence would accumulate mask trails.
    mask = mix(rawMask, texture(uPreviousPrepared,historyUV).a, stable);
    // Schmitt thresholds hold uncertain classification, but confident new masks win.
    float threshold=0.5+(previous.a>=0.5?-1.0:1.0)*0.08*uOutlineStability*valid*uncertainty;
    mask=clamp(mask+0.5-threshold,0.0,1.0);
  }
  int region = mask >= 0.5 ? 0 : 1;
  float detail = recession(uv)*uDepthDetail;
  float simplify = mix(uSimplify[region],1.0,detail);
  vec3 sum = vec3(0.0);
  float weightSum = 0.0;
  vec3 darkest = center;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if ((abs(x)>1 || abs(y)>1) && detail<0.01) continue;
    vec2 p = clamp(uv + vec2(x,y) / uSize * (0.34+detail*0.85), vec2(0.0), vec2(1.0));
    vec3 color = source(p);
    float m = maskAt(p);
    float sameRegion = uSplit ? (region == 0 ? m : 1.0-m) : 1.0;
    float weight = exp(-dot(color-center,color-center) * mix(65.0,12.0,simplify)) * sameRegion;
    // Broad clusters must not pull distant colors across a near silhouette.
    weight *= 1.0-smoothstep(0.04,0.14,abs(distanceAt(p)-distanceAt(uv))*uDepthMix);
    if (x == 0 && y == 0) weight += 0.05;
    sum += color * weight; weightSum += weight;
    if (sameRegion > 0.8 && lum(color) < lum(darkest)) darkest = color;
  }
  vec3 color = mix(center, sum/max(weightSum,0.001), 0.45 + simplify*0.55);
  float edge = smoothstep(0.08,0.25,lum(color)-lum(darkest));
  color = mix(color, darkest, edge * 0.16 * (1.0-simplify));
  float agreement=1.0-smoothstep(0.03,0.16,length(center-previous.rgb));
  color = mix(color, previous.rgb, pow(uStability*0.32,max(uHistoryStep,0.25))*valid*agreement);
  // Keep history in source color space; contrast is applied by the palette pass.
  outColor = vec4(clamp(color,0.0,1.0), mask);
}`;

const paletteFunctions = `
uniform vec3 uPalette[64];
uniform vec3 uPaletteLab[64];
uniform int uCounts[2];
vec3 lab(vec3 c) {
  c = mix(c/12.92, pow((c+0.055)/1.055,vec3(2.4)), step(vec3(0.04045),c));
  vec3 lms = mat3(0.4122214708,0.2119034982,0.0883024619,
                  0.5363325363,0.6806995451,0.2817188376,
                  0.0514459929,0.1073969566,0.6299787005) * c;
  lms = pow(max(lms,vec3(0.0)),vec3(1.0/3.0));
  return mat3(0.2104542553,1.9779984951,0.0259040371,
              0.7936177850,-2.4285922050,0.7827717662,
              -0.0040720468,0.4505937099,-0.8086757660) * lms;
}
float distanceColor(vec3 a, vec3 b) { vec3 d = lab(a)-lab(b); return dot(d,d); }
vec3 nearest(vec3 color, int region) {
  float best = 1e5; vec3 result = uPalette[region*32]; vec3 target = lab(color);
  for (int i=0;i<32;i++) {
    if (i>=uCounts[region]) break;
    vec3 entry = uPalette[region*32+i]; vec3 delta = uPaletteLab[region*32+i]-target;
    float d = dot(delta,delta);
    if (d<best) { best=d; result=entry; }
  }
  return result;
}
vec3 outlineColor(vec3 source,int region) {
  vec3 target=lab(source*0.48);
  float limit=lab(source).x-0.10,best=1e5,darkest=2.0;
  vec3 result=uPalette[region*32],fallback=result;
  for(int i=0;i<32;i++) {
    if(i>=uCounts[region]) break;
    vec3 entry=uPalette[region*32+i],perceptual=uPaletteLab[region*32+i];
    if(perceptual.x<darkest) { darkest=perceptual.x;fallback=entry; }
    vec3 delta=perceptual-target;float d=dot(delta,delta);
    if(perceptual.x<=limit&&d<best) { best=d;result=entry; }
  }
  return best<1e5?result:fallback;
}
`;

export const quantize = header + paletteFunctions + `
uniform sampler2D uPrevious;
uniform sampler2D uMotion;
uniform bool uReset;
uniform float uStability;
uniform float uContrast[2];
uniform float uSaturation[2];
void main() {
  vec4 value = texture(uInput,uv);
  int region = value.a >= 0.5 ? 0 : 1;
  vec3 color = clamp((value.rgb-0.5)*uContrast[region]+0.5,0.0,1.0);
  float l = dot(color,vec3(0.2126,0.7152,0.0722));
  color = clamp(mix(vec3(l),color,uSaturation[region]),0.0,1.0);
  color = atmosphere(color,uv);
  vec3 best = nearest(color,region);
  vec4 flow=texture(uMotion,uv);
  vec4 old = texture(uPrevious,uv+(round(flow.rg*255.0)-128.0)/uSize);
  if (!uReset && flow.b>0.4 && (old.a>=0.5)==(value.a>=0.5)) {
    vec3 previousColor = nearest(old.rgb,region);
    if (distanceColor(color,previousColor) < distanceColor(color,best) + uStability*0.00065) best=previousColor;
  }
  outColor=vec4(best,value.a);
}`;

export const clusters = header + `
uniform sampler2D uSource;
uniform float uStrength[2];
uniform bool uDepthCleanupOnly;
void main() {
  vec4 center = texture(uInput,uv);
  if (uDepthCleanupOnly && recession(uv)*uDepthDetail<0.1) { outColor=center; return; }
  int region = center.a>=0.5 ? 0 : 1;
  vec3 chosen = center.rgb;
  int best = 0;
  float contrast = 0.0;
  bool boundary = false;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    vec2 p=uv+vec2(x,y)/uSize;
    vec4 candidate=texture(uInput,p);
    boundary = boundary || ((candidate.a>=0.5)!=(center.a>=0.5)) || abs(distanceAt(p)-distanceAt(uv))*uDepthMix>0.12;
    contrast = max(contrast,length(texture(uSource,p).rgb-texture(uSource,uv).rgb));
    int count=0;
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
      vec4 other=texture(uInput,uv+vec2(i,j)/uSize);
      if ((other.a>=0.5)==(center.a>=0.5) && length(other.rgb-candidate.rgb)<0.004) count++;
    }
    if (count>best) { best=count; chosen=candidate.rgb; }
  }
  float strength=mix(uStrength[region],1.0,recession(uv)*uDepthDetail);
  int required = strength>0.65 ? 4 : 6;
  if (strength<0.01 || boundary || contrast>mix(0.10,0.35,strength) || best<required) chosen=center.rgb;
  outColor=vec4(chosen,center.a);
}`;

export const patterns = header + paletteFunctions + `
uniform sampler2D uSource;
uniform float uDither[2];
uniform int uTexture[2];
uniform float uTextureStrength[2];
uniform float uContrast[2];
uniform float uSaturation[2];
float bayer(ivec2 p) {
  int values[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(values[(p.y%4)*4+p.x%4])+0.5)/16.0-0.5;
}
void main() {
  vec4 c=texture(uInput,uv); int region=c.a>=0.5?0:1;
  vec3 raw=texture(uSource,uv).rgb;
  raw=clamp((raw-0.5)*uContrast[region]+0.5,0.0,1.0);
  float l=dot(raw,vec3(0.2126,0.7152,0.0722));
  raw=clamp(mix(vec3(l),raw,uSaturation[region]),0.0,1.0);
  raw=atmosphere(raw,uv);
  float quiet=1.0-recession(uv)*uDepthDetail;
  bool boundary=false; float gradient=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec4 neighbor=texture(uInput,uv+vec2(x,y)/uSize);
    boundary=boundary||((neighbor.a>=0.5)!=(c.a>=0.5));
    gradient=max(gradient,length(texture(uSource,uv+vec2(x,y)/uSize).rgb-texture(uSource,uv).rgb));
  }
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec3 result=c.rgb;
  if(!boundary && gradient<0.17) {
    if(uDither[region]>0.0) {
      // Dither around the unquantized signal to reveal intermediate shading.
      vec3 patterned=nearest(clamp(raw+bayer(p)*uDither[region]*quiet*0.32,0.0,1.0),region);
      if(distanceColor(raw,patterned)<distanceColor(raw,c.rgb)+0.014*uDither[region]) result=patterned;
    }
    float mark=0.0;
    if(uTexture[region]==1) mark=(p.x%4==1&&p.y%4==1)?1.0:0.0;
    if(uTexture[region]==2) mark=((p.x+p.y)%5==0)?1.0:0.0;
    if(l>0.12&&l<0.77&&mark>0.5) result=nearest(clamp(result-vec3(uTextureStrength[region]*quiet*0.2),0.0,1.0),region);
  }
  outColor=vec4(result,c.a);
}`;

export const finish = header + paletteFunctions + `
uniform sampler2D uSource;
uniform sampler2D uContours;
uniform sampler2D uGeometry;
uniform int uOutline[2];
uniform int uWidth[2];
uniform int uAA[2];
void main() {
  vec4 c=texture(uInput,uv); int region=c.a>=0.5?0:1;
  vec4 stroke=texture(uContours,uv);
  bool interior=stroke.b>0.5;
  if(uWidth[region]==2) {
    // Grow only along the positive dominant normal, so 2 px means two, not three.
    vec2 left=uv-vec2(1,0)/uSize,below=uv-vec2(0,1)/uSize;
    vec2 nx=texture(uGeometry,left).ba*2.0-1.0,ny=texture(uGeometry,below).ba*2.0-1.0;
    bool sameX=(texture(uSource,left).a>=0.5)==(c.a>=0.5);
    bool sameY=(texture(uSource,below).a>=0.5)==(c.a>=0.5);
    interior=interior||(sameX&&texture(uContours,left).b>0.5&&abs(nx.x)>=abs(nx.y))||
      (sameY&&texture(uContours,below).b>0.5&&abs(ny.y)>abs(ny.x));
  }
  vec3 outputColor=c.rgb;
  int mode=uOutline[region];
  if(mode>0 && (stroke.a>0.5||interior)) {
    // Outline color comes from the stable source, never from dither or texture pixels.
    outputColor=mode==1?nearest(vec3(0.0),region):outlineColor(texture(uSource,uv).rgb,region);
    outputColor=nearest(atmosphere(outputColor,uv),region);
    // Keep silhouettes readable while reducing far-away interior line emphasis.
    outputColor=nearest(mix(outputColor,c.rgb,recession(uv)*uDepthDetail*(stroke.a>0.5?0.30:0.85)),region);
    if(uAA[region]==1) outputColor=nearest(mix(c.rgb,outputColor,0.80),region);
  } else if(uAA[region]==1) {
    // Palette-constrained smoothing of diagonal color transitions only.
    vec3 a=texture(uInput,uv+vec2(1,0)/uSize).rgb;
    vec3 b=texture(uInput,uv+vec2(0,1)/uSize).rgb;
    bool sameRegion=(texture(uInput,uv+vec2(1,0)/uSize).a>=0.5)==(c.a>=0.5)&&
      (texture(uInput,uv+vec2(0,1)/uSize).a>=0.5)==(c.a>=0.5);
    if(sameRegion&&length(a-b)<0.01 && length(a-c.rgb)>0.1) outputColor=nearest(mix(c.rgb,a,0.25),region);
  }
  outColor=vec4(outputColor,1.0);
}`;

export const display = header + `
void main() {
  vec3 color=texture(uInput,uv).rgb;
  if(uDepthEnabled && uDepthPreview>0) {
    float d=distanceAt(uv);
    color=uDepthPreview==1 ? vec3(d) : d<1.0/3.0 ? vec3(0.22,0.78,0.65) : d<2.0/3.0 ? vec3(0.91,0.68,0.29) : vec3(0.40,0.57,0.86);
  }
  outColor=vec4(color,1.0);
}
`;
