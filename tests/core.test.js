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

import { LIB, WEEKS, resolve, sessionItems, sessionMinutes, toleranceFor, rangeProposal } from '../js/curriculum.js';
import { T, patternTimeline, repSeconds, estimateSeconds, countBeat } from '../js/timeline.js';
import { scoreAligned, positionStats, rootStats } from '../js/scoring.js';
import { tipFor, compareWithPrev, degreeGroups } from '../js/tips.js';

const stateFor = (low, high, week = 1) => ({
  profile: { low, high }, plan: { week, override: null }, songs: [],
  settings: { refMode: 'app', headphones: false },
});

test('план: 12 недель, все упражнения существуют, заминка в конце', () => {
  assert.equal(WEEKS.length, 12);
  WEEKS.forEach((w, i) => {
    for (const id of w.session) assert.ok(LIB[id], `неделя ${i + 1}: ${id}`);
    assert.equal(w.session[w.session.length - 1], 'cooldown');
  });
});

test('план: настоящая длительность занятия — 11–20 минут на любой неделе', () => {
  for (const [low, high] of [[45, 67], [41, 69], [57, 79], [50, 62]]) {
    for (let week = 1; week <= 12; week++) {
      const min = sessionMinutes(stateFor(low, high, week));
      assert.ok(min >= 11 && min <= 20, `диапазон ${low}–${high}, неделя ${week}: ${min} мин`);
    }
  }
});

test('упражнения: ноты лежат в диапазоне ученика, кроме упражнений на его расширение', () => {
  const ranges = [[41, 64], [45, 67], [48, 72], [57, 79], [60, 84], [50, 62], [55, 60]];
  for (const [low, high] of ranges) {
    for (let week = 1; week <= 12; week++) {
      const st = stateFor(low, high, week);
      for (const id of Object.keys(LIB)) {
        const ex = resolve(id, st);
        const span = high - low;
        // С девятой недели упражнения на диапазон выходят на полутон вниз и до двух вверх.
        const below = ex.stretched ? 1 : 0;
        const above = ex.stretched ? (week >= 10 ? 2 : 1) : 0;
        const check = (m, what) => {
          assert.ok(m >= low - below, `${id} ${what}: ${m} ниже ${low} (диапазон ${low}–${high}, неделя ${week})`);
          // Узкий диапазон может не вместить широкую попевку — тогда допускается выход вверх.
          if (span >= 16) assert.ok(m <= high + above, `${id} ${what}: ${m} выше ${high} (диапазон ${low}–${high}, неделя ${week})`);
        };
        if (ex.type === 'pattern') {
          assert.ok(ex.reps.length >= 1 && ex.reps.length <= 32, `${id}: повторов ${ex.reps.length}`);
          for (const rep of ex.reps) for (const n of rep.notes) check(n.midi, 'попевка');
        }
        if (ex.type === 'sustain') for (const m of ex.notes) check(m, 'нота');
        if (ex.type === 'match') for (const it of ex.items) { check(it.midi, 'цель'); if (it.root != null) check(it.root, 'основа'); }
        if (ex.type === 'glide') { check(ex.zone.lo, 'зона'); check(ex.zone.hi, 'зона'); }
        assert.equal(!!ex.stretched, !!LIB[id].stretch && week >= 9, `${id}: растяжка на неделе ${week}`);
      }
    }
  }
});

test('упражнения: попевка идёт вверх и возвращается вниз', () => {
  const ex = resolve('scale-5', stateFor(45, 67, 4));
  const roots = ex.reps.map((r) => r.root);
  const peak = roots.indexOf(Math.max(...roots));
  assert.ok(peak > 0 && peak < roots.length - 1, 'есть и подъём, и спуск');
  for (let i = 1; i <= peak; i++) assert.ok(roots[i] > roots[i - 1]);
  for (let i = peak + 1; i < roots.length && roots[i] !== roots[0]; i++) assert.ok(roots[i] < roots[i - 1]);
  assert.equal(roots[0], Math.min(...roots));
  assert.equal(ex.reps[0].notes.length, 9);
  assert.equal(ex.tol, toleranceFor(4));
});

test('упражнения: короткий проход повторяется вторым подходом', () => {
  const ex = resolve('scale-8', stateFor(45, 67, 5));
  const roots = ex.reps.map((r) => r.root);
  assert.ok(roots.filter((r) => r === Math.max(...roots)).length >= 2, `вершина пройдена дважды: ${roots}`);
});

test('диапазон: на 9-й неделе упражнение выходит на полутон выше, на 10-й — на два', () => {
  const top = (week) => Math.max(...resolve('arp-8', stateFor(45, 67, week)).reps.flatMap((r) => r.notes.map((n) => n.midi)));
  assert.equal(top(8), Math.round(45 + 0.82 * 22));
  assert.equal(top(9), 68);
  assert.equal(top(10), 69);
  assert.equal(resolve('lip-trill-glide', stateFor(45, 67, 10)).zone.hi, 69);
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

// ---------- Расписание и отсчёт ----------

test('расписание: отсчёт в темпе попевки, оценка длительности совпадает с расписанием', () => {
  assert.equal(countBeat(0.5), 0.5);
  assert.equal(countBeat(0.3), 0.6);
  assert.equal(countBeat(1.1), 0.55);
  const ex = resolve('scale-5', stateFor(45, 67, 3));
  const line = patternTimeline(ex.reps, ex.noteDur, 100);
  assert.equal(line.length, ex.reps.length);
  const first = line[0];
  assert.ok(Math.abs(first.refStart - (100 + T.prep)) < 1e-9);
  assert.ok(first.ticks[0] >= first.refStart + first.refLen + T.breath - 1e-9, 'щелчки после образца');
  assert.ok(Math.abs(first.singStart - first.ticks[1] - 0.5) < 1e-9, 'вступление через долю после второго щелчка');
  assert.ok(first.singStart - (first.refStart + first.refLen) >= 1.2, 'на вдох больше секунды');
  for (let i = 1; i < line.length; i++) assert.ok(line[i].refStart >= line[i - 1].singEnd + T.maxLag, 'следующий образец не мешает опоздавшему');
  const end = line[line.length - 1].singEnd + T.tail - 100;
  assert.ok(Math.abs(estimateSeconds(ex) - end) < 0.01);
  assert.ok(Math.abs(repSeconds(ex.reps[0].len, ex.noteDur) - (line[1].refStart - line[0].refStart)) < 1e-9);
});

// ---------- Оценка с учётом опоздания ----------

/** Кадры ученика, который поёт данные ноты с опозданием lag и смещением cents. */
function sing(notes, { lag = 0, cents = 0, drone = null } = {}) {
  const frames = [];
  const end = notes[notes.length - 1].start + notes[notes.length - 1].dur;
  for (let t = notes[0].start - 0.5; t < end + 1.5; t += 1 / 60) {
    const n = notes.find((x) => t - lag >= x.start && t - lag < x.start + x.dur);
    frames.push({ t, midi: drone != null ? drone : (n ? n.midi + cents / 100 : null) });
  }
  return frames;
}

test('оценка: опоздание до 0,6 с не снижает результат и сообщается отдельно', () => {
  for (const id of ['scale-3', 'scale-5', 'arp-8', 'scale-8', 'scale-9', 'staccato']) {
    const ex = resolve(id, stateFor(45, 67, 5));
    const notes = ex.reps[0].notes.map((n) => ({ ...n, start: n.start + 10 }));
    for (const lag of [0, 0.2, 0.4, 0.55]) {
      const r = scoreAligned(notes, sing(notes, { lag }), { tol: ex.tol, maxLag: T.maxLag });
      assert.equal(r.hitRate, 100, `${id}, опоздание ${lag}: ${r.hitRate}%`);
      assert.ok(Math.abs(r.lagSec - lag) <= 0.16, `${id}: опоздание ${lag} определено как ${r.lagSec}`);
    }
  }
});

test('оценка: поправка на опоздание не засчитывает фальшь', () => {
  const ex = resolve('scale-5', stateFor(45, 67, 5));
  const notes = ex.reps[0].notes.map((n) => ({ ...n, start: n.start + 10 }));
  const flat = scoreAligned(notes, sing(notes, { lag: 0.3, cents: -80 }), { tol: ex.tol });
  assert.equal(flat.hitRate, 0);
  assert.ok(flat.biasCents < -60);
  // Одна тянущаяся нота вместо попевки попадает только туда, где она и правда есть.
  const drone = scoreAligned(notes, sing(notes, { drone: notes[2].midi }), { tol: ex.tol });
  assert.equal(drone.hits, notes.filter((n) => n.midi === notes[2].midi).length);
  // Опоздание больше допустимого не прощается.
  const late = scoreAligned(notes, sing(notes, { lag: 1.2 }), { tol: ex.tol, maxLag: T.maxLag });
  assert.ok(late.hitRate < 50, `опоздание 1,2 с: ${late.hitRate}%`);
});

test('разбор: статистика по местам в попевке и по высоте', () => {
  const note = (cents, hit = Math.abs(cents) <= 45) => ({ sung: true, hit, cents });
  const lists = [[note(0), note(-10), note(-40)], [note(5), note(-20), note(-60)]];
  const pos = positionStats(lists, [0, 2, 4]);
  assert.deepEqual(pos.map((p) => p.hit), [100, 100, 50]);
  assert.deepEqual(pos.map((p) => p.bias), [3, -15, -50]);
  const roots = rootStats([{ root: 50, notes: lists[0] }, { root: 48, notes: lists[1] }, { root: 50, notes: lists[1] }]);
  assert.deepEqual(roots.map((r) => r.root), [48, 50]);
  assert.equal(roots[1].hitRate, 83);
});

// ---------- Советы ----------

const deg = (list) => list.map(([semis, hit, bias]) => ({ semis, hit, bias, n: 6 }));

test('совет: верхняя нота низит', () => {
  const m = { notes: 30, missed: 0, hitRate: 70, biasCents: -12, stdCents: 12, lagSec: 0.05, reps: [],
    degrees: deg([[0, 100, -2], [2, 100, -5], [4, 40, -38], [2, 90, -8], [0, 95, -3]]) };
  const tips = tipFor({ type: 'pattern', m });
  assert.match(tips[0], /Верхняя нота попевки низит/);
  assert.match(tips[0], /38 центов/);
  assert.match(tipFor({ type: 'pattern', m: { ...m, degrees: deg([[0, 100, -2], [4, 40, -34], [0, 95, -3]]) } })[0], /на 34 цента /);
  assert.deepEqual(degreeGroups(m.degrees).top, { n: 1, hit: 40, bias: -38 });
});

test('совет: спуск сползает, опоздание упоминается отдельно', () => {
  const m = { notes: 45, missed: 0, hitRate: 72, biasCents: -14, stdCents: 12, lagSec: 0.4, reps: [],
    degrees: deg([[0, 100, 0], [2, 100, 2], [4, 95, -2], [5, 90, -5], [7, 90, -4], [5, 60, -30], [4, 55, -28], [2, 60, -25], [0, 65, -26]]) };
  const tips = tipFor({ type: 'pattern', m });
  assert.match(tips[0], /вступаете позже примерно на 0,4 с/);
  assert.match(tips[1], /На спуске ноты сползают/);
});

test('совет: падение точности на верхних повторах и тихий голос', () => {
  const reps = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3'].map((from, i) => ({ from, hitRate: i < 4 ? 90 : 40, bias: 0 }));
  const m = { notes: 30, missed: 0, hitRate: 73, biasCents: 0, stdCents: 10, lagSec: 0, reps, degrees: deg([[0, 75, 0], [2, 72, 0], [0, 73, 0]]) };
  assert.match(tipFor({ type: 'pattern', m }).join(' '), /верхних повторах \(от G3 и выше\)/);
  assert.match(tipFor({ type: 'pattern', m: { ...m, missed: 20 } })[0], /почти не слышало голос/);
  assert.match(tipFor({ type: 'pattern', m: { ...m, reps: [], hitRate: 92 } })[0], /Чисто: 92%/);
});

test('совет: удержание ноты, выдох, попадание', () => {
  const off = { notes: [{ heldSec: 0 }, { heldSec: 0 }, { heldSec: 3 }], bestHeldSec: 3, avgStdCents: 10, biasCents: 0 };
  assert.match(tipFor({ type: 'sustain', m: off }, { holdSec: 6 })[0], /не ту ноту/);
  const shaky = { notes: [{ heldSec: 6 }, { heldSec: 6 }], bestHeldSec: 6, avgStdCents: 34, biasCents: 0 };
  assert.match(tipFor({ type: 'sustain', m: shaky }, { holdSec: 6 })[0], /Нота дрожит/);
  assert.match(tipFor({ type: 'exhale', m: { durations: [8, 7, 6], bestSec: 8, avgSec: 7 } })[0], /пока короткий — 8 с/);
  assert.match(tipFor({ type: 'match', m: { kind: 'ноты', hitRate: 30, biasCents: -40, avgSec: 2, items: [{ ok: true }, { ok: false }, { ok: false }] } })[0], /ниже цели/);
  assert.deepEqual(tipFor({ type: 'pattern', skipped: true }), []);
});

test('совет: сравнение с прошлой попыткой', () => {
  assert.equal(compareWithPrev({ type: 'pattern', score: 71, m: {} }, { type: 'pattern', score: 62, m: {} }), 'В прошлый раз 62% → сейчас 71% — лучше');
  assert.equal(compareWithPrev({ type: 'exhale', m: { bestSec: 12.5 } }, { type: 'exhale', m: { bestSec: 14 } }), 'В прошлый раз 14 с → сейчас 12,5 с');
  assert.equal(compareWithPrev({ type: 'pattern', score: 71, m: {} }, null), null);
  assert.equal(compareWithPrev({ type: 'pattern', score: 71, partial: true, m: {} }, { type: 'pattern', score: 62, m: {} }), null);
});

// ---------- Рост диапазона ----------

test('диапазон: предложение расширить появляется после трёх занятий с запасом', () => {
  const profile = { low: 45, high: 67 };
  const glide = (low, high) => ({ results: [{ type: 'glide', m: { reps: 4, low, high } }] });
  assert.equal(rangeProposal(profile, [glide(45, 67), glide(46, 68), glide(45, 67)]), null);
  assert.equal(rangeProposal(profile, [glide(45, 70), glide(45, 70)]), null, 'двух занятий мало');
  // Касание ноты в скольжении считается с запасом в полутон.
  assert.deepEqual(rangeProposal(profile, [glide(45, 69), glide(45, 70), glide(45, 69), glide(45, 67)]), { low: 45, high: 68 });
  assert.deepEqual(rangeProposal(profile, [glide(42, 72), glide(42, 72), glide(42, 72)]), { low: 43, high: 69 }, 'не больше двух полутонов за раз');
  const beyond = (topHit) => ({ results: [{ type: 'pattern', m: { beyond: { notes: 4, hits: 2, topHit, lowHit: null } } }] });
  assert.deepEqual(rangeProposal(profile, [beyond(68), beyond(68), beyond(69)]), { low: 45, high: 68 });
  assert.equal(rangeProposal(profile, [beyond(68), beyond(68), beyond(69)], { low: 45, high: 68 }), null, 'отклонённое не предлагается снова');
});
