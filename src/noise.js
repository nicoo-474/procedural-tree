/* 确定性随机 + 3D Perlin 噪声 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function grad(hash, x, y, z) {
    switch (hash & 15) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x + z;
      case 5: return -x + z;
      case 6: return x - z;
      case 7: return -x - z;
      case 8: return y + z;
      case 9: return -y + z;
      case 10: return y - z;
      case 11: return -y - z;
      case 12: return x + y;
      case 13: return -x + y;
      case 14: return y - z;
      default: return -y + z;
    }
  }

  function Noise3D(seed) {
    const rnd = mulberry32((seed | 0) + 1);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  Noise3D.prototype.noise = function (x, y, z) {
    const p = this.p;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);

    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

    return lerp(
      lerp(
        lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v),
      lerp(
        lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v),
      w);
  };

  Noise3D.prototype.fbm = function (x, y, z, oct) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < (oct || 3); i++) {
      sum += this.noise(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2.07;
    }
    return sum / norm;
  };

  global.PTNoise = { Noise3D: Noise3D, mulberry32: mulberry32 };
})(window);
