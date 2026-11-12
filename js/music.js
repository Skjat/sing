// Ноты, названия, аккорды и транспонирование. Чистые функции без DOM.

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

const LAT = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RU = ['до', 'до♯', 'ре', 'ре♯', 'ми', 'фа', 'фа♯', 'соль', 'соль♯', 'ля', 'ля♯', 'си'];
const OCT_RU = ['субконтроктавы', 'контроктавы', 'большой октавы', 'малой октавы',
  'первой октавы', 'второй октавы', 'третьей октавы', 'четвёртой октавы'];

const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
const oct = (m) => Math.floor(Math.round(m) / 12) - 1;

/** «A3» */
export const noteName = (m) => LAT[pc(m)] + oct(m);
/** «ля малой октавы» */
export const noteRu = (m) => `${RU[pc(m)]} ${OCT_RU[Math.max(0, Math.min(7, oct(m)))]}`;
/** «ля малой октавы (A3)» */
export const noteFull = (m) => `${noteRu(m)} (${noteName(m)})`;
/** «ля» */
export const noteShortRu = (m) => RU[pc(m)];

export const INTERVALS = {
  1: 'малая секунда', 2: 'большая секунда', 3: 'малая терция', 4: 'большая терция',
  5: 'чистая кварта', 6: 'тритон', 7: 'чистая квинта', 8: 'малая секста',
  9: 'большая секста', 10: 'малая септима', 11: 'большая септима', 12: 'октава',
};

// ---------- Аккорды ----------

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
const CHORD_RE = /^([A-H])([#b♯♭]?)((?:m|min|maj|M|dim|aug|sus|add|\+|°|ø|-)?\d{0,2}(?:(?:sus|add|maj|M|b|#|\+|-|\/(?=\d))\d{0,2})*(?:\([^)]{1,8}\))?)(?:\/([A-H])([#b♯♭]?))?$/;

function rootPc(letter, acc, german) {
  let p = LETTER_PC[letter];
  // Немецкая (и распространённая русская) запись: H — си, B — си-бемоль.
  if (german && letter === 'B' && !acc) p = 10;
  if (acc === '#' || acc === '♯') p += 1;
  if (acc === 'b' || acc === '♭') p -= 1;
  return (p + 12) % 12;
}

/**
 * Разбирает запись аккорда. german: true, если в песне «H» означает си.
 * Возвращает null, если строка не похожа на аккорд.
 */
export function parseChord(str, german = false) {
  const m = CHORD_RE.exec(String(str).trim());
  if (!m) return null;
  const [, letter, acc, quality, bassLetter, bassAcc] = m;
  return {
    root: rootPc(letter, acc, german),
    quality: quality || '',
    bass: bassLetter ? rootPc(bassLetter, bassAcc, german) : null,
  };
}

export const isChord = (str) => CHORD_RE.test(String(str).trim());

const isMinorQuality = (q) => /^(m(?!aj)|min|-)/.test(q) || /^(dim|°|ø)/.test(q);

const NAMES_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_MINOR = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

function pcName(p, minor, german) {
  if (german) {
    if (p === 11) return 'H';
    if (p === 10) return 'B';
  }
  return (minor ? NAMES_MINOR : NAMES_MAJOR)[p];
}

/** Транспонирует запись аккорда на semis полутонов. Не-аккорды возвращает как есть. */
export function transposeChord(str, semis, german = false) {
  const c = parseChord(str, german);
  if (!c) return str;
  const minor = isMinorQuality(c.quality);
  const shift = (p) => (((p + semis) % 12) + 12) % 12;
  let out = pcName(shift(c.root), minor, german) + c.quality;
  if (c.bass != null) out += '/' + pcName(shift(c.bass), false, german);
  return out;
}

/** Интервалы аккорда в полутонах от основного тона. */
export function chordIntervals(quality) {
  const q = quality.replace(/♯/g, '#').replace(/♭/g, 'b');
  let third = 4;
  let fifth = 7;
  const extra = [];
  const dim = /dim|°/.test(q);
  const halfDim = /ø|m7b5/.test(q);
  if (/^(m(?!aj)|min|-)/.test(q)) third = 3;
  if (dim || halfDim) { third = 3; fifth = 6; }
  if (/aug|\+(?!\d)/.test(q) || /#5/.test(q)) fifth = 8;
  if (/b5/.test(q)) fifth = 6;
  if (/sus2/.test(q)) third = 2;
  else if (/sus/.test(q)) third = 5;
  if (/^5$/.test(q)) third = null;
  if (/maj7|maj9|M7|M9/.test(q)) extra.push(11);
  else if (dim && /7/.test(q)) extra.push(9);
  else if (halfDim || /7|9|11|13/.test(q.replace(/add9|6\/9/, ''))) extra.push(10);
  if (/6/.test(q)) extra.push(9);
  if (/9/.test(q)) extra.push(14);
  const out = [0];
  if (third != null) out.push(third);
  out.push(fifth, ...extra);
  return out;
}

/**
 * MIDI-ноты аккорда для сопровождения: бас около до малой октавы,
 * остальные звуки собраны вокруг центра center.
 */
export function chordMidis(str, german = false, center = 55) {
  const c = parseChord(str, german);
  if (!c) return [];
  const bassPc = c.bass != null ? c.bass : c.root;
  let bass = 36 + bassPc; // C2..B2
  if (bass < 40) bass += 12;
  const notes = [bass];
  for (const iv of chordIntervals(c.quality)) {
    let n = c.root + iv;
    while (n < center - 6) n += 12;
    while (n > center + 6) n -= 12;
    if (!notes.includes(n)) notes.push(n);
  }
  return notes.sort((a, b) => a - b);
}

// ---------- Голос ----------

const VOICE_TYPES = [
  { id: 'bass', name: 'бас', center: 52 },          // E2–E4
  { id: 'baritone', name: 'баритон', center: 56 },  // G2–G4/A4
  { id: 'tenor', name: 'тенор', center: 60 },       // C3–C5
  { id: 'alto', name: 'контральто / альт', center: 65 },   // F3–F5
  { id: 'mezzo', name: 'меццо-сопрано', center: 69 },      // A3–A5
  { id: 'soprano', name: 'сопрано', center: 72 },          // C4–C6
];

/** Ориентировочный тип голоса по середине рабочего диапазона. */
export function guessVoiceType(low, high) {
  const center = (low + high) / 2;
  let best = VOICE_TYPES[0];
  for (const v of VOICE_TYPES) {
    if (Math.abs(v.center - center) < Math.abs(best.center - center)) best = v;
  }
  return best;
}

export const rangeLabel = (low, high) => `${noteName(low)} – ${noteName(high)}`;
