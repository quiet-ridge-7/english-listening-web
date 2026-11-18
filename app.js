// app.js — 画面と、音声(speechSynthesis)と、保存(ファイル / localStorage)を、つなぐ部分。
// 判断の計算は logic.mjs。物語のデータは stories/ フォルダ(目次 index.json と、節ごとのファイル)。
//   ファイル名: [レベル]-[ストーリー番号]-[節番号]-[ストーリー名].json(数字は2けた)。1つの物語は、1つのレベルに、属する。
//   目次は、起動時に、読む。節のファイルは、聞き始める時に、必要な節だけを、読み込む。
import {
  SPEEDS, DEFAULT_SECTION_COUNT, pad2,
  planSession, assembleSession, flattenSections, rangeLabel, rangeKey, sectionSeconds,
  findStory, resolvePosition, positionAfterSession,
  formatSeconds, todayString, groupHistory,
  parseProgress, createProgress, recordSession, sameProgress,
  readProgress, chooseSource, hasProgressData,
  sectionResults, updateSectionStats, isGoodSection,
} from "./logic.mjs";
import { SyncError, parseRepo, syncRecords, GITHUB_API } from "./sync.mjs";

const STORAGE_KEY = "english-listening-progress-v1";
const SYNC_KEY = "english-listening-sync-v1";   // 同期の設定(リポジトリと合鍵)。この端末の中だけ
// 同期先の API の場所。ふつうは GitHub。試験のためだけに、「同じ場所(/ で始まる)」への差し替えを、許す(合鍵を、他のサイトに送らせないため)
const SYNC_API = typeof window.__EL_GITHUB_API__ === "string" && /^\/[A-Za-z0-9_-][A-Za-z0-9_\/-]*$/.test(window.__EL_GITHUB_API__) ? window.__EL_GITHUB_API__ : GITHUB_API;
const SLOW_FACTOR = 0.75;    // 「ゆっくり聞く」の、速さの倍率
const MIN_RATE = 0.5;
const START_TIMEOUT_MS = 4000;   // 声が始まらない時に、別の声へ切り替えるまでの、待ち時間
const END_GRACE_MS = 10000;      // 読み終わりの通知が来ない時の、余裕(予想の長さに、足す)

// ---- 画面の部品を、取る ---------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = { start: $("screen-start"), play: $("screen-play"), finish: $("screen-finish") };

// 要素を、文字つきで、作る(innerHTML は、使わない)
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

// ---- 状態 -------------------------------------------------------------
const state = {
  mode: "start",          // "start" | "playing" | "finish"
  phase: "ready",         // 聞く画面の、段階: "ready"(準備。スタートを押すまで、読まない) | "speaking"(読み上げ中) | "judging"(判定待ち) | "revealed"(英文と解説を、表示中)
  progress: loadProgress(),
  catalog: null,          // 目次(stories/index.json): レベル → ストーリー → 節
  openLevels: new Set(),  // 右の列で、開いている、レベルの見出し
  openStories: new Set(), // 右の列で、開いている、ストーリーの見出し("レベル/名前")
  nowStoryKey: "",        // 右の列を、最後に、整えた時の、いまのストーリー(変わったら、いまのストーリーだけを開く)
  sectionCache: new Map(),   // 読み込み済みの、節のデータ(ファイル名 → 中身)
  loading: false,         // 節のファイルを、読み込み中か
  session: null,
  story: null,            // 今回の練習で使っている物語(おわりの画面でも、使う)
  index: 0,               // いまの文の番号(0から)
  judged: 0,              // ここまでに、「わかった / わからない」を、答えた文の数
  stops: new Set(),       // わからなかった文の番号
  runId: 0,               // 古い「読み終わり」の通知を、無視するための札
  utterance: null,        // いま読み上げている物(捨てられないように、持っておく)
  voiceProblem: "",       // 声の問題の、メッセージ(無ければ、空)
  storage: { ok: true, prev: null },   // 記録の保存が、使えるか(ブラウザの中)
  server: false,          // 記録を、ファイル(サーバ)にも、保存できるか(serve.py につながっている時だけ true)
  serverOk: true,         // 最後のファイルへの保存が、成功したか
  pushChain: Promise.resolve(),   // ファイルへの保存を、順番に、行うための、列
  audio: { files: {}, cache: new Map(), el: null },   // 音声ファイル: 目次(audio/manifest.json の files)、読み込み済み(名前 → blob のアドレス)、再生に使う部品(使い回す)
  sync: { config: null, status: "off", message: "", at: null, running: false, again: false, timer: null, lastTry: 0 },   // 記録の同期(GitHub)
};

function loadProgress() {
  try {
    return parseProgress(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return createProgress();
  }
}

// ---- 記録の同期(GitHub の非公開リポジトリ) ---------------------------------------
function loadSyncConfig() {
  try {
    const o = JSON.parse(window.localStorage.getItem(SYNC_KEY));
    if (o && parseRepo(o.repo) && typeof o.token === "string" && o.token) return { repo: o.repo, token: o.token };
  } catch { /* 設定なし */ }
  return null;
}

function storeSyncConfig(cfg) {
  try {
    if (cfg) window.localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
    else window.localStorage.removeItem(SYNC_KEY);
    return true;
  } catch {
    return false;
  }
}

// 同期で、合わせた記録を、この端末に、取り込む(更新時刻は、押し直さない。同期は、もう一度、起こさない)
function adoptRecord(rec) {
  state.progress = rec;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); } catch { /* 保存できなくても、よい */ }
  if (state.server) pushToServer();
}

const pad = (n) => String(n).padStart(2, "0");
const clockOf = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());

const SYNC_MESSAGES = {
  auth: "合鍵が、使えません。期限切れか、権限が、足りない可能性があります(そのリポジトリの、読み書き = Contents の権限が、必要です)。",
  repo: "リポジトリが、見つかりません。名前(所有者/名前)と、合鍵が、そのリポジトリを、対象にしているかを、確かめてください。",
  network: "つながりません。端末の中の記録は、そのままです。あとで、もう一度、試します。",
  conflict: "同時に、書き換えられ続けました。端末の中の記録は、そのままです。あとで、もう一度、試します。",
  data: "同期先のファイルが、記録の形ではありません。上書きは、していません。",
  http: "同期できませんでした。端末の中の記録は、そのままです。",
};

function setSyncStatus(status, message = "") {
  state.sync.status = status;
  state.sync.message = message;
  renderSync();
}

function renderSync() {
  const s = state.sync;
  const cfg = s.config;
  const summary = $("sync-summary");
  const box = $("sync-status");
  $("btn-sync-now").disabled = !cfg || s.running;
  $("btn-sync-off").disabled = !cfg;
  $("btn-sync-save").disabled = s.running;
  $("sync-token").placeholder = cfg ? "(設定ずみ。変える時だけ、入れ直す)" : "";
  if (cfg && document.activeElement !== $("sync-repo")) $("sync-repo").value = cfg.repo;
  if (!cfg) {
    summary.textContent = "同期: オフ(PC と iPhone で、記録を、そろえる)";
    box.textContent = s.message || "同期は、していません。";
    box.className = s.message ? "warn" : "sub";
  } else if (s.status === "syncing") {
    summary.textContent = "同期: 同期中…";
    box.textContent = "同期しています…";
    box.className = "sub";
  } else if (s.status === "error") {
    summary.textContent = "同期: うまくいきませんでした";
    box.textContent = s.message;
    box.className = "warn";
  } else {
    summary.textContent = "同期: オン(" + cfg.repo + (s.at ? "。最後: " + clockOf(s.at) : "") + ")";
    box.textContent = s.at ? "同期しました(" + clockOf(s.at) + ")。" : "同期は、まだ、していません。";
    box.className = "sub";
  }
}

// 同期する(合わせて、違いがあれば、同期先に書く)。練習中は、しない。
async function syncNow() {
  const cfg = state.sync.config;
  if (!cfg || state.mode === "playing") return;
  if (state.sync.running) { state.sync.again = true; return; }
  state.sync.running = true;
  state.sync.lastTry = Date.now();
  setSyncStatus("syncing");
  const snapshot = state.progress;
  try {
    const r = await syncRecords({ repo: parseRepo(cfg.repo), token: cfg.token, local: snapshot, apiBase: SYNC_API });
    if (state.progress !== snapshot || state.mode === "playing") {
      state.sync.again = true;   // 同期している間に、端末の記録が、変わった(または、練習が、始まった)。取り込まずに、あとで、もう一度
    } else if (r.record && !sameProgress(r.record, snapshot)) {
      adoptRecord(r.record);
      if (state.mode === "start" && state.catalog) renderStart();
    }
    state.sync.at = new Date();
    setSyncStatus("ok");
  } catch (e) {
    setSyncStatus("error", SYNC_MESSAGES[e instanceof SyncError ? e.kind : "http"] ?? SYNC_MESSAGES.http);
  } finally {
    state.sync.running = false;
    renderSync();
    if (state.sync.again) { state.sync.again = false; scheduleSync(); }
  }
}

// 記録を保存した後、少し待って、同期する(続けて保存しても、1回に、まとめる)
function scheduleSync() {
  if (!state.sync.config) return;
  clearTimeout(state.sync.timer);
  state.sync.timer = setTimeout(syncNow, 1500);
}

function onSyncSave() {
  const repoText = $("sync-repo").value.trim();
  const tokenText = $("sync-token").value.trim();
  const token = tokenText || (state.sync.config ? state.sync.config.token : "");
  const repo = parseRepo(repoText);
  if (!repo) { setSyncStatus(state.sync.config ? "error" : "off", "リポジトリは、「所有者/名前」の形で、入れてください(例: nickname/english-listening-records)。"); return; }
  if (!token || !/^[\x21-\x7e]+$/.test(token)) { setSyncStatus(state.sync.config ? "error" : "off", "合鍵を、入れてください(空白や、日本語は、入りません)。"); return; }
  const cfg = { repo: repo.owner + "/" + repo.repo, token };
  if (!storeSyncConfig(cfg)) { setSyncStatus("off", "この端末に、設定を、保存できませんでした(ブラウザの設定や、プライベートモードの可能性)。"); return; }
  state.sync.config = cfg;
  $("sync-token").value = "";
  syncNow();
}

function onSyncOff() {
  storeSyncConfig(null);
  state.sync.config = null;
  state.sync.at = null;
  clearTimeout(state.sync.timer);
  $("sync-token").value = "";
  setSyncStatus("off", "同期を、やめました(合鍵を、この端末から、消しました)。端末の中の記録と、同期先の記録は、そのままです。");
}

// 記録を、保存する: ブラウザの中(localStorage)と、サーバにつながっていれば、ファイル(data/progress.json)にも。
function saveProgress() {
  state.progress = { ...state.progress, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch {
    // 保存できなくても、練習は、続けられる
  }
  if (state.server) pushToServer();
  scheduleSync();
}

// いちばん新しい記録を、ファイルへ送る(順番に、1つずつ)
function pushToServer() {
  state.pushChain = state.pushChain.then(async () => {
    try {
      const r = await fetch("api/progress", {
        method: "PUT",
        headers: { "X-EL-App": "1", "Content-Type": "application/json" },
        body: JSON.stringify(state.progress),
      });
      state.serverOk = r.ok;
    } catch {
      state.serverOk = false;
    }
    renderStorageStatus();
  });
}

async function fetchWithTimeout(url, options, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// 起動時: サーバ(ファイル)の記録と、画面(ブラウザの中)の記録を、突き合わせる。
//   サーバにつながっていなければ、何もしない(ブラウザの中だけで、動く)。
async function syncWithServer() {
  // 記録を、ファイルに保存するサーバ(serve.py)は、この PC の中(localhost)だけ。公開の置き場所(GitHub Pages など)では、確かめない
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) { state.server = false; return; }
  try {
    const ping = await fetchWithTimeout("api/ping", {}, 1500);
    const info = await ping.json();
    if (!ping.ok || info.app !== "english-listening") return;
    state.server = true;
    state.serverOk = true;
    const r = await fetchWithTimeout("api/progress", {}, 3000);
    const remote = r.status === 200 ? readProgress(await r.text()) : null;
    const local = state.progress;
    const pick = chooseSource(remote, local);
    if (pick === "remote") {
      state.progress = remote;
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)); } catch { /* 保存できなくても、よい */ }
    } else if (pick === "local") {
      pushToServer();   // はじめての取り込み(ブラウザの中の記録を、ファイルへ)
    }
    // 画面を開いている間、サーバに「使っています」と伝える(画面を閉じると、サーバは、しばらくして、自分で終わる)
    setInterval(() => {
      fetch("api/ping").then((x) => { state.serverOk = x.ok; }).catch(() => { state.serverOk = false; renderStorageStatus(); });
    }, 60000);
  } catch {
    state.server = false;
  }
}

// ---- 物語のデータ(stories/ フォルダ) ------------------------------------------
// 目次(レベル → ストーリー → 節。各節の、ファイル名・文の数・単語数)
async function loadCatalog() {
  const r = await fetchWithTimeout("stories/index.json", {}, 5000);
  if (!r.ok) throw new Error("目次を読み込めません(" + r.status + ")");
  const catalog = await r.json();
  if (!catalog || catalog.version !== 2 || !Array.isArray(catalog.levels) || catalog.levels.length === 0) throw new Error("目次の形が、正しくありません");
  return catalog;
}

// 節のファイルを、1つ読み込む(読み込み済みなら、それを使う)
async function loadSection(file) {
  if (state.sectionCache.has(file)) return state.sectionCache.get(file);
  const r = await fetchWithTimeout("stories/" + file, {}, 8000);
  if (!r.ok) throw new Error(file + " を読み込めません(" + r.status + ")");
  const data = await r.json();
  if (!data || !Array.isArray(data.sentences)) throw new Error(file + " の形が、正しくありません");
  state.sectionCache.set(file, data);
  return data;
}

function setLoadNote(message) {
  const note = $("load-note");
  note.textContent = message;
  note.hidden = !message;
}

function showScreen(name) {
  state.mode = name === "play" ? "playing" : name;
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// ---- 音声 ---------------------------------------------------------------
function hasSpeech() {
  return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
}

const langOf = (v) => (v.lang || "").toLowerCase().replace("_", "-");

function englishVoices() {
  if (!hasSpeech()) return [];
  return window.speechSynthesis.getVoices().filter((v) => langOf(v).startsWith("en"));
}

// 声の優先順: この PC の声(通信しない) > en-US > そのほかの英語
function voiceScore(v) {
  let s = 0;
  if (v.localService) s += 100;
  if (langOf(v) === "en-us") s += 50;
  return s;
}

function voiceCandidates() {
  return englishVoices()
    .map((v, i) => ({ v, i }))
    .sort((a, b) => voiceScore(b.v) - voiceScore(a.v) || a.i - b.i)
    .map((x) => x.v);
}

function updateVoiceNote() {
  const note = $("voice-note");
  if (Object.keys(state.audio.files).length > 0) {   // 録音した音声ファイルを使えるので、声の心配は、いらない
    note.hidden = true;
  } else if (!hasSpeech()) {
    note.textContent = "このブラウザでは、音声の読み上げが、使えません。";
    note.hidden = false;
  } else if (voiceCandidates().length === 0) {
    note.textContent = "英語の声が、まだ見つかっていません(読み込み中かもしれません)。聞こえない時は、ブラウザや、OSの音声の設定を、確かめてください。";
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

// 声の問題を、画面に出す(空なら、消す)
function setVoiceProblem(message) {
  state.voiceProblem = message;
  const note = $("play-note");
  note.textContent = message;
  note.hidden = !message;
}

// 記録の保存が、使えるかを、確かめる(前回の起動の時刻も、読む)
function checkStorage() {
  try {
    const key = "english-listening-lastopen-v1";
    const prev = window.localStorage.getItem(key);
    const d = new Date();
    const stamp = todayString(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    window.localStorage.setItem(key, stamp);
    if (window.localStorage.getItem(key) !== stamp) throw new Error("保存できていない");
    return { ok: true, prev };
  } catch {
    return { ok: false, prev: null };
  }
}

function renderStorageStatus() {
  const s = state.storage;
  const box = $("storage-status");
  if (state.server) {
    if (state.serverOk) {
      box.textContent = "記録の保存: ファイル(data/progress.json)に、保存しています。ブラウザの保存データを消しても、開き方を変えても、更新しても、記録は、残ります(毎日、控えも、残します)。";
      box.className = "sub";
    } else {
      box.textContent = "記録の保存: ファイルに、保存できませんでした(サーバが止まっている可能性)。いまは、ブラウザの中にだけ、保存しています。ショートカットから、開き直してください。";
      box.className = "warn";
    }
    return;
  }
  if (!s.ok) {
    box.textContent = "記録の保存: 使えません(ブラウザの設定や、プライベートモードの可能性があります)。この画面を閉じると、記録は、消えます。";
    box.className = "warn";
  } else if (s.prev) {
    box.textContent = "記録の保存: 使えます(前回の起動: " + s.prev + ")";
    box.className = "sub";
  } else {
    box.textContent = "記録の保存: 使えます(前回の起動の記録は、ありません。はじめてか、ブラウザが保存データを消した可能性があります)";
    box.className = "sub";
  }
}

function cancelSpeech() {
  state.runId++;
  if (state.audio.el) { try { state.audio.el.pause(); } catch { /* 止められなくても、よい */ } }
  if (hasSpeech()) window.speechSynthesis.cancel();
}

// ---- 録音した音声ファイル(audio/)の、再生 ----
// 目次を読む(無ければ、音声ファイルは、使わない)
async function loadAudioManifest() {
  try {
    const r = await fetchWithTimeout("audio/manifest.json", {}, 3000);
    if (!r.ok) return;
    const m = await r.json();
    if (m && m.files && typeof m.files === "object") state.audio.files = m.files;
  } catch { /* 音声ファイルは、使わない(読み上げに、なる) */ }
}

// 今回の文の音声を、先に、全部、読み込んでおく(読み込めない文は、読み上げに、なる)。読み込み済みは、使い回す。
async function prepareAudio(sentences) {
  const cache = state.audio.cache;
  await Promise.all(sentences.map(async (s) => {
    if (!s.audio || !state.audio.files[s.audio] || cache.has(s.audio)) return;
    try {
      const r = await fetchWithTimeout("audio/" + s.audio, {}, 8000);
      if (!r.ok) return;
      cache.set(s.audio, URL.createObjectURL(await r.blob()));
    } catch { /* この文は、読み上げに、なる */ }
  }));
  while (cache.size > 80) {   // 古い物から、捨てる
    const oldest = cache.keys().next().value;
    URL.revokeObjectURL(cache.get(oldest));
    cache.delete(oldest);
  }
}

function audioElement() {
  if (!state.audio.el) {
    const el = new Audio();
    el.preload = "auto";
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
    state.audio.el = el;   // iPhone では、最初に、画面を触った時に、鳴らした部品でないと、あとから、鳴らせない。使い回す
  }
  return state.audio.el;
}

// 音声ファイルを、再生する。終わったら onDone。鳴らせない時(エラー / 始まらない)は onFail(読み上げに、切り替える)。
function playAudio(url, rate, onFail, onDone) {
  const run = ++state.runId;
  const el = audioElement();
  let done = false;
  let timer = null;
  const detach = () => { clearTimeout(timer); el.onended = null; el.onerror = null; el.onplaying = null; };
  const finish = () => { if (done || run !== state.runId) return; done = true; detach(); setVoiceProblem(""); onDone(); };
  const fail = () => { if (done || run !== state.runId) return; done = true; detach(); try { el.pause(); } catch { /* よい */ } onFail(); };
  el.onended = finish;
  el.onerror = fail;
  el.onplaying = () => {
    clearTimeout(timer);   // 鳴り始めた。終わりの通知が来ない時のための、見張り
    const sec = Number.isFinite(el.duration) ? el.duration : 10;
    timer = setTimeout(() => { if (!done && run === state.runId) { try { el.pause(); } catch { /* よい */ } finish(); } }, (sec / Math.max(rate, 0.3)) * 1000 + END_GRACE_MS);
  };
  el.src = url;
  el.defaultPlaybackRate = rate;
  el.playbackRate = rate;
  timer = setTimeout(fail, START_TIMEOUT_MS);   // 始まらない
  const p = el.play();
  if (p && typeof p.catch === "function") p.catch(fail);
}

// 1文を、読む: 録音した音声が、あれば、それ。無い / 鳴らせない時は、読み上げ。
function speakSentence(sentence, rate, onDone) {
  const url = sentence.audio ? state.audio.cache.get(sentence.audio) : null;
  if (url) playAudio(url, rate, () => speak(sentence.text, rate, onDone), onDone);
  else speak(sentence.text, rate, onDone);
}

// 1文を読む。読み終わったら onDone を呼ぶ(途中で止められた時は、呼ばない)。
//   声が黙った時(始まらない / エラー / 終わりの通知が来ない)は、別の声で、やり直す(最大3つの声まで)。
//   それでもだめなら、理由を画面に出して、onDone を呼ぶ(「もう一度聞く」で、もう一度、試せる)。
function speak(text, rate, onDone) {
  if (!hasSpeech()) { onDone(); return; }
  const run = ++state.runId;
  const candidates = voiceCandidates();
  const maxAttempts = Math.max(1, Math.min(candidates.length, 3));
  const words = text.split(/\s+/).length;
  const expectedMs = (words / (150 * Math.max(rate, 0.3))) * 60000;
  let attempt = 0;
  let done = false;
  let timer = null;
  let current = null;

  const detach = () => {
    clearTimeout(timer);
    if (current) { current.onstart = null; current.onend = null; current.onerror = null; }
  };
  const finish = (problem) => {
    if (done || run !== state.runId) return;
    done = true;
    detach();
    setVoiceProblem(problem || "");
    onDone();
  };
  const retryOrGiveUp = (why) => {
    if (done || run !== state.runId) return;
    detach();
    window.speechSynthesis.cancel();   // 古い読み上げを止める(その通知は、上の detach で、無視される)
    attempt++;
    if (attempt < maxAttempts) attemptSpeak();
    else finish(why + "。音の出力先(Bluetooth など)と、インターネットの接続を、確かめて、「もう一度聞く」を、試してください。");
  };
  const attemptSpeak = () => {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = rate;
    const voice = candidates[attempt];
    if (voice) u.voice = voice;
    current = u;
    state.utterance = u;   // 読み上げの途中で、ブラウザに捨てられないように、持っておく
    u.onstart = () => {
      clearTimeout(timer);
      // 読み始めたのに、終わりの通知が来ない時のための、見張り
      timer = setTimeout(() => {
        if (done || run !== state.runId) return;
        window.speechSynthesis.cancel();
        finish("読み上げの終わりの通知が、来ませんでした(先へ進みます)");
      }, expectedMs + END_GRACE_MS);
    };
    u.onend = () => finish("");
    u.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;   // 自分で止めた時の通知は、無視する
      retryOrGiveUp("声を出せませんでした(" + e.error + ")");
    };
    if (window.speechSynthesis.resume) window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
    timer = setTimeout(() => retryOrGiveUp("声が、始まりませんでした"), START_TIMEOUT_MS);
  };
  attemptSpeak();
}

// ---- はじめの画面 -------------------------------------------------------
// いまの位置(レベル・ストーリー・節)。起動時に、目次に合わせて、正しい形にしてある。
function position() {
  const p = state.progress;
  return { level: p.level, storyName: p.storyName, sceneIndex: p.sceneIndex };
}

function currentStory() {
  return findStory(state.catalog, state.progress.level, state.progress.storyName);
}

// 「次の節にする」ボタン(表紙): 節の数ぶん、先の、次のまとまりに進む(範囲が、重ならない)。
//   並びは、右の列と同じ(レベル → ストーリー → 節)。物語の終わりを越える時は、次の物語の、最初の節。
//   ボタンの文字には、進み先の、番号を、見せる(節の数が2以上なら、範囲)。
// 1回の練習は、常に、1節。速さは、表紙の速度ボタンで選んだ物
function planOf(pos) {
  return planSession(state.catalog, pos, { sectionCount: DEFAULT_SECTION_COUNT, rate: state.progress.rate });
}

// ボタンに出す、範囲の文字: 1節なら「番号  題名」、2節以上なら「番号 〜 番号」
function blockLabel(plan) {
  return plan.sections.length > 1 ? rangeLabel(plan) : plan.sections[0].code + "  " + plan.sections[0].title;
}

// おわりの画面の「次の節に進む」: いまの位置(聞いた直後に、自動の判定で、決まった次の位置)から、そのまま、次の練習へ
function continueLabel() {
  return "次の節に進む(" + blockLabel(planOf(position())) + ")";
}

function renderStart() {
  showScreen("start");
  const p = state.progress;
  const plan = planOf(position());
  const story = plan.story;
  const sentenceCount = plan.sections.reduce((n, sec) => n + sec.sentences, 0);
  const info = $("start-info");
  info.replaceChildren(
    el("div", "ストーリー: " + pad2(p.level) + "-" + pad2(story.no) + " " + story.title + "(" + story.titleJa + ")"),
    el("div", story.summaryJa, "sub"),
    ...(story.credit ? [el("div", story.credit, "sub")] : []),
    el("div", "レベル: " + p.level + "(この物語の、レベル)"),
    el("div", "今回の長さ: 約" + formatSeconds(plan.estimatedSeconds) + "、" + sentenceCount + " 文(" + plan.sections.length + "節)"),
    el("div", "今回の範囲: " + rangeLabel(plan), "sub"),
  );
  renderSpeed();
  renderHistory();
  renderLevelList();
  updateVoiceNote();
  renderStorageStatus();
  renderSync();
}

// 読む速さのボタン(0.5 / 0.8 / 1.0 / 1.2 / 1.5倍)。選んでいる物を、目立たせる
function renderSpeed() {
  for (const b of document.querySelectorAll(".speed-btn")) {
    const on = Number(b.dataset.rate) === state.progress.rate;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function setSpeed(rate) {
  if (state.mode !== "start" || !SPEEDS.includes(rate) || rate === state.progress.rate) return;
  state.progress = { ...state.progress, rate };
  saveProgress();
  renderStart();
}

// 右の列: レベル → ストーリー → 節 の順に、並べる。節を押すと、そのレベル・ストーリー・節から、始まる。
//   レベルの見出しは、折りたたみ式(いまのレベルだけ、開いておく)。
function renderLevelList() {
  const pos = position();
  const box = $("level-list");
  box.replaceChildren();
  const nowKey = pos.level + "/" + pos.storyName;
  if (state.nowStoryKey !== nowKey) {   // いまのストーリーが、変わったら、それ以外は、たたむ
    state.nowStoryKey = nowKey;
    state.openStories = new Set([nowKey]);
    state.openLevels.add(pos.level);
  }
  for (const lv of state.catalog.levels) {
    const group = document.createElement("details");
    group.className = "level-group";
    group.open = state.openLevels.has(lv.level);
    const summary = document.createElement("summary");
    let levelAllGood = lv.stories.length > 0;   // そのレベルの、全部の節が、緑か
    summary.textContent = "レベル " + pad2(lv.level) + "(" + lv.stories.length + " ストーリー)" + (lv.level === pos.level ? "  ← いま" : "");
    group.appendChild(summary);
    for (const st of lv.stories) {
      const isNowStory = lv.level === pos.level && st.name === pos.storyName;
      const storyKey = lv.level + "/" + st.name;
      const secs = flattenSections(st, lv.level);
      const storyAllGood = secs.length > 0 && secs.every((x) => isGoodSection(state.progress.sectionStats ? state.progress.sectionStats[x.code] : undefined));
      if (!storyAllGood) levelAllGood = false;
      const storyBox = document.createElement("details");
      storyBox.className = "story-group";
      storyBox.open = state.openStories.has(storyKey);
      storyBox.appendChild(el("summary", pad2(lv.level) + "-" + pad2(st.no) + "  " + st.name + "  " + st.title + "(" + st.titleJa + ")" + (isNowStory ? "  ← いま" : ""), (isNowStory ? "story-head now" : "story-head") + (storyAllGood ? " all-good" : "")));
      storyBox.addEventListener("toggle", () => {
        if (storyBox.open) state.openStories.add(storyKey);
        else state.openStories.delete(storyKey);
      });
      const list = el("div", undefined, "sec-list");
      for (const sec of secs) {
        const isNow = isNowStory && sec.index === pos.sceneIndex;
        const stat = state.progress.sectionStats ? state.progress.sectionStats[sec.code] : undefined;
        const good = isGoodSection(stat);   // 前回、その節を最後まで答えた時の、わからなかった文が、20% 以下
        const b = el("button", undefined, (isNow ? "chapter now" : "chapter") + (good ? " good" : ""));
        b.type = "button";
        if (stat) b.title = "前回(" + stat.date + "): わからなかった文 " + stat.stops + "/" + stat.sentences + "(" + Math.round((stat.stops / stat.sentences) * 100) + "%)";
        b.appendChild(el("span", sec.code, "no"));
        b.appendChild(el("span", sec.title, "ttl"));
        b.appendChild(document.createTextNode("  約" + formatSeconds(sectionSeconds(sec, state.progress.rate))));
        if (isNow) b.appendChild(el("span", "← ここから", "tag"));
        b.addEventListener("click", () => selectPosition(lv.level, st.name, sec.index));
        list.appendChild(b);
      }
      storyBox.appendChild(list);
      group.appendChild(storyBox);
    }
    if (levelAllGood) summary.classList.add("all-good");
    group.addEventListener("toggle", () => {
      if (group.open) state.openLevels.add(lv.level);
      else state.openLevels.delete(lv.level);
    });
    box.appendChild(group);
  }
}

// 右の列で選ぶ(次の練習の、レベル・ストーリー・節を、まとめて決める)
function selectPosition(level, storyName, index) {
  if (state.mode !== "start") return;
  state.openLevels.add(level);
  state.progress = { ...state.progress, level, storyName, sceneIndex: index };
  saveProgress();
  renderStart();
}

// これまでの記録: 1回の練習ごとに、1行(同じ日に、何回練習しても、1回ごとに、行が、増える)。新しい練習が、上。
const HISTORY_ROWS = 40;

function renderHistory() {
  const box = $("history");
  const rows = groupHistory(state.progress.history).slice(0, HISTORY_ROWS);   // 日付 × ストーリーごとに、1行(新しい順)
  if (rows.length === 0) {
    box.replaceChildren(el("div", "まだ、記録がありません。", "sub"));
    return;
  }
  const table = el("table");
  const head = el("tr");
  for (const h of ["日付", "物語", "範囲", "レベル", "回数", "わからなかった文", "状態"]) head.appendChild(el("th", h));
  table.appendChild(head);
  for (const h of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", h.date));
    tr.appendChild(el("td", h.story || "-"));
    tr.appendChild(el("td", h.range));
    tr.appendChild(el("td", String(h.level)));
    tr.appendChild(el("td", h.count + "回"));
    const rate = h.sentences === 0 ? 0 : h.stops / h.sentences;
    const cell = el("td");
    const bar = el("span", undefined, "bar");
    bar.style.width = Math.round(rate * 60) + "px";
    cell.appendChild(bar);
    cell.appendChild(document.createTextNode(Math.round(rate * 100) + "%(" + h.stops + "/" + h.sentences + ")"));
    tr.appendChild(cell);
    tr.appendChild(el("td", h.status === "all" ? "最後まで" : h.status === "none" ? "途中でやめた" : "途中でやめた分あり"));
    table.appendChild(tr);
  }
  const wrap = el("div", undefined, "table-wrap");
  wrap.appendChild(table);
  box.replaceChildren(wrap);
}

// 今回の練習で、最後まで答え終えた節の結果を、記録(節ごとの結果の表)に、足す
function withSectionStats(progress) {
  const results = sectionResults(state.session.sentences, state.judged, state.stops);
  if (results.length === 0) return progress;
  return { ...progress, sectionStats: updateSectionStats(progress.sectionStats, results, todayString()) };
}

// 記録に残す、時刻
function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// ---- 練習の流れ(1文ごとに、止まる) ------------------------------------------
//   聞き始める → 必要な節のファイルだけを、読み込む → 準備の画面(スタートを押すと、読み出す)
//   1文を読む → 止まって、「わかった / わからない」を、答える
//     わかった   → 次の文へ
//     わからない → その下に、英文と日本語訳と解説が出る → 「次へ」で、次の文へ
async function startSession() {
  if (state.loading || (state.mode !== "start" && state.mode !== "finish")) return;
  state.loading = true;
  $("btn-start").disabled = true;
  $("btn-continue").disabled = true;
  setLoadNote("");
  const plan = planOf(position());
  const story = plan.story;
  try {
    // 今回の範囲の節だけを、読み込む(読み込み済みの節は、使い回す)
    const loaded = await Promise.all(plan.sections.map((sec) => loadSection(sec.file)));
    state.story = story;
    state.session = assembleSession(plan, loaded);
    await prepareAudio(state.session.sentences);
    state.index = 0;
    state.judged = 0;
    state.stops = new Set();
    setVoiceProblem("");
    showScreen("play");
    setPhase("ready");   // まだ、読み出さない。左上の「スタート」を、押すと、1文目が、読まれる
  } catch (e) {
    if (state.mode === "finish") renderStart();   // おわりの画面からの時は、表紙に戻って、知らせる
    setLoadNote("物語のデータを、読み込めませんでした(" + e.message + ")。サーバが止まっている可能性があります。ショートカットから、開き直してください。");
  } finally {
    state.loading = false;
    $("btn-start").disabled = false;
    $("btn-continue").disabled = false;
  }
}

// 左上の「スタート」(Enter): 1文目を、読み出す
function onGo() {
  if (state.mode !== "playing" || state.phase !== "ready") return;
  playFrom(0);
}

// 画面を、いまの段階に、合わせる
function setPhase(phase) {
  state.phase = phase;
  const s = state.session;
  const sentence = s.sentences[state.index];
  const label = (state.index + 1) + " / " + s.sentences.length + "(" + sentence.sectionCode + ")";
  const head = phase === "ready" ? "準備ができました。スタートを押すと、1文目が読まれます(全 " + s.sentences.length + " 文・" + rangeLabel(s) + ")" :
    phase === "speaking" ? "聞いています… " + label : phase === "judging" ? "わかりましたか? " + label : "解説 " + label;
  $("play-status").textContent = head;
  $("play-meter").style.width = Math.round((state.index / s.sentences.length) * 100) + "%";
  $("btn-go").hidden = phase !== "ready";               // 左上の「スタート」は、準備の時だけ
  $("judge-row").hidden = phase === "revealed";
  $("btn-understood").disabled = phase !== "judging";   // 「わかった」は、読み終わってから
  $("btn-not").disabled = phase === "revealed" || phase === "ready";   // 「わからない」は、読んでいる途中でも、押せる(準備中は、押せない)
  $("btn-repeat").disabled = phase === "ready";
  $("btn-repeat-reveal").disabled = phase === "ready";
  $("btn-slow").disabled = phase === "ready";
  $("btn-back").disabled = phase === "ready" || state.index === 0;   // 「前の文に戻る」は、2文目から
  $("reveal").hidden = phase !== "revealed";
}

function playFrom(index) {
  const s = state.session;
  if (index >= s.sentences.length) {
    finishSession();
    return;
  }
  state.index = index;
  setPhase("speaking");
  speakSentence(s.sentences[index], s.rate, () => setPhase("judging"));
}

function onUnderstood() {
  if (state.mode !== "playing" || state.phase !== "judging") return;
  cancelSpeech();
  state.judged++;
  playFrom(state.index + 1);
}

function onNotUnderstood() {
  if (state.mode !== "playing" || state.phase === "revealed" || state.phase === "ready") return;
  cancelSpeech();
  state.judged++;
  state.stops.add(state.index);
  const sentence = state.session.sentences[state.index];
  $("reveal-text").textContent = sentence.text;
  $("reveal-ja").textContent = sentence.ja ? "日本語: " + sentence.ja : "";
  $("reveal-note").textContent = "解説: " + sentence.note;
  setPhase("revealed");
}

function onNext() {
  if (state.mode !== "playing" || state.phase !== "revealed") return;
  cancelSpeech();
  playFrom(state.index + 1);
}

// いまの文を、もう一度読む(factor = ふつうの速さに、かける倍率)
function replay(factor) {
  if (state.mode !== "playing" || state.phase === "ready") return;
  cancelSpeech();
  const rate = Math.max(MIN_RATE, state.session.rate * factor);
  const sentence = state.session.sentences[state.index];
  if (state.phase === "revealed") {
    speakSentence(sentence, rate, () => {});          // 解説を見ながら、聞き直す(画面は、そのまま)
  } else {
    setPhase("speaking");
    speakSentence(sentence, rate, () => setPhase("judging"));
  }
}

// 前の文に戻る: ひとつ前の文から、やり直す。その文と、それ以降の答え(わかった / わからない)は、取り消す(数え直す)
function onBack() {
  if (state.mode !== "playing" || state.phase === "ready" || state.index === 0) return;
  cancelSpeech();
  const target = state.index - 1;
  state.judged = target;
  state.stops = new Set([...state.stops].filter((i) => i < target));
  playFrom(target);
}

const onRepeat = () => replay(1);
const onSlow = () => replay(SLOW_FACTOR);

function onQuit() {
  if (state.mode !== "playing") return;
  cancelSpeech();
  if (state.judged > 0) {
    const p = state.progress;
    const record = {
      date: todayString(), time: nowTime(), story: state.story.title, range: rangeKey(state.session),
      level: p.level, sectionCount: state.session.sections.length,
      sentences: state.judged, stops: state.stops.size, completed: false,
    };
    state.progress = withSectionStats(recordSession(p, record, null));
    saveProgress();
  }
  renderStart();
}

function finishSession() {
  cancelSpeech();
  const s = state.session;
  const p = state.progress;
  const result = { sentences: s.sentences.length, stops: state.stops.size, completed: true };
  const record = {
    date: todayString(), time: nowTime(), story: state.story.title, range: rangeKey(s),
    level: p.level, sectionCount: s.sections.length, ...result,
  };
  // 次の位置: 右の列の並びで、聞いた節の、すぐ後ろ(表紙の「次の節にする」と、同じ)。レベルは、進んだ先で、決まる
  const place = positionAfterSession(state.catalog, s);
  state.progress = withSectionStats(recordSession(p, record, place));
  let storyNote = "";
  if (s.storyEnded) {
    const n = findStory(state.catalog, place.level, place.storyName);
    storyNote = "この物語は、ここまでです。次の回は、新しい物語「" + n.title + "」(" + n.titleJa + ")です。";
    if (place.level !== p.level) storyNote += "レベルは、" + place.level + " になります。";
  }
  saveProgress();
  $("finish-story").textContent = storyNote;

  showScreen("finish");
  $("btn-continue").textContent = continueLabel();
  $("btn-again").textContent = "同じ節を繰り返す(" + blockLabel(s) + ")";
  const percent = Math.round((result.stops / result.sentences) * 100);
  $("finish-stats").textContent = result.sentences + " 文のうち、わからなかった文: " + result.stops + "(" + percent + "%)";

  const unclear = $("finish-unclear");
  unclear.replaceChildren();
  const list = [...state.stops].sort((a, b) => a - b);
  if (list.length === 0) unclear.appendChild(el("div", "ありませんでした。", "sub"));
  for (const i of list) {
    unclear.appendChild(el("p", s.sentences[i].text, ""));
    if (s.sentences[i].ja) unclear.appendChild(el("div", "日本語: " + s.sentences[i].ja, "ja"));
    unclear.appendChild(el("div", "解説: " + s.sentences[i].note, "note"));
  }

  const all = $("finish-all");
  all.replaceChildren();
  for (let i = 0; i < s.sentences.length; i++) {
    all.appendChild(el("p", s.sentences[i].text, state.stops.has(i) ? "hit" : ""));
  }
}

// ---- 操作の、つなぎ込み -------------------------------------------------
$("btn-start").addEventListener("click", startSession);
$("btn-sync-save").addEventListener("click", onSyncSave);
$("btn-sync-now").addEventListener("click", syncNow);
$("btn-sync-off").addEventListener("click", onSyncOff);
// 画面に戻った時・ネットが戻った時に、同期する(30秒以内の、くり返しは、しない)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.sync.config && Date.now() - state.sync.lastTry > 30000) syncNow();
});
window.addEventListener("online", () => { if (state.sync.config) syncNow(); });
$("btn-go").addEventListener("click", onGo);
$("btn-understood").addEventListener("click", onUnderstood);
$("btn-not").addEventListener("click", onNotUnderstood);
$("btn-next").addEventListener("click", onNext);
$("btn-repeat").addEventListener("click", onRepeat);
$("btn-repeat-reveal").addEventListener("click", onRepeat);
$("btn-slow").addEventListener("click", onSlow);
$("btn-back").addEventListener("click", onBack);
$("btn-quit-play").addEventListener("click", onQuit);
for (const b of document.querySelectorAll(".speed-btn")) b.addEventListener("click", () => setSpeed(Number(b.dataset.rate)));
// 同じ節を繰り返す: いま聞き終えた節を、もう一度、はじめから(位置は、すでに、次の節に進んでいる。繰り返しても、同じ「次」になる)
function repeatSection() {
  if (state.mode !== "finish" || !state.session) return;
  state.index = 0;
  state.judged = 0;
  state.stops = new Set();
  setVoiceProblem("");
  showScreen("play");
  setPhase("ready");
}

// 表紙(はじめの画面)に戻る。次の回の設定は、自動の判定(おすすめ)のまま
$("btn-cover").addEventListener("click", () => { if (state.mode === "finish") renderStart(); });
$("btn-continue").addEventListener("click", () => { if (state.mode === "finish") startSession(); });
$("btn-again").addEventListener("click", repeatSection);

// キー: Enter = スタート(準備の画面)/ わかった / 次へ(解説の画面) ・ Space = わからない ・ R = もう一度 ・ S = ゆっくり
document.addEventListener("keydown", (e) => {
  if (e.repeat || state.mode !== "playing") return;
  if (e.code === "Enter") {
    e.preventDefault();
    if (state.phase === "ready") onGo();
    else if (state.phase === "judging") onUnderstood();
    else if (state.phase === "revealed") onNext();
  } else if (e.code === "Space") {
    e.preventDefault();
    onNotUnderstood();
  } else if (e.code === "KeyR") {
    onRepeat();
  } else if (e.code === "KeyS") {
    onSlow();
  }
});

if (hasSpeech()) {
  window.speechSynthesis.addEventListener("voiceschanged", updateVoiceNote);
}

// Web 版(manifest がある版)は、安全な接続(https、または、localhost)で、オフラインでも開けるように、sw.js を、登録する。この PC の版は、しない。
if ("serviceWorker" in navigator && window.isSecureContext && document.querySelector('link[rel="manifest"]')) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 登録できなくても、アプリは、動く */ });
}

// 起動: ブラウザの中の保存を確かめて、サーバがあれば、ファイルの記録と、突き合わせる。物語の目次を、読んでから、表紙を出す。
(async function main() {
  state.storage = checkStorage();
  await Promise.race([syncWithServer(), new Promise((resolve) => setTimeout(resolve, 4000))]);
  await loadAudioManifest();
  state.sync.config = loadSyncConfig();
  renderSync();
  if (state.sync.config) await Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, 4000))]);   // 開いた時に、同期(4秒で、待つのをやめる)
  try {
    state.catalog = await loadCatalog();
  } catch (e) {
    $("start-info").textContent = "物語のデータを、読み込めませんでした(" + e.message + ")。ファイルとして開いている場合は、ショートカット(英語リスニング.lnk)から、開いてください。";
    $("btn-start").disabled = true;
    renderStorageStatus();
    return;
  }
  // 記録の位置(レベル・物語・節)を、目次に合わせる(以前の記録の変換や、目次に無い物の修正)
  const pos = resolvePosition(state.catalog, state.progress);
  if (pos.level !== state.progress.level || pos.storyName !== state.progress.storyName || pos.sceneIndex !== state.progress.sceneIndex) {
    state.progress = { ...state.progress, level: pos.level, storyName: pos.storyName, sceneIndex: pos.sceneIndex };
    if (hasProgressData(state.progress)) saveProgress();
  }
  state.openLevels.add(state.progress.level);
  renderStart();
})();
