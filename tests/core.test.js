import test from 'node:test';
import assert from 'node:assert/strict';

import {
  midiToFreq, freqToMidi, noteName, noteRu, parseChord, isChord, transposeChord,
  chordIntervals, chordMidis, guessVoiceType,
} from '../js/music.js';
import { createDetector, PitchTracker, segmentNotes, normalizeMelody, HoldDetector } from '../js/pitch.js';
import { scoreTargets, scoreSustain, foldToOctave } from '../js/scoring.js';
import { parseSong, chordSegments, chordTimeline, uniquePhrases, phraseKey } from '../js/songparse.js';

const SR = 48000;
const N = 2048;

/** Голосоподобный сигнал: основной тон и гармоники, по желанию шум. */
function tone(freq, { harmonics = [1, 0.5, 0.3, 0.2], noise = 0, phase = 0, amp = 0.3 } = {}) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    harmonics.forEach((a, h) => { s += a * Math.sin(2 * Math.PI * freq * (h + 1) * (i / SR) + phase * (h + 1)); });
    buf[i] = amp * s + noise * (Math.random() * 2 - 1);
  }
  return buf;
}

test('ноты: частоты и названия', () => {
  assert.equal(Math.round(midiToFreq(69)), 440);
  assert.ok(Math.abs(freqToMidi(261.63) - 60) < 0.01);
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(57), 'A3');
  assert.equal(noteRu(57), 'ля малой октавы');
  assert.equal(noteRu(60), 'до первой октавы');
});

test('детектор: точность на гармоническом сигнале по всему певческому диапазону', () => {
  const detect = createDetector(SR, N);
  for (let midi = 40; midi <= 84; midi += 1) {
    for (const off of [-0.3, 0, 0.27]) {
      const f = midiToFreq(midi + off);
      const r = detect(tone(f));
      const cents = (freqToMidi(r.freq) - (midi + off)) * 100;
      assert.ok(Math.abs(cents) < 6, `${noteName(midi)}${off}: ошибка ${cents.toFixed(1)} ц`);
      assert.ok(r.clarity > 0.9);
    }
  }
});

test('детектор: слабый основной тон не даёт ошибки на октаву', () => {
  const detect = createDetector(SR, N);
  for (const midi of [45, 52, 60, 67]) {
    const r = detect(tone(midiToFreq(midi), { harmonics: [0.25, 1, 0.8, 0.5, 0.3] }));
    assert.ok(Math.abs(freqToMidi(r.freq) - midi) < 0.1, `${noteName(midi)} → ${r.freq.toFixed(1)} Гц`);
  }
});

test('детектор: шум и тишина не считаются тоном', () => {
  const detect = createDetector(SR, N);
  const silence = detect(new Float32Array(N));
  assert.equal(silence.freq, 0);
  const noise = new Float32Array(N).map(() => Math.random() * 0.2 - 0.1);
  const r = detect(noise);
  assert.ok(r.freq === 0 || r.clarity < 0.8);
});

test('детектор: тон с умеренным шумом остаётся точным', () => {
  const detect = createDetector(SR, N);
  const r = detect(tone(220, { noise: 0.03 }));
  assert.ok(Math.abs((freqToMidi(r.freq) - 57) * 100) < 10);
});

test('трекер: гасит одиночный скачок на октаву и принимает устойчивый', () => {
  const tr = new PitchTracker();
  const f = midiToFreq(57);
  for (let i = 0; i < 6; i++) tr.push(f, 0.95, 0.1);
  assert.equal(tr.push(f * 2, 0.95, 0.1), null);
  const back = tr.push(f, 0.95, 0.1);
  assert.ok(Math.abs(back - 57) < 0.01);
  let out = null;
  for (let i = 0; i < 4; i++) out = tr.push(f * 2, 0.95, 0.1);
  assert.ok(Math.abs(out - 69) < 0.01);
});

test('трекер: тихие и нечёткие кадры отбрасываются', () => {
  const tr = new PitchTracker({ gate: 0.01 });
  assert.equal(tr.push(220, 0.95, 0.005), null);
  assert.equal(tr.push(220, 0.5, 0.1), null);
  assert.ok(tr.push(220, 0.95, 0.1) != null);
});

/** Кадры с шагом 16 мс из описания [{ midi|null, sec, rms? }]. */
function makeFrames(parts, t0 = 0) {
  const frames = [];
  let t = t0;
  for (const p of parts) {
    const n = Math.round(p.sec / 0.016);
    for (let i = 0; i < n; i++) {
      const rms = typeof p.rms === 'function' ? p.rms(i / n) : (p.rms ?? 0.1);
      frames.push({ t, midi: p.midi == null ? null : p.midi + (p.wobble ? Math.sin(i) * p.wobble : 0), rms });
      t += 0.016;
    }
  }
  return frames;
}

test('сегментация: ноты, паузы и короткие выбросы', () => {
  const frames = makeFrames([
    { midi: 60, sec: 0.4 }, { midi: 62, sec: 0.4 }, { midi: 71, sec: 0.03 },
    { midi: 64, sec: 0.5, wobble: 0.15 }, { midi: null, sec: 0.3 }, { midi: 60, sec: 0.6 },
  ]);
  const notes = segmentNotes(frames);
  assert.deepEqual(notes.map((n) => n.midi), [60, 62, 64, 60]);
  assert.ok(Math.abs(notes[0].dur - 0.4) < 0.05);
});

test('сегментация: повтор одной ноты распознаётся по новой атаке', () => {
  const decay = (x) => 0.2 * Math.exp(-3 * x) + 0.01;
  const frames = makeFrames([
    { midi: 60, sec: 0.5, rms: decay }, { midi: 60, sec: 0.5, rms: decay }, { midi: 60, sec: 0.5, rms: decay },
  ]);
  const notes = segmentNotes(frames);
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => n.midi === 60));
});

test('сегментация: ровная нота с колебанием громкости не дробится', () => {
  const frames = makeFrames([{ midi: 60, sec: 2, rms: (x) => 0.1 + 0.03 * Math.sin(x * 40) }]);
  assert.equal(segmentNotes(frames).length, 1);
});

test('мелодия: нормализация времени и легато', () => {
  const mel = normalizeMelody([
    { midi: 60, start: 1.0, dur: 0.4 }, { midi: 62, start: 1.5, dur: 0.4 }, { midi: 64, start: 2.6, dur: 0.5 },
  ]);
  assert.equal(mel[0].start, 0);
  assert.equal(mel[0].dur, 0.5);
  assert.equal(mel[1].dur, 0.4);
  assert.equal(mel[2].start, 1.6);
});

test('удержание: срабатывает на устойчивой высоте и сбрасывается при уходе', () => {
  const hd = new HoldDetector({ minDur: 0.5, tol: 0.5 });
  let res = null;
  for (let t = 0; t < 0.4; t += 0.016) res = hd.push(t, 60.1);
  assert.equal(res, null);
  res = hd.push(0.42, 63);
  assert.equal(res, null);
  for (let t = 0.44; t < 1.1; t += 0.016) res = hd.push(t, 63.05);
  assert.ok(res && Math.abs(res.midi - 63.05) < 0.05);
});

test('оценка: попадания, промахи и смещение', () => {
  const targets = [
    { midi: 60, start: 0, dur: 0.5 }, { midi: 62, start: 0.5, dur: 0.5 },
    { midi: 64, start: 1.0, dur: 0.5 }, { midi: 65, start: 1.5, dur: 0.5 },
  ];
  const frames = makeFrames([
    { midi: 60.1, sec: 0.5 }, { midi: 61.2, sec: 0.5 }, { midi: 63.8, sec: 0.5 }, { midi: null, sec: 0.5 },
  ]);
  const r = scoreTargets(targets, frames, { tol: 50 });
  assert.equal(r.total, 4);
  assert.equal(r.hits, 2);
  assert.equal(r.missed, 1);
  assert.equal(r.hitRate, 50);
  assert.equal(r.notes[1].hit, false);
  assert.equal(r.notes[1].cents, -80);
  assert.ok(r.biasCents < 0);
});

test('оценка: тянущаяся нота', () => {
  const frames = makeFrames([{ midi: 57.2, sec: 3 }, { midi: null, sec: 0.5 }]);
  const r = scoreSustain(57, frames, 50);
  assert.ok(Math.abs(r.heldSec - 3) < 0.1);
  assert.equal(r.cents, 20);
  assert.equal(r.inTol, 100);
});

test('оценка: сравнение без учёта октавы', () => {
  assert.deepEqual(foldToOctave(48.2, 60), { cents: 20, octaves: -1 });
  assert.deepEqual(foldToOctave(59.7, 60), { cents: -30, octaves: 0 });
});

test('аккорды: распознавание', () => {
  for (const c of ['A', 'Am', 'Am7', 'Cmaj7', 'F#m7b5', 'Dsus4', 'G/B', 'Hm', 'B', 'E7#9', 'Cadd9', 'D7sus4', 'C6/9', 'Bb', 'A5', 'Dm(maj7)', 'C°7']) {
    assert.ok(isChord(c), c);
  }
  for (const w of ['Add', 'Be', 'Go', 'Dad', 'Привет', 'Hello', 'Fade', 'x2', '|']) {
    assert.ok(!isChord(w), w);
  }
});

test('аккорды: немецкая запись H и B', () => {
  assert.equal(parseChord('H', true).root, 11);
  assert.equal(parseChord('B', true).root, 10);
  assert.equal(parseChord('B', false).root, 11);
  assert.equal(parseChord('Bb', false).root, 10);
});

test('аккорды: транспонирование', () => {
  assert.equal(transposeChord('Am', 2), 'Bm');
  assert.equal(transposeChord('Am', 2, true), 'Hm');
  assert.equal(transposeChord('C', -2), 'Bb');
  assert.equal(transposeChord('C', -2, true), 'B');
  assert.equal(transposeChord('G/B', 1), 'Ab/C');
  assert.equal(transposeChord('F#m7', 3), 'Am7');
  assert.equal(transposeChord('Em', 1), 'Fm');
  assert.equal(transposeChord('Dsus4', 12), 'Dsus4');
  assert.equal(transposeChord('слово', 2), 'слово');
});

test('аккорды: состав', () => {
  assert.deepEqual(chordIntervals(''), [0, 4, 7]);
  assert.deepEqual(chordIntervals('m'), [0, 3, 7]);
  assert.deepEqual(chordIntervals('7'), [0, 4, 7, 10]);
  assert.deepEqual(chordIntervals('maj7'), [0, 4, 7, 11]);
  assert.deepEqual(chordIntervals('m7'), [0, 3, 7, 10]);
  assert.deepEqual(chordIntervals('sus4'), [0, 5, 7]);
  assert.deepEqual(chordIntervals('dim'), [0, 3, 6]);
  assert.deepEqual(chordIntervals('5'), [0, 7]);
  assert.deepEqual(chordIntervals('add9'), [0, 4, 7, 14]);
  const am = chordMidis('Am');
  assert.deepEqual(am.map((n) => n % 12).sort((a, b) => a - b), [0, 4, 9, 9]);
  assert.equal(am[0] % 12, 9);
  assert.equal(chordMidis('C/G')[0] % 12, 7);
});

test('тип голоса', () => {
  assert.equal(guessVoiceType(43, 67).id, 'baritone');
  assert.equal(guessVoiceType(60, 84).id, 'soprano');
});

const SONG = `Куплет 1:
Am           Dm
Первая строка песни
   G            C   E7
Вторая строка здесь

Припев:
[F]Поём мы [G]вместе
Am  Dm  G  C

Строка без аккордов
Am           Dm
Первая строка песни`;

test('песня: разбор строк, разделов и аккордов', () => {
  const p = parseSong(SONG);
  const types = p.lines.map((l) => l.type);
  assert.deepEqual(types, ['section', 'line', 'line', 'break', 'section', 'line', 'chords', 'break', 'line', 'line']);
  assert.equal(p.lines[0].text, 'Куплет 1');
  assert.equal(p.lines[1].lyrics, 'Первая строка песни');
  assert.deepEqual(p.lines[1].chords, [{ pos: 0, chord: 'Am' }, { pos: 13, chord: 'Dm' }]);
  assert.deepEqual(p.lines[2].chords.map((c) => c.chord), ['G', 'C', 'E7']);
  assert.equal(p.lines[5].lyrics, 'Поём мы вместе');
  assert.deepEqual(p.lines[5].chords, [{ pos: 0, chord: 'F' }, { pos: 8, chord: 'G' }]);
  assert.equal(p.lines[8].chords.length, 0);
  assert.equal(p.german, false);
  assert.equal(uniquePhrases(p).length, 4);
  assert.equal(p.lines[1].key, p.lines[9].key);
});

test('песня: признак немецкой записи', () => {
  assert.equal(parseSong('Hm   G\nСлова песни').german, true);
});

test('песня: отрезки для вёрстки и транспонирование', () => {
  const p = parseSong(SONG);
  const segs = chordSegments(p.lines[1], 2, false);
  assert.deepEqual(segs, [{ chord: 'Bm', text: 'Первая строка' }, { chord: 'Em', text: ' песни' }]);
  const segs2 = chordSegments(p.lines[2]);
  assert.equal(segs2[0].chord, '');
  assert.equal(segs2.map((s) => s.text).join(''), 'Вторая строка здесь');
});

test('песня: привязка аккордов к нотам мелодии', () => {
  const p = parseSong(SONG);
  const melody = [0, 0.5, 1, 1.5, 2, 2.5].map((start, i) => ({ midi: 60 + i, start, dur: 0.5 }));
  const tl = chordTimeline(p.lines[1], melody);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].start, 0);
  assert.equal(tl[1].start, 2);
  assert.equal(tl[0].dur + tl[1].dur, 3);
});

test('песня: ключ фразы не зависит от регистра и знаков', () => {
  assert.equal(phraseKey('Привет, мир!'), phraseKey('привет мир'));
});

// ---------- План и подгонка упражнений ----------

import { LIB, WEEKS, resolve, sessionItems, toleranceFor } from '../js/curriculum.js';

const stateFor = (low, high, week = 1) => ({
  profile: { low, high }, plan: { week, override: null }, songs: [],
  settings: { refMode: 'app', headphones: false },
});

test('план: 12 недель, все упражнения существуют, занятие 12–25 минут', () => {
  assert.equal(WEEKS.length, 12);
  WEEKS.forEach((w, i) => {
    for (const id of w.session) assert.ok(LIB[id], `неделя ${i + 1}: ${id}`);
    const min = w.session.reduce((a, id) => a + LIB[id].min, 0);
    assert.ok(min >= 12 && min <= 25, `неделя ${i + 1}: ${min} мин`);
    assert.equal(w.session[w.session.length - 1], 'cooldown');
  });
});

test('упражнения: все ноты лежат в диапазоне ученика на любой неделе', () => {
  const ranges = [[41, 64], [45, 67], [48, 72], [57, 79], [60, 84], [50, 62], [55, 60]];
  for (const [low, high] of ranges) {
    for (let week = 1; week <= 12; week++) {
      const st = stateFor(low, high, week);
      for (const id of Object.keys(LIB)) {
        const ex = resolve(id, st);
        const span = high - low;
        const check = (m, what) => {
          // Узкий диапазон может не вместить широкую попевку — тогда допускается выход только вверх.
          assert.ok(m >= low, `${id} ${what}: ${m} ниже ${low} (диапазон ${low}–${high}, неделя ${week})`);
          if (span >= 16) assert.ok(m <= high, `${id} ${what}: ${m} выше ${high} (диапазон ${low}–${high}, неделя ${week})`);
        };
        if (ex.type === 'pattern') {
          assert.ok(ex.reps.length >= 1 && ex.reps.length <= 8, `${id}: повторов ${ex.reps.length}`);
          for (const rep of ex.reps) for (const n of rep.notes) check(n.midi, 'попевка');
        }
        if (ex.type === 'sustain') for (const m of ex.notes) check(m, 'нота');
        if (ex.type === 'match') for (const it of ex.items) { check(it.midi, 'цель'); if (it.root != null) check(it.root, 'основа'); }
        if (ex.type === 'glide') { check(ex.zone.lo, 'зона'); check(ex.zone.hi, 'зона'); }
      }
    }
  }
});

test('упражнения: попевки поднимаются по полутонам снизу вверх', () => {
  const ex = resolve('scale-5', stateFor(45, 67, 4));
  const roots = ex.reps.map((r) => r.root);
  assert.deepEqual(roots, roots.slice().sort((a, b) => a - b));
  assert.equal(ex.reps[0].notes.length, 9);
  assert.equal(ex.tol, toleranceFor(4));
});

test('занятие: песня добавляется перед заминкой, выбор учителя учитывается', () => {
  const st = stateFor(45, 67, 1);
  assert.ok(!sessionItems(st).includes('song'));
  st.songs = [{ id: 'x' }];
  const ids = sessionItems(st);
  assert.equal(ids[ids.length - 2], 'song');
  assert.equal(ids[ids.length - 1], 'cooldown');
  st.plan.override = { week: 1, session: ['straw-glide', 'нет-такого', 'scale-3', 'cooldown'] };
  assert.deepEqual(sessionItems(st), ['straw-glide', 'scale-3', 'song', 'cooldown']);
});
