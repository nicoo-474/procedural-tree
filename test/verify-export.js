/*
 * 导出链路自检：在 Node 里跑一遍生成 → 烘焙 → 打包 GLB，并校验 glTF 容器结构。
 * 用法：node test/verify-export.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- 浏览器环境替身 ---------- */
global.window = global;

function fakeCtx() {
  const chain = new Proxy({}, {
    get: function (_t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      if (k === 'canvas') return null;
      if (k === 'globalCompositeOperation' || k === 'fillStyle' ||
          k === 'strokeStyle' || k === 'lineWidth') return '';
      return function () {};
    },
    set: function () { return true; }
  });
  return chain;
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

global.document = {
  createElement: function (tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext: function () { return fakeCtx(); },
      toDataURL: function () { return TINY_PNG; }
    };
  }
};

/* ---------- 加载 THREE 与项目模块 ---------- */
const THREE = require('../vendor/three.min.js');
global.THREE = THREE;

require('../src/noise.js');
require('../src/tree.js');
require('../src/export.js');

console.log('THREE 版本:', THREE.REVISION);

/* ---------- 生成一棵小树 ---------- */
const t0 = Date.now();
const data = PTTree.generate({
  species: 'oak',
  season: 'summer',
  seed: 20261025,
  maxLevel: 3,
  leafDensity: 0.45
});
const trunkGeo = PTTree.buildTrunkGeometry(data.branches);
const leafCanvas = PTTree.makeLeafTexture(data.species.leafShape);

console.log('生成耗时:', Date.now() - t0, 'ms');
console.log('枝条:', data.branches.length, ' 叶片:', data.leaves.length);

/* ---------- 烘焙叶片实例 ---------- */
const leafGeo = new THREE.PlaneGeometry(1, 1);
const leafColor = new THREE.Color(data.species.palette.summer);
const colors = data.leaves.map(function () { return leafColor; });
const sphereNormals = data.leafClusters.map(function (c, i) {
  const p = new THREE.Vector3().setFromMatrixPosition(data.leaves[i]);
  return p.sub(c).normalize();
});

const baked = PTExport.bakeInstances(leafGeo, data.leaves, colors, sphereNormals);

/* ---------- 打包 GLB ---------- */
const bytes = PTExport.buildGLB([
  {
    name: 'trunk',
    positions: trunkGeo.attributes.position.array,
    normals: trunkGeo.attributes.normal.array,
    uvs: trunkGeo.attributes.uv.array,
    colors: trunkGeo.attributes.color.array,
    indices: trunkGeo.index.array,
    material: { baseColor: [1, 1, 1, 1], roughness: 0.94, metallic: 0 }
  },
  {
    name: 'leaves',
    positions: baked.positions,
    normals: baked.normals,
    uvs: baked.uvs,
    colors: baked.colors,
    indices: baked.indices,
    material: {
      baseColor: [1, 1, 1, 1], roughness: 0.86, metallic: 0,
      textureCanvas: leafCanvas, alphaCutoff: 0.45, doubleSided: true
    }
  }
], { name: 'ProceduralTree' });

const outDir = path.join(__dirname, '..', 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'verify-tree.glb');
fs.writeFileSync(outPath, Buffer.from(bytes));
console.log('已写出:', outPath, (bytes.byteLength / 1024).toFixed(1), 'KB');

/* ---------- 校验容器 ---------- */
const errors = [];
function check(cond, msg) { if (!cond) errors.push(msg); }

const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
check(dv.getUint32(0, true) === 0x46546C67, 'magic 不是 glTF');
check(dv.getUint32(4, true) === 2, 'version 不是 2');
check(dv.getUint32(8, true) === bytes.byteLength, 'header 总长度与实际不符');

let p = 12;
const chunks = [];
while (p < bytes.byteLength) {
  const len = dv.getUint32(p, true);
  const type = dv.getUint32(p + 4, true);
  chunks.push({ len: len, type: type, start: p + 8 });
  p += 8 + len;
}
check(chunks.length === 2, 'chunk 数量应为 2，实际 ' + chunks.length);
check(chunks[0] && chunks[0].len % 4 === 0, 'JSON chunk 未 4 字节对齐');
check(chunks[1] && chunks[1].len % 4 === 0, 'BIN chunk 未 4 字节对齐');
check(chunks[0] && chunks[0].type === 0x4E4F534A, 'chunk0 不是 JSON');
check(chunks[1] && chunks[1].type === 0x004E4942, 'chunk1 不是 BIN');
check(p === bytes.byteLength, 'chunk 总长与文件长不一致');

const jsonText = Buffer.from(bytes.buffer, bytes.byteOffset + chunks[0].start, chunks[0].len)
  .toString('utf8').replace(/\s+$/, '');
let gltf;
try { gltf = JSON.parse(jsonText); } catch (e) { errors.push('JSON 解析失败: ' + e.message); }

if (gltf) {
  check(gltf.asset && gltf.asset.version === '2.0', 'asset.version 不是 2.0');
  check(gltf.buffers[0].byteLength === chunks[1].len, 'buffer.byteLength 与 BIN chunk 不符');

  const COMP = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
  const TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  gltf.bufferViews.forEach(function (bv, i) {
    check(bv.byteOffset + bv.byteLength <= gltf.buffers[0].byteLength,
      'bufferView[' + i + '] 越界');
  });

  gltf.accessors.forEach(function (a, i) {
    const bv = gltf.bufferViews[a.bufferView];
    const need = a.count * COMP[a.componentType] * TYPE[a.type];
    check(bv && need <= bv.byteLength,
      'accessor[' + i + '] 需要 ' + need + ' 字节，bufferView 只有 ' + (bv && bv.byteLength));
  });

  gltf.meshes[0].primitives.forEach(function (pr, i) {
    check(pr.attributes.POSITION !== undefined, 'primitive[' + i + '] 缺 POSITION');
    if (pr.attributes.POSITION !== undefined) {
      const pa = gltf.accessors[pr.attributes.POSITION];
      check(pa.min && pa.max, 'primitive[' + i + '] 的 POSITION 缺 min/max');
    }
    check(pr.indices !== undefined, 'primitive[' + i + '] 缺 indices');
    check(pr.material < gltf.materials.length, 'primitive[' + i + '] material 越界');
  });

  const tri = gltf.meshes[0].primitives.map(function (pr) {
    return gltf.accessors[pr.indices].count / 3;
  });
  console.log('primitive 数:', gltf.meshes[0].primitives.length, ' 三角面:', tri.join(' + '), '=',
    tri.reduce(function (a, b) { return a + b; }, 0));
  console.log('材质数:', gltf.materials.length, ' 贴图数:', gltf.textures.length);
  console.log('顶点数:', gltf.meshes[0].primitives.map(function (pr) {
    return gltf.accessors[pr.attributes.POSITION].count;
  }).join(' + '));
}

if (errors.length) {
  console.error('\n校验失败:');
  errors.forEach(function (e) { console.error('  - ' + e); });
  process.exit(1);
}
console.log('\n校验通过：GLB 容器结构合法');
