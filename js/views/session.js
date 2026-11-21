// Занятие по плану и отдельное упражнение.

import { state, save, saveNow, uid, dayKey, activeSong, lastResultOf } from '../store.js';
import { h, clear, go, toast, renderText } from '../ui.js';
import { mountRunner, resultShort } from '../runner.js';
import { stopMic } from '../audio.js';
import { LIB, resolve, sessionItems } from '../curriculum.js';
import { hasKey, streamReply, explainError, sessionReviewPrompt } from '../claude.js';

const FEEL = ['Легко', 'Нормально', 'Тяжело'];
const VOICE = ['Свежий', 'Немного устал', 'Сильно устал'];

/** Блок с потоковым разбором учителя. onDone получает готовый текст. */
export function teacherBlock(prompt, onDone) {
  const box = h('div.teacher-box');
  if (!hasKey()) {
    box.append(h('p.muted', 'Чтобы получать разбор учителя, добавьте ключ API в настройках.'),
      h('button.btn.ghost', { onclick: () => go('settings') }, 'В настройки'));
    return { el: box, abort() {} };
  }
  let req = null;
  const run = () => {
    clear(box);
    const out = h('div.stream');
    box.append(h('p.muted.pulse', 'Учитель смотрит результаты…'), out);
    req = streamReply([{ role: 'user', content: prompt }], (text) => {
      if (box.firstChild && box.firstChild.classList.contains('pulse')) box.firstChild.remove();
      clear(out).append(renderText(text));
    });
    req.text.then((text) => {
      clear(box).append(renderText(text));
      if (onDone) onDone(text);
    }).catch((e) => {
      clear(box).append(h('p.error', explainError(e)), h('button.btn.ghost', { onclick: run }, 'Повторить'));
    });
  };
  run();
  return { el: box, abort: () => req && req.abort() };
}

export function sessionView(root) {
  let runner = null;
  let teacher = null;
  const drop = () => { if (runner) { runner.destroy(); runner = null; } };

  // Незавершённое сегодняшнее занятие продолжается с того же места.
  if (!state.draft || state.draft.date !== dayKey()) {
    state.draft = { date: dayKey(), week: state.plan.week, ids: sessionItems(state), results: [], startedAt: Date.now() };
    save();
  }
  const draft = state.draft;

  const exit = () => {
    drop();
    stopMic();
    go('today');
  };

  function next() {
    drop();
    clear(root);
    const i = draft.results.length;
    if (i >= draft.ids.length) { report(); return; }
    const id = draft.ids[i];
    const step = `${i + 1}/${draft.ids.length}`;
    if (id === 'song') { songStep(step); return; }
    const ex = resolve(id, state, draft.week);
    runner = mountRunner(root, ex, {
      step, keepMic: true, prev: lastResultOf,
      onDone: (res) => { draft.results.push(res); saveNow(); next(); },
      onSkip: () => { draft.results.push({ id, title: LIB[id].title, type: LIB[id].type, skipped: true }); saveNow(); next(); },
      onExit: exit,
    });
  }

  function songStep(step) {
    stopMic();
    const song = activeSong();
    const today = dayKey();
    const practiced = song ? song.results.filter((r) => r.date.slice(0, 10) === today) : [];
    const finish = (skipped) => {
      draft.results.push(skipped || !song
        ? { id: 'song', title: LIB.song.title, type: 'song', skipped: true }
        : {
          id: 'song', title: `Песня «${song.title}»`, type: 'song', cat: 'Песня', score: practiced.length ? Math.round(practiced.reduce((a, r) => a + r.hitRate, 0) / practiced.length) : null,
          m: { song: song.title, attempts: practiced.length, phrases: practiced.slice(-8).map((r) => ({ text: r.lyrics, hitRate: r.hitRate, bias: r.bias })) },
        });
      saveNow();
      next();
    };
    root.append(h('div.runner',
      h('header.run-head',
        h('button.icon-btn', { onclick: exit, 'aria-label': 'Закрыть' }, '✕'),
        h('div.run-title', h('small', 'Песня'), h('strong', LIB.song.title)),
        h('span.run-step', step)),
      h('div.run-body',
        h('div.card.how',
          h('h3', song ? `«${song.title}»` : 'Песня не выбрана'),
          h('ol', LIB.song.how.map((t) => h('li', t))),
          h('p.feel', LIB.song.feel)),
        practiced.length
          ? h('div.card', h('h3', 'Сегодня отработано'),
            h('ul.phrase-scores', practiced.slice(-6).map((r) => h('li', h('span', r.lyrics), h('b', { class: r.hitRate >= 75 ? 'ok' : r.hitRate >= 45 ? 'warn' : 'bad' }, `${r.hitRate}%`)))))
          : h('p.hint', 'Откройте песню, поработайте над фразами и вернитесь сюда — занятие продолжится с этого места.')),
      h('div.run-foot',
        song ? h('button.btn.primary.wide', { onclick: () => go('song/' + song.id) }, 'Открыть песню') : null,
        h('button.btn' + (practiced.length ? '.primary' : '.ghost'), { onclick: () => finish(!practiced.length) }, practiced.length ? 'Дальше' : 'Пропустить'))));
  }

  function report() {
    stopMic();
    const rep = { feel: FEEL[1], voice: VOICE[0], strain: false, note: '' };
    const seg = (options, key) => {
      const el = h('div.seg', options.map((o) => {
        const b = h('button', { type: 'button', class: rep[key] === o ? 'on' : '' }, o);
        b.addEventListener('click', () => { rep[key] = o; [...el.children].forEach((c) => c.classList.toggle('on', c === b)); });
        return b;
      }));
      return el;
    };
    const strain = h('input', { type: 'checkbox', id: 'strain' });
    const note = h('textarea', { rows: 3, placeholder: 'Что получалось, что мешало, какие были ощущения' });
    const warn = h('p.error', { hidden: true }, 'Дайте голосу отдохнуть сегодня и завтра. Если першение или хрипота не проходят за несколько дней, обратитесь к фониатру.');
    strain.addEventListener('change', () => { warn.hidden = !strain.checked; });
    root.append(h('div.page',
      h('h1', 'Как прошло занятие'),
      h('div.card', h('h3', 'По ощущениям было'), seg(FEEL, 'feel')),
      h('div.card', h('h3', 'Голос после занятия'), seg(VOICE, 'voice'),
        h('label.check', strain, h('span', 'Были боль, першение или хрипота')), warn),
      h('div.card', h('h3', 'Заметка для учителя'), note),
      h('div.foot', h('button.btn.primary.wide', {
        onclick: () => {
          rep.strain = strain.checked;
          rep.note = note.value.trim();
          finishSession(rep);
        },
      }, 'Сохранить занятие'))));
  }

  function finishSession(rep) {
    const session = {
      id: uid(), date: new Date().toISOString(), week: draft.week, kind: 'session',
      results: draft.results, report: rep, sec: Math.round((Date.now() - draft.startedAt) / 1000), review: '',
    };
    state.sessions.push(session);
    state.draft = null;
    saveNow();
    summary(session);
  }

  function summary(session) {
    clear(root);
    teacher = teacherBlock(sessionReviewPrompt(session), (text) => { session.review = text; saveNow(); });
    root.append(h('div.page',
      h('h1', 'Занятие сохранено'),
      h('div.card',
        h('h3', 'Результаты'),
        h('ul.res-list', session.results.map((r) => h('li',
          h('span', r.title),
          h('span.muted', r.skipped ? 'пропущено' : resultShort(r)),
          r.score != null ? h('b', { class: r.score >= 75 ? 'ok' : r.score >= 45 ? 'warn' : 'bad' }, `${r.score}%`) : null)))),
      h('div.card', h('h3', 'Разбор учителя'), teacher.el),
      h('div.foot', h('button.btn.primary.wide', { onclick: () => go('today') }, 'Готово'))));
    root.scrollTop = 0;
  }

  next();
  return () => { drop(); if (teacher) teacher.abort(); };
}

/** Отдельное упражнение вне занятия. */
export function exerciseView(root, id) {
  if (!LIB[id] || id === 'song') { go('plan'); return null; }
  const ex = resolve(id, state);
  const back = () => { stopMic(); history.length > 1 ? history.back() : go('plan'); };
  const runner = mountRunner(root, ex, {
    doneLabel: 'Сохранить и выйти', prev: lastResultOf,
    onDone: (res) => {
      if (!res.partial || res.score != null) {
        state.sessions.push({ id: uid(), date: new Date().toISOString(), week: state.plan.week, kind: 'free', results: [res], sec: res.sec, review: '' });
        saveNow();
        toast('Результат сохранён');
      }
      back();
    },
    onExit: back,
  });
  return () => runner.destroy();
}
