/**
 * مولّد رمز QR — بدون أي مكتبة خارجية.
 *
 * A minimal QR Code encoder: byte mode, error-correction level M, versions
 * 1–10 (up to 213 bytes) — comfortably more than an otpauth:// URI needs.
 *
 * Written by hand rather than pulled from npm because the popular package
 * brings ~29 transitive packages along for its CLI, and this app deliberately
 * keeps its runtime dependency list at four. `test/qr.test.js` checks the
 * output module-for-module against that reference implementation, so the
 * shortcut is verified rather than assumed.
 *
 * Reference: ISO/IEC 18004.
 */

/* ────────────────────────── GF(256) ────────────────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial for QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, eccCount) {
  const generator = rsGenerator(eccCount);
  const remainder = new Array(eccCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < eccCount; i++) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
}

/* ────────────────────────── version tables (level M) ────────────────────────── */

// [ total codewords, ecc codewords per block, group1 blocks, group1 data cw,
//   group2 blocks, group2 data cw ]
const VERSIONS = {
  1: [26, 10, 1, 16, 0, 0],
  2: [44, 16, 1, 28, 0, 0],
  3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0],
  6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0],
  8: [242, 22, 2, 38, 2, 39],
  9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};

/** Alignment-pattern centre coordinates per version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const dataCapacity = (version) => {
  const [, ecc, g1, g1d, g2, g2d] = VERSIONS[version];
  void ecc;
  return g1 * g1d + g2 * g2d;
};

/** Byte-mode payload capacity, after the mode indicator and length field. */
function byteCapacity(version) {
  const lengthBits = version < 10 ? 8 : 16;
  return Math.floor((dataCapacity(version) * 8 - 4 - lengthBits) / 8);
}

function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version++) {
    if (byteLength <= byteCapacity(version)) return version;
  }
  throw new Error(`QR payload too long: ${byteLength} bytes (max ${byteCapacity(10)})`);
}

/* ────────────────────────── bit stream ────────────────────────── */

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] || 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

function encodeData(text, version) {
  const payload = Buffer.from(text, 'utf8');
  const capacity = dataCapacity(version);
  const buffer = new BitBuffer();

  buffer.put(0b0100, 4); // byte mode
  buffer.put(payload.length, version < 10 ? 8 : 16);
  for (const byte of payload) buffer.put(byte, 8);

  // Terminator, then pad to a byte boundary.
  const totalBits = capacity * 8;
  buffer.put(0, Math.min(4, totalBits - buffer.length));
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const bytes = buffer.toBytes();
  // Fill the remainder with the two pad codewords the spec alternates between.
  const PAD = [0xec, 0x11];
  for (let i = 0; bytes.length < capacity; i++) bytes.push(PAD[i % 2]);
  return bytes;
}

/** Split into blocks, add ECC, then interleave both as the spec requires. */
function buildCodewords(data, version) {
  const [, eccPerBlock, g1, g1d, g2, g2d] = VERSIONS[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(data.slice(offset, offset + g1d));
    offset += g1d;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(data.slice(offset, offset + g2d));
    offset += g2d;
  }

  const eccBlocks = blocks.map((block) => rsEncode(block, eccPerBlock));

  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of eccBlocks) out.push(block[i]);
  }
  return out;
}

/* ────────────────────────── matrix ────────────────────────── */

function emptyMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m.modules[rr][cc] = inRing;
      m.reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(m, version) {
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      // Skip the three corners already occupied by finder patterns.
      if (m.reserved[row][col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          m.modules[row + r][col + c] = ring !== 1;
          m.reserved[row + r][col + c] = true;
        }
      }
    }
  }
}

function placeTimingAndReserved(m, version) {
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    m.modules[6][i] = dark;
    m.reserved[6][i] = true;
    m.modules[i][6] = dark;
    m.reserved[i][6] = true;
  }

  // Format information areas (filled in after masking).
  for (let i = 0; i < 9; i++) {
    if (!m.reserved[8][i]) m.reserved[8][i] = true;
    if (!m.reserved[i][8]) m.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][m.size - 1 - i] = true;
    m.reserved[m.size - 1 - i][8] = true;
  }

  // The always-dark module below the top-left finder.
  m.modules[m.size - 8][8] = true;
  m.reserved[m.size - 8][8] = true;

  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m.reserved[i][m.size - 11 + j] = true;
        m.reserved[m.size - 11 + j][i] = true;
      }
    }
  }
}

function placeData(m, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return false; // remainder bits are 0
    const bit = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };

  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped entirely
    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.reserved[row][col]) continue;
        m.modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(modules, size) {
  let score = 0;

  // Rule 1 — runs of five or more identical modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2 — 2×2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 patterns with four light modules beside them.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, start, pattern) => {
    for (let k = 0; k < pattern.length; k++) if (line[start + k] !== pattern[k]) return false;
    return true;
  };
  for (let i = 0; i < size; i++) {
    const row = modules[i];
    const col = modules.map((r) => r[i]);
    for (const line of [row, col]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(line, j, A) || matches(line, j, B)) score += 40;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 balance of dark and light.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** BCH(15,5) format information for level M and the chosen mask. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // 00 = error-correction level M
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >>> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/** BCH(18,6) version information, versions 7 and up. */
function versionBits(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((value >>> i) & 1) value ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | value;
}

function applyFormat(m, mask) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const size = m.size;

  // The 15 format bits are laid out most-significant first: bit 14 sits at
  // (8,0), bit 0 at (0,8). Writing them LSB-first produces a code that looks
  // right but no scanner can read, so the order matters as much as the value.
  // (Version information, further down, is the opposite — LSB first.)
  const copy1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  copy1.forEach(([row, col], index) => {
    m.modules[row][col] = bit(14 - index);
  });

  // Second copy: bits 14→8 climb the left column, bits 7→0 run along row 8.
  for (let i = 0; i < 7; i++) m.modules[size - 1 - i][8] = bit(14 - i);
  for (let i = 0; i < 8; i++) m.modules[8][size - 8 + i] = bit(7 - i);

  m.modules[size - 8][8] = true; // dark module, restated after formatting
}

function applyVersionInfo(m, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = m.size - 11 + (i % 3);
    m.modules[row][col] = dark;
    m.modules[col][row] = dark;
  }
}

/* ────────────────────────── public API ────────────────────────── */

/**
 * @param {string} text
 * @returns {{size:number, modules:boolean[][], version:number}}
 */
export function encodeQR(text) {
  const payloadLength = Buffer.byteLength(text, 'utf8');
  const version = pickVersion(payloadLength);
  const size = 17 + version * 4;

  const codewords = buildCodewords(encodeData(text, version), version);

  const base = emptyMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTimingAndReserved(base, version);
  placeData(base, codewords);

  // Try all eight masks and keep the one the spec scores best.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = {
      size,
      modules: base.modules.map((row) => row.slice()),
      reserved: base.reserved,
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!base.reserved[r][c] && MASKS[mask](r, c)) candidate.modules[r][c] = !candidate.modules[r][c];
      }
    }
    applyFormat(candidate, mask);
    applyVersionInfo(candidate, version);

    const score = penalty(candidate.modules, size);
    if (!best || score < best.score) best = { score, modules: candidate.modules };
  }

  return { size, version, modules: best.modules.map((row) => row.map(Boolean)) };
}

/** Compact wire format for the browser: one string of '0'/'1' per row. */
export function encodeQRRows(text) {
  const { size, modules, version } = encodeQR(text);
  return { size, version, rows: modules.map((row) => row.map((v) => (v ? '1' : '0')).join('')) };
}
