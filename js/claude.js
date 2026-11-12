// Учитель: запросы к Claude API через официальный SDK (собран в vendor/ для работы без сборки).

import Anthropic, { jsonSchemaOutputFormat } from '../vendor/anthropic-sdk.js';
import { state, sessionsThisWeek } from './store.js';
import { LIB, WEEKS, stageOf, toleranceFor } from './curriculum.js';
import { noteName, guessVoiceType } from './music.js';
import { parseSong, uniquePhrases } from './songparse.js';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'рекомендуется' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', note: 'самая сильная, дороже' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'быстрее и дешевле' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'самая быстрая' },
];

export const hasKey = () => !!state.settings.apiKey.trim();

const exerciseList = Object.entries(LIB)
  .filter(([id]) => id !== 'song')
  .map(([id, e]) => `- ${id}: «${e.title}» (${e.cat}, ≈${e.min} мин)`)
  .join('\n');

const SYSTEM = `Вы — преподаватель вокала в приложении для самостоятельных занятий пением. Ученик занимается дома с айфоном; у него есть гитара и фортепиано. Обращайтесь на «вы», пишите по-русски.

Что вы знаете об ученике
Приложение слушает голос через микрофон, определяет высоту звука и присылает вам измерения. Аудио вы не получаете и голос не слышите. Поэтому судите только о том, что измеряется: точность попадания, смещение вверх или вниз, ровность удержания, охват диапазона, длительность выдоха и звука, а также о том, что ученик сам написал о самочувствии. О тембре, зажимах, положении гортани и дыхании вы можете только предполагать по косвенным признакам — так и говорите, не выдавайте предположения за наблюдения. Если для вывода не хватает данных, скажите, чего не хватает.

Как читать измерения
- «попадание» (hitRate) — доля нот в процентах, где голос оказался в пределах допуска от целевой ноты.
- отклонения даны в центах: 100 центов — полутон. Отрицательное смещение (bias) — ученик занижает, положительное — завышает.
- «разброс» (std) — насколько дрожит высота на тянущейся ноте; до 15–20 центов — ровно.
- допуск строже на поздних неделях плана, поэтому падение процента при переходе на новую неделю ожидаемо.
- попевки дают результат по повторам «от ноты»: если точность падает к верхним повторам, проблема в верхней части диапазона.
- длительность выдоха на «ссс» и самой долгой ноты отражает управление дыханием; 15–20 секунд для начинающего — нормальный результат.
- «partial: true» — упражнение прервано, данных меньше.

Как учить
- Сначала назовите одно-два главных наблюдения, затем дайте конкретное действие: что именно сделать на следующем занятии и на что обратить внимание в ощущениях.
- Опирайтесь на упражнения из библиотеки приложения и называйте их так же, как они названы там.
- Объясняйте причину простыми словами: что происходит с голосом и почему упражнение помогает.
- Хвалите только за то, что видно в данных. Не преувеличивайте успехи и не драматизируйте неудачи.
- Когда уместно, подсказывайте, как использовать инструмент: взять ноту на фортепиано, дать себе аккорд на гитаре перед фразой.
- Не ставьте диагнозов и не определяйте тип голоса окончательно — в приложении он ориентировочный.

Здоровье голоса
Боль, першение, хрипота, потеря голоса — повод прекратить занятие. Если ученик сообщает об этом, первым делом скажите остановиться и отдохнуть, предложите самые щадящие упражнения (трубочка, тихое «м») на следующий раз, а если симптомы держатся дольше нескольких дней — обратиться к фониатру или лору. Не предлагайте петь через дискомфорт, форсировать верхние ноты или громкость.

Формат ответа
Пишите коротко и по делу, как в переписке с учеником: обычно 4–8 предложений или короткий список. Без таблиц и заголовков. Жирным можно выделить одно-два ключевых слова.

Библиотека упражнений приложения (идентификатор: название)
${exerciseList}`;

function client() {
  return new Anthropic({ apiKey: state.settings.apiKey.trim(), dangerouslyAllowBrowser: true });
}

// ---------- Контекст об ученике ----------

function compactResult(r) {
  if (r.skipped) return { ex: r.title || r.id, skipped: true };
  const o = { ex: r.title, type: r.type };
  if (r.score != null) o.score = r.score;
  if (r.partial) o.partial = true;
  if (r.m) o.m = r.m;
  return o;
}

function songSummary(song) {
  const parsed = parseSong(song.text);
  const phrases = uniquePhrases(parsed);
  const withMelody = phrases.filter((p) => song.melodies[p.key]);
  let mel = null;
  if (withMelody.length) {
    const all = withMelody.flatMap((p) => song.melodies[p.key].map((n) => n.midi + song.transpose + 12 * song.octave));
    mel = `${noteName(Math.min(...all))}–${noteName(Math.max(...all))}`;
  }
  const last = {};
  for (const r of song.results) last[r.key] = r;
  return {
    title: song.title, artist: song.artist || undefined,
    transpose: song.transpose, phrases: phrases.length, withMelody: withMelody.length, melodyRange: mel,
    phraseResults: phrases.filter((p) => last[p.key]).map((p) => ({
      text: p.lyrics, hitRate: last[p.key].hitRate, avgAbs: last[p.key].avgAbs, bias: last[p.key].bias, date: last[p.key].date.slice(0, 10),
    })),
    takes: song.takes.slice(-3).map((t) => ({ date: t.date.slice(0, 10), mode: t.mode, selfRating: t.rating, note: t.note || undefined, hitRate: t.score ?? undefined })),
  };
}

/** Текстовая сводка об ученике для запроса. */
export function buildContext(opts = {}) {
  const p = state.profile;
  const week = state.plan.week;
  const w = WEEKS[week - 1];
  const lines = [];
  lines.push('ДАННЫЕ УЧЕНИКА (из приложения)');
  if (p) {
    lines.push(`Диапазон: ${noteName(p.low)}–${noteName(p.high)} (${p.high - p.low} полутонов), ориентировочно ${guessVoiceType(p.low, p.high).name}.`);
    lines.push(`Уровень по диагностике: ${p.level || 'не определён'}${p.matchRate != null ? `, попадание в ноты ${p.matchRate}%` : ''}${p.mpt ? `, самая долгая нота ${p.mpt} с` : ''}.`);
    if (p.goals) lines.push(`Цели ученика: ${p.goals}`);
    if (p.experience) lines.push(`Опыт: ${p.experience}`);
  }
  lines.push(`План: неделя ${week} из 12, этап «${stageOf(week).title}», тема «${w.title}». Цель недели: ${w.goal}`);
  lines.push(`Допуск на этой неделе: ±${toleranceFor(week)} центов. Занятий на этой неделе: ${sessionsThisWeek()}.`);
  lines.push(`Опорный звук: ${state.settings.refMode === 'own' ? 'свой инструмент' : 'играет приложение'}${state.settings.headphones ? ', занимается в наушниках' : ''}.`);
  if (state.plan.override && state.plan.override.week === week && state.plan.override.focus) {
    lines.push(`Ваш прошлый акцент на эту неделю: ${state.plan.override.focus}`);
  }
  const recent = state.sessions.slice(-(opts.sessions ?? 8));
  if (recent.length) {
    lines.push('', 'ПОСЛЕДНИЕ ЗАНЯТИЯ (от старых к новым), JSON:');
    for (const s of recent) {
      lines.push(JSON.stringify({
        date: s.date.slice(0, 10), week: s.week, kind: s.kind === 'session' ? 'занятие по плану' : s.kind === 'song' ? 'песня' : 'отдельное упражнение',
        minutes: Math.round((s.sec || 0) / 60), selfReport: s.report || undefined,
        results: (s.results || []).map(compactResult),
      }));
    }
  } else {
    lines.push('', 'Занятий пока не было.');
  }
  if (state.songs.length) {
    lines.push('', 'ПЕСНИ, JSON:');
    for (const song of state.songs.slice(0, 6)) lines.push(JSON.stringify(songSummary(song)));
  }
  return lines.join('\n');
}

// ---------- Запросы ----------

function baseParams(extra) {
  const model = state.settings.model;
  const params = {
    model,
    system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: buildContext(extra) }],
    output_config: { effort: state.settings.effort },
  };
  // Если модель отклонит запрос, сервер сам повторит его на запасной модели.
  // У Haiku 5.5 серверного запасного варианта нет.
  if (model !== 'claude-haiku-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

/**
 * Потоковый ответ учителя. messages — история в формате API.
 * onText(весьТекстНаДанныйМомент) вызывается по мере поступления.
 * Возвращает { text, abort }: promise с полным текстом и функцию отмены.
 */
export function streamReply(messages, onText) {
  const stream = client().beta.messages.stream({
    ...baseParams(),
    max_tokens: 64000,
    cache_control: { type: 'ephemeral' },
    messages,
  });
  let text = '';
  stream.on('text', (delta) => {
    text += delta;
    if (onText) onText(text);
  });
  const done = stream.finalMessage().then((msg) => {
    if (msg.stop_reason === 'refusal') throw new RefusalError();
    const full = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!full) throw new Error('Учитель прислал пустой ответ. Попробуйте ещё раз.');
    return full;
  });
  return { text: done, abort: () => { try { stream.abort(); } catch { /* уже завершён */ } } };
}

class RefusalError extends Error {
  constructor() {
    super('Модель отказалась отвечать на этот запрос. Переформулируйте вопрос.');
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Итог недели в 2–4 предложениях, с опорой на измерения' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Что получается, 1–3 пункта' },
    focus: { type: 'array', items: { type: 'string' }, description: 'На чём сосредоточиться, 1–3 пункта с конкретным действием' },
    decision: { type: 'string', enum: ['advance', 'repeat', 'ease'], description: 'advance — перейти к следующей неделе плана; repeat — повторить текущую; ease — повторить в облегчённом виде' },
    session: {
      type: 'array',
      items: { type: 'string', enum: Object.keys(LIB).filter((id) => id !== 'song') },
      description: 'Состав ежедневного занятия на следующую неделю: 5–8 идентификаторов упражнений по порядку, от разогрева к заминке',
    },
    message: { type: 'string', description: 'Короткое обращение к ученику, 1–2 предложения' },
  },
  required: ['summary', 'strengths', 'focus', 'decision', 'session', 'message'],
  additionalProperties: false,
};

/** Недельный разбор: структурированный ответ с решением и составом занятия. */
export async function weeklyReview() {
  const week = state.plan.week;
  const next = Math.min(12, week + 1);
  const task = [
    `Проведите недельный разбор. Ученик завершает неделю ${week} плана.`,
    `Состав занятия по умолчанию на неделе ${week}: ${WEEKS[week - 1].session.join(', ')}.`,
    week < 12 ? `Состав по умолчанию на неделе ${next} («${WEEKS[next - 1].title}»): ${WEEKS[next - 1].session.join(', ')}.` : 'Это последняя неделя плана.',
    'Решите, переходить ли дальше. Переходите, если основные упражнения недели даются стабильно (ориентир — попадание от 70% и без жалоб на голос). При жалобах на голос выбирайте ease и щадящий состав.',
    'Составьте занятие на следующую неделю: возьмите за основу состав по умолчанию для той недели, на которой ученик окажется после вашего решения, и замените одно-два упражнения, если данные показывают конкретную слабость. Начинайте с дыхания или разогрева, заканчивайте упражнением cooldown.',
  ].join('\n');
  const msg = await client().beta.messages.parse({
    ...baseParams({ sessions: 12 }),
    max_tokens: 16000,
    messages: [{ role: 'user', content: task }],
    output_config: { effort: state.settings.effort, format: jsonSchemaOutputFormat(REVIEW_SCHEMA) },
  });
  if (msg.stop_reason === 'refusal') throw new RefusalError();
  if (!msg.parsed_output) throw new Error('Не удалось разобрать ответ учителя. Попробуйте ещё раз.');
  return msg.parsed_output;
}

/** Короткая проверка ключа и выбранной модели. */
export async function testConnection() {
  const { text } = streamReply([{ role: 'user', content: 'Проверка связи. Ответьте одним коротким предложением, что связь работает.' }]);
  return text;
}

/** Понятное сообщение об ошибке запроса. */
export function explainError(e) {
  if (e instanceof RefusalError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'Ключ API не принят. Проверьте его в настройках.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'У ключа нет доступа к выбранной модели. Выберите другую модель в настройках.';
  if (e instanceof Anthropic.NotFoundError) return 'Выбранная модель недоступна для этого ключа. Выберите другую модель в настройках.';
  if (e instanceof Anthropic.RateLimitError) return 'Превышен лимит запросов. Подождите минуту и повторите.';
  if (e instanceof Anthropic.BadRequestError) return 'Сервер не принял запрос: ' + e.message;
  if (e instanceof Anthropic.APIUserAbortError) return 'Запрос отменён.';
  if (e instanceof Anthropic.APIConnectionError) return 'Нет связи с сервером. Проверьте интернет.';
  if (e instanceof Anthropic.APIError) return `Ошибка сервера (${e.status ?? '—'}). Попробуйте позже.`;
  return e && e.message ? e.message : 'Неизвестная ошибка.';
}

// ---------- Готовые задания для учителя ----------

export const sessionReviewPrompt = (session) =>
  `Разберите занятие, которое я только что закончил (${session.date.slice(0, 10)}). Оно последнее в списке занятий. ` +
  'Скажите, что получилось, что нет, и что мне сделать иначе на следующем занятии.';

export const songReviewPrompt = (song) =>
  `Разберите мою работу над песней «${song.title}». Данные о ней есть в разделе «ПЕСНИ». ` +
  'Назовите фразы, которые даются хуже всего, предположите причину и предложите упражнения из библиотеки под эти места. ' +
  'Если по диапазону мелодии видно, что тональность неудобна, скажите об этом.';
