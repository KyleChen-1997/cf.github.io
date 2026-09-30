import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoldierRig, normalizeRifle } from '../scripts/enemy_model.js';

const host = document.querySelector('#stage');
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222c38);
scene.add(new THREE.HemisphereLight(0xe0edff, 0x67604c, 2.5));
const key = new THREE.DirectionalLight(0xffe4bf, 3.2);
key.position.set(-3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xb9d8ff, 2);
rim.position.set(2, 3, -3); scene.add(rim);
const camera = new THREE.OrthographicCamera(-3, 3, 1.15, -1.15, .01, 50);
camera.position.set(0, .94, 4); camera.lookAt(0, .94, 0);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0x303a44,roughness:1}));
floor.rotation.x = -Math.PI / 2; floor.position.y = -.025; scene.add(floor);
let pose = 'idle', side = false;
const rigs = [];
document.querySelectorAll('[data-pose]').forEach(button => button.onclick = () => {
  pose = button.dataset.pose;
  document.querySelectorAll('[data-pose]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  rigs.forEach(({rig}) => { rig.reset(); rig.phase = 0; rig.breath = 0; });
});
document.querySelector('#angle').onclick = () => { side = !side; };
function resize() {
  const {width,height} = host.getBoundingClientRect();
  renderer.setSize(width,height);
  camera.left=-1.15*width/height; camera.right=-camera.left; camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);resize();
try {
  const rifle = normalizeRifle((await new GLTFLoader().loadAsync('../models/ak47.glb')).scene);
  // Optional local reference generated from origin/main (see README).
  let Before = SoldierRig;
  if (new URLSearchParams(location.search).has('compare')) {
    Before = (await import('./soldier-before.js')).SoldierRig;
  } else document.querySelector('#beforeLabel').textContent = '优化模型 · 正面';
  for (const [i, Rig] of [Before, SoldierRig].entries()) {
    const rig = new Rig(rifle), pivot = new THREE.Group(), body = new THREE.Group(), holder = new THREE.Group();
    holder.position.x = i ? 1.4 : -1.4;
    body.position.y = -1.15;body.add(rig.root);pivot.add(body);holder.add(pivot);scene.add(holder);
    rig.phase = 0;rig.breath = 0;rigs.push({rig,pivot,holder});
  }
  const metrics = rigs.map(({rig}) => {
    let triangles=0;
    rig.meshes.forEach(m => triangles += (m.geometry.index?.count ?? m.geometry.attributes.position.count)/3);
    return `${rig.meshes.length} 网格 / ${triangles} 三角形`;
  });
  document.querySelector('#status').textContent = metrics.join(' → ');
  let previous=performance.now();
  renderer.setAnimationLoop(now => {
    const dt=Math.min((now-previous)/1000,.05);previous=now;
    for (const {rig,pivot,holder} of rigs) {
      rig.animate(dt,{moved:pose==='walk'?dt*2:0,speed:pose==='walk'?2:0,aim:pose==='aim'?1:0,dead:pose==='dead',blind:0,flinch:0});
      const dead=rig.deathBlend;
      pivot.rotation.x = Math.PI/2*dead;
      pivot.position.y=1.15*(1-dead)+.26*dead;
      holder.rotation.y=side?Math.PI/2:-.2;
    }
    renderer.render(scene,camera);
  });
} catch(error) { document.querySelector('#status').textContent = `模型加载失败：${error.message}`; }
