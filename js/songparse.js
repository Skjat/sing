// Разбор текста песни с аккордами. Чистые функции.
// Понимает аккорды строкой над словами и запись в квадратных скобках: [Am]слова.

import { isChord, parseChord, transposeChord } from './music.js';

const SECTION_RE = /^[\[(]?\s*(куплет|припев|проигрыш|вступление|интро|бридж|кода|соло|запев|переход|финал|verse|chorus|bridge|intro|outro|solo|pre-?chorus|interlude)(?![a-zа-яё])[^a-zа-яё]*[\])]?\s*:?\s*$/i;
const FILLER_RE = /^(\||\|\||\/|-|—|%|x\d+|\(x\d+\)|\d+x|n\.?c\.?|\*+)$/i;

const tokens = (line) => {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) out.push({ text: m[0], pos: m.index });
  return out;
};

function isChordLine(line) {
  const ts = tokens(line);
  if (!ts.length) return false;
  let chords = 0;
  for (const t of ts) {
    if (isChord(t.text)) chords++;
    else if (!FILLER_RE.test(t.text)) return false;
  }
  return chords > 0;
}

function parseInline(line) {
  // «[Am]Слова [C]песни» → слова без скобок и позиции аккордов.
  const chords = [];
  let lyrics = '';
  let last = 0;
  const re = /\[([^\]]+)\]/g;
  let m;
  let found = false;
  while ((m = re.exec(line))) {
    if (!isChord(m[1])) continue;
    found = true;
    lyrics += line.slice(last, m.index);
    chords.push({ pos: lyrics.length, chord: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (!found) return null;
  lyrics += line.slice(last);
  return { lyrics: lyrics.replace(/\s+$/, ''), chords };
}

/** Ключ фразы: одинаковые строки (припев) делят одну записанную мелодию. */
export const phraseKey = (lyrics) =>
  lyrics.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();

/**
 * Возвращает { lines, german }.
 * lines: { type: 'section', text } | { type: 'break' } |
 *        { type: 'line', lyrics, chords: [{ pos, chord }], key } |
 *        { type: 'chords', chords: [{ pos, chord }] }
 */
export function parseSong(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => l.replace(/\s+$/, ''));
  const lines = [];
  let german = false;

  const noteGerman = (chords) => {
    for (const c of chords) if (/^H/.test(c.chord) || /\/H/.test(c.chord)) german = true;
  };

  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (!line.trim()) {
      if (lines.length && lines[lines.length - 1].type !== 'break') lines.push({ type: 'break' });
      continue;
    }
    if (SECTION_RE.test(line.trim())) {
      lines.push({ type: 'section', text: line.trim().replace(/^[\[(]\s*|\s*[\])]$/g, '').replace(/:$/, '') });
      continue;
    }
    const inline = parseInline(line);
    if (inline) {
      noteGerman(inline.chords);
      if (inline.lyrics.trim()) lines.push({ type: 'line', lyrics: inline.lyrics, chords: inline.chords, key: phraseKey(inline.lyrics) });
      else lines.push({ type: 'chords', chords: inline.chords });
      continue;
    }
    if (isChordLine(line)) {
      const chords = tokens(line).filter((t) => isChord(t.text)).map((t) => ({ pos: t.pos, chord: t.text }));
      noteGerman(chords);
      const next = src[i + 1];
      if (next && next.trim() && !isChordLine(next) && !SECTION_RE.test(next.trim()) && !parseInline(next)) {
        // Отступ текста сдвигает и позиции аккордов.
        const indent = next.length - next.trimStart().length;
        const lyrics = next.trimStart();
        lines.push({
          type: 'line',
          lyrics,
          chords: chords.map((c) => ({ pos: Math.max(0, c.pos - indent), chord: c.chord })),
          key: phraseKey(lyrics),
        });
        i++;
      } else {
        lines.push({ type: 'chords', chords });
      }
      continue;
    }
    const lyrics = line.trim();
    lines.push({ type: 'line', lyrics, chords: [], key: phraseKey(lyrics) });
  }
  while (lines.length && lines[lines.length - 1].type === 'break') lines.pop();
  return { lines, german };
}

/**
 * Делит строку на отрезки «аккорд + слова под ним» для вёрстки,
 * которая не ломается при переносе.
 */
export function chordSegments(line, semis = 0, german = false) {
  const lyrics = line.lyrics || '';
  const chords = (line.chords || []).slice().sort((a, b) => a.pos - b.pos);
  const tr = (c) => (semis ? transposeChord(c, semis, german) : c);
  if (!chords.length) return [{ chord: '', text: lyrics }];
  const segs = [];
  const first = Math.min(chords[0].pos, lyrics.length);
  if (first > 0) segs.push({ chord: '', text: lyrics.slice(0, first) });
  chords.forEach((c, i) => {
    const from = Math.min(c.pos, lyrics.length);
    const to = i + 1 < chords.length ? Math.min(chords[i + 1].pos, lyrics.length) : lyrics.length;
    segs.push({ chord: tr(c.chord), text: lyrics.slice(from, Math.max(from, to)) });
  });
  return segs;
}

/**
 * Привязывает аккорды строки к нотам мелодии: аккорд меняется в начале
 * ближайшей ноты. Возвращает [{ chord, start, dur }] во времени мелодии.
 */
export function chordTimeline(line, melody) {
  if (!melody || !melody.length || !line.chords || !line.chords.length) return [];
  const total = melody[melody.length - 1].start + melody[melody.length - 1].dur;
  const len = Math.max(1, line.lyrics.length);
  const marks = line.chords.map((c) => {
    const want = (Math.min(c.pos, len) / len) * total;
    let best = melody[0];
    for (const n of melody) if (Math.abs(n.start - want) < Math.abs(best.start - want)) best = n;
    return { chord: c.chord, start: best.start };
  });
  marks[0].start = 0;
  const out = [];
  for (const m of marks) {
    const prev = out[out.length - 1];
    if (prev && m.start <= prev.start) { prev.chord = m.chord; continue; }
    out.push({ chord: m.chord, start: m.start, dur: 0 });
  }
  out.forEach((m, i) => { m.dur = (i + 1 < out.length ? out[i + 1].start : total) - m.start; });
  return out;
}

/** Все уникальные фразы песни по порядку первого появления. */
export function uniquePhrases(parsed) {
  const seen = new Set();
  const out = [];
  for (const l of parsed.lines) {
    if (l.type !== 'line' || !l.key || seen.has(l.key)) continue;
    seen.add(l.key);
    out.push(l);
  }
  return out;
}

/** Подсказка про каподастр для сдвига вверх. */
export function capoHint(semis) {
  const s = ((semis % 12) + 12) % 12;
  if (s === 0 || s > 7) return '';
  return `Гитара: каподастр на ${s}-м ладу и исходные аккорды дают ту же тональность.`;
}

export { parseChord };
