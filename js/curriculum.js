// Библиотека упражнений, 12-недельный план и подгонка под диапазон ученика.

import { noteFull, noteName, INTERVALS } from './music.js';

const FIVE = [0, 2, 4, 5, 7, 5, 4, 2, 0];
const ARP8 = [0, 4, 7, 12, 7, 4, 0];

/**
 * Типы упражнений:
 *  breath  — дыхание по таймеру, без микрофона
 *  exhale  — замер длительности выдоха
 *  glide   — свободное скольжение, замер охвата
 *  sustain — удержание ноты
 *  pattern — попевка по нотам с повтором от разных ступеней
 *  match   — попадание в ноту или интервал
 *  echo    — «сыграл на инструменте — спел»
 *  song    — работа над песней
 */
export const LIB = {
  'breath-446': {
    title: 'Дыхание животом 4–4–6', cat: 'Дыхание', min: 2, type: 'breath', cycles: 5,
    phases: [{ label: 'Вдох носом', sec: 4 }, { label: 'Задержка', sec: 4 }, { label: 'Выдох ртом', sec: 6 }],
    how: ['Встаньте ровно, одну ладонь положите на живот, другую на рёбра сбоку.',
      'На вдохе живот и нижние рёбра расходятся в стороны, плечи остаются на месте.',
      'На выдохе живот плавно возвращается, рёбра не спешат опадать.'],
    feel: 'Плечи и грудь неподвижны. Если кружится голова — сделайте паузу и дышите обычно.',
  },
  'exhale-sss': {
    title: 'Долгий выдох на «ссс»', cat: 'Дыхание', min: 2, type: 'exhale', reps: 3, sound: 'ссс',
    how: ['Сделайте спокойный вдох животом.',
      'Выдыхайте на ровное «ссс» как можно дольше, не выдавливая остатки воздуха.',
      'Звук должен быть одинаковым по силе от начала до конца.'],
    feel: 'Работает живот, горло свободно. Растёт длительность — растёт и опора.',
  },
  'lip-trill-glide': {
    title: 'Губная трель: сирена', cat: 'Разогрев', min: 2, type: 'glide', reps: 4, sound: 'губная трель «бррр»', zone: [0.05, 0.9],
    how: ['Расслабьте губы и выдувайте воздух, чтобы они вибрировали, как у лошадки. Кончиками пальцев можно приподнять щёки.',
      'Добавьте голос и плавно скользите от низкой ноты вверх и обратно.',
      'Громкость небольшая, поток воздуха ровный.'],
    feel: 'Вибрация в губах и вокруг носа, в горле — ничего. Если трель срывается, не хватает ровного выдоха.',
  },
  'hum-glide': {
    title: 'Сирена на «м»', cat: 'Разогрев', min: 2, type: 'glide', reps: 4, sound: '«м» с закрытым ртом', zone: [0.05, 0.85],
    how: ['Сомкните губы, зубы разомкнуты, язык лежит свободно.',
      'Гудите на «м» и скользите снизу вверх и обратно, как сирена.',
      'Не прибавляйте громкость на верхних нотах.'],
    feel: 'Щекотка на губах и в переносице. Переход между нижним и верхним звучанием — плавный, без щелчка.',
  },
  'straw-glide': {
    title: 'Пение через трубочку', cat: 'Разогрев', min: 2, type: 'glide', reps: 4, sound: '«у» в коктейльную трубочку', zone: [0.05, 0.9],
    how: ['Возьмите тонкую трубочку для напитков, обхватите её губами. Нос не должен пропускать воздух.',
      'Гудите в трубочку и скользите по всему диапазону вверх и вниз.',
      'Можно опустить конец трубочки в стакан с водой на 2–3 см: пузыри должны идти ровно.'],
    feel: 'Голос включается легко, без толчка. Это самое бережное упражнение — годится и для уставшего голоса.',
  },
  cooldown: {
    title: 'Заминка: скольжение вниз', cat: 'Заминка', min: 1, type: 'glide', reps: 3, sound: 'тихое «м»', zone: [0.0, 0.6], down: true,
    how: ['Тихо гудите на «м» и скользите сверху вниз, как вздох облегчения.',
      'В конце дайте голосу опуститься в самый низ и растаять.'],
    feel: 'Голос возвращается к разговорной высоте. После заминки помолчите пару минут и попейте воды.',
  },
  'match-notes': {
    title: 'Попадание в ноту', cat: 'Интонация', min: 3, type: 'match', count: 6, syllable: 'а',
    how: ['Послушайте ноту до конца и представьте её «внутри головы».',
      'Спойте её на «а» и удерживайте, пока приложение не засчитает.',
      'Если линия голоса ниже цели — тянитесь вверх плавно, без рывка.'],
    feel: 'Сначала услышать, потом петь. Не подбирайте ноту голосом на ощупь.',
  },
  echo: {
    title: 'Сыграл — спел', cat: 'Слух', min: 3, type: 'echo', rounds: 5,
    how: ['Сыграйте одну любую ноту на фортепиано или гитаре.',
      'Дайте ей отзвучать или заглушите, затем спойте эту ноту на «а».',
      'Приложение покажет, насколько вы разошлись с инструментом. Октава значения не имеет.'],
    feel: 'Упражнение учит снимать ноту с инструмента — так вы будете находить первый звук песни.',
  },
  sustain: {
    title: 'Ровный звук', cat: 'Опора', min: 3, type: 'sustain', count: 3, holdSec: 5, syllable: 'а', zone: [0.25, 0.6],
    how: ['Вдох животом, начинайте звук мягко, без удара.',
      'Тяните «а» ровно: линия голоса должна лежать на цели без волн.',
      'Заканчивайте звук раньше, чем кончится воздух.'],
    feel: 'Живот медленно подбирается, грудь не падает. Дрожащая линия — признак того, что выдох неровный.',
  },
  'sustain-vowels': {
    title: 'Гласные на одной ноте', cat: 'Резонанс', min: 3, type: 'sustain', count: 3, holdSec: 8, syllable: 'и–э–а–о–у', zone: [0.3, 0.65],
    how: ['На одной ноте плавно перетекайте по гласным: и–э–а–о–у.',
      'Меняется только форма рта и языка, высота и громкость остаются прежними.',
      'Челюсть свободна, кончик языка у нижних зубов.'],
    feel: 'Звук остаётся «в одном месте» — впереди, у верхних зубов. Если на «а» нота проседает, вы её «роняете» назад.',
  },
  messa: {
    title: 'Тише — громче — тише', cat: 'Динамика', min: 3, type: 'sustain', count: 3, holdSec: 8, syllable: 'а', zone: [0.3, 0.6],
    how: ['Начните ноту очень тихо, плавно усильте до уверенной громкости и так же плавно вернитесь к тихой.',
      'Высота не должна уходить: громче — не значит выше.'],
    feel: 'Громкость растёт за счёт выдоха, а не давления в горле. При усилении ноты часто завышают — следите за линией.',
  },
  'trill-5': {
    title: 'Губная трель по пяти нотам', cat: 'Разогрев', min: 3, type: 'pattern', degrees: FIVE, noteDur: 0.45, syllable: 'губная трель', maxReps: 6,
    how: ['Послушайте попевку и повторите её губной трелью.',
      'Каждый повтор начинается на ступень выше.'],
    feel: 'Ноты связаны, между ними нет толчков. Трель не прерывается на верхней ноте.',
  },
  'scale-3': {
    title: 'Три ноты на «ма»', cat: 'Интонация', min: 3, type: 'pattern', degrees: [0, 2, 4, 2, 0], noteDur: 0.65, syllable: 'ма', maxReps: 6,
    how: ['Послушайте пять звуков и повторите на «ма-ма-ма-ма-ма».',
      'Каждую ноту берите сразу точно, без подъезда снизу.'],
    feel: 'Согласная «м» помогает начать звук мягко и близко. Верхняя нота не громче остальных.',
  },
  'scale-5': {
    title: 'Пять нот вверх и вниз', cat: 'Интонация', min: 4, type: 'pattern', degrees: FIVE, noteDur: 0.5, syllable: 'ма', maxReps: 7,
    how: ['Повторите попевку из пяти ступеней вверх и вниз на «ма».',
      'На спуске не давайте нотам «сползать» ниже цели — это самая частая ошибка.'],
    feel: 'Спускаясь, думайте, что шаги маленькие. Дыхания хватает на всю попевку.',
  },
  arp: {
    title: 'Трезвучие', cat: 'Интонация', min: 3, type: 'pattern', degrees: [0, 4, 7, 4, 0], noteDur: 0.65, syllable: 'ми', maxReps: 7,
    how: ['Спойте по звукам аккорда: до–ми–соль–ми–до на «ми-и-и-и-и».',
      'Скачки берите уверенно, заранее услышав ноту.'],
    feel: 'Между нотами нет «въезда». Верхний звук лёгкий, без нажима.',
  },
  'arp-8': {
    title: 'Арпеджио до октавы', cat: 'Диапазон', min: 4, type: 'pattern', degrees: ARP8, noteDur: 0.55, syllable: 'но', maxReps: 7,
    how: ['Спойте по звукам аккорда до верхней октавы и обратно на «но-о-о».',
      'К верхней ноте не усиливайте звук, а наоборот — облегчайте.'],
    feel: 'Челюсть свободно опускается к верхней ноте. Горло не сжимается.',
  },
  'scale-8': {
    title: 'Гамма на октаву', cat: 'Интонация', min: 4, type: 'pattern', degrees: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0], noteDur: 0.42, syllable: 'на', maxReps: 5,
    how: ['Спойте мажорную гамму вверх и вниз на «на-на-на».',
      'Седьмую ступень перед верхней нотой берите высоко — её обычно занижают.'],
    feel: 'Ровное движение без ускорения. Вдох берите перед началом, а не посередине.',
  },
  'ng-5': {
    title: '«Нг» по пяти нотам', cat: 'Резонанс', min: 3, type: 'pattern', degrees: FIVE, noteDur: 0.5, syllable: 'нг', maxReps: 6,
    how: ['Скажите «синг» и задержитесь на последнем звуке: задняя часть языка прижата к нёбу, рот приоткрыт.',
      'На этом «нг» спойте попевку из пяти нот.'],
    feel: 'Звук гудит в носу и переносице. Так голос находит верхний резонанс без усилия.',
  },
  'nay-arp': {
    title: '«Ней-ней» по арпеджио', cat: 'Регистры', min: 4, type: 'pattern', degrees: ARP8, noteDur: 0.5, syllable: 'ней', maxReps: 6,
    how: ['Спойте арпеджио на капризное, слегка «гнусавое» «ней-ней-ней».',
      'Звук яркий и близкий, как у дразнящегося ребёнка, но негромкий.'],
    feel: 'Яркий звук помогает пройти переходные ноты без срыва. Это рабочий приём, а не красивый тембр.',
  },
  'gug-down': {
    title: '«Гуг» сверху вниз', cat: 'Регистры', min: 3, type: 'pattern', degrees: [12, 7, 4, 0], noteDur: 0.55, syllable: 'гуг', maxReps: 6,
    how: ['Послушайте и спойте сверху вниз на «гуг-гуг-гуг-гуг».',
      'Начинайте верхнюю ноту легко, почти как зевок.'],
    feel: 'Гортань остаётся внизу, звук округлый. Верхняя нота не кричится.',
  },
  'octave-slide': {
    title: 'Скольжение на октаву', cat: 'Регистры', min: 3, type: 'pattern', degrees: [0, 12, 0], noteDur: 1.1, syllable: 'у', maxReps: 6, slide: true,
    how: ['На «у» плавно проскользите от нижней ноты до верхней и обратно, задевая все промежуточные звуки.',
      'Не прибавляйте громкость по пути вверх.'],
    feel: 'Голос переходит из грудного звучания в головное без щелчка. Если щёлкает — пойте тише.',
  },
  'octave-jump': {
    title: 'Скачок на октаву', cat: 'Диапазон', min: 3, type: 'pattern', degrees: [0, 12, 0, 12, 0], noteDur: 0.65, syllable: 'йа', maxReps: 6,
    how: ['Спойте нижнюю ноту, прыгните на октаву вверх и вернитесь, на «йа».',
      'Верхнюю ноту берите сверху, как будто опускаетесь на неё.'],
    feel: 'Скачок чистый, без подъезда. Нижняя нота после возврата не проседает.',
  },
  'scale-9': {
    title: 'Беглая гамма до ноны', cat: 'Беглость', min: 3, type: 'pattern', degrees: [0, 2, 4, 5, 7, 9, 11, 12, 14, 12, 11, 9, 7, 5, 4, 2, 0], noteDur: 0.3, syllable: 'а', maxReps: 5,
    how: ['Быстрая гамма вверх до девятой ступени и вниз на «а».',
      'Пойте легко и негромко, как смех.'],
    feel: 'Ноты отдельные, но связные. Тяжёлый звук быстро не побежит — облегчайте.',
  },
  staccato: {
    title: 'Стаккато «ха-ха»', cat: 'Беглость', min: 3, type: 'pattern', degrees: ARP8, noteDur: 0.42, syllable: 'ха', maxReps: 6,
    how: ['Спойте арпеджио короткими отрывистыми звуками на «ха».',
      'Каждый звук — лёгкий толчок животом, как смех.'],
    feel: 'Толчок идёт от живота, горло не смыкается с усилием. Нота точная с первого мгновения.',
  },
  'intervals-1': {
    title: 'Интервалы: секунды и терции', cat: 'Слух', min: 4, type: 'match', mode: 'interval', intervals: [2, 3, 4, -2], count: 6,
    how: ['Приложение сыграет нижний звук и назовёт интервал.',
      'Спойте второй звук интервала сами — его не сыграют заранее.',
      'После попытки вы услышите правильный ответ.'],
    feel: 'Пропойте про себя гамму от первого звука до нужной ступени — так проще найти ноту.',
  },
  'intervals-2': {
    title: 'Интервалы: кварта и квинта', cat: 'Слух', min: 4, type: 'match', mode: 'interval', intervals: [5, 7, 4, 3, -3, -4], count: 6,
    how: ['Приложение сыграет первый звук и назовёт интервал.',
      'Спойте второй звук сами, затем сверьтесь с ответом.'],
    feel: 'Кварта — начало многих гимнов и маршей, квинта звучит «пусто» и устойчиво.',
  },
  'intervals-3': {
    title: 'Интервалы: сексты и октава', cat: 'Слух', min: 4, type: 'match', mode: 'interval', intervals: [8, 9, 12, 7, -5, -7], count: 6,
    how: ['Приложение сыграет первый звук и назовёт интервал.',
      'Спойте второй звук сами, затем сверьтесь с ответом.'],
    feel: 'Широкий скачок берите сверху, заранее представив ноту.',
  },
  song: {
    title: 'Работа над песней', cat: 'Песня', min: 6, type: 'song',
    how: ['Откройте песню и поработайте над двумя-тремя фразами.',
      'Сначала на слог, потом со словами, затем спойте кусок целиком.'],
    feel: 'Переносите в песню то, что получилось в упражнениях: мягкое начало звука и ровный выдох.',
  },
};

const STAGES = [
  { n: 1, title: 'Дыхание и первый звук', weeks: [1, 2] },
  { n: 2, title: 'Интонация', weeks: [3, 4, 5] },
  { n: 3, title: 'Резонанс и регистры', weeks: [6, 7, 8] },
  { n: 4, title: 'Диапазон, беглость, динамика', weeks: [9, 10] },
  { n: 5, title: 'Применение в песне', weeks: [11, 12] },
];

export const WEEKS = [
  { title: 'Дыхание и мягкий звук',
    goal: 'Научиться дышать животом, включать голос без нажима и попадать в отдельные ноты.',
    session: ['breath-446', 'exhale-sss', 'lip-trill-glide', 'hum-glide', 'match-notes', 'sustain', 'cooldown'] },
  { title: 'Опора и первые попевки',
    goal: 'Удлинить выдох, снимать ноту с инструмента и спеть первые три ступени.',
    session: ['breath-446', 'exhale-sss', 'lip-trill-glide', 'match-notes', 'echo', 'scale-3', 'sustain', 'cooldown'] },
  { title: 'Пять нот',
    goal: 'Чисто петь поступенное движение в пределах квинты.',
    session: ['exhale-sss', 'lip-trill-glide', 'trill-5', 'scale-3', 'scale-5', 'echo', 'sustain', 'cooldown'] },
  { title: 'Трезвучие и первые интервалы',
    goal: 'Брать скачки на терцию и квинту, слышать секунды и терции.',
    session: ['exhale-sss', 'trill-5', 'scale-5', 'arp', 'intervals-1', 'sustain', 'cooldown'] },
  { title: 'Гамма и широкие шаги',
    goal: 'Спеть гамму на октаву и уверенно находить кварту и квинту.',
    session: ['lip-trill-glide', 'trill-5', 'scale-5', 'arp', 'scale-8', 'intervals-2', 'cooldown'] },
  { title: 'Звук вперёд',
    goal: 'Найти верхний резонанс и сохранить его на разных гласных.',
    session: ['straw-glide', 'hum-glide', 'ng-5', 'sustain-vowels', 'scale-5', 'arp', 'cooldown'] },
  { title: 'Переход между регистрами',
    goal: 'Проходить переходные ноты без срыва и без крика.',
    session: ['straw-glide', 'lip-trill-glide', 'octave-slide', 'nay-arp', 'ng-5', 'scale-8', 'cooldown'] },
  { title: 'Ровный голос сверху донизу',
    goal: 'Соединить нижнее и верхнее звучание и расширить слуховой запас интервалов.',
    session: ['lip-trill-glide', 'octave-slide', 'gug-down', 'nay-arp', 'sustain-vowels', 'intervals-3', 'cooldown'] },
  { title: 'Расширение диапазона',
    goal: 'Добавить по одной-две уверенные ноты вверх и вниз.',
    session: ['straw-glide', 'lip-trill-glide', 'arp-8', 'octave-jump', 'gug-down', 'sustain', 'cooldown'] },
  { title: 'Беглость и динамика',
    goal: 'Петь быстро и легко, управлять громкостью без потери высоты.',
    session: ['lip-trill-glide', 'trill-5', 'scale-9', 'staccato', 'messa', 'intervals-3', 'cooldown'] },
  { title: 'Техника в песне',
    goal: 'Перенести навыки в песню: дыхание по фразам, точные первые ноты.',
    session: ['lip-trill-glide', 'scale-5', 'arp-8', 'messa', 'cooldown'] },
  { title: 'Исполнение',
    goal: 'Спеть песню целиком уверенно и записать результат.',
    session: ['straw-glide', 'lip-trill-glide', 'arp-8', 'sustain-vowels', 'cooldown'] },
];

export const stageOf = (week) => STAGES.find((s) => s.weeks.includes(week)) || STAGES[STAGES.length - 1];
export { STAGES };

/** Допуск в центах: чем дальше по плану, тем строже. */
export const toleranceFor = (week) => (week <= 2 ? 50 : week <= 5 ? 45 : week <= 8 ? 40 : 35);

const stageZone = (week) => (week <= 2 ? [0.15, 0.6] : week <= 5 ? [0.1, 0.72] : week <= 8 ? [0.07, 0.82] : [0.04, 0.92]);

function zoneOf(profile, frac) {
  const span = profile.high - profile.low;
  return { lo: Math.round(profile.low + frac[0] * span), hi: Math.round(profile.low + frac[1] * span) };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Список упражнений занятия для текущей недели. */
export function sessionItems(st) {
  const week = st.plan.week;
  const ov = st.plan.override;
  let ids = (ov && ov.week === week && Array.isArray(ov.session) ? ov.session : WEEKS[week - 1].session).filter((id) => LIB[id]);
  if (!ids.length) ids = WEEKS[week - 1].session.slice();
  ids = ids.filter((id) => id !== 'song');
  if (st.songs.length) {
    const at = ids.lastIndexOf('cooldown');
    if (at >= 0) ids.splice(at, 0, 'song');
    else ids.push('song');
  }
  return ids;
}

export const sessionMinutes = (ids) => ids.reduce((a, id) => a + (LIB[id] ? LIB[id].min : 0), 0);

/**
 * Готовит упражнение под ученика: ноты в его диапазоне, допуск по неделе,
 * режим опорного звука из настроек.
 */
export function resolve(id, st, week = st.plan.week) {
  const def = LIB[id];
  if (!def) return null;
  const profile = st.profile || { low: 48, high: 67 };
  const tol = toleranceFor(week);
  const ex = {
    ...def, id, tol,
    refMode: st.settings.refMode,
    headphones: !!st.settings.headphones,
    range: { lo: profile.low, hi: profile.high },
  };
  const zone = zoneOf(profile, def.zone || stageZone(week));

  if (def.type === 'pattern') {
    const dmin = Math.min(...def.degrees);
    const dmax = Math.max(...def.degrees);
    let first = zone.lo - dmin;
    let last = zone.hi - dmax;
    if (last < first) {
      first = Math.max(profile.low - dmin, Math.min(first, profile.high - dmax));
      last = first;
    }
    const count = last - first + 1;
    const step = Math.max(1, Math.ceil(count / (def.maxReps || 6)));
    const roots = [];
    for (let r = first; r <= last; r += step) roots.push(r);
    ex.reps = roots.map((root) => ({
      root,
      notes: def.degrees.map((d, i) => ({ midi: root + d, start: i * def.noteDur, dur: def.noteDur })),
      len: def.degrees.length * def.noteDur,
    }));
  } else if (def.type === 'sustain') {
    const n = def.count || 3;
    ex.notes = [];
    for (let i = 0; i < n; i++) ex.notes.push(Math.round(zone.lo + ((zone.hi - zone.lo) * i) / Math.max(1, n - 1)));
  } else if (def.type === 'glide') {
    ex.zone = zone;
  } else if (def.type === 'match') {
    ex.items = [];
    let prev = null;
    for (let i = 0; i < def.count; i++) {
      if (def.mode === 'interval') {
        // Интервал должен целиком помещаться в голос: сначала в зону недели,
        // затем во весь диапазон, а если не помещается — берём интервал поуже.
        const fit = (step, a, b) => {
          const lo = Math.max(a, a - Math.min(0, step));
          const hi = Math.min(b, b - Math.max(0, step));
          return lo <= hi ? [lo, hi] : null;
        };
        let iv = def.intervals[i % def.intervals.length];
        let span = fit(iv, zone.lo, zone.hi) || fit(iv, profile.low, profile.high);
        while (!span && Math.abs(iv) > 1) {
          iv -= Math.sign(iv);
          span = fit(iv, profile.low, profile.high);
        }
        if (!span) span = [profile.low, profile.low];
        const root = span[0] + Math.floor(Math.random() * (span[1] - span[0] + 1));
        ex.items.push({
          root, midi: root + iv,
          prompt: `${INTERVALS[Math.abs(iv)]} ${iv > 0 ? 'вверх' : 'вниз'} от ${noteName(root)}`,
        });
      } else {
        let m;
        const opts = [];
        for (let k = zone.lo; k <= zone.hi; k++) if (prev == null || Math.abs(k - prev) >= 2) opts.push(k);
        m = opts.length ? pick(opts) : zone.lo;
        prev = m;
        ex.items.push({ midi: m, prompt: noteFull(m) });
      }
    }
  }
  return ex;
}

/** Уровень по доле попаданий в диагностике. */
export function levelOf(matchRate) {
  if (matchRate == null) return 'не определён';
  if (matchRate >= 80) return 'уверенный';
  if (matchRate >= 50) return 'средний';
  return 'начальный';
}

/** Диагностические шаги: диапазон, попадание в ноты, длительность звука. */
export function diagnosticSteps(st, low, high) {
  const fake = { ...st, profile: { low, high } };
  return {
    match: { ...resolve('match-notes', fake, 1), id: 'diag-match', title: 'Попадание в ноты', count: 5, items: resolve('match-notes', fake, 1).items.slice(0, 5) },
    mpt: {
      id: 'diag-mpt', title: 'Длительность звука', cat: 'Диагностика', type: 'sustain', free: true, count: 1, holdSec: 60, syllable: 'а',
      tol: 50, refMode: 'app', headphones: false, range: { lo: low, hi: high }, notes: [Math.round((low + high) / 2)],
      how: ['Сделайте спокойный вдох и тяните удобную ноту на «а» как можно дольше.', 'Высота может быть любой. Не выдавливайте остатки воздуха.'],
      feel: '',
    },
  };
}

export const RANGE_EX = {
  id: 'diag-range', title: 'Диапазон голоса', cat: 'Диагностика', type: 'range',
  how: ['Сначала спойте «а» и плавно опускайтесь до самой низкой ноты, которая ещё звучит уверенно. Подержите её секунду.',
    'Затем так же поднимитесь до самой высокой ноты, которую берёте без напряжения, и подержите её.'],
  feel: 'Ищем рабочие, а не предельные ноты. Если звук хрипит или давится — это уже за пределами диапазона.',
};

/** Готовые диапазоны на случай, если ученик пропускает диагностику. */
export const PRESET_RANGES = [
  { label: 'Низкий мужской', low: 41, high: 64 },
  { label: 'Средний мужской', low: 45, high: 67 },
  { label: 'Высокий мужской', low: 48, high: 72 },
  { label: 'Низкий женский', low: 53, high: 74 },
  { label: 'Средний женский', low: 57, high: 79 },
  { label: 'Высокий женский', low: 60, high: 84 },
];
