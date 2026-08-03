import crypto from "node:crypto";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let value = 0xffffffff;
  for (const byte of buffer) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blendPixel(pixels, width, height, x, y, colour, alpha = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const opacity = Math.max(0, Math.min(1, alpha * ((colour[3] ?? 255) / 255)));
  pixels[offset] = clampByte(pixels[offset] * (1 - opacity) + colour[0] * opacity);
  pixels[offset + 1] = clampByte(pixels[offset + 1] * (1 - opacity) + colour[1] * opacity);
  pixels[offset + 2] = clampByte(pixels[offset + 2] * (1 - opacity) + colour[2] * opacity);
  pixels[offset + 3] = 255;
}

function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, colour, alpha = 1) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) blendPixel(pixels, width, height, px, py, colour, alpha);
  }
}

function fillCircle(pixels, width, height, centreX, centreY, radius, colour, alpha = 1) {
  const r = Math.max(1, radius);
  const left = Math.floor(centreX - r);
  const right = Math.ceil(centreX + r);
  const top = Math.floor(centreY - r);
  const bottom = Math.ceil(centreY + r);
  const radiusSquared = r * r;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distanceSquared = ((x - centreX) ** 2) + ((y - centreY) ** 2);
      if (distanceSquared <= radiusSquared) blendPixel(pixels, width, height, x, y, colour, alpha);
    }
  }
}

function drawLine(pixels, width, height, startX, startY, endX, endY, colour, thickness = 1, alpha = 1) {
  const dx = endX - startX;
  const dy = endY - startY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const radius = Math.max(0.5, thickness / 2);
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    fillCircle(
      pixels,
      width,
      height,
      startX + (dx * progress),
      startY + (dy * progress),
      radius,
      colour,
      alpha,
    );
  }
}

function drawRoundedRect(pixels, width, height, x, y, rectWidth, rectHeight, radius, colour, alpha = 1) {
  fillRect(pixels, width, height, x + radius, y, rectWidth - (2 * radius), rectHeight, colour, alpha);
  fillRect(pixels, width, height, x, y + radius, rectWidth, rectHeight - (2 * radius), colour, alpha);
  fillCircle(pixels, width, height, x + radius, y + radius, radius, colour, alpha);
  fillCircle(pixels, width, height, x + rectWidth - radius, y + radius, radius, colour, alpha);
  fillCircle(pixels, width, height, x + radius, y + rectHeight - radius, radius, colour, alpha);
  fillCircle(pixels, width, height, x + rectWidth - radius, y + rectHeight - radius, radius, colour, alpha);
}

function seedBytes(seed = "ai-fallback") {
  return crypto.createHash("sha256").update(String(seed || "ai-fallback")).digest();
}

function buildPng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    rgba.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

export function createDeterministicAiFallbackPng({ width = 1200, height = 675, seed = "ai-fallback" } = {}) {
  const safeWidth = Math.max(320, Math.min(1600, Math.round(width)));
  const safeHeight = Math.max(320, Math.min(1600, Math.round(height)));
  const pixels = Buffer.alloc(safeWidth * safeHeight * 4);
  const seedData = seedBytes(seed);

  for (let y = 0; y < safeHeight; y += 1) {
    const vertical = y / Math.max(1, safeHeight - 1);
    for (let x = 0; x < safeWidth; x += 1) {
      const horizontal = x / Math.max(1, safeWidth - 1);
      const offset = (y * safeWidth + x) * 4;
      pixels[offset] = clampByte(5 + (horizontal * 5));
      pixels[offset + 1] = clampByte(15 + (vertical * 14));
      pixels[offset + 2] = clampByte(31 + (horizontal * 17) + (vertical * 8));
      pixels[offset + 3] = 255;
    }
  }

  const gridStep = Math.max(28, Math.round(Math.min(safeWidth, safeHeight) / 15));
  for (let x = 0; x < safeWidth; x += gridStep) {
    drawLine(pixels, safeWidth, safeHeight, x, 0, x, safeHeight, [32, 93, 126, 255], 1, 0.16);
  }
  for (let y = 0; y < safeHeight; y += gridStep) {
    drawLine(pixels, safeWidth, safeHeight, 0, y, safeWidth, y, [32, 93, 126, 255], 1, 0.13);
  }

  const centreX = safeWidth * 0.55;
  const centreY = safeHeight * 0.5;
  const chipWidth = safeWidth * 0.25;
  const chipHeight = safeHeight * 0.36;
  const chipX = centreX - (chipWidth / 2);
  const chipY = centreY - (chipHeight / 2);
  const accentA = [28, 207, 197, 255];
  const accentB = [112, 88, 255, 255];
  const accentC = [240, 139, 77, 255];

  for (let glow = 7; glow >= 1; glow -= 1) {
    fillCircle(pixels, safeWidth, safeHeight, centreX, centreY, (chipWidth * 0.72) + (glow * 10), accentB, 0.012 * glow);
  }

  const nodeCount = 9;
  const nodes = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const xBase = side < 0 ? safeWidth * 0.12 : safeWidth * 0.88;
    const xJitter = ((seedData[index] / 255) - 0.5) * safeWidth * 0.14;
    const y = safeHeight * (0.14 + ((index + 1) / (nodeCount + 2)) * 0.72);
    nodes.push({ x: xBase + xJitter, y, colour: index % 3 === 0 ? accentC : (index % 2 ? accentB : accentA) });
  }

  for (const [index, node] of nodes.entries()) {
    const targetX = sideTargetX(index, chipX, chipWidth);
    const targetY = chipY + chipHeight * (0.15 + ((index % 5) * 0.17));
    drawLine(pixels, safeWidth, safeHeight, node.x, node.y, targetX, targetY, node.colour, Math.max(2, safeWidth / 500), 0.58);
    fillCircle(pixels, safeWidth, safeHeight, node.x, node.y, Math.max(6, safeWidth / 115), node.colour, 0.18);
    fillCircle(pixels, safeWidth, safeHeight, node.x, node.y, Math.max(3, safeWidth / 230), node.colour, 0.92);
  }

  drawRoundedRect(pixels, safeWidth, safeHeight, chipX, chipY, chipWidth, chipHeight, Math.max(12, safeWidth / 90), [12, 30, 55, 255], 0.98);
  drawRoundedRect(
    pixels,
    safeWidth,
    safeHeight,
    chipX + chipWidth * 0.13,
    chipY + chipHeight * 0.13,
    chipWidth * 0.74,
    chipHeight * 0.74,
    Math.max(9, safeWidth / 125),
    [17, 61, 82, 255],
    0.95,
  );

  const pinCount = 7;
  for (let index = 0; index < pinCount; index += 1) {
    const progress = (index + 1) / (pinCount + 1);
    const pinY = chipY + (chipHeight * progress);
    drawLine(pixels, safeWidth, safeHeight, chipX - chipWidth * 0.1, pinY, chipX, pinY, accentA, Math.max(3, safeWidth / 350), 0.9);
    drawLine(pixels, safeWidth, safeHeight, chipX + chipWidth, pinY, chipX + chipWidth * 1.1, pinY, accentB, Math.max(3, safeWidth / 350), 0.9);
  }

  const coreRadius = Math.min(chipWidth, chipHeight) * 0.17;
  fillCircle(pixels, safeWidth, safeHeight, centreX, centreY, coreRadius * 1.85, accentA, 0.08);
  fillCircle(pixels, safeWidth, safeHeight, centreX, centreY, coreRadius, accentA, 0.85);
  fillCircle(pixels, safeWidth, safeHeight, centreX, centreY, coreRadius * 0.55, [225, 255, 250, 255], 0.92);

  const orbitRadius = Math.min(safeWidth, safeHeight) * 0.27;
  for (let index = 0; index < 12; index += 1) {
    const angle = ((Math.PI * 2) / 12) * index + ((seedData[20] / 255) * 0.35);
    const x = centreX + Math.cos(angle) * orbitRadius;
    const y = centreY + Math.sin(angle) * orbitRadius * 0.58;
    const colour = index % 3 === 0 ? accentC : (index % 2 ? accentB : accentA);
    fillCircle(pixels, safeWidth, safeHeight, x, y, Math.max(2, safeWidth / 360), colour, 0.72);
  }

  return buildPng(safeWidth, safeHeight, pixels);
}

function sideTargetX(index, chipX, chipWidth) {
  return index % 2 === 0 ? chipX : chipX + chipWidth;
}

export default { createDeterministicAiFallbackPng };
