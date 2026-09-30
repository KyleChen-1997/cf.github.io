// ===== 程序化士兵模型：自建关节骨架 + 程序化动画 =====
//
// 为什么弃用 models/soldier.glb：那个模型是**单网格静态姿势、没有骨骼也没有动画**
// （19 个 primitive 全是装备件，双臂垂在身侧），于是敌人只能整体平移，
// 枪只能作为刚体飘在胸前 —— 「自然」这件事在几何层面就做不到。
// 这里用基础几何自建一套带关节的骨架，走位/瞄准/开火/受击/倒地全部程序化驱动。
//
// 坐标系约定（与 enemies.js 一致）：**+z 是正面**、+y 是上、脚底在 y=0。
// 于是「朝右」是 -x（右手 = 扣扳机那只手在 -x 侧）。
//
// 旋转正负号（这套骨架里到处都要用，先记牢）：
//   朝上的骨（脊椎/颈）：rotation.x > 0 → 上端往 +z 倒 = **前倾**
//   朝下的骨（四肢）：  rotation.x > 0 → 末端往 -z 摆 = **向后摆**
// 所以「腿往前抬」是负的 rotation.x，「上身前倾」是正的 rotation.x。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { roundedBox, contourGeometry, ellipsoid } from "./model_geometry.js";
import { detailMaterial } from "./surface_materials.js";

// ---------- 骨架尺寸（身高 ≈ 1.82，保持原骨架尺寸；射线命中仍使用实际可见网格）----------
// 骨盆静止高度：必须让「髋(0.95-0.04) → 踝(0.10)」的距离接近腿长(0.82)，否则站立时
// 膝盖会一直弯着 40° 以上 —— 站着也像半蹲（实测 PELVIS_Y=0.90 时膝角 44°）。
// 0.95 时跨度 0.81 ≈ 98.8% 腿长，膝角自然回到 ~18°，身高 1.82 与旧 GLB 同量级。
const PELVIS_Y = 0.95;   // 骨盆静止高度
const HIP_DY = -0.04;    // 髋关节相对骨盆原点
const HIP_X = 0.10;
const THIGH = 0.42;
const SHIN = 0.40;
const ANKLE_Y = 0.10;    // 踝关节离地高度（脚掌厚度 + 一点间隙，免得脚掌切进甲板）
const SPINE_Y = 0.06;    // 骨盆 → 脊椎
const CHEST_Y = 0.28;    // 脊椎 → 胸腔中心
const SHOULDER_X = 0.20;
const SHOULDER_Y = 0.22; // 肩相对胸腔中心 → 离地 1.46
const NECK_Y = 0.50;     // 脊椎 → 颈
// 上臂/前臂：真人 1.8m 的肩→肘 ≈0.32、肘→腕 ≈0.29（臂展 0.61）。
// **这两个值不是纯造型参数，而是 IK 的硬约束**：支撑手要按在护木上，
// 0.58 的臂展配「枪心在胸前三四十厘米」会让左臂被拉成一条直线（见 HANDGUARD 注释）。
const UPPER = 0.32;      // 上臂
const FORE = 0.29;       // 前臂
const LEG_REACH = THIGH + SHIN;

// ---------- 配色（CF 潜伏者：深橄榄制服 + 黑战术装具 + 红队标）----------
const C = {
  cloth: 0xffffff, cloth2: 0xe0d9b8, gear: 0x8c8061, pouch: 0xafa181,
  glove: 0x4c483c, boot: 0x494337, skin: 0xad8660, mask: 0x30352e,
  lens: 0x17333a, team: 0xa8342f,
};

let GEO = null;
function geo() {
  if (GEO) return GEO;
  const box = (w,h,d,x=0,y=0,z=0,r) => roundedBox(w,h,d,r).translate(x,y,z);
  const oval = (w,h,d,x=0,y=0,z=0) => new THREE.SphereGeometry(1,18,12).scale(w,h,d).translate(x,y,z);
  const combine = (...parts) => {const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());return g;};
  const limb=(length,profile)=>contourGeometry(profile.map(([t,w,d,z=0])=>[-length*t,w,d,z]),16);
  // Crown, flared rim and lowered rear skirt; front remains open for the visor.
  const helmet=contourGeometry([[.045,.123,.133,-.007],[.082,.124,.134,-.008],[.135,.108,.118,-.014],[.177,.07,.077,-.014],[.192,.018,.023,-.012]],16);
  const plate=contourGeometry([[-.15,.12,.105],[-.11,.154,.12],[.02,.172,.132],[.11,.158,.12],[.18,.115,.098]],16);
  const mags=[],flaps=[],straps=[],molle=[];
  for(const x of [-.09,0,.09]) {
    mags.push(box(.078,.128,.058,x,-.073,.146));
    flaps.push(box(.075,.039,.009,x,-.025,.179));
    molle.push(box(.017,.105,.009,x,-.073,.18));
  }
  for(const x of [-.137,.137]) {
    straps.push(box(.049,.145,.038,x,.167,.068));
    straps.push(box(.027,.045,.014,x,.115,.126));
  }
  for(const y of [.012,.047,.082]) molle.push(box(.245,.014,.009,0,y,.128));
  // Boots have ankle collars, insteps, extended toes and separate rubber soles.
  const boot=combine(
    contourGeometry([[-.068,.065,.135,.046],[-.024,.067,.132,.046],[.023,.064,.100,.019],[.094,.055,.058,0],[.12,.05,.052,0]],16),
    ellipsoid(.051,.034,.055,16,10).translate(0,.035,.033));
  // A bare human base under the tactical shell keeps the head, neck, shoulders
  // and hands from reading as disconnected primitives. Gear still covers the
  // high-contact areas, but the anatomical forms supply the silhouette between
  // those layers.
  const face = ellipsoid(.101,.13,.086,20,14).translate(0,-.005,.018);
  const jaw = ellipsoid(.082,.064,.074,18,12).translate(0,-.083,.034);
  const nose = ellipsoid(.019,.032,.021,14,10).translate(0,-.005,.098);
  const ears = combine(
    ellipsoid(.024,.043,.022,14,10).translate(-.102,-.015,.008),
    ellipsoid(.024,.043,.022,14,10).translate(.102,-.015,.008)
  );
  const neckSkin = contourGeometry([[-.09,.063,.059],[-.04,.076,.067],[.05,.078,.069],[.13,.058,.059]],16);
  const shoulderCap = ellipsoid(.092,.087,.085,18,12);
  const palm = ellipsoid(.052,.064,.046,16,11).translate(0,-.034,.002);
  const thumb = ellipsoid(.024,.042,.025,14,10).translate(-.035,-.025,.018);
  GEO={
    pelvis:contourGeometry([[-.125,.141,.093],[-.07,.177,.105],[.065,.156,.103],[.11,.144,.093]]),
    belt:contourGeometry([[-.014,.175,.114],[.025,.175,.114]]).translate(0,.055,0),
    buckle:box(.06,.047,.012,0,.061,.117),
    torso:contourGeometry([[-.23,.125,.082],[-.14,.154,.096],[-.01,.188,.108],[.12,.193,.098],[.22,.145,.068]],16),
    vest:plate,
    webbing:combine(...straps,...molle),
    pouch:combine(...mags),
    pouchFlaps:combine(...flaps),
    backPack:combine(box(.19,.29,.087,0,.023,-.151),box(.12,.12,.022,0,-.025,-.199)),
    radio:combine(box(.073,.122,.054,-.175,.055,-.114),box(.009,.185,.009,-.193,.182,-.124)),
    collar:contourGeometry([[-.025,.085,.068],[.035,.075,.063]],16).translate(0,.22,0),
    neckSkin,
    head:face,
    jaw,
    nose,
    ears,
    helmet,
    brim:box(.245,.018,.11,0,.048,.083,.006),
    helmetRails:combine(box(.016,.032,.135,-.123,.074,-.025),box(.016,.032,.135,.123,.074,-.025),box(.04,.042,.02,0,.112,.105)),
    earCups:combine(oval(.029,.064,.044,-.106,-.022,-.016),oval(.029,.064,.044,.106,-.022,-.016)),
    mask:contourGeometry([[-.115,.048,.038,.054],[-.085,.077,.055,.05],[-.034,.087,.055,.049],[-.018,.079,.048,.05]],12),
    goggleFrame:combine(box(.099,.065,.04,-.052,.015,.087),box(.099,.065,.04,.052,.015,.087),box(.026,.018,.035,0,.019,.095)),
    goggles:combine(box(.079,.043,.016,-.053,.016,.113,.01),box(.079,.043,.016,.053,.016,.113,.01)),
    shoulderCap,
    arm:limb(UPPER,[[0,.058,.062],[.1,.076,.074],[.36,.083,.07],[.68,.068,.062],[.92,.053,.05],[1,.051,.05]]),
    fore:limb(FORE,[[0,.054,.052],[.18,.069,.06],[.45,.06,.055],[.8,.046,.045],[1,.042,.04]]),
    elbowPad:box(.072,.087,.028,0,-.013,-.055),
    hand:combine(palm,thumb),
    thigh:limb(THIGH,[[0,.097,.099],[.16,.107,.108],[.42,.103,.103],[.65,.086,.094],[.9,.074,.082],[1,.071,.076]]),
    shin:limb(SHIN,[[0,.073,.079],[.18,.082,.077,-.007],[.38,.087,.079,-.01],[.69,.066,.066,-.004],[.9,.051,.055],[1,.048,.052]]),
    cargo:box(.043,.15,.122,.094,-.182,-.007),
    cargoFlap:box(.05,.038,.132,.095,-.123,-.007),
    kneePad:combine(box(.111,.134,.031,0,-.025,.078),box(.088,.083,.014,0,-.021,.097)),
    kneeStraps:combine(box(.146,.023,.135,0,-.069,0),box(.146,.023,.135,0,.019,0)),
    foot:boot,
    sole:box(.135,.028,.28,0,-.076,.046,.01),
    bootLaces:combine(...[0,1,2,3].map(i=>box(.07,.008,.009,0,.033+i*.017,.08-i*.012))),
    teamBand:box(.065,.031,.009,0,.092,.131),
    jointBig:oval(.075,.078,.075),jointMid:oval(.051,.054,.052),
  };
  return GEO;
}

// ---------- 挂枪常量 ----------
export const RIFLE_LEN = 0.92;
const RIFLE_HALF = RIFLE_LEN / 2;
const RIFLE_YAW = Math.PI / 2;   // AK 枪口在本体 -x，+90° → 指向本组 +z

// 两个握点（相对枪心、在枪自身坐标系里）：扣扳机的手在下后方，托举手在护木上
// 握点/护木点（mount 本地系）：AK 归一化后是「中心归零、枪口朝 +z」的一根长枪，
// 扳机握把在中心**之后**约 19cm，木护木在中心之前约 13cm —— 这两个值是从实测截图上
// 量出来的（枪全长 0.92 → 用像素比例反推），不是拍脑袋。放错会让左手够到枪管中段。
// 更硬的一条约束：左肩(0.20, 0.22, 0) 到护木点的距离必须明显小于臂展 UPPER+FORE=0.58，
// 否则 IK 被迫把支撑臂拉成一条直线（实测护木取 z=0.20 时距离 0.577，手臂完全绷直，
// 看起来像「枪飘在胸前、手够不着」）。取 0.13 后约 0.50，肘部自然弯 ~60°。
const GRIP = new THREE.Vector3(0, -0.10, -0.19);
const HANDGUARD = new THREE.Vector3(0, -0.04, 0.10);

// 两个持枪姿态（相对胸腔中心的枪心位置 + 俯仰；俯仰 >0 = 枪口压下）。
// 两个姿态都**保证双手够得着**（臂展 0.58）：低姿 0.598/0.40、据枪 0.57/0.34，
// 所以过渡只是微微抬枪，不会出现手够不着枪的脱手画面。
const MOUNT_CARRY = { x: 0.0, y: 0.04, z: 0.30, pitch: 0.30 };
const MOUNT_AIM = { x: -0.02, y: 0.15, z: 0.36, pitch: 0.0 };

// 步频松驰系数：严格「支撑脚世界坐标不动」要求步幅与走过路程严格相等，
// 而腿长把跨步锁死在 ±0.32m → 3.4m/s 下要 5Hz 的步频，看着像小碎步。
// 这里让步幅与腿长脱钩 28%（支撑脚会缓慢前滑），换回接近真人的 ~3.7Hz。
const CADENCE_SLIP = 0.72;
const HALF_STRIDE_MAX = 0.32;

// ---------- 临时变量（避免每帧 new）----------
const DOWN = new THREE.Vector3(0, -1, 0);
const _i1 = new THREE.Vector3();
const _i2 = new THREE.Vector3();
const _i3 = new THREE.Vector3();
const _iq = new THREE.Quaternion();

// 两骨 3D IK：把 root→(上段→下段) 的末端拉到 target。全部在「上段父级坐标系」里算，
// 骨段朝局部 -y 伸展所以基准方向是 (0,-1,0)；pole 决定中间关节往哪边顶。
// 结果写进 qUp（上段局部四元数）与 qLo（下段相对上段的四元数）。
function ik2(root, target, pole, lenUp, lenLo, qUp, qLo) {
  _i1.subVectors(target, root);
  let d = _i1.length();
  const reach = (lenUp + lenLo) * 0.999;
  if (d > reach) { _i1.multiplyScalar(reach / d); d = reach; }
  else if (d < 0.05) { _i1.multiplyScalar(0.05 / Math.max(d, 1e-5)); d = 0.05; }
  const dir = _i2.copy(_i1).multiplyScalar(1 / d);            // 单位方向
  // 上段方向 = dir 绕 (dir × pole) 旋 A（余弦定理）→ 中间关节被 pole 顶向一侧
  const cosA = (lenUp * lenUp + d * d - lenLo * lenLo) / (2 * lenUp * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  _i3.crossVectors(dir, pole);
  if (_i3.lengthSq() < 1e-9) _i3.set(1, 0, 0).cross(dir);     // pole 与 dir 共线的退化兜底
  _i3.normalize();
  const upDir = _i1.copy(dir).applyAxisAngle(_i3, A).normalize();
  qUp.setFromUnitVectors(DOWN, upDir);
  // 下段方向 = 末端 - 中间关节；换算到上段局部系再取四元数
  const joint = _i3.copy(root).addScaledVector(upDir, lenUp);
  const loDir = _i1.copy(target).sub(joint).normalize();
  _iq.copy(qUp).invert();
  loDir.applyQuaternion(_iq);
  qLo.setFromUnitVectors(DOWN, loDir);
}

// IK 常量入参：肩点、极向量（肘往哪边顶）、致盲捂脸目标、倒地松手目标
const _shR = new THREE.Vector3(-SHOULDER_X, SHOULDER_Y, 0);
const _shL = new THREE.Vector3(SHOULDER_X, SHOULDER_Y, 0);
const _poleR = new THREE.Vector3(-1.0, -0.75, -0.35).normalize();
const _poleL = new THREE.Vector3(0.75, -1.0, -0.15).normalize();
const _faceT = new THREE.Vector3(0.10, SHOULDER_Y + 0.10, 0.16);
// 倒地时枪滑到的位置（胸腔系）与横转角：z 收回到 0.06 是为了让枪落在甲板上而不是甲板下
const _mountDeadP = new THREE.Vector3(-0.02, -0.22, 0.06);
const _MOUNT_DEAD_PITCH = 0.45;
const RIFLE_DEATH_YAW = 1.5;   // 叠加在 RIFLE_YAW 上的横转量（≈86°，几乎垂直于身体）
const _dropR = new THREE.Vector3(-0.26, -0.28, -0.10);
const _dropL = new THREE.Vector3(0.30, -0.32, -0.06);
// 握点目标（每帧从常量算出来，绝不在 GRIP/HANDGUARD 上原地 applyMatrix4）
const _gripT = new THREE.Vector3();
const _hgT = new THREE.Vector3();

// 把步枪模板定标成「世界模型」：最长边 RIFLE_LEN、枪口朝 +z、中心归零、整体压暗
export function normalizeRifle(source) {
  const g = source;
  g.rotation.set(0, 0, 0);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  g.scale.multiplyScalar(RIFLE_LEN / Math.max(size.x, size.y, size.z));
  g.rotation.y = RIFLE_YAW;
  g.position.sub(new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3()));
  g.traverse((o) => {
    if (o.isMesh && o.material) {
      const m = o.material.clone();
      if (m.color) m.color.multiplyScalar(0.6).lerp(new THREE.Color(0x6d6355), 0.2);
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.4);
      o.material = m;
    }
  });
  return g;
}

export class SoldierRig {
  constructor(rifleTemplate) {
    const G = geo();
    const mkMat = (color, rough = 0.82, metal = 0.05) =>
      detailMaterial(color, "fabric", { roughness: rough, metalness: metal });

    // 每个敌人一份材质（受击闪红要各自独立），几何体共享
    this.matCloth = detailMaterial(C.cloth, "camo");
    this.matCloth2 = detailMaterial(C.cloth2, "camo");
    this.matGear = mkMat(C.gear, 0.9);
    this.matPouch = mkMat(C.pouch, 0.9);
    this.matGlove = mkMat(C.glove, 0.85);
    this.matBoot = mkMat(C.boot, 0.9);
    this.matSkin = mkMat(C.skin, 0.75);
    this.matMask = mkMat(C.mask, 0.7);
    this.matLens = new THREE.MeshStandardMaterial({color:C.lens,roughness:.14,metalness:.5});
    this.matTeam = mkMat(C.team, 0.7);
    this.mats = [
      this.matCloth, this.matCloth2, this.matGear, this.matPouch, this.matGlove,
      this.matBoot, this.matSkin, this.matMask, this.matLens, this.matTeam,
    ];
    this.headMats = [this.matMask, this.matGear];   // 爆头闪得更狠

    this.meshes = [];
    const add = (parent, geometry, material, part) => {
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = false;
      m.receiveShadow = false;
      if (part) m.userData.part = part;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };

    // ---------- 层级：root → pelvis →（spine → chest → 双臂/头/枪）+ 双腿 ----------
    const root = new THREE.Group();
    const pelvis = new THREE.Group();
    pelvis.position.y = PELVIS_Y;
    root.add(pelvis);
    add(pelvis, G.pelvis, this.matCloth2);
    add(pelvis, G.belt, this.matGlove);
    add(pelvis, G.buckle, this.matGear);

    const spine = new THREE.Group();
    spine.position.y = SPINE_Y;
    pelvis.add(spine);

    const chest = new THREE.Group();
    chest.position.y = CHEST_Y;
    spine.add(chest);
    add(chest, G.torso, this.matCloth);
    add(chest, G.vest, this.matGear);
    add(chest, G.webbing, this.matPouch);
    add(chest, G.pouch, this.matPouch);
    add(chest, G.pouchFlaps, this.matGear);
    add(chest, G.radio, this.matGlove);
    add(chest, G.teamBand, this.matTeam);
    add(chest, G.backPack, this.matGear);
    add(chest, G.collar, this.matCloth2);

    // 头
    const neck = new THREE.Group();
    neck.position.y = NECK_Y;
    spine.add(neck);
    add(neck, G.neckSkin, this.matSkin, "head");
    const head = new THREE.Group();
    head.position.y = 0.14;
    neck.add(head);
    add(head, G.head, this.matSkin, "head");
    add(head, G.jaw, this.matSkin, "head");
    add(head, G.nose, this.matSkin, "head");
    add(head, G.ears, this.matSkin, "head");
    add(head, G.helmet, this.matCloth2, "head");
    add(head, G.helmetRails, this.matGlove, "head");
    add(head, G.earCups, this.matGear, "head");
    add(head, G.brim, this.matGear, "head");
    add(head, G.mask, this.matMask, "head");
    add(head, G.goggleFrame, this.matMask, "head");
    add(head, G.goggles, this.matLens, "head");

    // 双臂（肩 → 上臂 → 肘 → 前臂 → 手）
    const mkArm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      chest.add(sh);
      add(sh, G.shoulderCap, this.matCloth2);
      add(sh, G.jointMid, this.matCloth2);
      add(sh, G.arm, this.matCloth2);
      const el = new THREE.Group();
      el.position.y = -UPPER;
      sh.add(el);
      add(el, G.jointMid, this.matCloth2);
      add(el, G.fore, this.matCloth2);
      add(el, G.elbowPad, this.matGear);
      const hd = new THREE.Group();
      hd.position.y = -FORE;
      el.add(hd);
      add(hd, G.hand, this.matGlove);
      return { sh, el, hd };
    };
    this.armR = mkArm(-1);   // -x 是右手（扣扳机）
    this.armL = mkArm(1);

    // 双腿（髋 → 大腿 → 膝 → 小腿 → 踝 → 脚）
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * HIP_X, HIP_DY, 0);
      pelvis.add(hip);
      add(hip, G.jointBig, this.matCloth2);
      add(hip, G.thigh, this.matCloth2);
      const cargo = add(hip, G.cargo, this.matPouch);
      const flap = add(hip, G.cargoFlap, this.matGear);
      // Mirror the entire pocket without a negative scale (normal winding stays valid).
      if(side < 0) { cargo.rotation.y = Math.PI; flap.rotation.y = Math.PI; }
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      add(knee, G.jointBig, this.matCloth2);
      add(knee, G.kneePad, this.matGear);
      add(knee, G.kneeStraps, this.matGlove);
      add(knee, G.shin, this.matCloth2);
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      add(ankle, G.foot, this.matBoot);
      add(ankle, G.sole, this.matGlove);
      add(ankle, G.bootLaces, this.matPouch);
      return { hip, knee, ankle };
    };
    this.legR = mkLeg(-1);
    this.legL = mkLeg(1);

    // 枪：挂在胸腔的挂点上，位置/俯仰由姿态插值驱动
    this.mount = new THREE.Group();
    chest.add(this.mount);
    this.rifle = rifleTemplate ? rifleTemplate.clone(true) : null;
    if (this.rifle) this.mount.add(this.rifle);

    this.root = root;
    this.pelvis = pelvis;
    this.spine = spine;
    this.chest = chest;
    this.neck = neck;
    this.head = head;

    // 动画状态
    this._fR = { v: new THREE.Vector3(), lift: 0 };
    this._fL = { v: new THREE.Vector3(), lift: 0 };
    this._sR = { z: 0, lift: 0 };
    this._sL = { z: 0, lift: 0 };
    this.mountPos = new THREE.Vector3();
    this.mountPitch = 0;
    this.phase = 0;
    this.pelvisY = PELVIS_Y;
    this.aimBlend = 0;
    this.kick = 0;         // 开火后坐（每次射击置 1，指数衰减）
    this.breath = 0;
    this.deathBlend = 0;
    this.walkW = 0;
    this.reset();
  }

  reset() {
    this.phase = Math.random() * Math.PI * 2;
    this.pelvisY = PELVIS_Y;
    this.aimBlend = 0;
    this.kick = 0;
    this.deathBlend = 0;
    this.walkW = 0;
    this.breath = Math.random() * Math.PI * 2;
    this.pelvis.position.set(0, PELVIS_Y, 0);
    this.pelvis.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0);
    this.chest.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.mount.position.set(MOUNT_CARRY.x, MOUNT_CARRY.y, MOUNT_CARRY.z);
    this.mount.rotation.set(MOUNT_CARRY.pitch, 0, 0);
    this.mount.updateMatrix();
    this.animate(0, { moved: 0, speed: 0, aim: 0, blind: 0, flinch: 0, dead: false });
  }

  // 开火后坐：由 enemies.js 每发调用一次
  recoil() { this.kick = 1; }

  // 受击闪红（几何体共享、材质每人一份，所以只管这套材质）
  setFlash(k) {
    for (const m of this.mats) {
      const hot = this.headMats.indexOf(m) >= 0 ? 1 : 0.5;
      m.emissive.setRGB(0.85 * k * hot, 0.025 * k, 0.025 * k);
    }
  }

  // 枪口在 body 系（脚底为原点）的位置 —— 供 main.js 的枪口火光 / 枪声定位用。
  // 解析式而不是 localToWorld：后者依赖 matrixWorld，要等下一次 render 才更新，
  // 新生敌人会算到世界原点（历史上 attachMuzzleTo 踩过同一个坑）。
  muzzleBody(out) {
    out.set(0, 0.02, RIFLE_HALF + 0.03).applyMatrix4(this.mount.matrix);
    out.y += this.pelvis.position.y + SPINE_Y + CHEST_Y;
    return out;
  }

  // ---------- 每帧程序化动画 ----------
  // s: { moved, speed, aim, aimPitch, blind, flinch, dead }
  animate(dt, s) {
    const moved = Math.max(0, Number.isFinite(s.moved) ? s.moved : 0);
    const speed = Math.max(0, Number.isFinite(s.speed) ? s.speed : 0);
    const aim = clamp01(s.aim || 0);
    const aimPitch = Number.isFinite(s.aimPitch) ? s.aimPitch : 0;   // >0 = 目标更低
    const blind = clamp01(s.blind || 0);
    const flinch = clamp01(s.flinch || 0);
    this.breath += dt * 1.6;
    this.kick *= Math.exp(-dt * 11);                  // 后坐衰减（帧率无关）
    this.aimBlend += (aim - this.aimBlend) * (1 - Math.exp(-dt * 5.5));
    this.deathBlend += ((s.dead ? 1 : 0) - this.deathBlend) * (1 - Math.exp(-dt * 7));

    // ① 步幅跟着速度走，相位跟着「走过的路程」走 —— 支撑脚的脚底才不会打滑
    const walkW = clamp01((speed - 0.25) / 1.1);
    this.walkW = walkW;
    const halfStride = Math.min(HALF_STRIDE_MAX, Math.max(0.06, speed * 0.10));
    this.phase += (Math.PI * moved * CADENCE_SLIP) / (2 * halfStride);

    // ② 脚的前后位置与抬脚高度：支撑期在本体系里匀速后移（= 世界坐标里不动），
    //    摆动期抬起前摆。z/y 都不依赖骨盆高度，所以可以先算出来。
    const strideOf = (ph, out) => {
      const q = ((ph % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (q < Math.PI) {                        // 支撑期
        out.z = halfStride * (1 - (2 * q) / Math.PI);
        out.lift = 0;
      } else {                                  // 摆动期
        const u = (q - Math.PI) / Math.PI;
        out.z = -halfStride * Math.cos(Math.PI * u);
        out.lift = 0.15 * Math.sin(Math.PI * u);
      }
      out.z *= walkW;                           // 站定时把脚收回髋下（避免僵在跨步姿势上）
      out.lift *= walkW;
      return out;
    };
    const sR = strideOf(this.phase + Math.PI, this._sR);
    const sL = strideOf(this.phase, this._sL);

    // ③ 骨盆高度：取两条腿「刚刚够得着」的上界 —— 自然生成走路时的一起一伏，
    //    且永远不会把腿拉脱臼（超出伸展范围时 IK 会把脚拽离地面）。
    //    **必须在算脚的目标点之前定下来**：目标点是「相对骨盆」的，
    //    用上一帧的骨盆高度会把脚带偏 1~2cm（实测脚掌会切进甲板）。
    const bound = (s) =>
      ANKLE_Y - HIP_DY + s.lift + Math.sqrt(Math.max(0.02, (LEG_REACH * 0.99) ** 2 - s.z * s.z));
    const wantY = Math.min(PELVIS_Y, Math.min(bound(sR), bound(sL))) - 0.012 * walkW;
    this.pelvisY += (wantY - this.pelvisY) * (1 - Math.exp(-dt * 15));
    const idleW = 1 - walkW;
    this.pelvis.position.y = this.pelvisY + idleW * Math.sin(this.breath) * 0.008;
    this.pelvis.position.x = Math.sin(this.phase) * 0.022 * walkW;
    this.pelvis.rotation.z = Math.sin(this.phase) * 0.05 * walkW;
    this._fR.v.set(-HIP_X, -this.pelvisY + ANKLE_Y + sR.lift, sR.z);
    this._fL.v.set(HIP_X, -this.pelvisY + ANKLE_Y + sL.lift, sL.z);
    const fR = this._fR, fL = this._fL;

    // ④ 腿：纯 2D 解算（腿只在矢状面里摆，解析式比四元数 IK 更稳更省）
    const solveLeg = (leg, f) => {
      const dy = f.v.y - HIP_DY, dz = f.v.z;
      const d = Math.min(LEG_REACH * 0.995, Math.hypot(dy, dz));
      const base = Math.atan2(dz, -dy);                                    // 髋→踝 偏角（前为正）
      const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
      const thighA = base + Math.acos(Math.max(-1, Math.min(1, cosA)));    // 膝盖朝前顶
      const kneeZ = Math.sin(thighA) * THIGH, kneeY = -Math.cos(thighA) * THIGH;
      const shinA = Math.atan2(f.v.z - kneeZ, -(f.v.y - kneeY));
      leg.hip.rotation.x = -thighA;
      leg.knee.rotation.x = thighA - shinA;
      // 脚掌踩平（抵消小腿的绝对倾角），摆动期再让脚尖下垂一点
      leg.ankle.rotation.x = shinA - f.lift * 1.6;
    };
    solveLeg(this.legR, fR);
    solveLeg(this.legL, fL);

    // ⑤ 躯干：跑起来前倾、走起来左右微扭、受击后仰（都是小幅，不夺走「朝向=瞄准」这个前提）
    this.spine.rotation.x = 0.05 + 0.09 * walkW + 0.05 * blind - flinch * 0.26;
    this.spine.rotation.y = Math.sin(this.phase) * 0.09 * walkW * (1 - this.aimBlend) - flinch * 0.14;
    this.spine.rotation.z = blind * (0.08 + Math.sin(this.breath * 1.7) * 0.06);

    // ⑥ 头：跑动时抬起来一点、致盲时低头乱晃、受击时向后甩
    this.neck.rotation.x = -0.04 * walkW + Math.sin(this.breath * 0.9) * 0.02
      + blind * 0.20 - flinch * 0.30;
    this.neck.rotation.y = blind
      ? Math.sin(this.breath * 2.3) * 0.45
      : Math.sin(this.breath * 0.7) * 0.06;

    // ⑦ 枪：低姿 ↔ 据枪 插值，开火时往肩里推 + 抬枪口
    const k = this.aimBlend;
    const kick = this.kick;
    const db = this.deathBlend;
    this.mountPos.set(
      MOUNT_CARRY.x + (MOUNT_AIM.x - MOUNT_CARRY.x) * k,
      MOUNT_CARRY.y + (MOUNT_AIM.y - MOUNT_CARRY.y) * k - kick * 0.012,
      MOUNT_CARRY.z + (MOUNT_AIM.z - MOUNT_CARRY.z) * k - kick * 0.035
    );
    this.mountPitch = MOUNT_CARRY.pitch + (MOUNT_AIM.pitch - MOUNT_CARRY.pitch) * k
      - kick * 0.10 - aimPitch * (0.35 + 0.65 * k) + blind * 0.30;   // 注意是**减**：↑符号约定见文件头，负 pitch = 抬枪口
    // 倒地：枪从肩上滑下来，位置收回体侧、并把整根枪**绕 Y 横过来**。
    // 这不是审美而是一条几何硬约束：倒地时 enemies.js 的 tilt 会绕腰把整具身体转 90° 放平，
    // 「身体前方」随之变成「身体下方」，而枪口在胸前方 0.85m 处 —— 不横过来，整根枪管
    // 会从甲板底下捅出去（实测尸体最低点 -0.586m，等于甲板上插着一杆埋进去的枪）。
    // 横过来之后枪沿 ±x 躺着，x 轴在放平变换里不变，高度恒定在甲板之上。
    if (db > 0.001) {
      this.mountPos.lerp(_mountDeadP, db);
      this.mountPitch += (_MOUNT_DEAD_PITCH - this.mountPitch) * db;
    }
    if (this.rifle) this.rifle.rotation.y = RIFLE_YAW + RIFLE_DEATH_YAW * db;
    this.mount.position.copy(this.mountPos);
    this.mount.rotation.set(this.mountPitch, 0, 0);
    this.mount.updateMatrix();

    // ⑧ 双臂 IK：手要一直黏在握把与护木上（「看起来真的在持枪」的关键）。
    //    挂点在胸腔系里 → 肩也在胸腔系里，两边同系，IK 直接在这个系里解。
    _gripT.copy(GRIP).applyMatrix4(this.mount.matrix);
    _hgT.copy(HANDGUARD).applyMatrix4(this.mount.matrix);
    if (blind > 0.02) _hgT.lerp(_faceT, blind * 0.85);          // 致盲：左手抬起来捂脸
    if (this.deathBlend > 0.02) {                               // 倒地：双手松开垂在身侧
      _gripT.lerp(_dropR, this.deathBlend);
      _hgT.lerp(_dropL, this.deathBlend);
    }
    ik2(_shR, _gripT, _poleR, UPPER, FORE, this.armR.sh.quaternion, this.armR.el.quaternion);
    ik2(_shL, _hgT, _poleL, UPPER, FORE, this.armL.sh.quaternion, this.armL.el.quaternion);
    this.armR.hd.rotation.set(0.3, 0, 0);
    this.armL.hd.rotation.set(0.3, 0, 0);

    // ⑨ 倒地：全身只是「松掉」—— 四肢瘫软、上身塌下、头一歪。
    //    **绝对不能把腿折起来**：enemies.js 的 tilt 会把整具身体绕腰转 90° 放平，
    //    折起的腿在那之后会朝天上翘成一团（实测尸体像只翻倒的虫子）。
    //    pelvis 高度同理不能在这里动 —— 放平后的高度由 tilt.position.y 负责。
    if (this.deathBlend > 0.02) {
      const d = this.deathBlend;
      this.legR.hip.rotation.x += (0.10 - this.legR.hip.rotation.x) * d;
      this.legL.hip.rotation.x += (0.18 - this.legL.hip.rotation.x) * d;
      this.legR.knee.rotation.x += (-0.20 - this.legR.knee.rotation.x) * d;
      this.legL.knee.rotation.x += (-0.30 - this.legL.knee.rotation.x) * d;
      this.legR.ankle.rotation.x += (0.10 - this.legR.ankle.rotation.x) * d;
      this.legL.ankle.rotation.x += (0.14 - this.legL.ankle.rotation.x) * d;
      // 脊椎/脖子**几乎不能往前弯**：倒地后「身体前方」=「身体下方」，在这里前倾多少，
      // 脸和头盔就扎进甲板多少（实测脊椎 0.22 + 脖子 0.40 时头盔最低点 -0.219m）。
      // 头改成**整个转向侧面**（rotation.y 大角度）：一来这才是「死人歪着头」的样子，
      // 二来头盔的 0.27m 深度从「朝下」转到「朝侧」，直接退出「扎地板」的那条轴。
      this.spine.rotation.x += (0.08 - this.spine.rotation.x) * d;
      this.neck.rotation.x += (0.10 - this.neck.rotation.x) * d;
      this.neck.rotation.y += (1.15 - this.neck.rotation.y) * d;
      this.mount.rotation.x += (0.55 - this.mount.rotation.x) * d;
    }
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
