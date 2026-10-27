/** sRGB → Oklab, matching the shader transform. Cache palette entries on the CPU. */
export function rgbToOklab(rgb: readonly number[]): [number,number,number] {
  const [r,g,b]=rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b);
  const m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b);
  const s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  return [0.2104542553*l+0.7936177850*m-0.0040720468*s,
    1.9779984951*l-2.4285922050*m+0.4505937099*s,
    0.0259040371*l+0.7827717662*m-0.8086757660*s];
}
