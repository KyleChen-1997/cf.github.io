// Shared, bounded bevels: silhouettes stay inside the original box dimensions.
import * as THREE from "three";

export function roundedBox(w, h, d, radius = Math.min(w, h, d) * 0.16) {
  const r = Math.min(radius, Math.min(w, h, d) / 2);
  const geometry = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const half = new THREE.Vector3(w / 2, h / 2, d / 2);
  const inner = half.clone().subScalar(r);
  const v = new THREE.Vector3(), core = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Put the inner grid on the bevel boundary, rather than subdividing flat faces.
    v.set(
      Math.sign(v.x) * (Math.abs(v.x) > .49 ? half.x : inner.x),
      Math.sign(v.y) * (Math.abs(v.y) > .49 ? half.y : inner.y),
      Math.sign(v.z) * (Math.abs(v.z) > .49 ? half.z : inner.z)
    );
    core.set(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z)
    );
    normal.subVectors(v, core).normalize();
    v.copy(core).addScaledVector(normal, r);
    p.setXYZ(i, v.x, v.y, v.z);
    n.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// A tapered cloth sleeve with restrained folds, within its original maximum radius.
export function clothLimb(rTop, rBottom, length) {
  const profile = [[0, .90], [.08, 1], [.27, .97], [.48, 1], [.72, .95], [.92, 1], [1, .90]];
  const points = profile.map(([t, fold]) => new THREE.Vector2(
    THREE.MathUtils.lerp(rBottom, rTop, t) * fold, -length + t * length
  ));
  points.unshift(new THREE.Vector2(0, -length));
  points.push(new THREE.Vector2(0, 0));
  return new THREE.LatheGeometry(points, 10);
}

// Smooth low-poly anatomical forms. These are deliberately shared between all
// soldiers so the extra roundness does not create a per-enemy allocation spike.
// Ellipsoids are used for deltoids, joints, hands and facial planes where a box
// makes the silhouette read as a toy/block character.
export function ellipsoid(width, height, depth, segments = 18, rings = 12) {
  return new THREE.SphereGeometry(1, segments, rings).scale(width, height, depth);
}

// A capsule whose top is at y=0 and whose long axis points down local -y. This
// keeps the same joint convention as the rig while giving sleeves/trousers a
// continuous, rounded silhouette.
export function capsuleLimb(radius, length, radialSegments = 14, capSegments = 5) {
  const cylinderLength = Math.max(0.001, length - radius * 2);
  const geometry = new THREE.CapsuleGeometry(radius, cylinderLength, capSegments, radialSegments);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

// Elliptical cross sections produce an anatomical silhouette instead of straight tubes.
// Each ring is [y, halfWidth, halfDepth, centerZ]. Ends are capped for ray hits.
export function contourGeometry(rings, segments=12) {
  const positions=[],uvs=[],indices=[];
  for(let j=0;j<rings.length;j++) {
    const [y,rx,rz,cz=0]=rings[j];
    for(let i=0;i<=segments;i++) {
      const a=i/segments*Math.PI*2;
      positions.push(Math.cos(a)*rx,y,Math.sin(a)*rz+cz);uvs.push(i/segments,j/(rings.length-1));
    }
  }
  for(let j=0;j<rings.length-1;j++) for(let i=0;i<segments;i++) {
    const a=j*(segments+1)+i,b=a+segments+1;
    indices.push(a,b,a+1,b,b+1,a+1);
  }
  for(const [ring,flip] of [[0,false],[rings.length-1,true]]) {
    const [y,,,z=0]=rings[ring],center=positions.length/3;
    positions.push(0,y,z);uvs.push(.5,.5);
    for(let i=0;i<segments;i++) {const a=ring*(segments+1)+i;indices.push(center,flip?a+1:a,flip?a:a+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}
