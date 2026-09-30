// Run with: node tools/check-models.mjs (no npm packages required).
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const threeURL = new URL('../vendor/three/build/three.module.js', import.meta.url).href;
const THREE = await import(threeURL);
async function load(relative, extra = {}) {
  let source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const imports = { three: threeURL, ...extra };
  source = source.replace(/from (["'])([^"']+)\1/g, (match, quote, name) =>
    imports[name] ? `from ${JSON.stringify(imports[name])}` : match);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const geometryURL = await load('../scripts/model_geometry.js');
const surfaceURL = await load('../scripts/surface_materials.js');
const utilsURL = await load('../vendor/three/examples/jsm/utils/BufferGeometryUtils.js');
const { roundedBox } = await import(geometryURL);
const { SoldierRig } = await import(await load('../scripts/enemy_model.js', {
  './model_geometry.js': geometryURL,
  'three/addons/utils/BufferGeometryUtils.js': utilsURL,
  './surface_materials.js': surfaceURL,
}));
const geometry = roundedBox(.4,.3,.22);
const size = geometry.boundingBox.getSize(new THREE.Vector3());
assert.ok(size.distanceTo(new THREE.Vector3(.4,.3,.22)) < 1e-6, 'bevel must preserve dimensions');
const rig = new SoldierRig(), another = new SoldierRig();
assert.equal(rig.meshes[0].geometry, another.meshes[0].geometry, 'geometry must be shared');
assert.notEqual(rig.matGear, another.matGear, 'hit flashes must remain independent');
const holder = new THREE.Group(), body = new THREE.Group();
holder.add(body); body.position.y=-1.15;body.add(rig.root);
const point = new THREE.Vector3();
let lowestCorpse = Infinity, maxGripError = 0;
for (const pose of ['idle','walk','aim','blind','dead']) {
  rig.reset();rig.phase=0;rig.breath=0;
  for (let frame=0;frame<240;frame++) {
    rig.animate(1/60,{moved:pose==='walk'?2/60:0,speed:pose==='walk'?2:0,aim:pose==='aim'?1:0,blind:pose==='blind'?1:0,dead:pose==='dead',flinch:0});
    holder.position.y=1.15*(1-rig.deathBlend)+.26*rig.deathBlend;
    holder.rotation.x=Math.PI/2*rig.deathBlend;
    holder.updateMatrixWorld(true);
    rig.root.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${pose}: invalid transform`));
    if (['idle','walk','aim'].includes(pose)) {
      for (const [arm,target] of [[rig.armR,[0,-.10,-.19]],[rig.armL,[0,-.04,.10]]]) {
        const expected=rig.mount.localToWorld(new THREE.Vector3(...target));
        const actual=arm.hd.getWorldPosition(new THREE.Vector3());
        maxGripError=Math.max(maxGripError,expected.distanceTo(actual));
      }
    }
    if(pose==='dead' && frame===239) for(const mesh of rig.meshes) {
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++) {
        point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
        lowestCorpse=Math.min(lowestCorpse,point.y);
      }
    }
  }
}
assert.ok(maxGripError < .005, `hands detached: ${maxGripError}`);
assert.ok(lowestCorpse > -.015, `corpse intersects deck: ${lowestCorpse}`);
for(const mesh of rig.meshes) {
  for(const name of ['position','normal']) assert.ok(Array.from(mesh.geometry.attributes[name].array).every(Number.isFinite));
}
rig.setFlash(1);
assert.equal(another.matGear.emissive.r,0);
rig.setFlash(0);
const triangles=rig.meshes.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
assert.ok(triangles < 18000, 'soldier geometry budget exceeded');
console.log(JSON.stringify({poses:5,frames:1200,meshes:rig.meshes.length,triangles,maxGripError,lowestCorpse},null,2));

const { ViewArms, ARM_ANCHORS } = await import(await load('../scripts/viewarms.js', {
  './model_geometry.js': geometryURL,
  './surface_materials.js': surfaceURL,
}));
const arms = new ViewArms();
for (const weapon of Object.keys(ARM_ANCHORS)) {
  const group = new THREE.Group();
  arms.attach(group,weapon);
  for (let step=0;step<=20;step++) {
    arms.update(true,step/20,new THREE.Matrix4());
    group.updateMatrixWorld(true);
    group.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${weapon}: invalid hand transform`));
  }
  arms.update(false,0,new THREE.Matrix4());
  assert.equal(arms.magL.visible,false);
}
console.log('Hand geometry: 8 weapons × 21 reload poses passed.');
