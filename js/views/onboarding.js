// Знакомство: цели, диагностика голоса, результат.

import { state, saveNow } from '../store.js';
import { h, clear, go } from '../ui.js';
import { mountRunner } from '../runner.js';
import { stopMic } from '../audio.js';
import { RANGE_EX, PRESET_RANGES, diagnosticSteps, levelOf } from '../curriculum.js';
import { noteFull, rangeLabel, guessVoiceType } from '../music.js';

const GOALS = ['Петь чисто, без фальши', 'Расширить диапазон', 'Петь под гитару или фортепиано', 'Увереннее звучать', 'Дольше петь без усталости'];
const EXPERIENCE = ['Никогда не занимался', 'Пою для себя', 'Занимался с педагогом или в хоре'];

export function onboardingView(root) {
  const data = { goals: new Set(), goalText: '', experience: EXPERIENCE[0], low: null, high: null, matchRate: null, mpt: null };
  let runner = null;
  const redo = !!state.profile;
  if (redo) {
    data.goalText = state.profile.goals || '';
    data.experience = state.profile.experience || EXPERIENCE[0];
  }

  const drop = () => { if (runner) { runner.destroy(); runner = null; } };
  const page = (...nodes) => { drop(); clear(root); root.append(h('div.page.onb', ...nodes)); root.scrollTop = 0; };

  function welcome() {
    page(
      h('div.onb-hero', h('div.logo', '♪'), h('h1', 'Голос'), h('p.lead', 'План занятий вокалом на 12 недель, тренажёр, который слышит вашу высоту звука, и учитель на Claude.')),
      h('div.card',
        h('h3', 'Как это работает'),
        h('ul.plain',
          h('li', 'Микрофон слушает вас, приложение показывает линию голоса рядом с целевой нотой и считает попадание.'),
          h('li', 'Каждый день — занятие на 15–25 минут: дыхание, разогрев, интонация, песня.'),
          h('li', 'Учитель видит ваши результаты в цифрах и подсказывает, что делать дальше. Сам голос он не слышит.'))),
      h('div.card.warn-card',
        h('h3', 'Главное правило'),
        h('p', 'Пение не должно причинять боль. Першение, хрипота, боль в горле — сразу остановитесь и дайте голосу отдохнуть.')),
      h('div.foot', h('button.btn.primary.wide', { onclick: about }, redo ? 'Пройти диагностику заново' : 'Начать')),
      redo ? h('div.foot', h('button.btn.ghost.wide', { onclick: () => go('settings') }, 'Отмена')) : null);
  }

  function about() {
    const chips = h('div.chips.pick', GOALS.map((g) => {
      const b = h('button.chip', { type: 'button', class: data.goals.has(g) ? 'on' : '' }, g);
      b.addEventListener('click', () => {
        if (data.goals.has(g)) data.goals.delete(g); else data.goals.add(g);
        b.classList.toggle('on');
      });
      return b;
    }));
    const text = h('textarea', { rows: 2, placeholder: 'Своими словами: что хочется петь и зачем', value: data.goalText });
    text.addEventListener('input', () => { data.goalText = text.value; });
    const exp = h('div.seg', EXPERIENCE.map((e) => {
      const b = h('button', { type: 'button', class: data.experience === e ? 'on' : '' }, e);
      b.addEventListener('click', () => {
        data.experience = e;
        [...exp.children].forEach((c) => c.classList.toggle('on', c === b));
      });
      return b;
    }));
    page(
      h('h1', 'О вас'),
      h('div.card', h('h3', 'Чего хотите добиться'), chips, text),
      h('div.card', h('h3', 'Опыт'), exp),
      h('div.foot', h('button.btn.primary.wide', { onclick: micIntro }, 'Дальше')));
  }

  function micIntro() {
    page(
      h('h1', 'Диагностика голоса'),
      h('p.lead', 'Три коротких шага, около пяти минут. По ним приложение подберёт ноты упражнений под ваш голос.'),
      h('div.card',
        h('ol.steps',
          h('li', h('strong', 'Диапазон'), ' — самая низкая и самая высокая удобные ноты.'),
          h('li', h('strong', 'Попадание'), ' — пять нот, которые нужно повторить.'),
          h('li', h('strong', 'Дыхание'), ' — как долго вы тянете один звук.')),
        h('p.muted', 'Найдите тихое место, держите телефон в 30–40 см от лица. Приложение попросит доступ к микрофону. Звук никуда не отправляется и не сохраняется.')),
      h('div.foot', h('button.btn.primary.wide', { onclick: stepRange }, 'Начать диагностику')),
      h('div.foot', h('button.btn.ghost.wide', { onclick: presets }, 'Пропустить и выбрать диапазон вручную')));
  }

  function presets() {
    page(
      h('h1', 'Примерный диапазон'),
      h('p.lead', 'Выберите ближайший вариант. Диагностику можно пройти позже в настройках.'),
      h('div.list', PRESET_RANGES.map((p) => h('button.row-btn', {
        onclick: () => { data.low = p.low; data.high = p.high; finish(); },
      }, h('strong', p.label), h('span.muted', rangeLabel(p.low, p.high))))),
      h('div.foot', h('button.btn.ghost.wide', { onclick: micIntro }, 'Назад')));
  }

  function run(ex, step, onDone) {
    drop();
    clear(root);
    runner = mountRunner(root, ex, { step, keepMic: true, onDone, onExit: micIntro });
  }

  function stepRange() {
    run(RANGE_EX, '1/3', (res) => {
      const { low, high } = res.m;
      if (low == null || high == null || high - low < 5) {
        page(
          h('h1', 'Не получилось определить диапазон'),
          h('p.lead', low != null && high != null
            ? `Получилось ${rangeLabel(low, high)} — это слишком узко. Попробуйте ещё раз: сначала уверенно вниз, потом вверх.`
            : 'Приложение не расслышало устойчивые ноты. Пойте чуть громче и ближе к телефону.'),
          h('div.foot', h('button.btn.primary.wide', { onclick: stepRange }, 'Повторить')),
          h('div.foot', h('button.btn.ghost.wide', { onclick: presets }, 'Выбрать вручную')));
        return;
      }
      data.low = low;
      data.high = high;
      stepMatch();
    });
  }

  function stepMatch() {
    const { match } = diagnosticSteps(state, data.low, data.high);
    run(match, '2/3', (res) => {
      data.matchRate = res.m.hitRate ?? null;
      stepMpt();
    });
  }

  function stepMpt() {
    const { mpt } = diagnosticSteps(state, data.low, data.high);
    run(mpt, '3/3', (res) => {
      data.mpt = res.m.bestHeldSec || null;
      finish();
    });
  }

  function finish() {
    drop();
    stopMic();
    const goals = [...data.goals].join('; ') + (data.goalText.trim() ? (data.goals.size ? '; ' : '') + data.goalText.trim() : '');
    const vt = guessVoiceType(data.low, data.high);
    state.profile = {
      goals, experience: data.experience,
      low: data.low, high: data.high, voiceType: vt.id,
      level: levelOf(data.matchRate), matchRate: data.matchRate, mpt: data.mpt,
      diagnosedAt: new Date().toISOString(),
    };
    if (!state.plan.weekStartedAt) state.plan.weekStartedAt = new Date().toISOString();
    saveNow();
    page(
      h('h1', 'Ваш голос'),
      h('div.card',
        h('dl',
          h('dt', 'Рабочий диапазон'), h('dd', rangeLabel(data.low, data.high)),
          h('dt', 'Нижняя нота'), h('dd', noteFull(data.low)),
          h('dt', 'Верхняя нота'), h('dd', noteFull(data.high)),
          h('dt', 'Тип голоса'), h('dd', `${vt.name} (ориентировочно)`),
          data.matchRate != null ? [h('dt', 'Попадание в ноты'), h('dd', `${data.matchRate}% — уровень ${levelOf(data.matchRate)}`)] : null,
          data.mpt ? [h('dt', 'Самая долгая нота'), h('dd', `${data.mpt} с`)] : null),
        h('p.muted', 'Тип голоса определён только по высоте и может уточниться. Диапазон обычно расширяется за первые недели занятий — диагностику можно повторить в настройках.')),
      h('div.card',
        h('h3', 'Что дальше'),
        h('p', 'План рассчитан на 12 недель. Ноты во всех упражнениях подобраны под ваш диапазон. Чтобы подключить учителя, добавьте ключ API в настройках.')),
      h('div.foot', h('button.btn.primary.wide', { onclick: () => go('today') }, 'К занятиям')));
  }

  welcome();
  return drop;
}
