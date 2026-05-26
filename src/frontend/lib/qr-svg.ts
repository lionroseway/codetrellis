/**
 * Minimal QR Code SVG generator — zero dependencies.
 *
 * Produces a QR Code (version 1–10, error correction L) as an
 * SVG string. Sufficient for the pairing payload which is
 * ~500–1200 bytes of JSON.
 *
 * Adapted from the public-domain QR code algorithm with
 * simplified bit-stream encoding (byte mode only).
 */

// --- Reed-Solomon GF(256) tables ---

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsGenPoly(n: number): Uint8Array {
  const g = new Uint8Array(n + 1);
  g[0] = 1;
  for (let i = 0; i < n; i++) {
    for (let j = n; j >= 1; j--) {
      g[j] = g[j - 1] ^ gfMul(g[j], EXP[i]);
    }
    g[0] = gfMul(g[0], EXP[i]);
  }
  return g;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j], factor);
    }
  }
  return rem;
}

// --- QR version tables (Level L only) ---

interface VersionInfo {
  size: number;
  dataCodewords: number;
  ecCodewordsPerBlock: number;
  group1Blocks: number;
  group1DataCw: number;
  group2Blocks: number;
  group2DataCw: number;
  alignmentPatterns: number[];
}

// Versions 1–13 (L error correction)
const VERSIONS: VersionInfo[] = [
  /* v1  */ { size: 21, dataCodewords: 19, ecCodewordsPerBlock: 7, group1Blocks: 1, group1DataCw: 19, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [] },
  /* v2  */ { size: 25, dataCodewords: 34, ecCodewordsPerBlock: 10, group1Blocks: 1, group1DataCw: 34, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [18] },
  /* v3  */ { size: 29, dataCodewords: 55, ecCodewordsPerBlock: 15, group1Blocks: 1, group1DataCw: 55, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [22] },
  /* v4  */ { size: 33, dataCodewords: 80, ecCodewordsPerBlock: 20, group1Blocks: 1, group1DataCw: 80, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [26] },
  /* v5  */ { size: 37, dataCodewords: 108, ecCodewordsPerBlock: 26, group1Blocks: 1, group1DataCw: 108, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [30] },
  /* v6  */ { size: 41, dataCodewords: 136, ecCodewordsPerBlock: 18, group1Blocks: 2, group1DataCw: 68, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [34] },
  /* v7  */ { size: 45, dataCodewords: 156, ecCodewordsPerBlock: 20, group1Blocks: 2, group1DataCw: 78, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [22, 38] },
  /* v8  */ { size: 49, dataCodewords: 192, ecCodewordsPerBlock: 24, group1Blocks: 2, group1DataCw: 97, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [24, 42] },
  /* v9  */ { size: 53, dataCodewords: 224, ecCodewordsPerBlock: 30, group1Blocks: 2, group1DataCw: 116, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [26, 46] },
  /* v10 */ { size: 57, dataCodewords: 264, ecCodewordsPerBlock: 18, group1Blocks: 2, group1DataCw: 68, group2Blocks: 2, group2DataCw: 69, alignmentPatterns: [28, 50] },
  /* v11 */ { size: 61, dataCodewords: 308, ecCodewordsPerBlock: 20, group1Blocks: 4, group1DataCw: 81, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [30, 54] },
  /* v12 */ { size: 65, dataCodewords: 348, ecCodewordsPerBlock: 24, group1Blocks: 2, group1DataCw: 92, group2Blocks: 2, group2DataCw: 93, alignmentPatterns: [32, 58] },
  /* v13 */ { size: 69, dataCodewords: 397, ecCodewordsPerBlock: 26, group1Blocks: 4, group1DataCw: 107, group2Blocks: 0, group2DataCw: 0, alignmentPatterns: [34, 62] },
];

// Format info bits for mask 0–7, EC level L (01)
const FORMAT_BITS: number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

// Version info bits for versions 7+
const VERSION_BITS: number[] = [
  0, 0, 0, 0, 0, 0,   // v1–6 don't need version info
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847,
];

function pickVersion(byteLength: number): number {
  // Byte mode: 4-bit mode indicator + character count indicator + data + terminator
  for (let v = 0; v < VERSIONS.length; v++) {
    const cciBits = v < 9 ? 8 : 16;
    const dataBits = 4 + cciBits + byteLength * 8;
    const capacity = VERSIONS[v].dataCodewords * 8;
    if (dataBits <= capacity) return v;
  }
  throw new Error(`Data too large for QR (${byteLength} bytes)`);
}

function encodeData(text: string, version: number): Uint8Array {
  const ver = VERSIONS[version];
  const bytes = new TextEncoder().encode(text);
  const cciBits = version < 9 ? 8 : 16;

  // Build bit stream
  const totalBits = ver.dataCodewords * 8;
  const bits = new Uint8Array(Math.ceil(totalBits / 8));
  let pos = 0;

  function writeBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      if (val & (1 << i)) bits[pos >> 3] |= 0x80 >> (pos & 7);
      pos++;
    }
  }

  writeBits(0b0100, 4); // Byte mode
  writeBits(bytes.length, cciBits);
  for (const b of bytes) writeBits(b, 8);
  writeBits(0, Math.min(4, totalBits - pos)); // Terminator

  // Pad to byte boundary
  pos = Math.ceil(pos / 8) * 8;

  // Pad codewords
  let padToggle = false;
  while (pos < totalBits) {
    writeBits(padToggle ? 0x11 : 0xec, 8);
    padToggle = !padToggle;
  }

  return bits.slice(0, ver.dataCodewords);
}

function addErrorCorrection(data: Uint8Array, version: number): Uint8Array {
  const ver = VERSIONS[version];
  const ecLen = ver.ecCodewordsPerBlock;
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let g = 0; g < 2; g++) {
    const count = g === 0 ? ver.group1Blocks : ver.group2Blocks;
    const cw = g === 0 ? ver.group1DataCw : ver.group2DataCw;
    for (let b = 0; b < count; b++) {
      const block = data.slice(offset, offset + cw);
      blocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
      offset += cw;
    }
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.length) result.push(block[i]);
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < ecLen; i++) {
    for (const ec of ecBlocks) {
      result.push(ec[i]);
    }
  }

  return new Uint8Array(result);
}

function createMatrix(version: number): { grid: number[][]; size: number } {
  const size = VERSIONS[version].size;
  // 0 = unset, 1 = black (function), 2 = white (function), 3 = black (data), 4 = white (data)
  const grid: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  return { grid, size };
}

function placeFinderPattern(grid: number[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
      const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      grid[rr][cc] = isBlack ? 1 : 2;
    }
  }
}

function placeAlignmentPattern(grid: number[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (grid[row + r][col + c] !== 0) continue; // Don't overwrite finder patterns
      const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      grid[row + r][col + c] = isBlack ? 1 : 2;
    }
  }
}

function placeTimingPatterns(grid: number[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    if (grid[6][i] === 0) grid[6][i] = i % 2 === 0 ? 1 : 2;
    if (grid[i][6] === 0) grid[i][6] = i % 2 === 0 ? 1 : 2;
  }
}

function reserveFormatAreas(grid: number[][], size: number) {
  // Around finder patterns
  for (let i = 0; i < 8; i++) {
    if (grid[8][i] === 0) grid[8][i] = 2;
    if (grid[i][8] === 0) grid[i][8] = 2;
    if (grid[8][size - 1 - i] === 0) grid[8][size - 1 - i] = 2;
    if (grid[size - 1 - i][8] === 0) grid[size - 1 - i][8] = 2;
  }
  grid[8][8] = 2;
  // Dark module
  grid[size - 8][8] = 1;
}

function placeVersionInfo(grid: number[][], version: number, size: number) {
  if (version < 6) return; // No version info for v1–6
  const bits = VERSION_BITS[version];
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = (size - 11) + (i % 3);
    grid[r][c] = bit ? 1 : 2;
    grid[c][r] = bit ? 1 : 2;
  }
}

function placeData(grid: number[][], size: number, codewords: Uint8Array) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  // Traverse upward/downward in 2-column strips from right to left
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5; // Skip timing column

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (grid[row][c] !== 0) continue;
        if (bitIndex < totalBits) {
          const bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          grid[row][c] = bit ? 3 : 4;
          bitIndex++;
        } else {
          grid[row][c] = 4; // Padding
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(grid: number[][], size: number, maskId: number): number[][] {
  const masked = grid.map(row => [...row]);
  const maskFn = [
    (r: number, c: number) => (r + c) % 2 === 0,
    (r: number) => r % 2 === 0,
    (_r: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r: number, c: number) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ][maskId];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (masked[r][c] === 3 || masked[r][c] === 4) {
        if (maskFn(r, c)) {
          masked[r][c] = masked[r][c] === 3 ? 4 : 3;
        }
      }
    }
  }
  return masked;
}

function placeFormatInfo(grid: number[][], size: number, maskId: number) {
  const bits = FORMAT_BITS[maskId];
  // Horizontal strip near top-left finder
  for (let i = 0; i <= 5; i++) grid[8][i] = (bits >> (14 - i)) & 1 ? 1 : 2;
  grid[8][7] = (bits >> 8) & 1 ? 1 : 2;
  grid[8][8] = (bits >> 7) & 1 ? 1 : 2;
  grid[7][8] = (bits >> 6) & 1 ? 1 : 2;
  for (let i = 0; i <= 5; i++) grid[5 - i][8] = (bits >> (i)) & 1 ? 1 : 2;

  // Near bottom-left and top-right finders
  for (let i = 0; i <= 7; i++) grid[size - 1 - i][8] = (bits >> (14 - i)) & 1 ? 1 : 2;
  for (let i = 0; i <= 7; i++) grid[8][size - 8 + i] = (bits >> (7 - i)) & 1 ? 1 : 2;
}

function scorePenalty(grid: number[][], size: number): number {
  let penalty = 0;
  const isBlack = (r: number, c: number) => grid[r][c] === 1 || grid[r][c] === 3;

  // Rule 1: runs of same color
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (isBlack(r, c) === isBlack(r, c - 1)) { run++; } else { if (run >= 5) penalty += run - 2; run = 1; }
    }
    if (run >= 5) penalty += run - 2;
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (isBlack(r, c) === isBlack(r - 1, c)) { run++; } else { if (run >= 5) penalty += run - 2; run = 1; }
    }
    if (run >= 5) penalty += run - 2;
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const b = isBlack(r, c);
      if (b === isBlack(r, c + 1) && b === isBlack(r + 1, c) && b === isBlack(r + 1, c + 1)) penalty += 3;
    }
  }

  // Rule 4: proportion
  let black = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (isBlack(r, c)) black++;
  const pct = (black * 100) / (size * size);
  const prev5 = Math.floor(pct / 5) * 5;
  const next5 = prev5 + 5;
  penalty += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

  return penalty;
}

/**
 * Generate a QR code as an SVG string.
 *
 * @param text - The text/data to encode
 * @param moduleSize - Size of each module in pixels (default 4)
 * @param margin - Quiet zone in modules (default 2)
 * @returns SVG markup string
 */
export function generateQrSvg(
  text: string,
  moduleSize = 4,
  margin = 2,
): string {
  const version = pickVersion(new TextEncoder().encode(text).length);
  const ver = VERSIONS[version];
  const data = encodeData(text, version);
  const codewords = addErrorCorrection(data, version);
  const { grid, size } = createMatrix(version);

  // Place function patterns
  placeFinderPattern(grid, 0, 0);
  placeFinderPattern(grid, 0, size - 7);
  placeFinderPattern(grid, size - 7, 0);

  // Alignment patterns
  const ap = ver.alignmentPatterns;
  if (ap.length > 0) {
    const positions = [6, ...ap];
    for (const r of positions) {
      for (const c of positions) {
        // Skip if overlapping finder patterns
        if (r <= 8 && c <= 8) continue;
        if (r <= 8 && c >= size - 8) continue;
        if (r >= size - 8 && c <= 8) continue;
        placeAlignmentPattern(grid, r, c);
      }
    }
  }

  placeTimingPatterns(grid, size);
  reserveFormatAreas(grid, size);
  placeVersionInfo(grid, version, size);
  placeData(grid, size, codewords);

  // Try all 8 masks, pick the one with lowest penalty
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    const masked = applyMask(grid, size, m);
    placeFormatInfo(masked, size, m);
    const p = scorePenalty(masked, size);
    if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
  }

  // Apply best mask
  const final = applyMask(grid, size, bestMask);
  placeFormatInfo(final, size, bestMask);

  // Generate SVG
  const totalSize = (size + margin * 2) * moduleSize;
  const paths: string[] = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (final[r][c] === 1 || final[r][c] === 3) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        paths.push(`M${x},${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">` +
    `<rect width="${totalSize}" height="${totalSize}" fill="white"/>` +
    `<path d="${paths.join('')}" fill="black"/>` +
    `</svg>`;
}
