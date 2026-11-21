// Песни: список, текст с аккордами, запись мелодии, разучивание и исполнение.

import { state, saveNow, uid, putTake, getTake, deleteTake, dayKey } from '../store.js';
import { h, clear, put, go, sheet, toast, confirmSheet, icon, fmtDate, renderText } from '../ui.js';
import * as audio from '../audio.js';
import { Roll } from '../roll.js';
import { mountRunner } from '../runner.js';
import { parseSong, chordSegments, chordTimeline, uniquePhrases, capoHint } from '../songparse.js';
import { segmentNotes, normalizeMelody } from '../pitch.js';
import { noteName, rangeLabel, chordMidis, transposeChord } from '../music.js';
import { toleranceFor } from '../curriculum.js';
import { teacherBlock } from './session.js';
import { songReviewPrompt } from '../claude.js';

const EXAMPLE = `Куплет 1:
Am            Dm
Первая строка песни
G             C
Вторая строка песни`;

/** Отрезки «аккорд над словами». Пробел в конце отрезка делаем неразрывным, чтобы он не пропадал при вёрстке. */
const segNodes = (line, semis, german) => chordSegments(line, semis, german).map((sg) =>
  h('span.sg', h('span.ch', sg.chord || '\u00a0'), h('span.tx', (sg.text || '\u00a0').replace(/ $/, '\u00a0'))));

const shiftOf = (song) => song.transpose + 12 * song.octave;
const cls = (v) => (v >= 75 ? 'ok' : v >= 45 ? 'warn' : 'bad');

function editSheet(song, onSave) {
  const title = h('input', { type: 'text', placeholder: 'Название', value: song ? song.title : '' });
  const artist = h('input', { type: 'text', placeholder: 'Исполнитель (необязательно)', value: song ? song.artist : '' });
  const text = h('textarea.mono', { rows: 12, placeholder: EXAMPLE, value: song ? song.text : '', spellcheck: false, autocapitalize: 'off' });
  const err = h('p.error', { hidden: true });
  sheet(song ? 'Изменить песню' : 'Новая песня', (close) => h('div.form',
    title, artist,
    h('p.muted', 'Вставьте текст с аккордами: аккорды строкой над словами или в квадратных скобках — [Am]слова. Разделы «Куплет», «Припев» распознаются сами.'),
    text, err,
    h('button.btn.primary.wide', {
      onclick: () => {
        const parsed = parseSong(text.value);
        if (!title.value.trim()) { err.textContent = 'Введите название.'; err.hidden = false; return; }
        if (!parsed.lines.some((l) => l.type === 'line')) { err.textContent = 'В тексте не нашлось строк со словами.'; err.hidden = false; return; }
        onSave({ title: title.value.trim(), artist: artist.value.trim(), text: text.value });
        close();
      },
    }, 'Сохранить')));
}

export function songsView(root) {
  const render = () => {
    clear(root);
    root.append(h('div.page',
      h('header.top', h('div', h('small.muted', 'Репертуар'), h('h1', 'Песни')),
        h('button.icon-btn', { onclick: add, 'aria-label': 'Добавить песню' }, icon('plus'))),
      state.songs.length
        ? h('div.list', state.songs.map((s) => {
          const parsed = parseSong(s.text);
          const phrases = uniquePhrases(parsed);
          const ready = phrases.filter((p) => s.melodies[p.key]).length;
          return h('button.row-btn', { onclick: () => go('song/' + s.id) },
            h('span.grow', h('strong', s.title), h('span.muted', [s.artist, `мелодия: ${ready} из ${phrases.length} фраз`].filter(Boolean).join(' · '))),
            s.id === state.activeSongId ? h('span.tag', 'в занятии') : null);
        }))
        : h('div.card.empty',
          h('h3', 'Пока нет песен'),
          h('p.muted', 'Добавьте текст с аккордами. Мелодию каждой фразы вы один раз наиграете на инструменте, и приложение начнёт оценивать попадание.'),
          h('button.btn.primary', { onclick: add }, 'Добавить песню')),
      h('p.footnote', 'Тексты хранятся только на этом устройстве. При разборе песни текст отправляется учителю вместе с результатами.')));
  };
  function add() {
    editSheet(null, (data) => {
      const song = { id: uid(), ...data, transpose: 0, octave: 0, melodies: {}, results: [], takes: [], review: '', createdAt: new Date().toISOString() };
      state.songs.push(song);
      if (!state.activeSongId) state.activeSongId = song.id;
      saveNow();
      go('song/' + song.id);
    });
  }
  render();
}

export function songView(root, id) {
  const song = state.songs.find((s) => s.id === id);
  if (!song) { go('songs'); return null; }
  let runner = null;
  let raf = 0;
  let takeUrl = null;
  let teacher = null;
  let scrollTimer = 0;

  const stopAll = () => {
    if (runner) { runner.destroy(); runner = null; }
    cancelAnimationFrame(raf);
    clearInterval(scrollTimer);
    audio.stopSound();
    audio.keepAwake(false);
  };
  const parsed = () => parseSong(song.text);
  const melody = (key) => {
    const m = song.melodies[key];
    return m ? m.map((n) => ({ ...n, midi: n.midi + shiftOf(song) })) : null;
  };
  const rawRange = (p) => {
    const all = uniquePhrases(p).flatMap((l) => (song.melodies[l.key] || []).map((n) => n.midi));
    return all.length ? { lo: Math.min(...all), hi: Math.max(...all) } : null;
  };
  const lastResult = (key) => [...song.results].reverse().find((r) => r.key === key);

  // ---------- Главный экран песни ----------

  function main() {
    stopAll();
    audio.stopMic();
    clear(root);
    const p = parsed();
    const rr = rawRange(p);
    const prof = state.profile;
    const s = shiftOf(song);
    const inSession = state.draft && state.draft.date === dayKey() && state.draft.ids[state.draft.results.length] === 'song';
    const phraseCount = uniquePhrases(p).length;
    const ready = uniquePhrases(p).filter((l) => song.melodies[l.key]).length;

    const fit = () => {
      if (!rr) return h('p.muted', 'Запишите мелодию хотя бы одной фразы — приложение сравнит её с вашим диапазоном и подскажет тональность.');
      const lo = rr.lo + s;
      const hi = rr.hi + s;
      const below = prof.low - lo;
      const above = hi - prof.high;
      const msg = below > 0 || above > 0
        ? `выходит за ваш диапазон: ${[below > 0 ? `на ${below} полутон. ниже` : '', above > 0 ? `на ${above} полутон. выше` : ''].filter(Boolean).join(' и ')}`
        : 'помещается в ваш диапазон';
      return h('p.muted', `Мелодия ${rangeLabel(lo, hi)} — ${msg} (${rangeLabel(prof.low, prof.high)}).`);
    };

    const stepper = (label, value, onChange) => h('div.stepper',
      h('span', label),
      h('div', h('button.icon-btn', { onclick: () => onChange(-1), 'aria-label': 'Меньше' }, '−'),
        h('b', value),
        h('button.icon-btn', { onclick: () => onChange(1), 'aria-label': 'Больше' }, '+')));

    const takeBox = h('div');
    getTake(song.id).then((blob) => {
      if (!blob || !takeBox.isConnected) return;
      if (takeUrl) URL.revokeObjectURL(takeUrl);
      takeUrl = URL.createObjectURL(blob);
      const last = song.takes[song.takes.length - 1];
      takeBox.append(h('p.muted', `Последняя запись${last ? ' · ' + fmtDate(last.date) : ''}`), h('audio', { controls: true, src: takeUrl, preload: 'metadata' }));
    });

    const teacherBox = h('div', song.review ? renderText(song.review) : null);

    root.append(h('div.page',
      h('header.top',
        h('button.icon-btn', { onclick: () => go('songs'), 'aria-label': 'Назад' }, icon('back')),
        h('div.grow', h('small.muted', song.artist || 'Песня'), h('h1.small', song.title)),
        h('button.btn.ghost.sm', { onclick: edit }, 'Изменить')),

      inSession ? h('button.btn.primary.wide', { onclick: () => go('session') }, 'Вернуться к занятию') : null,

      h('div.card',
        stepper('Тональность', song.transpose === 0 ? 'исходная' : (song.transpose > 0 ? '+' : '') + song.transpose, (d) => {
          song.transpose = Math.max(-11, Math.min(11, song.transpose + d));
          saveNow(); main();
        }),
        rr ? stepper('Октава мелодии', song.octave === 0 ? '0' : (song.octave > 0 ? '+' : '') + song.octave, (d) => {
          song.octave = Math.max(-2, Math.min(2, song.octave + d));
          saveNow(); main();
        }) : null,
        fit(),
        rr ? h('button.btn.ghost.sm', { onclick: autoKey }, 'Подобрать под мой голос') : null,
        song.transpose > 0 && capoHint(song.transpose) ? h('p.hint', capoHint(song.transpose)) : null),

      h('div.card',
        h('h3', 'Петь целиком'),
        h('div.row',
          h('button.btn.primary', { disabled: !ready, onclick: perform }, 'С оценкой'),
          h('button.btn', { onclick: prompter }, 'Под свой аккомпанемент')),
        h('p.muted', ready
          ? `С оценкой: без инструмента, приложение считает попадание (мелодия есть у ${ready} из ${phraseCount} фраз). Под аккомпанемент: текст и аккорды перед глазами, без оценки.`
          : 'Режим с оценкой откроется, когда будет записана мелодия хотя бы одной фразы.'),
        takeBox),

      h('div.card.sheet-card',
        h('div.card-head', h('h3', 'Текст'), h('span.muted', 'нажмите на строку')),
        p.lines.map((l) => {
          if (l.type === 'section') return h('h4.sec', l.text);
          if (l.type === 'break') return h('div.gap');
          if (l.type === 'chords') return h('div.chord-only', l.chords.map((c) => h('span.ch', transposeChord(c.chord, song.transpose, p.german))));
          const res = lastResult(l.key);
          return h('button.phrase', { onclick: () => phraseSheet(l, p) },
            h('span.segs', segNodes(l, song.transpose, p.german)),
            h('span.mark', { class: song.melodies[l.key] ? 'has' : '' }, res ? h('b', { class: cls(res.hitRate) }, `${res.hitRate}%`) : (song.melodies[l.key] ? '♪' : '○')));
        })),

      h('div.card',
        h('h3', 'Разбор учителя'),
        teacherBox,
        h('button.btn.ghost', {
          onclick: (e) => {
            e.target.hidden = true;
            if (teacher) teacher.abort();
            teacher = teacherBlock(songReviewPrompt(song), (text) => { song.review = text; saveNow(); });
            clear(teacherBox).append(teacher.el);
          },
        }, song.review ? 'Запросить заново' : 'Запросить разбор')),

      h('div.row',
        state.activeSongId !== song.id
          ? h('button.btn.ghost', { onclick: () => { state.activeSongId = song.id; saveNow(); toast('Песня добавлена в занятие'); main(); } }, 'Сделать песней занятия')
          : h('span.muted', 'Эта песня входит в ежедневное занятие'),
        h('button.btn.ghost.danger', { onclick: remove }, 'Удалить'))));
  }

  function edit() {
    editSheet(song, (data) => { Object.assign(song, data); saveNow(); main(); });
  }

  async function remove() {
    if (!(await confirmSheet('Удалить песню?', 'Текст, записанные мелодии и результаты будут удалены.', 'Удалить', true))) return;
    state.songs = state.songs.filter((s) => s.id !== song.id);
    if (state.activeSongId === song.id) state.activeSongId = state.songs[0] ? state.songs[0].id : null;
    deleteTake(song.id);
    saveNow();
    go('songs');
  }

  function autoKey() {
    const rr = rawRange(parsed());
    const prof = state.profile;
    const lo = prof.low + 1;
    const hi = prof.high - 2;
    let best = null;
    for (let o = -2; o <= 2; o++) {
      for (let t = -5; t <= 6; t++) {
        const sh = t + 12 * o;
        const out = Math.max(0, lo - (rr.lo + sh)) + Math.max(0, rr.hi + sh - hi);
        const center = Math.abs((rr.lo + rr.hi) / 2 + sh - (lo + hi) / 2);
        const cost = out * 100 + (out === 0 ? Math.abs(t) * 2 : center) + Math.abs(o) * 0.1;
        if (!best || cost < best.cost) best = { cost, t, o, out };
      }
    }
    song.transpose = best.t;
    song.octave = best.o;
    saveNow();
    toast(best.out ? 'Мелодия шире вашего диапазона — выбран ближайший вариант' : 'Тональность подобрана');
    main();
  }

  // ---------- Фраза ----------

  function phraseSheet(line, p) {
    const mel = melody(line.key);
    let tempo = 1;
    sheet('Фраза', (close) => {
      const tempoSeg = h('div.seg', [[1, '100%'], [0.8, '80%'], [0.6, '60%']].map(([v, label]) => {
        const b = h('button', { type: 'button', class: v === tempo ? 'on' : '' }, label);
        b.addEventListener('click', () => { tempo = v; [...tempoSeg.children].forEach((c) => c.classList.toggle('on', c === b)); });
        return b;
      }));
      return h('div',
        h('p.lyric', line.lyrics),
        line.chords.length ? h('p.muted', line.chords.map((c) => transposeChord(c.chord, song.transpose, p.german)).join('  ')) : null,
        mel
          ? [
            h('div.chips', mel.map((n) => h('span.chip', noteName(n.midi)))),
            h('div.row',
              h('button.btn', { onclick: async () => { await audio.unlock(); audio.stopSound(); audio.playNotes(mel, audio.now() + 0.1, 0.6); } }, icon('play'), ' Прослушать'),
              h('button.btn.primary', { onclick: () => { close(); practice(line, tempo); } }, 'Разучивать')),
            h('div.field', h('span.muted', 'Темп'), tempoSeg),
            h('div.row',
              h('button.btn.ghost', { onclick: () => { close(); record(line); } }, 'Перезаписать'),
              h('button.btn.ghost.danger', { onclick: () => { delete song.melodies[line.key]; saveNow(); close(); main(); } }, 'Удалить мелодию')),
          ]
          : [
            h('p.muted', 'Мелодия этой фразы ещё не записана. Сыграйте её одним голосом на фортепиано или гитаре — приложение запишет ноты и будет сверять с ними ваш голос. Одинаковые строки (припев) записываются один раз.'),
            h('button.btn.primary.wide', { onclick: () => { close(); record(line); } }, 'Записать мелодию'),
          ]);
    });
  }

  // ---------- Запись мелодии ----------

  function record(line) {
    stopAll();
    let frames = [];
    let notes = [];
    let center = 60;
    let roll = null;
    const status = h('h2.run-status', 'Запись мелодии');
    const sub = h('p.run-sub', line.lyrics);
    const body = h('div.run-body');
    const foot = h('div.run-foot');
    const canvas = h('canvas.roll');
    const noteEl = h('div.run-note', '—');

    const frame = (...children) => {
      clear(root).append(h('div.runner',
        h('header.run-head',
          h('button.icon-btn', { onclick: main, 'aria-label': 'Закрыть' }, icon('back')),
          h('div.run-title', h('small', song.title), h('strong', 'Запись мелодии')),
          h('span.run-step', '')),
        ...children));
    };

    const idle = (error) => {
      cancelAnimationFrame(raf);
      put(clear(body), 
        h('div.card.how',
          h('h3', 'Как записать'),
          h('ol',
            h('li', 'Поставьте телефон рядом с инструментом.'),
            h('li', 'Нажмите «Начать запись» и сыграйте мелодию фразы одним голосом, без аккордов, в том ритме, в каком она поётся.'),
            h('li', 'Нажмите «Стоп». Проверьте ноты на слух и сохраните.')),
          h('p.feel', `Играйте в тональности, которая сейчас показана в тексте${song.transpose ? ` (сдвиг ${song.transpose > 0 ? '+' : ''}${song.transpose})` : ''}. Мелодию можно и напеть, но тогда эталон унаследует ваши неточности.`)),
        h('p.lyric', line.lyrics),
        error ? h('p.error', error) : null);
      put(clear(foot), h('button.btn.primary.wide', { onclick: start }, icon('mic'), ' Начать запись'));
      frame(body, foot);
    };

    const start = async () => {
      try {
        await audio.startMic();
        await audio.calibrate(0.4);
        audio.resetTracker();
      } catch (e) { idle(e.message); return; }
      audio.keepAwake(true);
      frames = [];
      put(clear(body), h('div.run-top', status, sub), h('div.run-stage', canvas, h('div.run-readout', noteEl)));
      put(clear(foot), h('button.btn.primary.wide', { onclick: stop }, 'Стоп'));
      frame(body, foot);
      status.textContent = 'Играйте фразу';
      roll = new Roll(canvas);
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const f = audio.readFrame();
        if (!f) return;
        frames.push(f);
        if (f.midi != null) {
          if (f.midi > center + 9) center = f.midi - 9;
          if (f.midi < center - 9) center = f.midi + 9;
          noteEl.textContent = noteName(Math.round(f.midi));
        } else noteEl.textContent = '—';
        roll.draw({ now: audio.now(), frames, targets: [], lo: Math.round(center) - 12, hi: Math.round(center) + 12 });
      };
      loop();
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      audio.keepAwake(false);
      audio.stopMic();
      notes = normalizeMelody(segmentNotes(frames, { minDur: 0.11 }));
      review();
    };

    const review = () => {
      const chips = h('div.chips.edit', notes.map((n, i) => h('button.chip', { onclick: () => editNote(i) }, noteName(n.midi))));
      put(clear(body), 
        h('p.lyric', line.lyrics),
        notes.length
          ? h('div.card', h('h3', `Распознано нот: ${notes.length}`), chips,
            h('p.muted', 'Нажмите на ноту, чтобы поправить или удалить её. Прослушайте результат: он должен совпадать с мелодией.'))
          : h('p.error', 'Ноты не распознаны. Играйте чуть громче и ближе к телефону, по одной ноте.'));
      put(clear(foot), 
        notes.length ? h('button.btn', { onclick: async () => { await audio.unlock(); audio.stopSound(); audio.playNotes(notes, audio.now() + 0.1, 0.6); } }, icon('play'), ' Прослушать') : null,
        notes.length ? h('button.btn.primary', {
          onclick: () => {
            song.melodies[line.key] = notes.map((n) => ({ midi: n.midi - song.transpose, start: n.start, dur: n.dur }));
            saveNow();
            toast('Мелодия сохранена');
            main();
          },
        }, 'Сохранить') : null,
        h('button.btn.ghost', { onclick: () => idle() }, 'Заново'));
      frame(body, foot);
    };

    const editNote = (i) => {
      sheet(`Нота ${noteName(notes[i].midi)}`, (close) => h('div.row',
        h('button.btn', { onclick: () => { notes[i].midi -= 1; close(); review(); } }, '− полутон'),
        h('button.btn', { onclick: () => { notes[i].midi += 1; close(); review(); } }, '+ полутон'),
        h('button.btn.ghost.danger', {
          onclick: () => {
            const gone = notes[i];
            notes.splice(i, 1);
            // Сдвигаем остаток, чтобы на месте удалённой ноты не осталось дыры.
            for (let k = i; k < notes.length; k++) notes[k].start = Math.max(0, Math.round((notes[k].start - gone.dur) * 1000) / 1000);
            close(); review();
          },
        }, 'Удалить')));
    };

    idle();
  }

  // ---------- Разучивание фразы ----------

  function practice(line, tempo) {
    stopAll();
    const mel = melody(line.key).map((n) => ({ midi: n.midi, start: n.start / tempo, dur: n.dur / tempo }));
    const last = mel[mel.length - 1];
    const ex = {
      id: 'phrase', type: 'pattern', title: song.title, cat: 'Фраза', lyric: line.lyrics, syllable: 'ма',
      noteDur: mel.map((n) => n.dur).sort((a, b) => a - b)[Math.floor(mel.length / 2)],
      reps: [{ root: mel[0].midi, notes: mel, len: last.start + last.dur }],
      tol: toleranceFor(state.plan.week), refMode: 'app', headphones: state.settings.headphones,
      range: { lo: state.profile.low, hi: state.profile.high },
      how: ['Послушайте фразу, вдохните на два щелчка и спойте её сами.',
        'Первые разы пойте на слог «ма» или губной трелью — так легче поймать высоту.',
        'Когда попадание станет устойчивым, пойте со словами.'],
      feel: tempo < 1 ? `Темп ${Math.round(tempo * 100)}%. Когда получится — вернитесь к полному.` : 'Берите дыхание перед фразой, а не посередине.',
    };
    clear(root);
    runner = mountRunner(root, ex, {
      keepMic: false, doneLabel: 'К песне',
      onDone: (res) => {
        if (res.m && res.m.notes) {
          song.results.push({ date: new Date().toISOString(), key: line.key, lyrics: line.lyrics, hitRate: res.m.hitRate, avgAbs: res.m.avgAbsCents, bias: res.m.biasCents, mode: 'phrase', tempo });
          if (song.results.length > 400) song.results.splice(0, song.results.length - 400);
          saveNow();
        }
        main();
      },
      onExit: main,
    });
  }

  // ---------- Песня целиком с оценкой ----------

  function perform() {
    stopAll();
    const p = parsed();
    const phrases = [];
    let skipped = 0;
    for (const l of p.lines) {
      if (l.type !== 'line') continue;
      const mel = melody(l.key);
      if (!mel) { skipped++; continue; }
      const last = mel[mel.length - 1];
      phrases.push({
        key: l.key, lyrics: l.lyrics, notes: mel, len: last.start + last.dur,
        chords: chordTimeline(l, mel).map((c) => ({ midis: chordMidis(transposeChord(c.chord, song.transpose, p.german), p.german), start: c.start, dur: c.dur })),
      });
    }
    const all = phrases.flatMap((ph) => ph.notes.map((n) => n.midi));
    const ex = {
      id: 'song-full', type: 'perform', title: song.title, cat: 'Песня целиком', phrases, gap: 1.2,
      lo: Math.min(...all), hi: Math.max(...all),
      tol: toleranceFor(state.plan.week), headphones: state.settings.headphones,
      how: ['Приложение даст первую ноту, затем фразы пойдут подряд. Пойте без инструмента: микрофон должен слышать только голос.',
        'Слова текущей фразы показаны сверху, следующей — под ними.',
        state.settings.headphones ? 'В наушниках звучат аккорды песни.' : 'Чтобы слышать аккорды во время пения, наденьте наушники и включите режим наушников в настройках.'],
      feel: skipped ? `Строк без записанной мелодии: ${skipped} — они пропускаются.` : 'Исполнение записывается, его можно будет прослушать на странице песни.',
    };
    clear(root);
    runner = mountRunner(root, ex, {
      doneLabel: 'Оценить исполнение',
      onStart: () => audio.startRecording(),
      onFinish: () => audio.stopRecording().then((blob) => { if (blob) putTake(song.id, blob); }),
      onDone: (res) => {
        const date = new Date().toISOString();
        for (const ph of (res.m && res.m.phrases) || []) {
          song.results.push({ date, key: ph.key, lyrics: ph.lyrics, hitRate: ph.hitRate, avgAbs: ph.avgAbs, bias: ph.bias, mode: 'full' });
        }
        saveNow();
        rate('с оценкой', res.score);
      },
      onExit: () => { audio.stopRecording(); main(); },
    });
  }

  // ---------- Под свой аккомпанемент ----------

  function prompter() {
    stopAll();
    const p = parsed();
    let recording = false;
    let speed = 0;
    const scroller = h('div.prompter', p.lines.map((l) => {
      if (l.type === 'section') return h('h4.sec', l.text);
      if (l.type === 'break') return h('div.gap');
      if (l.type === 'chords') return h('div.chord-only', l.chords.map((c) => h('span.ch', transposeChord(c.chord, song.transpose, p.german))));
      return h('div.phrase.big', h('span.segs', segNodes(l, song.transpose, p.german)));
    }), h('div.gap.tall'));
    const recBtn = h('button.btn', { onclick: toggleRec }, icon('mic'), ' Записать');
    const speedSeg = h('div.seg', [[0, 'Стоп'], [12, 'Медленно'], [22, 'Средне'], [36, 'Быстро']].map(([v, label]) => {
      const b = h('button', { type: 'button', class: v === speed ? 'on' : '' }, label);
      b.addEventListener('click', () => { speed = v; [...speedSeg.children].forEach((c) => c.classList.toggle('on', c === b)); });
      return b;
    }));
    let acc = 0;
    scrollTimer = setInterval(() => {
      if (!speed) return;
      acc += speed / 20;
      if (acc >= 1) { scroller.scrollTop += Math.floor(acc); acc -= Math.floor(acc); }
    }, 50);

    async function toggleRec() {
      if (recording) return;
      try {
        await audio.startMic();
      } catch (e) { toast(e.message, 'bad'); return; }
      if (audio.startRecording()) {
        recording = true;
        recBtn.classList.add('on');
        recBtn.lastChild.textContent = ' Идёт запись';
      } else toast('Запись на этом устройстве недоступна', 'bad');
    }

    async function done() {
      clearInterval(scrollTimer);
      audio.keepAwake(false);
      if (recording) {
        const blob = await audio.stopRecording();
        if (blob) await putTake(song.id, blob);
      }
      audio.stopMic();
      rate('под аккомпанемент', null);
    }

    audio.keepAwake(true);
    clear(root).append(h('div.runner',
      h('header.run-head',
        h('button.icon-btn', { onclick: () => { audio.stopRecording(); main(); }, 'aria-label': 'Закрыть' }, icon('back')),
        h('div.run-title', h('small', song.artist || 'Под свой аккомпанемент'), h('strong', song.title)),
        h('span.run-step', '')),
      scroller,
      h('div.run-foot.col',
        h('div.field', h('span.muted', 'Прокрутка'), speedSeg),
        h('div.row', recBtn, h('button.btn.primary', { onclick: done }, 'Закончить')))));
  }

  // ---------- Самооценка ----------

  function rate(mode, score) {
    stopAll();
    audio.stopMic();
    let rating = 0;
    const stars = h('div.stars', [1, 2, 3, 4, 5].map((n) => {
      const b = h('button', { type: 'button', 'aria-label': `${n} из 5` }, '★');
      b.addEventListener('click', () => { rating = n; [...stars.children].forEach((c, i) => c.classList.toggle('on', i < n)); });
      return b;
    }));
    const note = h('textarea', { rows: 3, placeholder: 'Что получилось, где было трудно' });
    clear(root).append(h('div.page',
      h('h1', 'Как спели?'),
      score != null ? h('div.card', h('h3', 'Попадание в ноты'), h('div.score', { class: cls(score) }, `${score}%`)) : null,
      h('div.card', h('h3', 'Ваша оценка'), stars, note),
      h('div.foot', h('button.btn.primary.wide', {
        onclick: () => {
          song.takes.push({ date: new Date().toISOString(), mode, rating: rating || null, note: note.value.trim(), score });
          if (song.takes.length > 50) song.takes.shift();
          state.sessions.push({
            id: uid(), date: new Date().toISOString(), week: state.plan.week, kind: 'song', sec: 0, review: '',
            results: [{ id: 'song-full', title: `«${song.title}» целиком (${mode})`, type: 'song', score, m: { selfRating: rating || null, note: note.value.trim() || undefined } }],
          });
          saveNow();
          main();
        },
      }, 'Сохранить'))));
  }

  main();
  return () => {
    stopAll();
    audio.stopRecording();
    audio.stopMic();
    if (teacher) teacher.abort();
    if (takeUrl) URL.revokeObjectURL(takeUrl);
  };
}
