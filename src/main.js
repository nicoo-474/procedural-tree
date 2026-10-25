/* 场景装配、交互与导出 */
(function () {
  'use strict';

  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const BG = 0xf1eadf;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 9, 30);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(4.5, 3.2, 5.6);

  /* ---------- 光照 ---------- */
  const hemi = new THREE.HemisphereLight(0xfff7ea, 0xd5c6ae, 0.95);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1da, 2.30);
  key.position.set(6.2, 5.4, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 6.5;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 24;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 6;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 1.6, 0);

  const fill = new THREE.DirectionalLight(0xcadcf4, 0.50);
  fill.position.set(-5.2, 3.4, -4.4);
  scene.add(fill);

  /* ---------- 地面 ---------- */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 96),
    new THREE.MeshStandardMaterial({ color: 0xe9dfcd, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function radialTexture(inner, outer, size) {
    const s = size || 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.55, outer.replace(/[\d.]+\)$/, '0.18)'));
    grd.addColorStop(1, outer.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return c;
  }

  const aoTex = new THREE.CanvasTexture(radialTexture('rgba(70,50,30,0.55)', 'rgba(70,50,30,0.30)', 256));
  aoTex.colorSpace = THREE.SRGBColorSpace;
  const aoMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, opacity: 0.30 })
  );
  aoMesh.rotation.x = -Math.PI / 2;
  aoMesh.position.y = 0.004;
  scene.add(aoMesh);

  /* ---------- 风场 uniforms ---------- */
  const wind = {
    uTime: { value: 0 },
    uWind: { value: 0.6 }
  };

  /* ---------- 轨道控制 ---------- */
  const ctrl = {
    az: 0.62, el: 0.20, dist: 7.6,
    target: new THREE.Vector3(0, 1.75, 0),
    vAz: 0, vEl: 0,
    dragging: false, lastX: 0, lastY: 0, idle: 0
  };

  function applyCamera() {
    const ce = Math.cos(ctrl.el), se = Math.sin(ctrl.el);
    camera.position.set(
      ctrl.target.x + ctrl.dist * ce * Math.sin(ctrl.az),
      ctrl.target.y + ctrl.dist * se,
      ctrl.target.z + ctrl.dist * ce * Math.cos(ctrl.az)
    );
    camera.lookAt(ctrl.target);
  }

  canvas.addEventListener('pointerdown', function (e) {
    ctrl.dragging = true;
    ctrl.lastX = e.clientX;
    ctrl.lastY = e.clientY;
    ctrl.idle = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!ctrl.dragging) return;
    const dx = e.clientX - ctrl.lastX;
    const dy = e.clientY - ctrl.lastY;
    ctrl.lastX = e.clientX;
    ctrl.lastY = e.clientY;
    ctrl.vAz -= dx * 0.005;
    ctrl.vEl += dy * 0.004;
    ctrl.az += ctrl.vAz;
    ctrl.el += ctrl.vEl;
    ctrl.idle = 0;
  });
  function endDrag(e) {
    if (!ctrl.dragging) return;
    ctrl.dragging = false;
    canvas.style.cursor = 'grab';
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    ctrl.dist *= Math.exp(e.deltaY * 0.0011);
    ctrl.dist = Math.max(3.0, Math.min(15, ctrl.dist));
    ctrl.idle = 0;
  }, { passive: false });
  canvas.style.cursor = 'grab';

  /* ---------- 状态 ---------- */
  const state = {
    species: 'oak',
    season: 'summer',
    seed: 20261025,
    maxLevel: 4,
    leafDensity: 1.0,
    wind: 0.6,
    autoRotate: true,
    fitOverride: false
  };

  let trunkMesh = null;
  let leafMesh = null;
  let leafGeo = null;
  let leafMatrices = [];
  let leafColors = [];
  let leafSphereNormals = [];
  let leafCanvas = null;
  let trunkIndexCount = 0;
  let grow = { start: 0, dur: 1.5, active: false };
  let stats = { branches: 0, leaves: 0, tris: 0 };

  /* 根据树的高度和冠幅自动取景 */
  function autoFit(fit) {
    ctrl.target.set(fit.centerX || 0, fit.height * 0.50, fit.centerZ || 0);

    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const tanH = tanV * camera.aspect;
    const fill = 0.58;                       // 树占画面高度的比例
    const distV = (fit.height * 0.5) / (tanV * fill);
    const distH = fit.radius / (tanH * fill);
    const d = Math.max(distV, distH);

    ctrl.dist = Math.max(3.8, Math.min(24, d));
    aoMesh.scale.setScalar(Math.max(2.2, fit.radius * 2.4));
  }

  /* ---------- 生成 ---------- */
  function disposeTree() {
    if (trunkMesh) {
      scene.remove(trunkMesh);
      trunkMesh.geometry.dispose();
      trunkMesh.material.dispose();
      trunkMesh = null;
    }
    if (leafMesh) {
      scene.remove(leafMesh);
      if (leafMesh.material.map) leafMesh.material.map.dispose();
      leafMesh.material.dispose();
      if (leafMesh.customDepthMaterial) {
        leafMesh.customDepthMaterial.dispose();
      }
      leafMesh = null;
    }
    if (leafGeo) {
      leafGeo.dispose();
      leafGeo = null;
    }
  }

  function buildLeafMaterial(tex) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.86,
      metalness: 0,
      color: 0xffffff
    });

    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = wind.uTime;
      shader.uniforms.uWind = wind.uWind;

      shader.vertexShader =
        'uniform float uTime;\nuniform float uWind;\nattribute vec3 aClusterCenter;\n' +
        shader.vertexShader;

      // 法线不再用叶片自身的朝向，而是「叶丛中心 → 本片叶子」的方向，
      // 也就是把一丛叶子当成一个球来看待。
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        [
          'vec3 objectNormal;',
          '#ifdef USE_INSTANCING',
          '  vec3 sphOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
          '  vec3 sphDir = sphOrigin - aClusterCenter;',
          '  float sphLen = length(sphDir);',
          '  objectNormal = sphLen > 1e-4 ? sphDir / sphLen : vec3(0.0, 1.0, 0.0);',
          '#else',
          '  objectNormal = vec3(0.0, 0.0, 1.0);',
          '#endif'
        ].join('\n')
      );

      // objectNormal 已经在树的空间里，不能再被实例矩阵旋转一次
      shader.vertexShader = shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        [
          'vec3 transformedNormal = normalMatrix * objectNormal;',
          '#ifdef FLIP_SIDED',
          '  transformedNormal = -transformedNormal;',
          '#endif'
        ].join('\n')
      );

      // 双面材质会按面朝向翻转法线，球形法线不能翻
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\n  normal = normalize( vNormal );\n#endif'
      );

      // 风摆
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
          '  float ph = iOrigin.x * 2.13 + iOrigin.z * 2.71 + iOrigin.y * 1.37;',
          '  float s1 = sin(uTime * 1.62 + ph);',
          '  float s2 = sin(uTime * 2.86 + ph * 1.73);',
          '  float amp = uWind * 0.085 * (0.35 + 0.65 * (position.y + 0.5));',
          '  transformed.x += s1 * amp;',
          '  transformed.z += cos(uTime * 1.23 + ph * 1.19) * amp * 0.78;',
          '  transformed.y += s2 * amp * 0.28;',
          '#endif'
        ].join('\n')
      );
    };
    return mat;
  }

  function regenerate(newSeed) {
    if (newSeed) state.seed = (Math.random() * 1e9) | 0;

    disposeTree();

    const t0 = performance.now();
    const data = PTTree.generate({
      species: state.species,
      season: state.season,
      seed: state.seed,
      maxLevel: state.maxLevel,
      leafDensity: state.leafDensity
    });
    const sp = data.species;

    if (!state.fitOverride) autoFit(data.fit);

    // 树干
    const trunkGeo = PTTree.buildTrunkGeometry(data.branches);
    const trunkMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0
    });
    trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    scene.add(trunkMesh);
    trunkIndexCount = trunkGeo.index.count;

    // 叶片
    leafCanvas = PTTree.makeLeafTexture(sp.leafShape);
    const tex = new THREE.CanvasTexture(leafCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    leafGeo = new THREE.PlaneGeometry(1, 1);
    const mat = buildLeafMaterial(tex);
    const count = data.leaves.length;

    // 每片叶子属于哪一丛，供球形法线使用
    const clusterArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const c = data.leafClusters[i] || data.leafClusters[0];
      clusterArr[i * 3] = c.x;
      clusterArr[i * 3 + 1] = c.y;
      clusterArr[i * 3 + 2] = c.z;
    }
    leafGeo.setAttribute('aClusterCenter', new THREE.InstancedBufferAttribute(clusterArr, 3));

    leafMesh = new THREE.InstancedMesh(leafGeo, mat, Math.max(1, count));
    leafMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    leafMesh.castShadow = true;
    // 同一树杈上的叶子视为一个整体，不再互相投影，否则冠内会碎成噪点
    leafMesh.receiveShadow = false;
    leafMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: tex,
      alphaTest: 0.45
    });

    // 整棵树只用一种叶色，形体交给球形法线的光照去表达
    const leafColor = new THREE.Color(sp.palette[state.season] || sp.palette.summer);

    leafMatrices = data.leaves;
    leafColors = [];
    leafSphereNormals = data.leafClusters.map(function (c, i) {
      const p = new THREE.Vector3().setFromMatrixPosition(data.leaves[i]);
      return p.sub(c).normalize();
    });

    for (let i = 0; i < count; i++) {
      leafMesh.setMatrixAt(i, data.leaves[i]);
      leafMesh.setColorAt(i, leafColor);
      leafColors.push(leafColor);
    }
    leafMesh.instanceMatrix.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;

    scene.add(leafMesh);

    stats = {
      branches: data.branches.length,
      leaves: count,
      tris: Math.round(trunkIndexCount / 3) + count * 2
    };
    updateStats();

    grow.start = performance.now();
    grow.dur = state.instant ? 0 : 1.5;
    grow.active = true;

    const t1 = performance.now();
    console.log('[tree] ' + sp.label + ' 生成 ' + Math.round(t1 - t0) + 'ms, 枝条 ' +
      stats.branches + ', 叶片 ' + stats.leaves);
  }

  function updateStats() {
    document.getElementById('s-branch').textContent = stats.branches;
    document.getElementById('s-leaf').textContent = stats.leaves;
    document.getElementById('s-tri').textContent = stats.tris.toLocaleString('en-US');
    document.getElementById('s-seed').textContent = state.seed;
  }

  /* ---------- 导出 ---------- */
  function doExport() {
    if (!trunkMesh || !leafMesh) return;
    try {
      const trunkPart = {
        name: 'trunk',
        positions: trunkMesh.geometry.attributes.position.array,
        normals: trunkMesh.geometry.attributes.normal.array,
        uvs: trunkMesh.geometry.attributes.uv.array,
        colors: trunkMesh.geometry.attributes.color.array,
        indices: trunkMesh.geometry.index.array,
        material: { baseColor: [1, 1, 1, 1], roughness: 0.94, metallic: 0 }
      };

      const baked = PTExport.bakeInstances(leafGeo, leafMatrices, leafColors, leafSphereNormals);
      const leafPart = {
        name: 'leaves',
        positions: baked.positions,
        normals: baked.normals,
        uvs: baked.uvs,
        colors: baked.colors,
        indices: baked.indices,
        material: {
          baseColor: [1, 1, 1, 1],
          roughness: 0.86,
          metallic: 0,
          textureCanvas: leafCanvas,
          alphaCutoff: 0.45,
          doubleSided: true
        }
      };

      const bytes = PTExport.buildGLB([trunkPart, leafPart], { name: 'ProceduralTree' });
      PTExport.download(bytes, 'tree_' + state.species + '_' + state.seed + '.glb');
      flash('已导出 ' + (bytes.byteLength / 1024).toFixed(0) + ' KB');
    } catch (err) {
      console.error(err);
      flash('导出失败：' + err.message, true);
    }
  }

  let flashTimer = 0;
  function flash(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.color = isError ? '#a33' : '#4f6b3d';
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------- URL 参数（便于无头截图复现） ---------- */
  (function parseHash() {
    const h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    const q = {};
    h.split('&').forEach(function (kv) {
      const p = kv.split('=');
      if (p[0]) q[p[0]] = decodeURIComponent(p[1] || '');
    });
    if (q.species && PTTree.SPECIES[q.species]) state.species = q.species;
    if (q.season && PTTree.SEASONS[q.season]) state.season = q.season;
    if (q.seed) state.seed = parseInt(q.seed, 10) || state.seed;
    if (q.level) state.maxLevel = Math.max(2, Math.min(5, parseInt(q.level, 10)));
    if (q.density) state.leafDensity = parseFloat(q.density);
    if (q.wind) state.wind = parseFloat(q.wind);
    if (q.instant) state.instant = true;
    if (q.az) ctrl.az = parseFloat(q.az);
    if (q.el) ctrl.el = parseFloat(q.el);
    if (q.dist) { ctrl.dist = parseFloat(q.dist); state.fitOverride = true; }
    if (q.noauto) state.autoRotate = false;
  })();

  /* ---------- UI ---------- */
  function buildChips(containerId, items, current, onPick) {
    const box = document.getElementById(containerId);
    box.innerHTML = '';
    Object.keys(items).forEach(function (k) {
      const btn = document.createElement('button');
      btn.textContent = items[k].label;
      btn.className = 'chip' + (k === current ? ' on' : '');
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('on'); });
        btn.classList.add('on');
        onPick(k);
      });
      box.appendChild(btn);
    });
  }

  function bindSlider(id, labelId, key, fmt) {
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    let timer = 0;
    el.addEventListener('input', function () {
      const v = parseFloat(el.value);
      state[key] = v;
      lab.textContent = fmt ? fmt(v) : v;
      if (key === 'wind') wind.uWind.value = v;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (key !== 'wind') regenerate(false);
      }, 160);
    });
  }

  buildChips('species', PTTree.SPECIES, state.species, function (k) {
    state.species = k;
    regenerate(false);
  });
  buildChips('season', PTTree.SEASONS, state.season, function (k) {
    state.season = k;
    regenerate(false);
  });

  bindSlider('level', 'v-level', 'maxLevel', function (v) { return v.toFixed(0); });
  bindSlider('density', 'v-density', 'leafDensity', function (v) { return v.toFixed(1); });
  bindSlider('wind', 'v-wind', 'wind', function (v) { return v.toFixed(2); });

  document.getElementById('regen').addEventListener('click', function () { regenerate(true); });
  document.getElementById('export').addEventListener('click', doExport);


  /* ---------- 初始化 ---------- */
  document.getElementById('v-level').textContent = state.maxLevel.toFixed(0);
  document.getElementById('v-density').textContent = state.leafDensity.toFixed(1);
  document.getElementById('v-wind').textContent = state.wind.toFixed(2);
  document.getElementById('level').value = state.maxLevel;
  document.getElementById('density').value = state.leafDensity;
  document.getElementById('wind').value = state.wind;
  wind.uWind.value = state.wind;

  regenerate(false);
  applyCamera();

  /* ---------- 主循环 ---------- */
  const clock = new THREE.Clock();
  const easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();
    wind.uTime.value = t;

    if (grow.active) {
      const p = grow.dur <= 0 ? 1 : Math.min(1, (performance.now() - grow.start) / (grow.dur * 1000));
      const e = easeOut(p);
      if (trunkMesh) {
        const c = Math.floor((trunkIndexCount * e) / 3) * 3;
        trunkMesh.geometry.setDrawRange(0, Math.max(3, c));
      }
      if (leafMesh) {
        leafMesh.count = Math.max(1, Math.floor(stats.leaves * e));
      }
      if (p >= 1) {
        grow.active = false;
        if (trunkMesh) trunkMesh.geometry.setDrawRange(0, trunkIndexCount);
        if (leafMesh) leafMesh.count = stats.leaves;
      }
    }

    if (!ctrl.dragging) {
      ctrl.az += ctrl.vAz;
      ctrl.el += ctrl.vEl;
      ctrl.vAz *= 0.90;
      ctrl.vEl *= 0.90;
      ctrl.idle += dt;
      if (state.autoRotate && ctrl.idle > 3.0) ctrl.az += dt * 0.10;
    }
    ctrl.el = Math.max(-0.06, Math.min(1.22, ctrl.el));

    applyCamera();

    if (leafMesh) {
      leafMesh.rotation.z = Math.sin(t * 0.83) * 0.0045 * wind.uWind.value;
    }

    renderer.render(scene, camera);
  }

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();

  window.__PT = {
    state: state,
    ctrl: ctrl,
    regenerate: regenerate,
    exportGLB: doExport,
    stats: function () { return stats; }
  };
})();
