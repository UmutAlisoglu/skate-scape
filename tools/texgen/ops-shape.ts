// The vector shape rasterizer (rt4 TextureOpShapeRasterizer with TextureOpShapeRect, ShapeBezier, ShapeLine and
// ShapeEllipse). Ported line for line, including the client's argument orders, so the pixels match exactly.
import type { Reader } from '../cache/reader.ts';
import { clamp, div, imul, T, TextureOp } from './core.ts';

let canvas: Int32Array[] = [];
let clipRight = 100, clipBottom = 100, clipLeft = 0, clipTop = 0;

/** ArrayUtils.fillRange: dest[from..to) = value (the client would throw outside the row) */
function fillRange(dest: Int32Array, from: number, to: number, value: number) {
  if (to <= from) return;
  if (from < 0 || to > dest.length) throw new RangeError('shape outside the canvas');
  dest.fill(value, from, to);
}

// ---- TextureOpShapeLine statics ----
function fillSpan(color: number, row: number, x2: number, x1: number) {
  if (x1 <= x2) fillRange(canvas[row], x1, x2, color);
  else fillRange(canvas[row], x2, x1, color);
}
function fillVerticalLine(y1: number, x: number, y2: number, color: number) {
  if (y1 <= y2) for (let y = y1; y < y2; y++) canvas[y][x] = color;
  else for (let y = y2; y < y1; y++) canvas[y][x] = color;
}
function plotLine(color: number, y2: number, y1: number, x2: number, x1: number) {
  let dy = y2 - y1, dx = x2 - x1;
  if (dx === 0) { if (dy !== 0) fillVerticalLine(y1, x1, y2, color); return; }
  if (dy === 0) { fillSpan(color, y1, x2, x1); return; }
  if (dy < 0) dy = -dy;
  if (dx < 0) dx = -dx;
  const steep = dx < dy;
  if (steep) { const t = x1, t2 = x2; x1 = y1; y1 = t; x2 = y2; y2 = t2; }
  if (x2 < x1) { let t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
  let y = y1;
  const run = x2 - x1;
  let deltaY = y2 - y1, error = -(run >> 1);
  const yStep = y2 <= y1 ? -1 : 1;
  if (deltaY < 0) deltaY = -deltaY;
  if (steep) for (let i = x1; i <= x2; i++) { canvas[i][y] = color; error += deltaY; if (error > 0) { y += yStep; error -= run; } }
  else for (let i = x1; i <= x2; i++) { error += deltaY; canvas[y][i] = color; if (error > 0) { y += yStep; error -= run; } }
}
function fillCircle(cx: number, radius: number, color: number, cy: number) {
  let x = 0;
  fillRange(canvas[cy], cx - radius, cx + radius, color);
  let err = -radius, y = radius, delta = -1;
  while (x < y) {
    x++; delta += 2; err += delta;
    if (err >= 0) {
      y--; err -= y << 1;
      fillRange(canvas[cy + y], cx - x, cx + x, color);
      fillRange(canvas[cy - y], cx - x, cx + x, color);
    }
    fillRange(canvas[cy + x], cx - y, y + cx, color);
    fillRange(canvas[cy - x], cx - y, y + cx, color);
  }
}
function drawFramedRect(lineWidth: number, bottom: number, fillColor: number, outlineColor: number, top: number, right: number, left: number) {
  if (clipLeft <= left && clipRight >= right && top >= clipTop && bottom <= clipBottom) {
    const topBorderEnd = lineWidth + top, innerLeft = lineWidth + left, bottomBorderStart = bottom - lineWidth, innerRight = right - lineWidth;
    for (let y = top; y < topBorderEnd; y++) fillRange(canvas[y], left, right, outlineColor);
    for (let y = bottom; y > bottomBorderStart; y--) fillRange(canvas[y], left, right, outlineColor);
    for (let y = topBorderEnd; y <= bottomBorderStart; y++) {
      const row = canvas[y];
      fillRange(row, left, innerLeft, outlineColor); fillRange(row, innerLeft, innerRight, fillColor); fillRange(row, innerRight, right, outlineColor);
    }
  } else {
    const ct = clamp(clipBottom, top, clipTop), cb = clamp(clipBottom, bottom, clipTop), cl = clamp(clipRight, left, clipLeft), cr = clamp(clipRight, right, clipLeft);
    const topBorderEnd = clamp(clipBottom, lineWidth + top, clipTop), bottomBorderStart = clamp(clipBottom, bottom - lineWidth, clipTop);
    for (let y = ct; y < topBorderEnd; y++) fillRange(canvas[y], cl, cr, outlineColor);
    for (let y = cb; y > bottomBorderStart; y--) fillRange(canvas[y], cl, cr, outlineColor);
    const innerLeft = clamp(clipRight, lineWidth + left, clipLeft), innerRight = clamp(clipRight, right - lineWidth, clipLeft);
    for (let y = topBorderEnd; y <= bottomBorderStart; y++) {
      const row = canvas[y];
      fillRange(row, cl, innerLeft, outlineColor); fillRange(row, innerLeft, innerRight, fillColor); fillRange(row, innerRight, cr, outlineColor);
    }
  }
}
function fillSolidRect(left: number, color: number, bottom: number, right: number, top: number) {
  if (left >= clipLeft && right <= clipRight && clipTop <= top && clipBottom >= bottom) {
    for (let y = top; y <= bottom; y++) fillRange(canvas[y], left, right, color);
  } else {
    const ct = clamp(clipBottom, top, clipTop), cb = clamp(clipBottom, bottom, clipTop), cl = clamp(clipRight, left, clipLeft), cr = clamp(clipRight, right, clipLeft);
    for (let y = ct; y <= cb; y++) fillRange(canvas[y], cl, cr, color);
  }
}
function drawRectOutline(color: number, left: number, top: number, right: number, bottom: number, lineWidth: number) {
  if (clipLeft <= left && clipRight >= right && clipTop <= top && bottom <= clipBottom) {
    if (lineWidth === 1) {
      fillRange(canvas[top], left, right, color);
      fillRange(canvas[bottom], left, right, color);
      for (let y = top + 1; y <= bottom - 1; y++) { const row = canvas[y]; row[left] = row[right] = color; }
    } else {
      const topBorderEnd = lineWidth + top, bottomBorderStart = bottom - lineWidth, innerLeft = lineWidth + left, innerRight = right - lineWidth;
      for (let y = top; y < topBorderEnd; y++) fillRange(canvas[y], left, right, color);
      for (let y = bottom; y > bottomBorderStart; y--) fillRange(canvas[y], left, right, color);
      for (let y = topBorderEnd; y <= bottomBorderStart; y++) { const row = canvas[y]; fillRange(row, left, innerLeft, color); fillRange(row, innerRight, right, color); }
    }
  } else if (lineWidth === 1) {
    if (top > clipBottom || bottom < clipTop) return;
    let leftVisible: boolean, rightVisible: boolean;
    if (clipLeft > left) { leftVisible = false; left = clipLeft; }
    else if (clipRight >= left) leftVisible = true;
    else { leftVisible = false; left = clipRight; }
    if (right < clipLeft) { right = clipLeft; rightVisible = false; }
    else if (right > clipRight) { right = clipRight; rightVisible = false; }
    else rightVisible = true;
    if (clipTop > top) top = clipTop;
    else fillRange(canvas[top++], left, right, color);
    if (bottom <= clipBottom) fillRange(canvas[bottom--], left, right, color);
    else bottom = clipBottom;
    if (leftVisible && rightVisible) for (let y = top; y <= bottom; y++) { const row = canvas[y]; row[left] = row[right] = color; }
    else if (leftVisible) for (let y = top; y <= bottom; y++) canvas[y][left] = color;
    else if (rightVisible) for (let y = top; y <= bottom; y++) canvas[y][right] = color;
  } else {
    const ct = clamp(clipBottom, top, clipTop), cb = clamp(clipBottom, bottom, clipTop), cl = clamp(clipRight, left, clipLeft), cr = clamp(clipRight, right, clipLeft);
    const topBorderEnd = clamp(clipBottom, top + lineWidth, clipTop), bottomBorderStart = clamp(clipBottom, bottom - lineWidth, clipTop);
    for (let y = ct; y < topBorderEnd; y++) fillRange(canvas[y], cl, cr, color);
    for (let y = cb; y > bottomBorderStart; y--) fillRange(canvas[y], cl, cr, color);
    const innerLeft = clamp(clipRight, lineWidth + left, clipLeft), innerRight = clamp(clipRight, right - lineWidth, clipLeft);
    for (let y = topBorderEnd; y <= bottomBorderStart; y++) { const row = canvas[y]; fillRange(row, cl, innerLeft, color); fillRange(row, innerRight, cr, color); }
  }
}

// ---- TextureOpShapeRasterizer statics ----
function drawLine(color: number, y2: number, x1: number, y1: number, x2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0) {
    if (dy !== 0 && x1 >= clipLeft && x1 <= clipRight) fillVerticalLine(clamp(clipBottom, y1, clipTop), x1, clamp(clipBottom, y2, clipTop), color);
    return;
  }
  if (dy === 0) {
    if (y1 >= clipTop && y1 <= clipBottom) fillSpan(color, y1, clamp(clipRight, x2, clipLeft), clamp(clipRight, x1, clipLeft));
    return;
  }
  const slope = div(dy << 12, dx), intercept = y1 - (imul(slope, x1) >> 12);
  let cx1: number, cy1: number, cx2: number, cy2: number;
  if (clipLeft > x1) { cx1 = clipLeft; cy1 = (imul(clipLeft, slope) >> 12) + intercept; }
  else if (x1 > clipRight) { cy1 = (imul(clipRight, slope) >> 12) + intercept; cx1 = clipRight; }
  else { cx1 = x1; cy1 = y1; }
  if (x2 < clipLeft) { cx2 = clipLeft; cy2 = intercept + (imul(slope, clipLeft) >> 12); }
  else if (clipRight < x2) { cx2 = clipRight; cy2 = intercept + (imul(slope, clipRight) >> 12); }
  else { cy2 = y2; cx2 = x2; }
  if (clipTop > cy2) { cx2 = div((clipTop - intercept) << 12, slope); cy2 = clipTop; }
  else if (cy2 > clipBottom) { cy2 = clipBottom; cx2 = div((clipBottom - intercept) << 12, slope); }
  if (cy1 < clipTop) { cy1 = clipTop; cx1 = div((clipTop - intercept) << 12, slope); }
  else if (clipBottom < cy1) { cy1 = clipBottom; cx1 = div((clipBottom - intercept) << 12, slope); }
  plotLine(color, cy2, cy1, cx2, cx1);
}

/** Midpoint ellipse stepping shared by the client's ellipse routines: x for each y below ry. */
function drawEllipseBorderedClipped(outerRadiusX: number, fillColor: number, borderColor: number, borderWidth: number, cy: number, cx: number, radiusY: number) {
  let outerX = 0, innerX = 0, y = radiusY;
  const innerRadiusX = outerRadiusX - borderWidth, rySq = imul(radiusY, radiusY), innerRadiusY = radiusY - borderWidth;
  const outerRxSq = imul(outerRadiusX, outerRadiusX), rySq2 = rySq << 1, innerRySq = imul(innerRadiusY, innerRadiusY), innerRxSq = imul(innerRadiusX, innerRadiusX);
  const outerRxSq2 = outerRxSq << 1, innerRySq2 = innerRySq << 1, innerRxSq2 = innerRxSq << 1, innerRy2 = innerRadiusY << 1, ry2 = radiusY << 1;
  let outerErr1 = rySq2 + imul(outerRxSq, 1 - ry2), outerErr2 = rySq - imul(ry2 - 1, outerRxSq2);
  let innerErr1 = innerRySq2 + imul(innerRxSq, 1 - innerRy2), innerErr2 = innerRySq - imul(innerRxSq2, innerRy2 - 1);
  const rySq4 = rySq << 2, outerRxSq4 = outerRxSq << 2, innerRySq4 = innerRySq << 2, innerRxSq4 = innerRxSq << 2;
  let outerInc1 = rySq2 * 3, outerDec1 = imul(ry2 - 3, outerRxSq2), innerInc1 = innerRySq2 * 3, innerDec1 = imul(innerRy2 - 3, innerRxSq2);
  let outerDec2 = imul(radiusY - 1, outerRxSq4), innerInc2 = innerRySq4, outerInc2 = rySq4, innerDec2 = imul(innerRadiusY - 1, innerRxSq4);
  if (cy >= clipTop && clipBottom >= cy) {
    const row = canvas[cy];
    const a = clamp(clipRight, cx - outerRadiusX, clipLeft), b = clamp(clipRight, cx + outerRadiusX, clipLeft), c = clamp(clipRight, cx - innerRadiusX, clipLeft), d = clamp(clipRight, cx + innerRadiusX, clipLeft);
    fillRange(row, a, c, borderColor); fillRange(row, c, d, fillColor); fillRange(row, d, b, borderColor);
  }
  while (y > 0) {
    while (outerErr1 < 0) { outerErr1 += outerInc1; outerInc1 += rySq4; outerX++; outerErr2 += outerInc2; outerInc2 += rySq4; }
    const hasInner = y <= innerRadiusY;
    if (outerErr2 < 0) { outerErr2 += outerInc2; outerErr1 += outerInc1; outerX++; outerInc2 += rySq4; outerInc1 += rySq4; }
    if (hasInner) {
      while (innerErr1 < 0) { innerX++; innerErr2 += innerInc2; innerInc2 += innerRySq4; innerErr1 += innerInc1; innerInc1 += innerRySq4; }
      if (innerErr2 < 0) { innerX++; innerErr2 += innerInc2; innerErr1 += innerInc1; innerInc2 += innerRySq4; innerInc1 += innerRySq4; }
      innerErr1 -= innerDec2; innerDec2 -= innerRxSq4; innerErr2 -= innerDec1; innerDec1 -= innerRxSq4;
    }
    outerErr2 -= outerDec1; outerErr1 -= outerDec2; outerDec2 -= outerRxSq4; outerDec1 -= outerRxSq4;
    y--;
    const yBottom = cy + y, yTop = cy - y;
    if (clipTop <= yBottom && clipBottom >= yTop) {
      const xRight = clamp(clipRight, cx + outerX, clipLeft), xLeft = clamp(clipRight, cx - outerX, clipLeft);
      if (hasInner) {
        const innerRight = clamp(clipRight, cx + innerX, clipLeft), innerLeft = clamp(clipRight, cx - innerX, clipLeft);
        for (const yy of [yTop, yBottom]) {
          if (yy === yTop ? clipTop > yTop : yBottom > clipBottom) continue;
          const s = canvas[yy];
          fillRange(s, xLeft, innerLeft, borderColor); fillRange(s, innerLeft, innerRight, fillColor); fillRange(s, innerRight, xRight, borderColor);
        }
      } else {
        if (clipTop <= yTop) fillRange(canvas[yTop], xLeft, xRight, borderColor);
        if (clipBottom >= yBottom) fillRange(canvas[yBottom], xLeft, xRight, borderColor);
      }
    }
  }
}

// ---- TextureOpShapeEllipse statics ----
let scratch = new Int32Array(0);
const ensureScratch = (capacity: number) => { if (scratch.length < capacity) scratch = new Int32Array(capacity); };

function drawEllipseBordered(borderWidth: number, cx: number, cy: number, ry: number, borderColor: number, fillColor: number, rx: number) {
  if (ry === rx) drawCircleBordered(borderWidth, cy, fillColor, rx, cx, borderColor);
  else if (cx - rx >= clipLeft && rx + cx <= clipRight && clipTop <= cy - ry && clipBottom >= cy + ry) drawEllipseBorderedFast(fillColor, cx, cy, borderColor, rx, ry, borderWidth);
  else drawEllipseBorderedClipped(rx, fillColor, borderColor, borderWidth, cy, cx, ry);
}
function drawEllipseBorderedFast(fillColor: number, cx: number, cy: number, borderColor: number, rx: number, ry: number, borderWidth: number) {
  let outerX = 0, y = ry, innerX = 0;
  const innerRx = rx - borderWidth, rxSq = imul(rx, rx), innerRy = ry - borderWidth, rySq = imul(ry, ry), innerRySq = imul(innerRy, innerRy);
  const rySq2 = rySq << 1, rxSq2 = rxSq << 1, innerRySq2 = innerRySq << 1, innerRxSq = imul(innerRx, innerRx), innerRxSq2 = innerRxSq << 1;
  const ry2 = ry << 1, innerRy2 = innerRy << 1;
  let outerErr2 = rySq - imul(ry2 - 1, rxSq2), innerErr1 = imul(innerRxSq, 1 - innerRy2) + innerRySq2, outerErr1 = imul(1 - ry2, rxSq) + rySq2;
  const rxSq4 = rxSq << 2;
  let innerErr2 = innerRySq - imul(innerRxSq2, innerRy2 - 1);
  const innerRxSq4 = innerRxSq << 2, rySq4 = rySq << 2, innerRySq4 = innerRySq << 2;
  let outerDec1 = imul(ry2 - 3, rxSq2), outerInc1 = rySq2 * 3, innerDec1 = imul(innerRy2 - 3, innerRxSq2), innerInc1 = innerRySq2 * 3;
  let outerInc2 = rySq4, innerInc2 = innerRySq4, innerDec2 = imul(innerRy - 1, innerRxSq4), outerDec2 = imul(ry - 1, rxSq4);
  const center = canvas[cy];
  fillRange(center, cx - rx, cx - innerRx, borderColor);
  fillRange(center, cx - innerRx, cx + innerRx, fillColor);
  fillRange(center, cx + innerRx, rx + cx, borderColor);
  while (y > 0) {
    while (outerErr1 < 0) { outerErr2 += outerInc2; outerErr1 += outerInc1; outerX++; outerInc2 += rySq4; outerInc1 += rySq4; }
    if (outerErr2 < 0) { outerErr1 += outerInc1; outerX++; outerInc1 += rySq4; outerErr2 += outerInc2; outerInc2 += rySq4; }
    const hasInner = y <= innerRy;
    if (hasInner) {
      while (innerErr1 < 0) { innerErr1 += innerInc1; innerInc1 += innerRySq4; innerX++; innerErr2 += innerInc2; innerInc2 += innerRySq4; }
      if (innerErr2 < 0) { innerErr1 += innerInc1; innerX++; innerInc1 += innerRySq4; innerErr2 += innerInc2; innerInc2 += innerRySq4; }
      innerErr2 -= innerDec1; innerDec1 -= innerRxSq4; innerErr1 -= innerDec2; innerDec2 -= innerRxSq4;
    }
    outerErr1 -= outerDec2; outerErr2 -= outerDec1; outerDec1 -= rxSq4;
    y--;
    const yTop = cy - y, xRight = outerX + cx;
    outerDec2 -= rxSq4;
    const yBottom = y + cy, xLeft = cx - outerX;
    for (const yy of [yTop, yBottom]) {
      const s = canvas[yy];
      if (hasInner) {
        const innerRight = cx + innerX, innerLeft = cx - innerX;
        fillRange(s, xLeft, innerLeft, borderColor); fillRange(s, innerLeft, innerRight, fillColor); fillRange(s, innerRight, xRight, borderColor);
      } else fillRange(s, xLeft, xRight, borderColor);
    }
  }
}
function drawCircleBordered(borderWidth: number, cy: number, fillColor: number, radius: number, cx: number, borderColor: number) {
  if (cx - radius >= clipLeft && clipRight >= cx + radius && clipTop <= cy - radius && clipBottom >= radius + cy) drawCircleBorderedFast(borderColor, borderWidth, cy, fillColor, radius, cx);
  else drawCircleBorderedClipped(fillColor, cy, radius, borderColor, borderWidth, cx);
}
function drawCircleBorderedFast(borderColor: number, borderWidth: number, cy: number, fillColor: number, radius: number, cx: number) {
  ensureScratch(radius);
  let innerRadius = radius - borderWidth, x = 0;
  if (innerRadius < 0) innerRadius = 0;
  let outerErr = -radius, outerY = radius, innerY = innerRadius, innerErr = -innerRadius, innerStep = -1, outerStep = -1;
  const center = canvas[cy], rightInner = cx + innerRadius, leftInner = cx - innerRadius;
  fillRange(center, cx - radius, leftInner, borderColor); fillRange(center, leftInner, rightInner, fillColor); fillRange(center, rightInner, cx + radius, borderColor);
  const ring = (row: Int32Array, outerLeft: number, innerLeft: number, innerRight: number, outerRight: number) => {
    fillRange(row, outerLeft, innerLeft, borderColor); fillRange(row, innerLeft, innerRight, fillColor); fillRange(row, innerRight, outerRight, borderColor);
  };
  while (x < outerY) {
    innerStep += 2; innerErr += innerStep;
    if (innerErr >= 0 && innerY >= 1) { scratch[innerY] = x; innerY--; innerErr -= innerY << 1; }
    x++; outerStep += 2; outerErr += outerStep;
    if (outerErr >= 0) {
      outerY--; outerErr -= outerY << 1;
      const rowA = canvas[outerY + cy], rowB = canvas[cy - outerY];
      if (innerRadius > outerY) {
        const innerXAtY = scratch[outerY];
        ring(rowA, cx - x, cx - innerXAtY, innerXAtY + cx, x + cx); ring(rowB, cx - x, cx - innerXAtY, innerXAtY + cx, x + cx);
      } else { fillRange(rowA, cx - x, x + cx, borderColor); fillRange(rowB, cx - x, x + cx, borderColor); }
    }
    const rowA = canvas[cy + x], rowB = canvas[cy - x], outerRight = outerY + cx, outerLeft = cx - outerY;
    if (innerRadius <= x) { fillRange(rowA, outerLeft, outerRight, borderColor); fillRange(rowB, outerLeft, outerRight, borderColor); }
    else {
      const inner = x <= innerY ? innerY : scratch[x];
      ring(rowA, outerLeft, cx - inner, inner + cx, outerRight); ring(rowB, outerLeft, cx - inner, inner + cx, outerRight);
    }
  }
}
function drawCircleBorderedClipped(fillColor: number, cy: number, radius: number, borderColor: number, borderWidth: number, cx: number) {
  let innerRadius = radius - borderWidth;
  ensureScratch(radius);
  let x = 0;
  if (innerRadius < 0) innerRadius = 0;
  let outerY = radius, outerErr = -radius, innerErr = -innerRadius, innerY = innerRadius, outerStep = -1, innerStep = -1;
  const c = (v: number) => clamp(clipRight, v, clipLeft);
  const ring = (row: Int32Array, outerLeft: number, innerLeft: number, innerRight: number, outerRight: number) => {
    fillRange(row, outerLeft, innerLeft, borderColor); fillRange(row, innerLeft, innerRight, fillColor); fillRange(row, innerRight, outerRight, borderColor);
  };
  if (cy >= clipTop && clipBottom >= cy) ring(canvas[cy], c(cx - radius), c(cx - innerRadius), c(cx + innerRadius), c(radius + cx));
  while (x < outerY) {
    outerStep += 2; innerStep += 2; innerErr += innerStep; outerErr += outerStep;
    if (innerErr >= 0 && innerY >= 1) { innerY--; scratch[innerY] = x; innerErr -= innerY << 1; }
    x++;
    if (outerErr >= 0) {
      outerY--; outerErr -= outerY << 1;
      const yTop = cy - outerY, yBottom = cy + outerY;
      if (clipTop <= yBottom && clipBottom >= yTop) {
        if (outerY >= innerRadius) {
          const xr = c(x + cx), xl = c(cx - x);
          if (clipBottom >= yBottom) fillRange(canvas[yBottom], xl, xr, borderColor);
          if (yTop >= clipTop) fillRange(canvas[yTop], xl, xr, borderColor);
        } else {
          const inner = scratch[outerY], outerRight = c(x + cx), outerLeft = c(cx - x), innerRight = c(cx + inner), innerLeft = c(cx - inner);
          if (clipBottom >= yBottom) ring(canvas[yBottom], outerLeft, innerLeft, innerRight, outerRight);
          if (yTop >= clipTop) ring(canvas[yTop], outerLeft, innerLeft, innerRight, outerRight);
        }
      }
    }
    const yTop = cy - x, yBottom = cy + x;
    if (clipTop <= yBottom && clipBottom >= yTop) {
      let xRight = cx + outerY, xLeft = cx - outerY;
      if (xRight >= clipLeft && clipRight >= xLeft) {
        xRight = c(xRight); xLeft = c(xLeft);
        if (x < innerRadius) {
          const inner = innerY >= x ? innerY : scratch[x], innerRight = c(inner + cx), innerLeft = c(cx - inner);
          if (clipBottom >= yBottom) ring(canvas[yBottom], xLeft, innerLeft, innerRight, xRight);
          if (yTop >= clipTop) ring(canvas[yTop], xLeft, innerLeft, innerRight, xRight);
        } else {
          if (clipBottom >= yBottom) fillRange(canvas[yBottom], xLeft, xRight, borderColor);
          if (yTop >= clipTop) fillRange(canvas[yTop], xLeft, xRight, borderColor);
        }
      }
    }
  }
}
function fillEllipseSingleColor(color: number, ry: number, cx: number, cy: number, rx: number) {
  if (ry === rx) {
    if (cx - rx >= clipLeft && clipRight >= rx + cx && cy - rx >= clipTop && clipBottom >= rx + cy) fillCircle(cx, rx, color, cy);
    else fillCircleClipped(color, cy, rx, cx);
  } else if (clipLeft <= cx - rx && cx + rx <= clipRight && cy - ry >= clipTop && cy + ry <= clipBottom) fillEllipseFast(cy, cx, rx, ry, color);
  else fillEllipseClipped(color, ry, rx, cx, cy);
}
function fillCircleClipped(color: number, cy: number, radius: number, cx: number) {
  let x = 0, y = radius, err = -radius, step = -1;
  const c = (v: number) => clamp(clipRight, v, clipLeft);
  fillRange(canvas[cy], c(cx - radius), c(radius + cx), color);
  while (x < y) {
    step += 2; err += step;
    if (err > 0) {
      y--;
      const yTop = cy - y;
      err -= y << 1;
      const yBottom = cy + y;
      if (yBottom >= clipTop && yTop <= clipBottom) {
        const right = c(cx + x), left = c(cx - x);
        if (clipBottom >= yBottom) fillRange(canvas[yBottom], left, right, color);
        if (clipTop <= yTop) fillRange(canvas[yTop], left, right, color);
      }
    }
    x++;
    const yTop = cy - x, yBottom = x + cy;
    if (yBottom >= clipTop && clipBottom >= yTop) {
      const right = c(cx + y), left = c(cx - y);
      if (yBottom <= clipBottom) fillRange(canvas[yBottom], left, right, color);
      if (yTop >= clipTop) fillRange(canvas[yTop], left, right, color);
    }
  }
}
function fillEllipseFast(cy: number, cx: number, rx: number, ry: number, color: number) {
  fillRange(canvas[cy], cx - rx, rx + cx, color);
  let x = 0, y = ry;
  const rxSq = imul(rx, rx), rySq = imul(ry, ry), rySq2 = rySq << 1, rxSq2 = rxSq << 1, ry2 = ry << 1;
  let err1 = rySq2 + imul(1 - ry2, rxSq), err2 = rySq - imul(rxSq2, ry2 - 1);
  const rxSq4 = rxSq << 2, rySq4 = rySq << 2;
  let inc1 = rySq2 * 3, dec1 = imul(rxSq2, (ry << 1) - 3), inc2 = rySq4, dec2 = imul(rxSq4, ry - 1);
  while (y > 0) {
    y--;
    const yBottom = y + cy, yTop = cy - y;
    while (err1 < 0) { x++; err1 += inc1; err2 += inc2; inc2 += rySq4; inc1 += rySq4; }
    if (err2 < 0) { err1 += inc1; inc1 += rySq4; err2 += inc2; x++; inc2 += rySq4; }
    err2 -= dec1; dec1 -= rxSq4; err1 -= dec2; dec2 -= rxSq4;
    fillRange(canvas[yTop], cx - x, x + cx, color);
    fillRange(canvas[yBottom], cx - x, x + cx, color);
  }
}
function fillEllipseClipped(color: number, ry: number, rx: number, cx: number, cy: number) {
  const rxSq = imul(rx, rx);
  let x = 0, y = ry;
  const rxSq2 = rxSq << 1, rySq = imul(ry, ry), ry2 = ry << 1, rySq2 = rySq << 1;
  let err1 = imul(rxSq, 1 - ry2) + rySq2, err2 = rySq - imul(rxSq2, ry2 - 1);
  const rySq4 = rySq << 2, rxSq4 = rxSq << 2;
  let inc1 = rySq2 * 3, dec1 = imul((ry << 1) - 3, rxSq2), inc2 = rySq4;
  const c = (v: number) => clamp(clipRight, v, clipLeft);
  if (cy >= clipTop && clipBottom >= cy) fillRange(canvas[cy], c(cx - rx), c(rx + cx), color);
  let dec2 = imul(rxSq4, ry - 1);
  while (y > 0) {
    y--;
    while (err1 < 0) { x++; err1 += inc1; err2 += inc2; inc2 += rySq4; inc1 += rySq4; }
    const yTop = cy - y;
    if (err2 < 0) { err2 += inc2; err1 += inc1; inc1 += rySq4; inc2 += rySq4; x++; }
    err2 -= dec1; dec1 -= rxSq4; err1 -= dec2;
    const yBottom = y + cy;
    if (clipTop <= yBottom && clipBottom >= yTop) {
      const right = c(x + cx), left = c(cx - x);
      if (yTop >= clipTop) fillRange(canvas[yTop], left, right, color);
      if (clipBottom >= yBottom) fillRange(canvas[yBottom], left, right, color);
    }
    dec2 -= rxSq4;
  }
}

// ---- Bezier ----
function drawCurve(cx1: number, ex: number, cy1: number, ey: number, sy: number, sx: number, cx2: number, cy2: number, color: number) {
  const inX = (v: number) => v >= clipLeft && v <= clipRight, inY = (v: number) => v >= clipTop && v <= clipBottom;
  const fast = inX(sx) && inX(cx1) && inX(cx2) && inX(ex) && inY(sy) && inY(cy2) && inY(cy1) && inY(ey);
  if (sx === cx1 && sy === cy2 && cx2 === ex && ey === cy1) {
    if (fast) plotLine(color, ey, sy, ex, sx); else drawLine(color, ey, sx, sy, ex);
    return;
  }
  let prevX = sx, prevY = sy;
  const sx3 = sx * 3, sy3 = sy * 3, cx1_3 = cx1 * 3, cy2_3 = cy2 * 3, cx2_3 = cx2 * 3, cy1_3 = cy1 * 3;
  const aX = ex + cx1_3 - cx2_3 - sx, aY = ey + cy2_3 - sy - cy1_3, bX = sx3 + cx2_3 - cx1_3 - cx1_3, bY = sy3 + cy1_3 - cy2_3 - cy2_3;
  const cX = cx1_3 - sx3, cY = cy2_3 - sy3;
  for (let t = 128; t <= 4096; t += 128) {
    const tSq = imul(t, t) >> 12, tCube = imul(t, tSq) >> 12;
    const curX = ((imul(cX, t) + imul(aX, tCube) + imul(tSq, bX)) >> 12) + sx;
    const curY = sy + ((imul(cY, t) + imul(aY, tCube) + imul(tSq, bY)) >> 12);
    if (fast) plotLine(color, curY, prevY, curX, prevX); else drawLine(color, curY, prevX, prevY, curX);
    prevX = curX; prevY = curY;
  }
}

interface Shape {
  fillColor: number; outlineColor: number;
  bordered(h: number, w: number): void; outlined(h: number, w: number): void; filled(w: number, h: number): void;
}
function readShape(buf: Reader): Shape | undefined {
  const type = buf.g1();
  if (type === 0) {
    const sx = buf.g2b(), sy = buf.g2b(), ex = buf.g2b(), ey = buf.g2b(), outline = buf.g3(), lineWidth = buf.g1();
    return { fillColor: -1, outlineColor: outline, bordered() {}, filled() {}, outlined(h, w) { drawLine(outline, imul(h, ey) >> 12, imul(w, sx) >> 12, imul(h, sy) >> 12, imul(ex, w) >> 12); void lineWidth; } };
  }
  if (type === 1) {
    const startX = buf.g2b(), startY = buf.g2b(), controlX1 = buf.g2b(), controlY2 = buf.g2b(), controlX2 = buf.g2b(), controlY1 = buf.g2b(), endX = buf.g2b(), endY = buf.g2b(), outline = buf.g3();
    buf.g1();
    return {
      fillColor: -1, outlineColor: outline, bordered() {}, filled() {},
      outlined(h, w) {
        drawCurve(imul(w, controlX1) >> 12, imul(endX, w) >> 12, imul(h, controlY1) >> 12, imul(h, endY) >> 12, imul(startY, h) >> 12, imul(w, startX) >> 12, imul(controlX2, w) >> 12, imul(controlY2, h) >> 12, outline);
      },
    };
  }
  if (type === 2) {
    const left = buf.g2b(), top = buf.g2b(), right = buf.g2b(), bottom = buf.g2b(), fill = buf.g3(), outline = buf.g3(), lineWidth = buf.g1();
    return {
      fillColor: fill, outlineColor: outline,
      outlined(h, w) { drawRectOutline(outline, imul(left, w) >> 12, imul(top, h) >> 12, imul(w, right) >> 12, imul(bottom, h) >> 12, lineWidth); },
      filled(w, h) { fillSolidRect(imul(left, w) >> 12, fill, imul(h, bottom) >> 12, imul(w, right) >> 12, imul(h, top) >> 12); },
      bordered(h, w) { drawFramedRect(lineWidth, imul(bottom, h) >> 12, fill, outline, imul(top, h) >> 12, imul(w, right) >> 12, imul(w, left) >> 12); },
    };
  }
  if (type === 3) {
    const centerX = buf.g2b(), centerY = buf.g2b(), radiusX = buf.g2b(), radiusY = buf.g2b(), fill = buf.g3(), outline = buf.g3(), lineWidth = buf.g1();
    return {
      fillColor: fill, outlineColor: outline, outlined() {},
      filled(w, h) { fillEllipseSingleColor(fill, imul(radiusY, h) >> 12, imul(centerX, w) >> 12, imul(centerY, h) >> 12, imul(w, radiusX) >> 12); },
      bordered(h, w) { drawEllipseBordered(lineWidth, imul(w, centerX) >> 12, imul(centerY, h) >> 12, imul(radiusY, h) >> 12, outline, fill, imul(radiusX, w) >> 12); },
    };
  }
  return undefined;
}

export class ShapeRasterizer extends TextureOp {
  private shapes: (Shape | undefined)[] | null = null;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.shapes = Array.from({ length: buf.g1() }, () => readShape(buf));
    else if (opcode === 1) this.monochrome = buf.g1() === 1;
  }
  private rasterize(target: Int32Array[]) {
    const h = T.height, w = T.width;
    canvas = target;
    clipRight = T.widthMask; clipLeft = 0; clipTop = 0; clipBottom = T.heightMask;
    if (!this.shapes) return;
    for (const shape of this.shapes) {
      // (a missing shape type throws in the client)
      if (!shape) throw new Error('unknown shape type');
      if (shape.fillColor >= 0) { if (shape.outlineColor < 0) shape.filled(w, h); else shape.bordered(h, w); }
      else if (shape.outlineColor >= 0) shape.outlined(h, w);
    }
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) this.rasterize(this.monoCache.all());
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) {
      const packed = Array.from({ length: T.height }, () => new Int32Array(T.width)), rows = this.colorCache.all();
      this.rasterize(packed);
      for (let y = 0; y < T.height; y++) {
        const p = packed[y], [r, g, b] = rows[y];
        for (let x = 0; x < T.width; x++) { const c = p[x]; b[x] = (c & 0xff) << 4; g[x] = (c >> 4) & 0xff0; r[x] = (c >> 12) & 0xff0; }
      }
    }
    return out;
  }
}
