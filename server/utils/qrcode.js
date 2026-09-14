// --------------------------------------------------------

// Zwei-Faktor-Einrichtung als SVG.
//





//


//   - Fehlerkorrektur M (~15 %, die uebliche Wahl fuer Bildschirm-QRs)
//   - Versionen 1 bis 10, also bis 216 Datencodewoerter

// --------------------------------------------------------

// Je Version (Index 0 = Version 1) fuer Fehlerkorrektur-Level M:
// [EC-Codewoerter je Block, Bloecke Gruppe 1, Datencodewoerter Gruppe 1,
//  Bloecke Gruppe 2, Datencodewoerter Gruppe 2]
const EC_TABLE_M = [
  [10, 1, 16, 0,  0],
  [16, 1, 28, 0,  0],
  [26, 1, 44, 0,  0],
  [18, 2, 32, 0,  0],
  [24, 2, 43, 0,  0],
  [16, 4, 27, 0,  0],
  [18, 4, 31, 0,  0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];


const ALIGNMENT_POSITIONS = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MAX_VERSION = EC_TABLE_M.length;

// --------------------------------------------------------

// --------------------------------------------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Generatorpolynom fuer `degree` Fehlerkorrektur-Codewoerter.
 * @param {number} degree
 * @returns {number[]}
 */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/**
 * Reed-Solomon-Rest eines Datenblocks.
 * @param {number[]} data
 * @param {number} ecCount
 * @returns {number[]}
 */
function reedSolomon(data, ecCount) {
  const gen = generatorPoly(ecCount);
  const rest = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rest[0];
    rest.shift();
    rest.push(0);
    for (let i = 0; i < ecCount; i += 1) rest[i] ^= gfMul(gen[i + 1], factor);
  }
  return rest;
}

// --------------------------------------------------------
// Bitstrom -> Codewoerter
// --------------------------------------------------------
function encodeData(bytes, version) {
  const [ecPerBlock, blocks1, data1, blocks2, data2] = EC_TABLE_M[version - 1];
  const totalData = blocks1 * data1 + blocks2 * data2;

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4);                              // Byte-Modus
  push(bytes.length, version < 10 ? 8 : 16);    // Laengenfeld
  for (const byte of bytes) push(byte, 8);


  const capacityBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const PAD = [0xec, 0x11];
  while (codewords.length < totalData) codewords.push(PAD[(codewords.length - bits.length / 8) % 2]);


  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < blocks1 + blocks2; i += 1) {
    const size = i < blocks1 ? data1 : data2;
    const block = codewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }


  const out = [];
  const maxData = Math.max(data1, data2);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// --------------------------------------------------------
// Matrix
// --------------------------------------------------------
function placeFunctionPatterns(size, version) {
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = dark;
    reserved[row][col] = true;
  };

  // Suchmuster samt Trennstreifen an drei Ecken.
  for (const [baseRow, baseCol] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inner
          && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFn(baseRow + r, baseCol + c, dark);
      }
    }
  }

  // Taktmuster.
  for (let i = 8; i < size - 8; i += 1) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }


  const positions = ALIGNMENT_POSITIONS[version - 1];
  for (const row of positions) {
    for (const col of positions) {
      const nearFinder = (row <= 8 && col <= 8)
        || (row <= 8 && col >= size - 9)
        || (row >= size - 9 && col <= 8);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          setFn(row + r, col + c, Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
        }
      }
    }
  }

  // Immer dunkles Modul.
  setFn(size - 8, 8, true);


  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) { modules[8][i] = false; reserved[8][i] = true; }
    if (!reserved[i][8]) { modules[i][8] = false; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) { modules[8][size - 1 - i] = false; reserved[8][size - 1 - i] = true; }
    if (!reserved[size - 1 - i][8]) { modules[size - 1 - i][8] = false; reserved[size - 1 - i][8] = true; }
  }

  // Versionsinformation ab Version 7.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      setFn(row, size - 11 + col, false);
      setFn(size - 11 + col, row, false);
    }
  }

  return { modules, reserved };
}

function placeCodewords(modules, reserved, size, codewords) {
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >>> 3];

    const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit === 1;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {

    const colPair = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [colPair, colPair - 1]) {
        if (reserved[row][col]) continue;
        modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // Regel 1: Laufweiten ab fuenf gleichfarbigen Modulen.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const prev = horizontal ? modules[i][j - 1] : modules[j - 1][i];
        const cur  = horizontal ? modules[i][j]     : modules[j][i];
        if (cur === prev) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Regel 2: gleichfarbige 2x2-Bloecke.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }



  const PATTERN_A = [true, false, true, true, true, false, true, false, false, false, false];
  const PATTERN_B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      for (const horizontal of [true, false]) {
        let matchA = true;
        let matchB = true;
        for (let k = 0; k < 11; k += 1) {
          const v = horizontal ? modules[i][j + k] : modules[j + k][i];
          if (v !== PATTERN_A[k]) matchA = false;
          if (v !== PATTERN_B[k]) matchB = false;
        }
        if (matchA) score += 40;
        if (matchB) score += 40;
      }
    }
  }

  // Regel 4: Abweichung vom halb-halb-Verhaeltnis dunkel zu hell.
  //






  // Optimierung, keine Frage der Korrektheit.
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}


function formatBits(maskIndex) {
  const data = (0b00 << 3) | maskIndex;
  let rest = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rest >>> i) & 1) rest ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rest) ^ 0b101010000010010;
}




// weshalb der Fehler unterhalb davon unsichtbar bleibt.
function versionBits(version) {
  let rest = version;
  for (let i = 0; i < 12; i += 1) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
  return ((version << 12) | rest) & 0x3ffff;
}

function applyFormatInfo(modules, size, maskIndex) {
  const bits = formatBits(maskIndex);
  const bit = (i) => ((bits >>> i) & 1) === 1;


  // senkrecht darunter, die oberen waagerecht daneben.
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i <= 14; i += 1) modules[8][14 - i] = bit(i);





  for (let i = 0; i <= 7; i += 1) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) modules[size - 15 + i][8] = bit(i);
}

function applyVersionInfo(modules, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    modules[row][size - 11 + col] = dark;
    modules[size - 11 + col][row] = dark;
  }
}

function chooseVersion(length) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const [ecPerBlock, blocks1, data1, blocks2, data2] = EC_TABLE_M[version - 1];
    void ecPerBlock;
    const totalData = blocks1 * data1 + blocks2 * data2;
    const headerBits = 4 + (version < 10 ? 8 : 16);
    if (headerBits + length * 8 <= totalData * 8) return version;
  }
  throw new Error(`Text is too long for a QR code up to version ${MAX_VERSION}.`);
}

export function encodeQr(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = encodeData(bytes, version);

  const { modules, reserved } = placeFunctionPatterns(size, version);
  placeCodewords(modules, reserved, size, codewords);
  applyVersionInfo(modules, size, version);


  let best = null;
  let bestScore = Infinity;
  for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
    const candidate = modules.map((row, r) => row.map((value, c) => (
      reserved[r][c] ? value : value !== MASKS[maskIndex](r, c)
    )));
    applyFormatInfo(candidate, size, maskIndex);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function qrToSvg(text, { moduleSize = 4, quietZone = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const modules = encodeQr(text);
  const size = modules.length;
  const total = (size + quietZone * 2) * moduleSize;

  let path = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!modules[r][c]) continue;
      const x = (c + quietZone) * moduleSize;
      const y = (r + quietZone) * moduleSize;
      path += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" `
       + `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
       + `<rect width="${total}" height="${total}" fill="${light}"/>`
       + `<path d="${path}" fill="${dark}"/>`
       + '</svg>';
}

export function qrToDataUrl(text, opts) {
  return `data:image/svg+xml;base64,${Buffer.from(qrToSvg(text, opts), 'utf8').toString('base64')}`;
}
