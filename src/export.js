/* 极简 glTF 2.0 (.glb) 导出器：支持顶点色 + 内嵌 PNG 贴图 + 透明裁剪 */
(function (global) {
  'use strict';

  const ARRAY_BUFFER = 34962;
  const ELEMENT_ARRAY_BUFFER = 34963;
  const FLOAT = 5126;
  const UINT = 5125;
  const UNSIGNED_BYTE = 5121;

  function align4(n) { return (n + 3) & ~3; }

  function b64ToBytes(dataURL) {
    const b64 = dataURL.split(',')[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bounds(arr, stride) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += stride) {
      for (let k = 0; k < 3; k++) {
        const v = arr[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    if (!isFinite(min[0])) { min[0] = min[1] = min[2] = 0; max[0] = max[1] = max[2] = 0; }
    return { min: min, max: max };
  }

  function buildGLB(parts, meta) {
    const gltf = {
      asset: { version: '2.0', generator: 'procedural-tree' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: (meta && meta.name) || 'ProceduralTree' }],
      meshes: [{ name: 'Tree', primitives: [] }],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
      textures: [],
      images: [],
      samplers: []
    };

    const bin = [];
    let offset = 0;

    function pushBytes(bytes) {
      const pad = (4 - (offset % 4)) % 4;
      if (pad) { bin.push(new Uint8Array(pad)); offset += pad; }
      const start = offset;
      bin.push(bytes);
      offset += bytes.byteLength;
      return { byteOffset: start, byteLength: bytes.byteLength };
    }

    function pushTyped(typed) {
      const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      return pushBytes(bytes);
    }

    function addBufferView(typed, target) {
      const bv = pushTyped(typed);
      const view = { buffer: 0, byteOffset: bv.byteOffset, byteLength: bv.byteLength };
      if (target) view.target = target;
      gltf.bufferViews.push(view);
      return gltf.bufferViews.length - 1;
    }

    function addAccessor(typed, type, count, componentType, target, minmax, normalized) {
      const bvIndex = addBufferView(typed, target);
      const acc = {
        bufferView: bvIndex,
        componentType: componentType,
        count: count,
        type: type
      };
      // 整型颜色必须声明 normalized，否则会被当成 0~255 直接截断
      if (normalized) acc.normalized = true;
      if (minmax) { acc.min = minmax.min; acc.max = minmax.max; }
      gltf.accessors.push(acc);
      return gltf.accessors.length - 1;
    }

    const imageCache = new Map();

    function addTexture(canvas) {
      if (imageCache.has(canvas)) return imageCache.get(canvas);
      const bytes = b64ToBytes(canvas.toDataURL('image/png'));
      const bv = pushBytes(bytes);
      gltf.bufferViews.push({ buffer: 0, byteOffset: bv.byteOffset, byteLength: bv.byteLength });
      const bvIndex = gltf.bufferViews.length - 1;

      gltf.images.push({ bufferView: bvIndex, mimeType: 'image/png', name: 'leaf' });
      gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
      gltf.textures.push({ sampler: gltf.samplers.length - 1, source: gltf.images.length - 1 });

      const index = gltf.textures.length - 1;
      imageCache.set(canvas, index);
      return index;
    }

    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const pos = part.positions;
      const vCount = pos.length / 3;

      const positionAcc = addAccessor(
        new Float32Array(pos), 'VEC3', vCount, FLOAT,
        ARRAY_BUFFER, bounds(pos, 3)
      );

      const attrs = { POSITION: positionAcc };

      if (part.normals && part.normals.length) {
        attrs.NORMAL = addAccessor(
          new Float32Array(part.normals), 'VEC3', vCount, FLOAT, ARRAY_BUFFER, null
        );
      }
      if (part.uvs && part.uvs.length) {
        attrs.TEXCOORD_0 = addAccessor(
          new Float32Array(part.uvs), 'VEC2', vCount, FLOAT, ARRAY_BUFFER, null
        );
      }
      if (part.colors && part.colors.length) {
        const cArr = new Uint8Array(vCount * 4);
        for (let i = 0; i < vCount; i++) {
          cArr[i * 4] = Math.max(0, Math.min(255, Math.round(part.colors[i * 3] * 255)));
          cArr[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(part.colors[i * 3 + 1] * 255)));
          cArr[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(part.colors[i * 3 + 2] * 255)));
          cArr[i * 4 + 3] = 255;
        }
        attrs.COLOR_0 = addAccessor(
          cArr, 'VEC4', vCount, UNSIGNED_BYTE, ARRAY_BUFFER, null, true
        );
      }

      const indices = new Uint32Array(part.indices);
      const indexAcc = addAccessor(
        indices, 'SCALAR', indices.length, UINT, ELEMENT_ARRAY_BUFFER, null
      );

      const mat = part.material || {};
      const pbr = {
        baseColorFactor: mat.baseColor || [1, 1, 1, 1],
        metallicFactor: mat.metallic === undefined ? 0 : mat.metallic,
        roughnessFactor: mat.roughness === undefined ? 0.8 : mat.roughness
      };

      const material = { name: part.name || ('mat' + p), pbrMetallicRoughness: pbr };

      if (mat.textureCanvas) {
        material.pbrMetallicRoughness.baseColorTexture = { index: addTexture(mat.textureCanvas) };
        material.alphaMode = 'MASK';
        material.alphaCutoff = mat.alphaCutoff === undefined ? 0.45 : mat.alphaCutoff;
      }
      if (mat.doubleSided) material.doubleSided = true;

      gltf.materials.push(material);
      gltf.meshes[0].primitives.push({
        attributes: attrs,
        indices: indexAcc,
        material: gltf.materials.length - 1,
        mode: 4
      });
    }

    const binPad = (4 - (offset % 4)) % 4;
    const binLength = offset + binPad;
    gltf.buffers.push({ byteLength: binLength });

    const jsonStr = JSON.stringify(gltf);
    const encoder = new TextEncoder();
    const jsonRaw = encoder.encode(jsonStr);
    const jsonLength = align4(jsonRaw.length);

    const total = 12 + 8 + jsonLength + 8 + binLength;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);

    dv.setUint32(0, 0x46546C67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);

    let ptr = 12;
    dv.setUint32(ptr, jsonLength, true); ptr += 4;
    dv.setUint32(ptr, 0x4E4F534A, true); ptr += 4;
    out.set(jsonRaw, ptr);
    for (let i = jsonRaw.length; i < jsonLength; i++) out[ptr + i] = 0x20;
    ptr += jsonLength;

    dv.setUint32(ptr, binLength, true); ptr += 4;
    dv.setUint32(ptr, 0x004E4942, true); ptr += 4;
    for (let i = 0; i < bin.length; i++) {
      out.set(bin[i], ptr);
      ptr += bin[i].byteLength;
    }

    return out;
  }

  function download(bytes, filename) {
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* 把 InstancedMesh 的实例烘焙成单一几何，便于导出 */
  function bakeInstances(baseGeo, matrices, colors, instNormals) {
    const src = baseGeo.attributes.position;
    const srcN = baseGeo.attributes.normal;
    const srcUV = baseGeo.attributes.uv;
    const srcIdx = baseGeo.index;
    const vCount = src.count;
    const iCount = srcIdx.count;
    const n = matrices.length;

    const positions = new Float32Array(n * vCount * 3);
    const normals = new Float32Array(n * vCount * 3);
    const uvs = new Float32Array(n * vCount * 2);
    const colOut = new Float32Array(n * vCount * 3);
    const indices = new Uint32Array(n * iCount);

    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();

    for (let i = 0; i < n; i++) {
      const m = matrices[i];
      nm.getNormalMatrix(m);
      const c = colors[i];

      for (let k = 0; k < vCount; k++) {
        v.fromBufferAttribute(src, k).applyMatrix4(m);
        positions[(i * vCount + k) * 3] = v.x;
        positions[(i * vCount + k) * 3 + 1] = v.y;
        positions[(i * vCount + k) * 3 + 2] = v.z;

        if (instNormals && instNormals[i]) {
          // 叶丛用球形法线：整片叶子共享同一个方向
          const sn = instNormals[i];
          normals[(i * vCount + k) * 3] = sn.x;
          normals[(i * vCount + k) * 3 + 1] = sn.y;
          normals[(i * vCount + k) * 3 + 2] = sn.z;
        } else {
          v.fromBufferAttribute(srcN, k).applyMatrix3(nm).normalize();
          normals[(i * vCount + k) * 3] = v.x;
          normals[(i * vCount + k) * 3 + 1] = v.y;
          normals[(i * vCount + k) * 3 + 2] = v.z;
        }

        uvs[(i * vCount + k) * 2] = srcUV.getX(k);
        uvs[(i * vCount + k) * 2 + 1] = srcUV.getY(k);

        colOut[(i * vCount + k) * 3] = c.r;
        colOut[(i * vCount + k) * 3 + 1] = c.g;
        colOut[(i * vCount + k) * 3 + 2] = c.b;
      }

      for (let k = 0; k < iCount; k++) {
        indices[i * iCount + k] = srcIdx.getX(k) + i * vCount;
      }
    }

    return { positions: positions, normals: normals, uvs: uvs, colors: colOut, indices: indices };
  }

  global.PTExport = { buildGLB: buildGLB, download: download, bakeInstances: bakeInstances };
})(window);
