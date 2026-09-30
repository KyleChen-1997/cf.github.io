// Deterministic local PBR textures. Shared by all instances; no downloads or canvas dependency.
import * as THREE from 'three';
const cache = new Map();
function hash(x,y) { let n = Math.imul(x,374761393)+Math.imul(y,668265263); n = Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295; }
function noise(x,y) {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),u),THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),u),v);
}
export function surfaceTextures(kind) {
  if(cache.has(kind)) return cache.get(kind);
  const size=256, color=new Uint8Array(size*size*4), height=new Uint8Array(size*size*4), rough=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const index=(y*size+x)*4, grain=hash(x,y), n=noise(x/19,y/17)*.65+noise(x/7,y/9)*.35;
    let rgb=[224,224,224], b=128, r=220;
    if(kind==='camo') {
      rgb=n<.34?[49,56,42]:n<.48?[94,101,73]:n<.62?[137,137,97]:[66,76,55];
      b=110+((x%4===0||y%4===0)?26:0)+grain*16; r=223+grain*24;
    } else if(kind==='fabric') {
      const weave=(x%4===0||y%4===0)?-.08:0;
      rgb=[1,1,1].map(()=>220+weave*255+grain*12);b=112+weave*100+grain*10;r=226;
    } else if(kind==='metal') {
      const scratch=(hash(x,Math.floor(y/22))>.985)?-36:0;
      rgb=[220+grain*18+scratch,220+grain*18+scratch,220+grain*18+scratch];b=128+grain*12+scratch*.3;r=170+noise(x/8,y/48)*65;
    } else if(kind==='wood') {
      const grainLine=Math.sin(y*.32+Math.sin(x*.045)*1.7+noise(x/40,y/14)*7);
      const v=196+grainLine*20+grain*14;rgb=[v+12,v+5,v-8];b=120+grainLine*25;r=225;
    } else if(kind==='paint') {
      const chip=noise(x/3,y/4)>.77, seam=y>244;
      rgb=chip?[103,79,56]:seam?[148,151,151]:[217+n*24,220+n*22,214+n*24];b=chip?90:126+grain*5;r=chip?232:195+grain*35;
    } else {
      rgb=[205+grain*24,205+grain*24,205+grain*24];b=118+grain*22;r=220;
    }
    for(let c=0;c<3;c++) {color[index+c]=rgb[c];height[index+c]=b;rough[index+c]=r;}
    color[index+3]=height[index+3]=rough[index+3]=255;
  }
  const texture=(data,srgb=false)=>{
    const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;
    if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;
  };
  const result={map:texture(color,true),bumpMap:texture(height),roughnessMap:texture(rough)};
  cache.set(kind,result);return result;
}
export function detailMaterial(color,kind='fabric',options={}) {
  return new THREE.MeshStandardMaterial({color,...surfaceTextures(kind),bumpScale:kind==='metal'?.0005:.0015,roughness:1,metalness:kind==='metal'?.55:0,...options});
}
