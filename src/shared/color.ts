// RuneScape packs colors as 16-bit HSL: 6 bits hue, 3 bits saturation, 7 bits lightness.

export function rgbToHsl(rgb: number): number {
  const r = ((rgb >> 16) & 0xff) / 256;
  const g = ((rgb >> 8) & 0xff) / 256;
  const b = (rgb & 0xff) / 256;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  let hue = 0;
  let saturation = 0;
  const lightness = (min + max) / 2;
  if (min !== max) {
    saturation = lightness < 0.5 ? (max - min) / (min + max) : (max - min) / (2 - max - min);
    if (max === r) hue = (g - b) / (max - min);
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
  }
  hue /= 6;
  const light = Math.min(255, Math.max(0, Math.trunc(lightness * 256)));
  const h = Math.trunc(hue * 256);
  return packHsl(light, Math.min(255, Math.max(0, Math.trunc(saturation * 256))), h);
}

export function packHsl(lightness: number, saturation: number, hue: number): number {
  if (lightness > 243) saturation >>= 4;
  else if (lightness > 217) saturation >>= 3;
  else if (lightness > 192) saturation >>= 2;
  else if (lightness > 179) saturation >>= 1;
  return ((lightness >> 1) + ((saturation >> 5) << 7) + ((hue >> 2) << 10)) & 0xffff;
}

/** HSL16 -> 0xRRGGBB, matching the client's palette (brightness is a gamma exponent). */
export function hslToRgb(hsl: number, brightness = 0.8): number {
  const hue = ((hsl >> 10) & 0x3f) / 64 + 0.0078125;
  const sat = ((hsl >> 7) & 0x7) / 8 + 0.0625;
  const light = (hsl & 0x7f) / 128;
  let r = light;
  let g = light;
  let b = light;
  if (sat !== 0) {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    const channel = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (6 * t < 1) return p + (q - p) * 6 * t;
      if (2 * t < 1) return q;
      if (3 * t < 2) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = channel(hue + 1 / 3);
    g = channel(hue);
    b = channel(hue - 1 / 3);
  }
  const to8 = (v: number) => Math.min(255, Math.max(0, Math.round(Math.pow(v, brightness) * 256)));
  return (to8(r) << 16) | (to8(g) << 8) | to8(b);
}

/** Palette exponent the HD (GL) client uses with high-detail lighting. */
export const HD_BRIGHTNESS = 0.7;

/** Client ColorUtils.multiplyLightness2: scales HSL lightness by factor/128, clamped to 2..126. */
export function scaleLightness(hsl: number, factor: number): number {
  let l = (factor * (hsl & 0x7f)) >> 7;
  if (l < 2) l = 2;
  else if (l > 126) l = 126;
  return (hsl & 0xff80) + l;
}

/**
 * Vertex color the HD client gives a model face before GL lighting (GlModel.packColorToRGBA):
 * lightness scaled by the model's ambient, and textured faces lifted toward white by the texture's brightness.
 */
export function hdFaceColor(hsl: number, ambient: number, textureBrightness = 0): number {
  let rgb = hslToRgb(scaleLightness(hsl, ambient), HD_BRIGHTNESS);
  if (textureBrightness !== 0) {
    const white = ambient < 0 ? 0 : ambient > 127 ? 0xffffff : ambient * 0x020202;
    if (textureBrightness >= 256) rgb = white;
    else {
      const b = textureBrightness, k = 256 - b;
      rgb = ((((white & 0xff00ff) * b + (rgb & 0xff00ff) * k) & 0xff00ff00) + (((white & 0xff00) * b + (rgb & 0xff00) * k) & 0xff0000)) >>> 8;
    }
  }
  return rgb;
}

/** Grey of the given HSL lightness (0-127), as used under textured ground tiles. */
export function greyRgb(lightness: number): number {
  const v = Math.min(255, Math.max(0, Math.round(Math.pow(Math.max(2, Math.min(126, lightness)) / 128, HD_BRIGHTNESS) * 256)));
  return (v << 16) | (v << 8) | v;
}
