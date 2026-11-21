// План на 12 недель, библиотека упражнений и недельный разбор.

import { state, saveNow, sessionsThisWeek } from '../store.js';
import { h, clear, go, sheet, toast, confirmSheet } from '../ui.js';
import { LIB, WEEKS, STAGES, sessionItems, sessionMinutes, exerciseMinutes } from '../curriculum.js';
import { hasKey, weeklyReview, explainError } from '../claude.js';
import { WEEK_TARGET } from './today.js';

const DECISION = { advance: 'Перейти к следующей неделе', repeat: 'Повторить эту неделю', ease: 'Повторить в облегчённом виде' };

export function exerciseSheet(id) {
  const e = LIB[id];
  sheet(e.title, (close) => h('div',
    h('p.muted', `${e.cat} · ≈ ${exerciseMinutes(id, state)} мин`),
    h('ol', e.how.map((t) => h('li', t))),
    e.feel ? h('p.feel', e.feel) : null,
    id !== 'song'
      ? h('button.btn.primary.wide', { onclick: () => { close(); go('exercise/' + id); } }, 'Выполнить')
      : h('button.btn.primary.wide', { onclick: () => { close(); go('songs'); } }, 'К песням')));
}

function setWeek(n) {
  state.plan.week = n;
  state.plan.weekStartedAt = new Date().toISOString();
  if (state.plan.override && state.plan.override.week !== n) state.plan.override = null;
  state.draft = null;
  saveNow();
}

export function planView(root) {
  const render = () => {
    clear(root);
    const week = state.plan.week;
    const done = sessionsThisWeek();
    const ids = sessionItems(state);

    const reviewCard = h('div.card',
      h('div.card-head', h('h3', 'Недельный разбор'), h('span.muted', `${done} из ${WEEK_TARGET} занятий`)),
      h('p.muted', hasKey()
        ? 'Учитель посмотрит результаты недели, решит, переходить ли дальше, и соберёт занятие под ваши слабые места.'
        : 'Без ключа API переход между неделями — вручную. Ориентир: пять занятий и попадание от 70%.'),
      hasKey()
        ? h('button.btn.primary', { disabled: done < 1, onclick: runReview }, 'Запросить разбор')
        : (week < 12 ? h('button.btn', { onclick: () => advance(week + 1) }, `Перейти к неделе ${week + 1}`) : null),
      hasKey() && done < 1 ? h('p.hint', 'Нужно хотя бы одно занятие на этой неделе.') : null);

    const last = state.weekly[state.weekly.length - 1];

    root.append(h('div.page',
      h('header.top', h('div', h('small.muted', 'План развития'), h('h1', '12 недель'))),
      h('div.card.hero',
        h('small', `Сейчас: неделя ${week}`),
        h('h2', WEEKS[week - 1].title),
        h('p', WEEKS[week - 1].goal),
        h('div.card-head', h('h3', 'Занятие'), h('span.muted', `≈ ${sessionMinutes(state, ids)} мин`)),
        h('ul.ex-list.tap', ids.map((id) => h('li', { onclick: () => exerciseSheet(id) },
          h('span.ex-title', LIB[id].title), h('span.muted', LIB[id].cat)))),
        state.plan.override && state.plan.override.week === week
          ? h('p.hint', 'Состав занятия подобран учителем. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); state.plan.override = null; saveNow(); render(); } }, 'Вернуть стандартный'))
          : null),
      reviewCard,
      last ? h('div.card',
        h('div.card-head', h('h3', 'Последний разбор'), h('span.muted', `неделя ${last.week}`)),
        reviewBody(last.data)) : null,
      STAGES.map((st) => h('section.stage',
        h('h3.stage-title', `Этап ${st.n}. ${st.title}`),
        h('div.list', st.weeks.map((n) => h('button.row-btn', {
          class: n === week ? 'cur' : n < week ? 'past' : '',
          onclick: () => weekSheet(n),
        }, h('span.num', n), h('span.grow', h('strong', WEEKS[n - 1].title), h('span.muted', WEEKS[n - 1].goal)), n < week ? h('span.tick', '✓') : null))))),
      h('section.stage',
        h('h3.stage-title', 'Все упражнения'),
        h('div.list', Object.keys(LIB).filter((id) => id !== 'song').map((id) => h('button.row-btn', { onclick: () => exerciseSheet(id) },
          h('span.grow', h('strong', LIB[id].title), h('span.muted', LIB[id].cat))))))));
  };

  function reviewBody(d) {
    return h('div',
      h('p', d.summary),
      d.strengths.length ? [h('h4', 'Получается'), h('ul', d.strengths.map((s) => h('li', s)))] : null,
      d.focus.length ? [h('h4', 'На чём сосредоточиться'), h('ul', d.focus.map((s) => h('li', s)))] : null,
      h('p.muted', `Решение: ${DECISION[d.decision].toLowerCase()}.`));
  }

  function weekSheet(n) {
    const w = WEEKS[n - 1];
    sheet(`Неделя ${n}. ${w.title}`, (close) => h('div',
      h('p', w.goal),
      h('ul.ex-list.tap', w.session.map((id) => h('li', { onclick: () => { close(); exerciseSheet(id); } },
        h('span.ex-title', LIB[id].title), h('span.muted', LIB[id].cat)))),
      n !== state.plan.week
        ? h('button.btn.wide', {
          onclick: async () => {
            close();
            if (await confirmSheet(`Перейти к неделе ${n}?`, 'Текущая неделя начнётся заново с этого места плана. Журнал занятий сохранится.', 'Перейти')) advance(n);
          },
        }, 'Перейти к этой неделе')
        : h('p.hint', 'Это текущая неделя.')));
  }

  function advance(n) {
    setWeek(n);
    toast(`Неделя ${n}: ${WEEKS[n - 1].title}`);
    render();
  }

  async function runReview() {
    const box = h('div', h('p.muted.pulse', 'Учитель изучает результаты недели…'));
    const close = sheet('Недельный разбор', box);
    try {
      const d = await weeklyReview();
      // Заметки — память учителя об ученике; они сохраняются независимо от решения по плану.
      if (d.notes && d.notes.trim()) { state.teacherNotes = d.notes.trim().slice(0, 2000); saveNow(); }
      const week = state.plan.week;
      const target = d.decision === 'advance' ? Math.min(12, week + 1) : week;
      clear(box).append(
        h('p.lead', d.message),
        reviewBody(d),
        h('h4', `Занятие на неделю ${target}`),
        h('ol', d.session.filter((id) => LIB[id]).map((id) => h('li', LIB[id].title))),
        h('div.row',
          h('button.btn.ghost', { onclick: close }, 'Не применять'),
          h('button.btn.primary', {
            onclick: () => {
              state.weekly.push({ date: new Date().toISOString(), week, data: d });
              if (target !== week) setWeek(target);
              state.plan.override = { week: target, session: d.session.filter((id) => LIB[id]), focus: d.focus.join(' ') };
              state.draft = null;
              saveNow();
              close();
              toast(DECISION[d.decision]);
              render();
            },
          }, 'Применить')));
    } catch (e) {
      clear(box).append(h('p.error', explainError(e)));
    }
  }

  render();
}
