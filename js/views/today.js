// Главный экран: занятие на сегодня.

import { state, streak, sessionsThisWeek, doneToday, dayKey, saveFailed } from '../store.js';
import { h, go, icon, fmtDate, plural, renderText } from '../ui.js';
import { LIB, WEEKS, stageOf, sessionItems, sessionMinutes } from '../curriculum.js';
import { rangeLabel } from '../music.js';
import { hasKey } from '../claude.js';

export const WEEK_TARGET = 5;

export function todayView(root) {
  const week = state.plan.week;
  const w = WEEKS[week - 1];
  const ids = sessionItems(state);
  const done = doneToday();
  const draft = state.draft && state.draft.date === dayKey() ? state.draft : null;
  const weekDone = sessionsThisWeek();
  const days = streak();
  const lastReviewed = [...state.sessions].reverse().find((s) => s.review);
  const ov = state.plan.override && state.plan.override.week === week ? state.plan.override : null;

  const startLabel = draft ? `Продолжить (${draft.results.length} из ${draft.ids.length})` : done ? 'Позаниматься ещё раз' : 'Начать занятие';

  root.append(h('div.page',
    h('header.top',
      h('div', h('small.muted', fmtDate(new Date()) + (days ? ` · ${days} ${plural(days, 'день', 'дня', 'дней')} подряд` : '')), h('h1', 'Сегодня')),
      h('button.icon-btn', { onclick: () => go('settings'), 'aria-label': 'Настройки' }, icon('gear'))),

    saveFailed() ? h('p.error', 'Не удаётся сохранить данные на устройстве. Проверьте свободное место и сделайте резервную копию в настройках.') : null,

    h('div.card.hero',
      h('small', `Неделя ${week} из 12 · ${stageOf(week).title}`),
      h('h2', w.title),
      h('p', w.goal),
      h('div.meter', h('i', { style: { width: Math.min(100, (weekDone / WEEK_TARGET) * 100) + '%' } })),
      h('small.muted', `Занятий на этой неделе: ${weekDone} из ${WEEK_TARGET}`)),

    weekDone >= WEEK_TARGET
      ? h('div.card.note-card',
        h('h3', 'Неделя пройдена'),
        h('p', hasKey() ? 'Попросите учителя подвести итог и решить, переходить ли дальше.' : 'Можно переходить к следующей неделе плана.'),
        h('button.btn', { onclick: () => go('plan') }, 'К плану'))
      : null,

    ov && ov.focus
      ? h('div.card.note-card', h('h3', 'Акцент от учителя'), h('p', ov.focus))
      : null,

    h('div.card',
      h('div.card-head', h('h3', done ? 'Занятие выполнено' : 'Занятие'), h('span.muted', `≈ ${sessionMinutes(ids)} мин`)),
      h('ol.ex-list', ids.map((id, i) => {
        const res = draft && draft.results[i];
        return h('li', { class: res ? 'done' : '' },
          h('span.ex-title', LIB[id].title),
          h('span.muted', LIB[id].cat));
      })),
      h('button.btn.primary.wide', { onclick: () => go('session') }, startLabel)),

    !state.songs.length
      ? h('div.card', h('h3', 'Добавьте песню'), h('p.muted', 'С песней занятие получает блок «Работа над песней»: фразы разучиваются с оценкой попадания.'),
        h('button.btn', { onclick: () => go('songs') }, 'К песням'))
      : null,

    lastReviewed
      ? h('div.card',
        h('div.card-head', h('h3', 'Учитель о прошлом занятии'), h('span.muted', fmtDate(lastReviewed.date))),
        h('div.clamp', renderText(lastReviewed.review)),
        h('button.btn.ghost', { onclick: () => go('progress') }, 'Весь журнал'))
      : (!hasKey()
        ? h('div.card', h('h3', 'Подключите учителя'), h('p.muted', 'С ключом API Claude разбирает каждое занятие и корректирует план.'),
          h('button.btn', { onclick: () => go('settings') }, 'В настройки'))
        : null),

    h('details.card',
      h('summary', 'Памятка о голосе'),
      h('ul.plain',
        h('li', 'Перед пением выпейте воды комнатной температуры.'),
        h('li', 'Начинайте с разогрева, даже если мало времени.'),
        h('li', 'Громкость — средняя. Верхние ноты не кричите.'),
        h('li', 'Боль, першение, хрипота — занятие окончено. Если не проходит за несколько дней, покажитесь фониатру.'))),

    state.profile ? h('p.footnote', `Диапазон: ${rangeLabel(state.profile.low, state.profile.high)}`) : null));
}
