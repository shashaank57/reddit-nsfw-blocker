const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/**
 * Experimental HD Icon Generator (Separate Flow)
 * Outputs test icons to icons-experimental/ without touching main icons/
 */
function createExperimentalPNG(targetSize) {
  const scale = 16;
  const size = targetSize * scale;
  const cx = size / 2;
  const cy = size * 0.48;

  const superData = new Uint8Array(size * size * 4);

  // Maximize scale edge-to-edge for Chrome toolbars
  const shieldW = size * 0.50;
  const shieldH = size * 0.52;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      const normX = Math.abs(x - cx) / shieldW;
      const normY = (y - cy) / shieldH;

      const topY = -0.82 + 0.16 * (normX * normX);
      const botY = 0.90 - 0.78 * Math.pow(Math.max(0, normX), 1.25);
      const inOuter = normX <= 0.94 && normY >= topY && normY <= botY;

      const innerW = shieldW * 0.82;
      const innerH = shieldH * 0.82;
      const inNormX = Math.abs(x - cx) / innerW;
      const inNormY = (y - cy) / innerH;
      const inTopY = -0.82 + 0.16 * (inNormX * inNormX);
      const inBotY = 0.90 - 0.78 * Math.pow(Math.max(0, inNormX), 1.25);
      const inInner = inNormX <= 0.94 && inNormY >= inTopY && inNormY <= inBotY;

      const isBorder = inOuter && !inInner;
      const isFill = inInner;

      // Typography (Maximized scale)
      const fx = (x - cx) / (size * 0.44);
      const fy = (y - (cy - size * 0.035)) / (size * 0.44);

      const isOneStem = fx >= -0.38 && fx <= -0.28 && fy >= -0.36 && fy <= 0.36;
      const isOneBeak = fx >= -0.50 && fx <= -0.38 && fy >= -0.36 && fy <= -0.20 &&
                        (fy - (-0.38)) <= 1.35 * (fx - (-0.50));
      const isOne = isOneStem || isOneBeak;

      const topDist = Math.sqrt((fx - 0.08) * (fx - 0.08) + (fy + 0.155) * (fy + 0.155));
      const botDist = Math.sqrt((fx - 0.08) * (fx - 0.08) + (fy - 0.155) * (fy - 0.155));

      const inTopLoop = (fy <= 0.0) && (topDist >= 0.105 && topDist <= 0.205);
      const inBotLoop = (fy > 0.0) && (botDist >= 0.105 && botDist <= 0.205);
      const isEight = inTopLoop || inBotLoop;

      const isPlusH = fx >= 0.44 && fx <= 0.64 && Math.abs(fy + 0.04) <= 0.035;
      const isPlusV = Math.abs(fx - 0.54) <= 0.035 && fy >= -0.14 && fy <= 0.06;
      const isPlus = isPlusH || isPlusV;

      const isText = (isOne || isEight || isPlus) && isFill;

      const lightDx = (x - size * 0.3) / size;
      const lightDy = (y - size * 0.2) / size;
      const specular = Math.max(0, 1 - Math.sqrt(lightDx * lightDx + lightDy * lightDy) * 1.5);

      let r = 0, g = 0, b = 0, a = 0;

      if (isText) {
        r = 255; g = 255; b = 255; a = 255;
      } else if (isBorder) {
        r = Math.min(255, Math.round(255 * (0.85 + specular * 0.3)));
        g = Math.min(255, Math.round(69 + specular * 100));
        b = Math.min(255, Math.round(specular * 80));
        a = 255;
      } else if (isFill) {
        r = Math.round(22 + specular * 40);
        g = Math.round(27 + specular * 45);
        b = Math.round(34 + specular * 55);
        a = Math.round(235 + specular * 20);
      }

      superData[idx] = r;
      superData[idx + 1] = g;
      superData[idx + 2] = b;
      superData[idx + 3] = a;
    }
  }

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

const expDir = path.join(__dirname, 'icons-experimental');
if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

[16, 32, 48, 64, 128].forEach(size => {
  const png = createExperimentalPNG(size);
  fs.writeFileSync(path.join(expDir, `icon${size}.png`), png);
});

console.log('🧪 Experimental icons generated in icons-experimental/!');
