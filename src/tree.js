/* 程序化树生成器：骨架 → 管道几何 + 叶片实例 */
(function (global) {
  'use strict';

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const TAU = Math.PI * 2;

  /* ---------------- 树种参数 ---------------- */
  const SPECIES = {
    oak: {
      label: '橡树', habit: 'spreading',
      trunkHeight: 2.25, trunkRadius: 0.135, trunkTilt: 0.05,
      limbs: 6, limbRise: [0.70, 1.28], limbLen: [0.58, 0.40], clusterLevel: 2,
      maxLevel: 4, ternary: 0.80,
      branchAngle: 42, lengthRatio: 0.72, radiusRatio: 0.66, taper: 0.50,
      gravity: 0.60, tropism: 1.0, childRise: 0.05,
      wander: 0.95, noiseScale: 0.62,
      leafShape: 'broad', leafSize: 0.18, leavesPer: 62, leafStart: 0.14,
      leafUp: 0.26, leafDroop: false, leafSpread: 0.062,
      palette: {
        spring: '#93c25e',
        summer: '#569b3f',
        autumn: '#d79c3c',
        winter: '#9a8a70'
      }
    },
    willow: {
      label: '垂柳', habit: 'spreading',
      trunkHeight: 2.55, trunkRadius: 0.13, trunkTilt: 0.03,
      limbs: 5, limbRise: [0.20, 0.55], limbLen: [0.74, 0.56], clusterLevel: 2,
      maxLevel: 4, ternary: 0.72,
      branchAngle: 28, lengthRatio: 0.82, radiusRatio: 0.58, taper: 0.38,
      gravity: 3.20, gravityBase: 0.50, tropism: 0.50, childRise: -0.02,
      wander: 1.15, noiseScale: 0.46,
      leafShape: 'willow', leafSize: 0.30, leavesPer: 110, leafStart: 0.02,
      leafUp: -0.60, leafDroop: true, leafSpread: 0.055,
      palette: {
        spring: '#a8c85c',
        summer: '#87b148',
        autumn: '#d8bb52',
        winter: '#a5987d'
      }
    },
    pine: {
      label: '松树', habit: 'conical',
      trunkHeight: 3.10, trunkRadius: 0.082, trunkTilt: 0.02,
      maxLevel: 3, ternary: 0.62,
      branchAngle: 66, lengthRatio: 0.64, radiusRatio: 0.56, taper: 0.42,
      gravity: 0.35, tropism: 0.42, childRise: 0.10,
      wander: 0.55, noiseScale: 0.70,
      leafShape: 'needle', leafSize: 0.23, leavesPer: 20, leafStart: 0.05,
      leafUp: 0.15, leafDroop: false, leafSpread: 0.055,
      rings: 15, ringBranchLen: 0.66, ringOut: 0.72, ringUp: 0.52, clusterLevel: 1,
      palette: {
        spring: '#4a7a42',
        summer: '#3d7043',
        autumn: '#3e6034',
        winter: '#3c5c3c'
      }
    },
    sakura: {
      label: '樱花', habit: 'spreading',
      trunkHeight: 1.85, trunkRadius: 0.125, trunkTilt: 0.07,
      limbs: 6, limbRise: [0.52, 1.05], limbLen: [0.58, 0.40], clusterLevel: 2,
      maxLevel: 4, ternary: 0.78,
      branchAngle: 50, lengthRatio: 0.70, radiusRatio: 0.63, taper: 0.46,
      gravity: 0.90, tropism: 0.85, childRise: 0.02,
      wander: 1.05, noiseScale: 0.58,
      leafShape: 'petal', leafSize: 0.095, leavesPer: 92, leafStart: 0.10,
      leafUp: 0.15, leafDroop: false, leafSpread: 0.075,
      palette: {
        spring: '#f2b3c4',
        summer: '#8fb568',
        autumn: '#d98a5c',
        winter: '#a08c7d'
      }
    }
  };

  const SEASONS = {
    spring: { label: '春', density: 1.05, size: 1.00 },
    summer: { label: '夏', density: 1.20, size: 1.04 },
    autumn: { label: '秋', density: 0.90, size: 1.00 },
    winter: { label: '冬', density: 0.15, size: 0.70 }
  };

  /* ---------------- 骨架生成 ---------------- */
  function generate(cfg) {
    const sp = SPECIES[cfg.species] || SPECIES.oak;
    const season = SEASONS[cfg.season] || SEASONS.summer;
    const rnd = PTNoise.mulberry32(cfg.seed >>> 0);
    const noise = new PTNoise.Noise3D((cfg.seed * 31 + 17) | 0);

    const maxLevel = Math.max(2, Math.min(5, cfg.maxLevel));
    const branches = [];
    const leaves = [];
    const leafClusterIds = [];
    const ns = sp.noiseScale;

    let maxY = 0, maxXZ = 0;
    let gidCounter = 0;
    const clusterLevel = sp.clusterLevel || 2;

    function randDir() {
      return new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    }

    function tangentAt(pts, i) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      return b.clone().sub(a).normalize();
    }

    function pointAt(pts, t) {
      const f = t * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(f));
      const k = f - i;
      return pts[i].clone().lerp(pts[i + 1], k);
    }

    function trackExtent(pts) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.y > maxY) maxY = p.y;
        const r = Math.sqrt(p.x * p.x + p.z * p.z);
        if (r > maxXZ) maxXZ = r;
      }
    }

    /* 沿枝干采样一条带噪声弯曲的路径 */
    function samplePath(start, dir, length, level) {
      const segs = Math.max(5, Math.round(4 + length * 5.5));
      const pts = [start.clone()];
      const p = start.clone();
      const d = dir.clone().normalize();
      const step = length / segs;
      const lf = level / maxLevel;

      for (let i = 1; i <= segs; i++) {
        const nx = noise.noise(p.x * ns + 31.7, p.y * ns, p.z * ns);
        const ny = noise.noise(p.x * ns + 7.1, p.y * ns, p.z * ns + 53.9);
        const nz = noise.noise(p.x * ns, p.y * ns + 17.3, p.z * ns);

        const nvec = new THREE.Vector3(nx, ny * 0.55, nz);
        nvec.addScaledVector(d, -nvec.dot(d));
        d.addScaledVector(nvec, sp.wander * (0.45 + lf * 0.95) * 0.075);

        d.y += sp.tropism * 0.020 * (0.35 + lf);
        const gBias = sp.gravityBase || 0;
        d.y -= sp.gravity * (gBias + (1 - gBias) * lf) * 0.030;
        d.normalize();

        p.addScaledVector(d, step);
        pts.push(p.clone());
        if (p.y < 0.06) break;   // 触地即止，避免枝条穿进地面
      }
      return pts;
    }

    function addBranch(pts, r0, r1, level) {
      branches.push({ pts: pts, r0: r0, r1: Math.max(r1, 0.0022), level: level });
      trackExtent(pts);
    }

    /* 在枝干上撒叶片 */
    function scatterLeaves(pts, densityScale, gid) {
      const base = sp.leavesPer * season.density * cfg.leafDensity * densityScale;
      const n = Math.max(3, Math.round(base * (0.78 + rnd() * 0.44)));
      const span = 1 - sp.leafStart;

      for (let k = 0; k < n; k++) {
        const t = sp.leafStart + span * rnd();
        const pos = pointAt(pts, t);

        const outward = new THREE.Vector3(pos.x, 0, pos.z);
        if (outward.lengthSq() < 1e-5) outward.copy(randDir()).setY(0);
        if (outward.lengthSq() < 1e-5) outward.set(1, 0, 0);
        outward.normalize();

        const nrm = outward.clone()
          .addScaledVector(new THREE.Vector3(0, 1, 0), sp.leafUp)
          .addScaledVector(randDir(), 0.68)
          .normalize();

        pos.addScaledVector(randDir(), sp.leafSpread);

        const up = new THREE.Vector3(0, 1, 0);
        let right = new THREE.Vector3().crossVectors(up, nrm);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        const up2 = new THREE.Vector3().crossVectors(nrm, right).normalize();

        const m = new THREE.Matrix4().makeBasis(right, up2, nrm);
        m.multiply(new THREE.Matrix4().makeRotationZ(rnd() * TAU));
        if (sp.leafDroop) m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI));

        const s = sp.leafSize * season.size * (0.66 + rnd() * 0.72);
        m.scale(new THREE.Vector3(s, s * (0.9 + rnd() * 0.25), s));
        m.setPosition(pos);

        leaves.push(m);
        leafClusterIds.push(gid);
      }
    }

    /* 递归生长枝条 */
    function grow(start, dir, length, radius, level, gid) {
      const pts = samplePath(start, dir, length, level);
      const r1 = radius * (level >= maxLevel ? 0.30 : sp.taper);
      addBranch(pts, radius, r1, level);

      if (level >= maxLevel) { scatterLeaves(pts, 1.0, gid); return; }
      if (level === maxLevel - 1) scatterLeaves(pts, 0.62, gid);
      if (level === maxLevel - 2) scatterLeaves(pts, 0.14, gid);

      const count = rnd() < sp.ternary ? 3 : 2;
      const isWillow = sp.leafDroop;

      for (let i = 0; i < count; i++) {
        const tPos = 0.34 + 0.64 * ((i + 0.35 + rnd() * 0.5) / count);
        const idx = Math.min(pts.length - 2, Math.max(1, Math.round(tPos * (pts.length - 1))));
        const origin = pts[idx].clone();
        const tan = tangentAt(pts, idx);

        const refUp = Math.abs(tan.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const ax = new THREE.Vector3().crossVectors(tan, refUp).normalize();
        const ay = new THREE.Vector3().crossVectors(tan, ax).normalize();

        // 侧枝方位均匀铺开，避免全挤到一边
        const azim = (i / count) * TAU + GOLDEN * level * 1.7 + rnd() * 0.85;
        let pitch = THREE.MathUtils.degToRad(sp.branchAngle * (0.72 + rnd() * 0.62));
        if (isWillow && level >= 1) pitch += THREE.MathUtils.degToRad(9 * (level / maxLevel));

        const dirC = tan.clone().multiplyScalar(Math.cos(pitch))
          .addScaledVector(ax, Math.sin(pitch) * Math.cos(azim))
          .addScaledVector(ay, Math.sin(pitch) * Math.sin(azim))
          .normalize();
        dirC.y += sp.childRise;
        dirC.normalize();

        const r = radius * sp.radiusRatio * (0.88 + rnd() * 0.22);
        const L = length * sp.lengthRatio * (0.82 + rnd() * 0.34);
        // 到了分杈层，每个子树各自成为一「团」
        const childGid = (level === clusterLevel - 1) ? (gidCounter++) : gid;
        grow(origin, dirC, L, r, level + 1, childGid);
      }
    }

    /* ---- 主干 ---- */
    function buildTrunk(segs) {
      const H = sp.trunkHeight * (0.94 + rnd() * 0.12);
      const pts = [];
      const p = new THREE.Vector3(0, 0, 0);
      const d = new THREE.Vector3(
        (rnd() - 0.5) * sp.trunkTilt * 2, 1, (rnd() - 0.5) * sp.trunkTilt * 2
      ).normalize();
      pts.push(p.clone());

      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        d.x += noise.noise(3.1, t * 2.2, 8.2) * sp.wander * 0.022;
        d.z += noise.noise(11.4, t * 2.2, 2.7) * sp.wander * 0.022;
        d.y = Math.max(d.y, 0.9);          // 主干保持向上
        d.normalize();
        p.addScaledVector(d, H / segs);
        pts.push(p.clone());
      }
      addBranch(pts, sp.trunkRadius, sp.trunkRadius * 0.26, 0);
      return pts;
    }

    /* ---- 主入口 ---- */
    if (sp.habit === 'conical') {
      const trunkPts = buildTrunk(18);
      const H = trunkPts[trunkPts.length - 1].y - trunkPts[0].y;

      const rings = sp.rings;
      for (let r = 0; r < rings; r++) {
        const t = 0.12 + 0.86 * (r / (rings - 1));
        const idx = Math.min(trunkPts.length - 2, Math.max(1, Math.round(t * (trunkPts.length - 1))));
        const origin = trunkPts[idx].clone();
        const L0 = sp.ringBranchLen * (0.26 + 0.72 * Math.pow(1 - t, 0.85));
        const rad0 = sp.trunkRadius * (0.26 + 0.50 * Math.pow(1 - t, 0.7));
        const n = 3 + (rnd() < 0.55 ? 1 : 0);

        for (let k = 0; k < n; k++) {
          const az = (k / n) * TAU + r * 0.95 + (rnd() - 0.5) * 0.28;
          const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
          const dirC = out.multiplyScalar(sp.ringOut)
            .add(new THREE.Vector3(0, sp.ringUp, 0))
            .normalize();
          grow(origin.clone(), dirC, L0 * (0.8 + rnd() * 0.4), rad0 * (0.85 + rnd() * 0.3), 1, r);
        }
      }
      // 顶端用一圈短枝收口，避免出现悬空的叶团
      const tip = trunkPts[trunkPts.length - 1].clone();
      for (let k = 0; k < 3; k++) {
        const az = (k / 3) * TAU + rnd();
        const dirC = new THREE.Vector3(Math.cos(az) * 0.55, 1.0, Math.sin(az) * 0.55).normalize();
        grow(tip.clone(), dirC, H * 0.10, sp.trunkRadius * 0.16, Math.min(maxLevel, 2), rings);
      }
    } else {
      // 阔叶：一根主干 + 若干轮生主枝 + 顶梢，形成稳定的瓶状冠
      const trunkPts = buildTrunk(18);
      const top = trunkPts[trunkPts.length - 1];
      const H = top.y;

      const limbCount = sp.limbs;
      for (let i = 0; i < limbCount; i++) {
        const u = limbCount === 1 ? 0.5 : i / (limbCount - 1);
        const t = 0.46 + 0.46 * u;
        const idx = Math.min(trunkPts.length - 2, Math.max(1, Math.round(t * (trunkPts.length - 1))));
        const origin = trunkPts[idx].clone();
        const tan = tangentAt(trunkPts, idx);

        const az = (i / limbCount) * TAU + 0.45 + (rnd() - 0.5) * 0.55;
        const rise = THREE.MathUtils.lerp(sp.limbRise[0], sp.limbRise[1], u);
        const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));

        const dirC = out.clone().add(new THREE.Vector3(0, rise, 0)).normalize();
        dirC.lerp(tan, 0.22).normalize();
        dirC.y += sp.childRise;
        dirC.normalize();

        const L = H * THREE.MathUtils.lerp(sp.limbLen[0], sp.limbLen[1], u) * (0.9 + rnd() * 0.22);
        const rad = sp.trunkRadius * THREE.MathUtils.lerp(0.60, 0.40, t) * (0.95 + rnd() * 0.12);
        grow(origin, dirC, L, rad, 1, i);
      }

      const topDir = new THREE.Vector3(
        (rnd() - 0.5) * 0.35, 1, (rnd() - 0.5) * 0.35
      ).normalize();
      grow(top.clone(), topDir, H * 0.34, sp.trunkRadius * 0.26, 1, limbCount);
    }

    /* 按分组求重心：一根主枝上的叶子算作一个整体 */
    const canopyCenter = new THREE.Vector3(0, 0, 0);
    const groupSum = new Map();
    if (leaves.length) {
      const p = new THREE.Vector3();
      for (let i = 0; i < leaves.length; i++) {
        p.setFromMatrixPosition(leaves[i]);
        canopyCenter.add(p);
        const g = leafClusterIds[i];
        let e = groupSum.get(g);
        if (!e) { e = { c: new THREE.Vector3(), n: 0 }; groupSum.set(g, e); }
        e.c.add(p);
        e.n++;
      }
      canopyCenter.multiplyScalar(1 / leaves.length);
      groupSum.forEach(function (e) { e.c.multiplyScalar(1 / e.n); });
    }

    const leafClusters = new Array(leaves.length);
    for (let i = 0; i < leaves.length; i++) {
      const e = groupSum.get(leafClusterIds[i]);
      leafClusters[i] = e ? e.c : canopyCenter;
    }

    // 取景参考：高度、冠幅、冠心水平位置
    const fit = {
      height: maxY,
      radius: maxXZ,
      centerX: canopyCenter.x,
      centerZ: canopyCenter.z
    };

    return {
      branches: branches, leaves: leaves, leafClusters: leafClusters,
      species: sp, season: season, fit: fit
    };
  }

  /* ---------------- 管道几何 ---------------- */
  function buildTrunkGeometry(branches) {
    const positions = [], normals = [], uvs = [], colors = [], indices = [];
    const RAD = 6;
    const tmpB = new THREE.Vector3();
    const woodDark = new THREE.Color('#38281b');
    const woodLight = new THREE.Color('#8a6a4c');
    const col = new THREE.Color();
    let vBase = 0;

    for (let bi = 0; bi < branches.length; bi++) {
      const b = branches[bi];
      const pts = b.pts;
      const n = pts.length;
      if (n < 2) continue;

      let tan = pts[1].clone().sub(pts[0]).normalize();
      let ref = Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      let nrm = new THREE.Vector3().crossVectors(tan, ref).normalize();

      const levelDark = Math.min(0.42, b.level * 0.075);

      for (let i = 0; i < n; i++) {
        if (i === 0) {
          tan = pts[1].clone().sub(pts[0]).normalize();
        } else if (i === n - 1) {
          tan = pts[n - 1].clone().sub(pts[n - 2]).normalize();
        } else {
          tan = pts[i + 1].clone().sub(pts[i - 1]).normalize();
        }
        nrm.addScaledVector(tan, -nrm.dot(tan));
        if (nrm.lengthSq() < 1e-8) {
          ref = Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          nrm.crossVectors(tan, ref);
        }
        nrm.normalize();
        tmpB.crossVectors(tan, nrm).normalize();

        const t = i / (n - 1);
        const r = b.r0 + (b.r1 - b.r0) * Math.pow(t, 0.72);

        for (let j = 0; j <= RAD; j++) {
          const a = (j / RAD) * TAU;
          const ca = Math.cos(a), sa = Math.sin(a);
          const nx = nrm.x * ca + tmpB.x * sa;
          const ny = nrm.y * ca + tmpB.y * sa;
          const nz = nrm.z * ca + tmpB.z * sa;

          positions.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
          normals.push(nx, ny, nz);
          uvs.push(j / RAD, t * 2);

          const shade = 0.55 * (1 - levelDark) + 0.45 * (1 - Math.abs(ca) * 0.35);
          col.copy(woodDark).lerp(woodLight, Math.min(1, shade) * (0.75 + 0.25 * (1 - t)));
          colors.push(col.r, col.g, col.b);
        }
      }

      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < RAD; j++) {
          const a = vBase + i * (RAD + 1) + j;
          const c = a + RAD + 1;
          indices.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
      vBase += n * (RAD + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /* ---------------- 叶片纹理 ---------------- */
  function makeLeafTexture(shape) {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);

    g.fillStyle = '#ffffff';
    g.beginPath();

    if (shape === 'needle') {
      const w = 8;
      g.moveTo(S / 2, 6);
      g.quadraticCurveTo(S / 2 + w, S * 0.42, S / 2, S - 4);
      g.quadraticCurveTo(S / 2 - w, S * 0.42, S / 2, 6);
    } else if (shape === 'willow') {
      const w = 21;
      g.moveTo(S / 2, 5);
      g.bezierCurveTo(S / 2 + w, S * 0.40, S / 2 + w * 0.55, S * 0.92, S / 2, S - 3);
      g.bezierCurveTo(S / 2 - w * 0.55, S * 0.92, S / 2 - w, S * 0.40, S / 2, 5);
    } else if (shape === 'petal') {
      g.moveTo(S / 2, 8);
      g.bezierCurveTo(S * 0.92, S * 0.16, S * 0.90, S * 0.80, S / 2, S * 0.94);
      g.bezierCurveTo(S * 0.10, S * 0.80, S * 0.08, S * 0.16, S / 2, 8);
    } else {
      // 窄长叶：宽约 0.45S
      g.moveTo(S / 2, 4);
      g.bezierCurveTo(S * 0.80, S * 0.22, S * 0.82, S * 0.72, S / 2, S - 4);
      g.bezierCurveTo(S * 0.18, S * 0.72, S * 0.20, S * 0.22, S / 2, 4);
    }
    g.fill();

    if (shape === 'petal') {
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(S / 2, 11, 8, 0, TAU);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }

    return c;
  }

  global.PTTree = {
    SPECIES: SPECIES,
    SEASONS: SEASONS,
    generate: generate,
    buildTrunkGeometry: buildTrunkGeometry,
    makeLeafTexture: makeLeafTexture
  };
})(window);
