// logic.mjs — 英語リスニングアプリの、判断の部分(画面にも、音声にも、依存しない、純粋な関数)。
// Node でも、ブラウザでも、動く。テストは logic_test.mjs。

// ---- 設定 ----------------------------------------------------------

// 1分間に、読み上げられる単語数(読み上げの速さの目安。rate 1.0 の時)
export const WORDS_PER_MINUTE = 150;

// 読み上げの速さ(speechSynthesis の rate。1.0 が、ふつう)。はじめの速さ。レベルとは、無関係。
export const READING_RATE = 0.8;
// 表紙の速度ボタンで、選べる速さ(倍率)
export const SPEEDS = [0.5, 0.8, 1.0, 1.2, 1.5];
export const isSpeed = (x) => SPEEDS.includes(x);

// 1回の練習で、続けて聞く、節の数: 範囲(1〜5)。はじめは、1節(1回の練習 = 1つの節)
export const LIMITS = { minSections: 1, maxSections: 5 };
export const DEFAULT_SECTION_COUNT = 1;

// 古い記録(長さを、秒で持っていた時)との互換のため、記録に、残している値。いまは、使わない。
//   (古いサーバの、記録の検査を、通すため。書き出す記録にも、入れておく)
export const LEGACY_TARGET_SECONDS = 30;

// レベルの自動判定の境目: 1文あたりの、平均の単語数。 6.5 未満 = レベル1 / 9.5 未満 = レベル2 / それ以上 = レベル3
//   (いまの物語: 易しい版 5.0〜5.1、ふつう版 8.0〜8.3、難しい版 11.3〜12.1、The Open Boat 11.2。どれも、境目から、離れている)
export const LEVEL_BOUNDS = [6.5, 9.5];

const STORAGE_VERSION = 1;
const MAX_HISTORY = 200;

// 以前の記録の、「物語の番号(storyIndex)」を、名前に直す時の、対応(昔の並び順)
export const LEGACY_STORY_NAMES = ["ken", "umbrella", "bakery", "openboat"];

// ---- 文章の、基本の計算 ----------------------------------------------

// 英文の、単語の数(アルファベット、数字、アポストロフィの、まとまり)
export function countWords(text) {
  const m = String(text).match(/[A-Za-z0-9']+/g);
  return m ? m.length : 0;
}

// 文のリストを、読み上げるのに、かかる秒数の、目安
export function estimateSeconds(sentences, rate = READING_RATE) {
  const words = sentences.reduce((sum, s) => sum + countWords(s.text), 0);
  return (words / (WORDS_PER_MINUTE * rate)) * 60;
}

// 秒数を、「1分30秒」のような文にする
export function formatSeconds(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return s + "秒";
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? m + "分" : m + "分" + rest + "秒";
}

// 今日の日付を、「2026-11-16」の形で(その人の、ふだんの時計の日付)
export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// ---- レベルの、自動判定 -------------------------------------------------

// 1文あたりの、平均の単語数
export function averageWords(sentences) {
  if (sentences.length === 0) return 0;
  return sentences.reduce((sum, s) => sum + countWords(s.text), 0) / sentences.length;
}

// 物語を作ったら、レベルは、自動で決まる(1つの物語は、1つのレベルに、属する)
export function detectLevel(sentences) {
  const avg = averageWords(sentences);
  if (avg < LEVEL_BOUNDS[0]) return 1;
  if (avg < LEVEL_BOUNDS[1]) return 2;
  return 3;
}

// ---- ファイル名の決まり: [レベル]-[ストーリー番号]-[節番号]-[ストーリー名].json(数字は、全部2けた) ----

export const pad2 = (n) => String(n).padStart(2, "0");

// 「01-02-03」(レベル1・ストーリー2・節3)
export function sectionCode(level, storyNo, sectionNo) {
  return pad2(level) + "-" + pad2(storyNo) + "-" + pad2(sectionNo);
}

export function sectionFileName(level, storyNo, sectionNo, name) {
  return sectionCode(level, storyNo, sectionNo) + "-" + name + ".json";
}

// ストーリー名は、英小文字だけ(ハイフンで区切るため、名前の中には、ハイフンを、使わない)
export const SECTION_FILE_PATTERN = /^(\d{2})-(\d{2})-(\d{2})-([a-z]+)\.json$/;

export function parseSectionFileName(file) {
  const m = SECTION_FILE_PATTERN.exec(file);
  return m ? { level: Number(m[1]), story: Number(m[2]), section: Number(m[3]), name: m[4] } : null;
}

// ---- 物語の、構成(目次 stories/index.json): レベル → ストーリー → 節 ----------------------
// 1つの物語は、1つのレベルに、属する。ストーリー番号は、レベルごとに、01から。節番号は、物語の中の、通し番号。
// 目次には、各節の、ファイル名・文の数・単語数が、書いてある(ファイルを開かずに、長さを、見積もれる)。

export function levelsOf(catalog) {
  return catalog.levels.map((l) => l.level);
}

// いちばん上のレベル(目次にある、最大のレベル)
export function maxLevelOf(catalog) {
  return Math.max(...levelsOf(catalog));
}

export function storiesOfLevel(catalog, level) {
  const l = catalog.levels.find((x) => x.level === level);
  return l ? l.stories : [];
}

export function findStory(catalog, level, name) {
  return storiesOfLevel(catalog, level).find((s) => s.name === name) ?? null;
}

// 物語の、全部の節を、1列に並べる(番号は、0から。記録の sceneIndex は、この番号)
export function flattenSections(story, level) {
  return story.sections.map((sec, i) => ({
    index: i, level, storyNo: story.no, name: story.name, storyTitle: story.title,
    sectionNo: sec.no, title: sec.title, titleJa: sec.titleJa, file: sec.file,
    sentences: sec.sentences, words: sec.words, code: sectionCode(level, story.no, sec.no),
  }));
}

// 1つの節を、読み上げるのに、かかる秒数の、目安(目次の、単語数から)
export function sectionSeconds(sec, rate = READING_RATE) {
  return (sec.words / (WORDS_PER_MINUTE * rate)) * 60;
}

// 聞き始める時に、どの節を、読み込むかを、決める: 位置(レベル・ストーリー・節)から、sectionCount 個の節(物語の終わりまで)。
//   position: { level, storyName, sceneIndex }
//   戻り値: { level, storyName, story, rate, sections(読み込む節), estimatedSeconds, nextIndex, storyEnded, sectionCount }
export function planSession(catalog, position, { sectionCount = DEFAULT_SECTION_COUNT, rate = READING_RATE } = {}) {
  const story = findStory(catalog, position.level, position.storyName);
  if (!story) throw new Error("そのレベルに、その物語が、ありません: レベル " + position.level + " " + position.storyName);
  const flat = flattenSections(story, position.level);
  const sections = [];
  let seconds = 0;
  let i = position.sceneIndex;
  while (i < flat.length && sections.length < sectionCount) {
    sections.push(flat[i]);
    seconds += sectionSeconds(flat[i], rate);
    i++;
  }
  return { level: position.level, storyName: position.storyName, story, rate, sections, estimatedSeconds: seconds, nextIndex: i, storyEnded: i >= flat.length, sectionCount: flat.length };
}

// 読み込んだ節のデータ(plan.sections と、同じ順番)から、読み上げる文の列を、組み立てる。
//   各文: { text, ja, note, sectionCode, number(1から) }
// 1文の、音声ファイルの名前: 節のファイル名(.json を除く)- 文の番号(1から、2けた).mp3  例: 01-01-01-ken-01.mp3
//   make_audio.py が、同じ名前で、audio/ に、作る。
export function audioName(sectionFile, index) {
  return String(sectionFile).replace(/\.json$/, "") + "-" + pad2(index + 1) + ".mp3";
}

export function assembleSession(plan, loaded) {
  const sentences = [];
  plan.sections.forEach((sec, k) => {
    const data = loaded[k];
    const list = data && Array.isArray(data.sentences) ? data.sentences : null;
    if (!list) throw new Error("節のデータに、文が、ありません: " + sec.code);
    list.forEach((s, j) => {
      sentences.push({ text: s.text, ja: s.ja, note: s.note, sectionCode: sec.code, number: sentences.length + 1, audio: audioName(sec.file, j) });
    });
  });
  return { ...plan, sentences };
}

// 今回の範囲を、文字にする: 「01-01-01」 または 「01-01-01 〜 01-01-02」
export function rangeLabel(plan) {
  const a = plan.sections[0].code;
  const b = plan.sections[plan.sections.length - 1].code;
  return a === b ? a : a + " 〜 " + b;
}

// 記録に残す、範囲の文字: 「01-01-01」 または 「01-01-01〜01-01-02」
export function rangeKey(plan) {
  const a = plan.sections[0].code;
  const b = plan.sections[plan.sections.length - 1].code;
  return a === b ? a : a + "〜" + b;
}

// ---- 位置(レベル・ストーリー・節)の、扱い ------------------------------------------

// 記録の位置を、目次に合わせて、正しい形にする(目次に無い物は、直す)
//   - ストーリー名が、そのレベルに、無い → 他のレベルを、探す(あれば、そのレベルへ。無ければ、そのレベルの01番の、節0から)
//   - 節の番号が、その物語の節の数を、超えている → 剰余(最後まで聞いた後)
export function resolvePosition(catalog, progress) {
  const levels = levelsOf(catalog);
  let level = levels.includes(progress.level) ? progress.level : levels[0];
  let story = progress.storyName ? findStory(catalog, level, progress.storyName) : null;
  if (!story && progress.storyName) {
    for (const l of levels) {
      const s = findStory(catalog, l, progress.storyName);
      if (s) { level = l; story = s; break; }
    }
  }
  if (!story) {
    const first = storiesOfLevel(catalog, level)[0];
    return { level, storyName: first.name, sceneIndex: 0 };
  }
  return { level, storyName: story.name, sceneIndex: progress.sceneIndex % story.sections.length };
}

// 右の列の並び(レベル → ストーリー → 節)で、1つ先の節の、位置。
//   物語の最後の節の次 = 同じレベルの、次の物語の、最初の節 / レベルの最後の物語の、最後の節の次 = 次のレベルの、最初の節
//   いちばん最後の次は、いちばん最初(1周する)
export function nextSectionPosition(catalog, pos) {
  const story = findStory(catalog, pos.level, pos.storyName);
  if (story && pos.sceneIndex + 1 < story.sections.length) {
    return { level: pos.level, storyName: pos.storyName, sceneIndex: pos.sceneIndex + 1 };
  }
  const stories = storiesOfLevel(catalog, pos.level);
  const i = stories.findIndex((s) => s.name === pos.storyName);
  if (i >= 0 && i + 1 < stories.length) {
    return { level: pos.level, storyName: stories[i + 1].name, sceneIndex: 0 };
  }
  const levels = levelsOf(catalog);
  const nextLevel = levels[(levels.indexOf(pos.level) + 1) % levels.length];
  return { level: nextLevel, storyName: storiesOfLevel(catalog, nextLevel)[0].name, sceneIndex: 0 };
}

// 「次の節にする」: 節の数(count)ぶん、先の位置(次のまとまりの、最初の節)。
//   1回の練習は、count 個の節を、続けて聞く。ボタンは、その1回分を、飛ばして、次のまとまりに進む(範囲が、重ならない)。
//   物語の終わりを、越える時は、次の物語の最初の節(レベルの最後なら、次のレベル。最後の次は、最初)。count = 1 なら、nextSectionPosition と、同じ。
export function nextBlockPosition(catalog, pos, count = 1) {
  const story = findStory(catalog, pos.level, pos.storyName);
  if (!story) return nextSectionPosition(catalog, pos);
  const idx = pos.sceneIndex + count;
  if (idx < story.sections.length) return { level: pos.level, storyName: pos.storyName, sceneIndex: idx };
  return nextSectionPosition(catalog, { level: pos.level, storyName: pos.storyName, sceneIndex: story.sections.length - 1 });
}

// 練習の後の、新しい位置を、決める(表紙の「次の節にする」と、同じ動き)。
//   plan: planSession の戻り値(いま聞いた節。 sections[0] が、最初の節)
//   右の列の並び(レベル → ストーリー → 節)で、聞いた節の、すぐ後ろ。物語の終わりや、レベルの終わりも、越える。
//   レベルは、進んだ先の位置で、決まる(わからなかった文の割合では、変えない)。
export function positionAfterSession(catalog, plan) {
  const first = plan.sections[0].index;
  return nextBlockPosition(catalog, { level: plan.level, storyName: plan.storyName, sceneIndex: first }, plan.sections.length);
}

// ---- 節ごとの結果(右の列で、わからなかった文が少なかった節の題名を、緑にする) ----

// 「わからなかった文が、この割合以下」なら、良い(緑)。20% 以下。
export const GOOD_RATE = 0.2;

// 今回の練習で、最後まで答え終えた節の、結果を、返す(途中までの節は、入れない)。
//   sentences: 組み立てた文の列(各文に sectionCode) / judgedCount: 答えた文の数(先頭から、順に) / stops: わからなかった文の番号の集合
//   戻り値: [ { code, sentences, stops } ](節の順)
export function sectionResults(sentences, judgedCount, stops) {
  const bySection = new Map();
  sentences.forEach((s, i) => {
    const r = bySection.get(s.sectionCode) ?? { code: s.sectionCode, sentences: 0, answered: 0, stops: 0 };
    r.sentences += 1;
    if (i < judgedCount) {
      r.answered += 1;
      if (stops.has(i)) r.stops += 1;
    }
    bySection.set(s.sectionCode, r);
  });
  return [...bySection.values()].filter((r) => r.answered === r.sentences).map(({ code, sentences: n, stops: k }) => ({ code, sentences: n, stops: k }));
}

// 節ごとの結果の表を、新しくする(その節の、いちばん新しい結果に、置き換える)。元の表は、書き換えない。
export function updateSectionStats(stats, results, date) {
  const next = { ...(stats ?? {}) };
  for (const r of results) next[r.code] = { sentences: r.sentences, stops: r.stops, date };
  return next;
}

// その節の、最後の結果が、「わからなかった文が 20% 以下」か(結果が無い節は、false)
export function isGoodSection(stat) {
  return Boolean(stat && stat.sentences > 0 && stat.stops / stat.sentences <= GOOD_RATE + 1e-9);
}

// ---- 記録の表: 日付ごと × ストーリーごとに、まとめる ----------------------------

// 範囲の文字(「01-01-01〜01-01-03」「01-01-05」)から、(レベル-ストーリー)と、節の番号の列を、取り出す。読めない形なら、null。
function parseRangeText(text) {
  const m = /^(\d{2}-\d{2})-(\d{2})(?:〜(\d{2}-\d{2})-(\d{2}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const [, prefix, a, prefix2, b] = m;
  if (b !== undefined && prefix2 !== prefix) return null;
  const from = Number(a);
  const to = b === undefined ? from : Number(b);
  if (to < from) return null;
  const nos = [];
  for (let n = from; n <= to; n++) nos.push(n);
  return { prefix, nos };
}

// 節の番号の集まりを、つながった範囲ごとに、まとめて書く。例: 01-01-01〜01-01-03, 01-01-05
function formatRanges(prefix, nosSet) {
  const nos = [...nosSet].sort((x, y) => x - y);
  const parts = [];
  let i = 0;
  while (i < nos.length) {
    let j = i;
    while (j + 1 < nos.length && nos[j + 1] === nos[j] + 1) j++;
    const code = (n) => prefix + "-" + pad2(n);
    parts.push(i === j ? code(nos[i]) : code(nos[i]) + "〜" + code(nos[j]));
    i = j + 1;
  }
  return parts;
}

function rangeText({ byPrefix, others }) {
  return [...byPrefix].flatMap(([prefix, set]) => formatRanges(prefix, set)).concat(others).join(", ") || "-";
}

// 練習の履歴(1回ごと)を、「日付 × レベル × ストーリー」ごとに、1行に、まとめる。新しい行が、先。元の履歴は、書き換えない。
//   戻り値: [ { date, story, level, range, count(練習の回数), sentences, stops, status: "all" | "some" | "none" } ]
//     range: 最後まで聞いた回の、節の範囲(つながっていない時は、「, 」で、区切る)。最後まで聞いた回が、1つも無い時だけ、途中でやめた回の、予定の範囲。読めない古い形は、そのまま、並べる。
//     status: all = 全部、最後まで聞いた / some = 途中でやめた回も、ある / none = 全部、途中でやめた
export function groupHistory(history) {
  const groups = new Map();
  history.forEach((h, index) => {
    const key = [h.date, h.level, h.story ?? ""].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { date: h.date, story: h.story || "", level: h.level, count: 0, sentences: 0, stops: 0, done: 0, ranges: { done: { byPrefix: new Map(), others: [] }, quit: { byPrefix: new Map(), others: [] } }, last: index };
      groups.set(key, g);
    }
    g.last = index;
    g.count += 1;
    g.sentences += h.sentences ?? 0;
    g.stops += h.stops ?? 0;
    if (h.completed) g.done += 1;
    const text = h.range || h.chapters || "";
    const r = parseRangeText(text);
    const into = h.completed ? g.ranges.done : g.ranges.quit;
    if (r) {
      const set = into.byPrefix.get(r.prefix) ?? new Set();
      r.nos.forEach((n) => set.add(n));
      into.byPrefix.set(r.prefix, set);
    } else if (text && !into.others.includes(text)) {
      into.others.push(text);
    }
  });
  return [...groups.values()]
    .sort((x, y) => y.last - x.last)
    .map((g) => ({
      date: g.date, story: g.story, level: g.level,
      range: rangeText(g.done > 0 ? g.ranges.done : g.ranges.quit),
      count: g.count, sentences: g.sentences, stops: g.stops,
      status: g.done === g.count ? "all" : g.done === 0 ? "none" : "some",
    }));
}

// ---- 記録(進歩)----------------------------------------------------------

// storyName が空の時は、起動時に、そのレベルの01番の物語に、直される(resolvePosition)
export function createProgress() {
  return { version: STORAGE_VERSION, level: 1, sectionCount: DEFAULT_SECTION_COUNT, rate: READING_RATE, targetSeconds: LEGACY_TARGET_SECONDS, storyName: "", sceneIndex: 0, sectionStats: {}, history: [] };
}

// 保存してあった文字を、読み取る。正しい記録なら、その記録。壊れていたら、null(はじめの状態には、しない)。
//   ファイルや、別の場所から、記録を取り込む時に、「壊れた物で、いまの記録を、つぶさない」ために、使う。
//   以前の記録(storyIndex だけがある)は、物語の名前に、直す。
export function readProgress(text) {
  if (text === null || text === undefined || text === "") return null;
  try {
    const p = JSON.parse(text);
    const ok =
      p && typeof p === "object" &&
      Number.isInteger(p.level) && p.level >= 1 &&
      (p.targetSeconds === undefined || (Number.isFinite(p.targetSeconds) && p.targetSeconds >= 30 && p.targetSeconds <= 300)) &&
      Number.isInteger(p.sceneIndex) && p.sceneIndex >= 0 &&
      Array.isArray(p.history);
    if (!ok) return null;
    const { storyIndex, ...rest } = p;
    let storyName = typeof p.storyName === "string" ? p.storyName : null;
    if (storyName === null) {
      const i = Number.isInteger(storyIndex) && storyIndex >= 0 ? storyIndex : 0;
      storyName = LEGACY_STORY_NAMES[i % LEGACY_STORY_NAMES.length];
    }
    const sectionStats = rest.sectionStats && typeof rest.sectionStats === "object" && !Array.isArray(rest.sectionStats) ? rest.sectionStats : {};
    // 節の数: 古い記録には、無い(無ければ、1)。範囲外も、1にする
    const sectionCount = Number.isInteger(rest.sectionCount) && rest.sectionCount >= LIMITS.minSections && rest.sectionCount <= LIMITS.maxSections ? rest.sectionCount : DEFAULT_SECTION_COUNT;
    // 速さ: 選べる値だけ(古い記録には、無い。範囲外も、はじめの速さにする)
    const rate = isSpeed(rest.rate) ? rest.rate : READING_RATE;
    return { ...createProgress(), ...rest, storyName, sectionStats, sectionCount, rate };
  } catch {
    return null;
  }
}

// 保存してあった文字を、読み取る。壊れていたら、はじめの状態に戻す。
export function parseProgress(text) {
  return readProgress(text) ?? createProgress();
}

// 記録に、中身(練習の履歴や、更新時刻)が、あるか。はじめの状態の、空の記録は、false。
export function hasProgressData(p) {
  return Boolean(p && (p.updatedAt || (Array.isArray(p.history) && p.history.length > 0)));
}

// 2つの記録の、どちらを使うか。サーバ(ファイル)の記録 remote と、この画面の記録 local。
//   "remote" = ファイルの記録を使う / "local" = この画面の記録を、ファイルに書く / "none" = 何もしない
//   規則: ファイルが無い → 画面に中身があれば、ファイルへ書く(はじめての取り込み)
//         ファイルがある → 画面の更新時刻が、ファイルより新しい時だけ、画面を、ファイルに書く。それ以外は、ファイルを使う。
export function chooseSource(remote, local) {
  if (!remote) return hasProgressData(local) ? "local" : "none";
  if (hasProgressData(local) && local.updatedAt && (!remote.updatedAt || local.updatedAt > remote.updatedAt)) return "local";
  return "remote";
}

// ---- 2つの記録を、合わせる(端末と、同期先) -------------------------------------

// 履歴の1行を、見分ける印(同じ練習は、同じ印になる)
const historyKey = (h) => [h.date, h.time ?? "", h.story ?? "", h.range ?? h.chapters ?? "", h.level, h.sentences, h.stops, h.completed ? 1 : 0].join("|");

// 2つの記録 a, b を、1つに合わせる(どちらも、書き換えない)。同期で、「どちらかで、上書き」しないために、使う。
//   履歴: 両方の行を、合わせる(同じ行は、増やさない。同じ行が、1つの側に、2つあれば、2つ残す)。日付と時刻の順。最新の 200 件
//   節ごとの結果(緑): 節ごとに、日付が新しい方(同じ日なら、更新の新しい記録の方)
//   位置・速さ・その他: 更新(updatedAt)の新しい記録の方(同じなら a)
//   片方が無ければ、もう片方
export function mergeProgress(a, b) {
  if (!a && !b) return null;
  if (!a) return { ...b };
  if (!b) return { ...a };
  const aTime = a.updatedAt ?? "";
  const bTime = b.updatedAt ?? "";
  const newer = bTime > aTime ? b : a;

  // 履歴: 印ごとの個数の、多い方を、残す
  const count = (list) => { const m = new Map(); for (const h of list) m.set(historyKey(h), (m.get(historyKey(h)) ?? 0) + 1); return m; };
  const ca = count(a.history);
  const cb = count(b.history);
  const taken = new Map();
  const merged = [];
  for (const h of [...a.history, ...b.history]) {
    const k = historyKey(h);
    const want = Math.max(ca.get(k) ?? 0, cb.get(k) ?? 0);
    const got = taken.get(k) ?? 0;
    if (got < want) { merged.push(h); taken.set(k, got + 1); }
  }
  const history = merged
    .map((h, i) => ({ h, i }))
    .sort((x, y) => ((x.h.date ?? "") + " " + (x.h.time ?? "")).localeCompare((y.h.date ?? "") + " " + (y.h.time ?? "")) || x.i - y.i)
    .map((x) => ({ ...x.h }))
    .slice(-MAX_HISTORY);

  // 節ごとの結果
  const sa = a.sectionStats ?? {};
  const sb = b.sectionStats ?? {};
  const sectionStats = {};
  for (const code of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    const x = sa[code];
    const y = sb[code];
    if (!x) sectionStats[code] = y;
    else if (!y) sectionStats[code] = x;
    else if ((y.date ?? "") > (x.date ?? "")) sectionStats[code] = y;
    else if ((x.date ?? "") > (y.date ?? "")) sectionStats[code] = x;
    else sectionStats[code] = newer === b ? y : x;
  }
  return { ...newer, history, sectionStats, updatedAt: aTime > bTime ? aTime : bTime || undefined };
}

// 2つの記録が、同じ中身か(キーの順番は、問わない)
export function sameProgress(a, b) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// 1回の練習を、記録に足した、新しい記録を、返す(元の物は、書き換えない)。
//   record: { date, level, sectionCount, sentences, stops, completed }
//   place: 次の位置 { level, storyName, sceneIndex }(positionAfterSession の戻り値)。最後まで聞いた時だけ、進める(途中でやめた時は、null)。
//   節の数は、変えない(利用者が、表紙の「−/+」で、決める)。
export function recordSession(progress, record, place) {
  const history = [...progress.history, { ...record }].slice(-MAX_HISTORY);
  if (!record.completed) {
    return { ...progress, history };
  }
  return { ...progress, level: place.level, storyName: place.storyName, sceneIndex: place.sceneIndex, history };
}
