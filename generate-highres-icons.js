const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/**
 * Ultra-Clear Anti-Aliased Icon Generator for "18+ in a Shield" Badge
 * Renders a bold protective shield with crystal-clear 18+ typography inside.
 */
function createShieldPNG(targetSize) {
  const scale = 8; // 8x Supersampling for razor-sharp anti-aliased curves
  const size = targetSize * scale;
  const cx = size / 2;
  const cy = size * 0.48;

  const superData = new Uint8Array(size * size * 4);

  const shieldW = size * 0.44;
  const shieldH = size * 0.48;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      const normX = Math.abs(x - cx) / shieldW;
      const normY = (y - cy) / shieldH;

      // 1. Shield Outer & Inner Contour Geometry
      // Top curved dip: dy = -0.75 + 0.12 * dx^2
      const topY = -0.80 + 0.15 * (normX * normX);
      // Bottom pointed arch: dy = 0.85 - 0.65 * dx^1.3
      const botY = 0.85 - 0.75 * Math.pow(Math.max(0, normX), 1.3);

      const inShieldOuter = normX <= 0.88 && normY >= topY && normY <= botY;

      // Inner Shield Fill Contour (Border thickness)
      const innerNormX = Math.abs(x - cx) / (shieldW * 0.78);
      const innerNormY = (y - cy) / (shieldH * 0.78);
      const innerTopY = -0.80 + 0.15 * (innerNormX * innerNormX);
      const innerBotY = 0.85 - 0.75 * Math.pow(Math.max(0, innerNormX), 1.3);

      const inShieldInner = innerNormX <= 0.88 && innerNormY >= innerTopY && innerNormY <= innerBotY;

      const isShieldBorder = inShieldOuter && !inShieldInner;
      const isShieldFill = inShieldInner;

      // 2. High-Contrast Bold "18+" Typography (Centered inside shield)
      const textX = (x - cx) / (size * 0.38);
      const textY = (y - cy) / (size * 0.38);

      // "1" digit
      const isOne = textX >= -0.55 && textX <= -0.36 && textY >= -0.32 && textY <= 0.40;
      const isOneSerif = textX >= -0.72 && textX <= -0.55 && textY >= -0.32 && textY <= -0.15 &&
                         Math.abs((textX + 0.635) + (textY + 0.235)) <= 0.11;

      // "8" digit
      const top8 = Math.sqrt((textX + 0.05) * (textX + 0.05) + (textY + 0.12) * (textY + 0.12));
      const bot8 = Math.sqrt((textX + 0.05) * (textX + 0.05) + (textY - 0.22) * (textY - 0.22));
      const isEight = (top8 >= 0.11 && top8 <= 0.26) || (bot8 >= 0.12 && bot8 <= 0.28);

      // "+" sign
      const isPlusH = textX >= 0.38 && textX <= 0.72 && Math.abs(textY - 0.05) <= 0.08;
      const isPlusV = Math.abs(textX - 0.55) <= 0.08 && textY >= -0.12 && textY <= 0.22;
      const isPlus = isPlusH || isPlusV;

      const isText = (isOne || isOneSerif || isEight || isPlus) && isShieldFill;

      let r = 0, g = 0, b = 0, a = 0;

      if (isText) {
        // Solid High-Contrast White Typography (#FFFFFF)
        r = 255; g = 255; b = 255; a = 255;
      } else if (isShieldBorder) {
        // Reddit-Orange (#FF4500) Shield Border
        r = 255; g = 69; b = 0; a = 255;
      } else if (isShieldFill) {
        // Dark Glass background (#161B22)
        r = 22; g = 27; b = 34; a = 230;
      }

      superData[idx] = r;
      superData[idx + 1] = g;
      superData[idx + 2] = b;
      superData[idx + 3] = a;
    }
  }

  // Downsample with Area Box Filter Anti-Aliasing to targetSize x targetSize
  const rowSize = targetSize * 4 + 1;
  const rawData = Buffer.alloc(targetSize * rowSize);

  for (let ty = 0; ty < targetSize; ty++) {
    const rowOffset = ty * rowSize;
    rawData[rowOffset] = 0;

    for (let tx = 0; tx < targetSize; tx++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;

      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = tx * scale + sx;
          const py = ty * scale + sy;
          const sIdx = (py * size + px) * 4;

          const sa = superData[sIdx + 3] / 255;
          sumR += superData[sIdx] * sa;
          sumG += superData[sIdx + 1] * sa;
          sumB += superData[sIdx + 2] * sa;
          sumA += superData[sIdx + 3];
        }
      }

      const totalSamples = scale * scale;
      const avgA = Math.round(sumA / totalSamples);

      const pxOffset = rowOffset + 1 + tx * 4;
      if (avgA > 0) {
        rawData[pxOffset] = Math.round(sumR / (sumA / 255 || 1));
        rawData[pxOffset + 1] = Math.round(sumG / (sumA / 255 || 1));
        rawData[pxOffset + 2] = Math.round(sumB / (sumA / 255 || 1));
        rawData[pxOffset + 3] = avgA;
      } else {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  function writeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const checksum = zlib.crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(checksum, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const header = Buffer.alloc(8);
  header.write('89504e470d0a1a0a', 'hex');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(targetSize, 0);
  ihdr.writeUInt32BE(targetSize, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = writeChunk('IHDR', ihdr);
  const idatChunk = writeChunk('IDAT', compressed);
  const iendChunk = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

[16, 32, 48, 64, 128].forEach(size => {
  const png = createShieldPNG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
});

console.log('🛡️ "18+ inside a Shield" transparent PNG icons generated successfully!');
