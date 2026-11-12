// Чат с учителем.

import { state, saveNow } from '../store.js';
import { h, clear, go, renderText, confirmSheet } from '../ui.js';
import { hasKey, streamReply, explainError } from '../claude.js';

const QUICK = [
  'Разберите мою последнюю неделю: что улучшилось, а что нет?',
  'Что мне сейчас важнее всего исправить?',
  'Я занижаю ноты на спуске. Что с этим делать?',
  'Как брать верхние ноты без зажима?',
  'Как лучше использовать гитару и фортепиано на занятиях?',
];

const MAX_HISTORY = 24;

export function teacherView(root) {
  let req = null;
  let busy = false;
  const log = h('div.chat-log');
  const input = h('textarea', { rows: 1, placeholder: 'Вопрос учителю', 'aria-label': 'Вопрос учителю' });
  const send = h('button.btn.primary', { 'aria-label': 'Отправить' }, '↑');

  const scrollDown = () => { root.scrollTop = root.scrollHeight; window.scrollTo(0, document.body.scrollHeight); };

  const bubble = (m) => h('div.msg.' + m.role, m.role === 'assistant' ? renderText(m.content) : h('p', m.content));

  function renderLog() {
    clear(log);
    if (!state.chat.length) {
      log.append(h('div.card.empty',
        h('h3', 'Спросите учителя'),
        h('p.muted', 'Учитель видит ваш диапазон, план и результаты последних занятий в цифрах. Сам голос он не слышит — о тембре и зажимах расскажите словами.'),
        h('div.quick', QUICK.map((q) => h('button.chip', { onclick: () => ask(q) }, q)))));
    } else {
      for (const m of state.chat) log.append(bubble(m));
    }
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    input.style.height = '';
    if (!state.chat.length) clear(log);
    state.chat.push({ role: 'user', content: text, ts: Date.now() });
    saveNow();
    log.append(bubble({ role: 'user', content: text }));
    const live = h('div.msg.assistant', h('p.muted.pulse', 'Учитель думает…'));
    log.append(live);
    scrollDown();
    const history = state.chat.slice(-MAX_HISTORY);
    // История должна начинаться с реплики ученика.
    while (history.length && history[0].role !== 'user') history.shift();
    req = streamReply(history.map((m) => ({ role: m.role, content: m.content })), (t) => {
      clear(live).append(renderText(t));
    });
    try {
      const full = await req.text;
      state.chat.push({ role: 'assistant', content: full, ts: Date.now() });
      if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
      saveNow();
      clear(live).append(renderText(full));
    } catch (e) {
      // Вопрос без ответа убираем из истории, чтобы реплики чередовались.
      state.chat.pop();
      saveNow();
      clear(live).append(h('p.error', explainError(e)), h('button.btn.ghost.sm', { onclick: () => { live.previousSibling && live.previousSibling.remove(); live.remove(); ask(text); } }, 'Повторить'));
    }
    busy = false;
    send.disabled = false;
    req = null;
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  });
  send.addEventListener('click', () => ask(input.value));

  const page = h('div.page.chat',
    h('header.top', h('div', h('small.muted', 'Claude'), h('h1', 'Учитель')),
      state.chat.length ? h('button.btn.ghost.sm', {
        onclick: async () => {
          if (await confirmSheet('Очистить переписку?', 'Сообщения будут удалены. Журнал занятий останется.', 'Очистить', true)) {
            state.chat = [];
            saveNow();
            renderLog();
          }
        },
      }, 'Очистить') : null));

  if (!hasKey()) {
    page.append(h('div.card.empty',
      h('h3', 'Учитель не подключён'),
      h('p.muted', 'Добавьте ключ API Anthropic в настройках. Ключ хранится только на этом устройстве, запросы идут напрямую в API.'),
      h('button.btn.primary', { onclick: () => go('settings') }, 'В настройки')));
    root.append(page);
    return null;
  }

  renderLog();
  page.append(log, h('div.composer', input, send));
  root.append(page);
  requestAnimationFrame(scrollDown);
  return () => { if (req) req.abort(); };
}
