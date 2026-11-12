// Настройки: учитель, звук, диапазон, резервная копия.

import { state, saveNow, exportData, importData, resetAll } from '../store.js';
import { h, clear, go, toast, confirmSheet, icon } from '../ui.js';
import { MODELS, hasKey, testConnection, explainError } from '../claude.js';
import { rangeLabel, guessVoiceType } from '../music.js';

const EFFORT = [['low', 'Быстрее'], ['medium', 'Обычно'], ['high', 'Вдумчивее']];

export function settingsView(root) {
  const render = () => {
    clear(root);
    const st = state.settings;
    const p = state.profile;

    const key = h('input', { type: 'password', placeholder: 'sk-ant-…', value: st.apiKey, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Ключ API' });
    key.addEventListener('change', () => { st.apiKey = key.value.trim(); saveNow(); });
    const showKey = h('button.btn.ghost.sm', { type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; showKey.textContent = key.type === 'password' ? 'Показать' : 'Скрыть'; } }, 'Показать');
    const model = h('select', { 'aria-label': 'Модель' }, MODELS.map((m) => h('option', { value: m.id, selected: m.id === st.model }, `${m.name} — ${m.note}`)));
    model.addEventListener('change', () => { st.model = model.value; saveNow(); });
    const status = h('p.muted');
    const test = h('button.btn', {
      onclick: async () => {
        st.apiKey = key.value.trim();
        saveNow();
        if (!hasKey()) { status.className = 'error'; status.textContent = 'Сначала введите ключ.'; return; }
        test.disabled = true;
        status.className = 'muted pulse';
        status.textContent = 'Проверяю связь…';
        try {
          await testConnection();
          status.className = 'ok-text';
          status.textContent = 'Связь работает, учитель отвечает.';
        } catch (e) {
          status.className = 'error';
          status.textContent = explainError(e);
        }
        test.disabled = false;
      },
    }, 'Проверить');

    const seg = (options, current, onPick) => {
      const el = h('div.seg', options.map(([v, label]) => {
        const b = h('button', { type: 'button', class: v === current ? 'on' : '' }, label);
        b.addEventListener('click', () => { onPick(v); [...el.children].forEach((c) => c.classList.toggle('on', c === b)); });
        return b;
      }));
      return el;
    };

    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        importData(await f.text());
        toast('Данные восстановлены');
        render();
      } catch (e) {
        toast(e.message || 'Не удалось прочитать файл', 'bad');
      }
    });

    root.append(h('div.page',
      h('header.top',
        h('button.icon-btn', { onclick: () => go('today'), 'aria-label': 'Назад' }, icon('back')),
        h('div.grow', h('small.muted', 'Приложение'), h('h1', 'Настройки'))),

      h('div.card',
        h('h3', 'Учитель Claude'),
        h('label.field', h('span', 'Ключ API Anthropic'), h('div.row.tight', key, showKey)),
        h('p.muted', 'Ключ создаётся на platform.claude.com и хранится только на этом устройстве. Запросы идут из приложения напрямую в API; расход оплачивается с вашего аккаунта Anthropic.'),
        h('label.field', h('span', 'Модель'), model),
        h('div.field', h('span', 'Глубина ответа'), seg(EFFORT, st.effort, (v) => { st.effort = v; saveNow(); })),
        h('div.row', test), status,
        h('p.muted', 'Учителю отправляются: диапазон, цели, результаты занятий в цифрах, ваши заметки и тексты песен при их разборе. Звук не отправляется.')),

      h('div.card',
        h('h3', 'Опорный звук'),
        seg([['app', 'Приложение'], ['own', 'Свой инструмент']], st.refMode, (v) => { st.refMode = v; saveNow(); }),
        h('p.muted', '«Приложение» само проигрывает ноту или попевку перед тем, как вы поёте. «Свой инструмент» — упражнение называет ноту, вы берёте её на фортепиано или гитаре и поёте после того, как звук затихнет.'),
        h('label.check',
          h('input', { type: 'checkbox', checked: st.headphones, onchange: (e) => { st.headphones = e.target.checked; saveNow(); } }),
          h('span', 'Я занимаюсь в наушниках')),
        h('p.muted', 'В наушниках приложение подыгрывает во время пения: попевку в упражнениях и аккорды в песне. Без наушников оно молчит, пока вы поёте, чтобы микрофон слышал только голос.')),

      h('div.card',
        h('h3', 'Голос'),
        p ? h('dl',
          h('dt', 'Диапазон'), h('dd', rangeLabel(p.low, p.high)),
          h('dt', 'Тип голоса'), h('dd', `${guessVoiceType(p.low, p.high).name} (ориентировочно)`),
          h('dt', 'Уровень'), h('dd', p.level || '—')) : null,
        h('button.btn', { onclick: () => go('onboarding') }, 'Пройти диагностику заново'),
        h('p.muted', 'Повторяйте диагностику раз в 3–4 недели: диапазон растёт, и упражнения подстроятся под него.')),

      h('div.card',
        h('h3', 'Данные'),
        h('p.muted', 'Всё хранится на этом устройстве. Если удалить приложение с домашнего экрана или очистить данные Safari, история пропадёт — сохраняйте резервную копию.'),
        h('div.row',
          h('button.btn', {
            onclick: async () => {
              const blob = new File([exportData()], `golos-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
              try {
                if (navigator.canShare && navigator.canShare({ files: [blob] })) { await navigator.share({ files: [blob] }); return; }
              } catch (e) { if (e && e.name === 'AbortError') return; }
              const a = h('a', { href: URL.createObjectURL(blob), download: blob.name });
              document.body.append(a);
              a.click();
              a.remove();
            },
          }, 'Сохранить копию'),
          h('button.btn', { onclick: () => file.click() }, 'Восстановить'), file),
        h('p.muted', 'Ключ API в копию не попадает. Записи исполнения песен в копию не входят.'),
        h('button.btn.ghost.danger', {
          onclick: async () => {
            if (await confirmSheet('Удалить все данные?', 'План, журнал, песни, переписка с учителем и ключ API будут стёрты с этого устройства.', 'Удалить всё', true)) {
              resetAll();
              go('onboarding');
            }
          },
        }, 'Удалить все данные')),

      h('div.card',
        h('h3', 'Установка на айфон'),
        h('ol',
          h('li', 'Откройте этот сайт в Safari.'),
          h('li', 'Нажмите «Поделиться» и выберите «На экран „Домой“».'),
          h('li', 'Запускайте приложение с иконки: так оно работает на весь экран и без сети (кроме учителя).'))),

      h('p.footnote', 'Приложение не заменяет врача и педагога. Оно измеряет высоту звука; тембр и технику оно не слышит.')));
  };
  render();
}
