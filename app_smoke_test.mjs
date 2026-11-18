// app_smoke_test.mjs — 本物の画面(ヘッドレス Edge)で、練習の流れを、通しで確かめる試験。
//   speechSynthesis(声)だけを、偽物に差し替える(本物の声は、人が聞いて確かめる)。
//   使う物: Node 22 以上(WebSocket, fetch)、Edge。ポートは 8791(静的サーバ)と 9341(Edge の遠隔操作)。
//   実行: node app_smoke_test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadCatalog, sessionOf, sectionSentences, JA } from "./test_data.mjs";
import { todayString, READING_RATE, sectionCode, findStory, planSession } from "./logic.mjs";

// 物語のデータ(stories/ フォルダ: 目次と、節ごとのファイル)。「何文目が、何か」を、確かめるのに、使う。
const CATALOG = loadCatalog();
const titleOf = (level, name) => findStory(CATALOG, level, name).title;
const SLOW_RATE = READING_RATE * 0.75;   // 「ゆっくり聞く」の速さ

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = 8791;
// 試験の対象: 既定 = 簡易サーバ(node)経由の index.html(記録は、ブラウザの中だけ)
//   TARGET=app = 本物のサーバ(serve.py。記録を、ファイルに保存)経由。記録の保存先は、一時フォルダ(本物の記録には、触れない)
const TARGET = process.env.TARGET === "app" ? "app" : "server";
const SERVER_MODE = TARGET === "app";   // 記録を、ファイルにも、保存する形
const PAGE_URL = "http://127.0.0.1:" + HTTP_PORT + "/";
console.log("試験の対象: " + (SERVER_MODE ? "index.html(serve.py 経由。記録は、ファイルに保存)" : "index.html(簡易サーバ経由)") + "  " + PAGE_URL);
const CDP_PORT = 9341;
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

const DATA_DIR = SERVER_MODE ? fs.mkdtempSync(path.join(os.tmpdir(), "el_appdata_")) : null;
const DATA_FILE = DATA_DIR ? path.join(DATA_DIR, "progress.json") : null;
let pyServer = null;

// ---- 偽の GitHub(Contents API の、読む・書くだけ。/__gh/ の下。同期の試験用。本物の GitHub には、つながない) ----
const GH_TOKEN = "ghp_SMOKETEST_0123456789";
const gh = { token: GH_TOKEN, repoExists: true, file: null, sha: null, mode: "ok", requests: [], puts: 0 };
const ghSha = (text) => createHash("sha1").update(text).digest("hex");
function fakeGitHub(req, res, body) {
  const u = new URL(req.url, "http://x");
  gh.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || "", body });
  if (gh.mode === "drop") { res.destroy(); return; }
  const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== "Bearer " + gh.token) return send(401, { message: "Bad credentials" });
  const m = /^\/__gh\/repos\/([^/]+)\/([^/]+)(\/contents\/progress\.json)?$/.exec(u.pathname);
  if (!m || !gh.repoExists || m[1] !== "someone" || m[2] !== "records") return send(404, { message: "Not Found" });
  if (!m[3]) return send(200, { full_name: "someone/records", private: true });
  if (req.method === "GET") {
    if (gh.file === null) return send(404, { message: "Not Found" });
    return send(200, { encoding: "base64", content: Buffer.from(gh.file, "utf8").toString("base64"), sha: gh.sha });
  }
  if (req.method === "PUT") {
    const b = JSON.parse(body);
    if (gh.file !== null && b.sha !== gh.sha) return send(409, { message: "does not match" });
    gh.puts++;
    gh.file = Buffer.from(b.content, "base64").toString("utf8");
    gh.sha = ghSha(gh.file);
    return send(200, { content: { sha: gh.sha } });
  }
  return send(405, {});
}

// ---- 静的サーバ(このフォルダの、読み取りだけ) ----
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/__gh/")) {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => fakeGitHub(req, res, body));
    return;
  }
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(ROOT, name === "/" ? "index.html" : name);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(fs.readFileSync(file));
});
if (SERVER_MODE) {
  pyServer = spawn(process.env.PYTHON || "python", [path.join(ROOT, "serve.py"), String(HTTP_PORT)], {
    env: { ...process.env, EL_DATA_DIR: DATA_DIR, EL_IDLE_EXIT_SEC: "0", PYTHONIOENCODING: "utf-8" }, stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch("http://127.0.0.1:" + HTTP_PORT + "/api/ping")).ok) break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
} else {
  await new Promise((r) => server.listen(HTTP_PORT, "127.0.0.1", r));
}

// ---- Edge を起動 ----
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "el_smoke_"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });

const failures = [];
const check = (name, cond, detail = "") => {
  console.log((cond ? "OK " : "NG ") + name + (cond ? "" : "  <- " + detail));
  if (!cond) failures.push(name);
};

async function cleanup() {
  try { execSync("taskkill /PID " + edge.pid + " /T /F", { stdio: "ignore" }); } catch {}
  if (pyServer) { try { pyServer.kill(); } catch {} } else { server.close(); }
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  if (DATA_DIR) { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {} }
}

try {
  // Edge の準備を待つ
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try { targets = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json")).json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!targets) throw new Error("Edge に、つながりません");
  const page = targets.find((t) => t.type === "page");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  const storyRequests = [];   // 画面が、読み込んだ、stories/ のファイル名(目次と、節のファイル)
  const audioRequests = [];   // 画面が、読み込もうとした、audio/ のファイル名
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Network.requestWillBeSent" && /\/stories\//.test(d.params.request.url)) storyRequests.push(d.params.request.url.split("/").pop());
    if (d.method === "Network.requestWillBeSent" && /\/audio\//.test(d.params.request.url)) audioRequests.push(d.params.request.url.split("/").pop());
    if (d.method === "Runtime.exceptionThrown") {
      const ex = d.params.exceptionDetails;
      pageErrors.push((ex.exception && ex.exception.description ? ex.exception.description : ex.text).split("\n")[0]);
    }
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      pageErrors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error("評価エラー: " + expression + " → " + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const waitFor = async (expression, what, timeoutMs = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("時間切れ: " + what);
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["*/audio/*"] });   // 音声ファイルは、既定では、使わない(読み上げで、試験する)。使う試験(AU)だけ、ふさぎを外す
  const setWidth = (width) => send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await setWidth(1200);   // ふつうのパソコンの、広さ

  // 偽の speechSynthesis(5ミリ秒で「読み終わり」を通知する。cancel は、中断の通知を出す)
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__audioPlays = [];
      // 偽の音声再生: 再生の記録を、取って、1ミリ秒で「鳴り始め」、6ミリ秒で「終わり」を通知する(__audioFail = 再生できない / __audioHold = 終わらない)
      HTMLMediaElement.prototype.play = function () {
        window.__audioPlays.push({ src: this.src, rate: this.playbackRate });
        if (window.__audioFail) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
        const el = this;
        setTimeout(() => el.dispatchEvent(new Event("playing")), 1);
        if (!window.__audioHold) setTimeout(() => el.dispatchEvent(new Event("ended")), 6);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {};
      window.__spoken = [];
      window.__EL_GITHUB_API__ = "/__gh";
      class FakeUtterance { constructor(t) { this.text = t; } }
      // 英語の声が2つ(この PC の声 B と、オンラインの声 A)。優先順は、B(通信しない声)が、先。
      const VOICES = [{ lang: "en-US", name: "Fake A", localService: false }, { lang: "en-GB", name: "Fake B", localService: true }];
      let current = null;
      const fake = {
        speak(u) {
          window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice ? u.voice.name : null });
          current = u;
          // 声が、エラーで黙る(__failWith にエラー名を入れる)
          if (window.__failWith) { setTimeout(() => { if (current === u) { current = null; u.onerror && u.onerror({ error: window.__failWith }); } }, 1); return; }
          // 声が、始まりも、終わりもしない(__noStart)
          if (window.__noStart) return;
          setTimeout(() => { if (current === u) u.onstart && u.onstart({}); }, 1);
          if (!window.__hold) setTimeout(() => { if (current === u) { current = null; u.onend && u.onend({}); } }, 5);
        },
        cancel() { if (current) { const u = current; current = null; u.onerror && u.onerror({ error: "interrupted" }); } },
        resume() {},
        getVoices() { return VOICES; },
        addEventListener() {},
      };
      Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
    `,
  });

  const load = async () => {
    await send("Page.navigate", { url: PAGE_URL });
    await waitFor(`document.readyState === "complete" && document.getElementById("start-info") && document.getElementById("start-info").textContent.length > 0`, "画面の読み込み");
  };
  const visible = (name) => ev(`!document.getElementById("screen-${name}").hidden`);
  const text = (id) => ev(`document.getElementById("${id}").textContent`);
  const key = (code) => ev(`document.dispatchEvent(new KeyboardEvent("keydown", { code: "${code}", bubbles: true })); true`);
  const click = (id) => ev(`document.getElementById("${id}").click(); true`);
  const stored = async () => JSON.parse(await ev(`window.localStorage.getItem("english-listening-progress-v1")`));

  // 記録の、初期化と、設定(サーバ版では、ファイルにも、同じことをする)
  const KEY = "english-listening-progress-v1";
  // サーバ版: 直前の操作の「ファイルへの保存」が、飛行中だと、初期化のあとに、古い記録が、書き戻される。先に、少し、待つ。
  const settle = async () => { if (DATA_FILE) await new Promise((r) => setTimeout(r, 300)); };
  const resetStorage = async () => { await settle(); await ev(`window.localStorage.clear(); true`); if (DATA_FILE) fs.rmSync(DATA_FILE, { force: true }); };
  const setRawProgress = async (text) => { await settle(); await ev(`window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(text)}); true`); if (DATA_FILE) fs.rmSync(DATA_FILE, { force: true }); };
  const setProgress = async (obj) => {
    await settle();
    await ev(`window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(obj))}); true`);
    if (DATA_FILE) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(obj)); }
  };

  const BASE = { version: 1, level: 1, storyName: "ken", sceneIndex: 0, history: [] };   // 主な流れの試験の、はじめの記録(1回の練習は、常に、1節 = 5文)
  const FIRST = sessionOf(1, "ken", 0, 1, CATALOG);   // 最初の練習(レベル1・ケン・01-01-01 の、1節)で、読まれる文
  const first = FIRST.sentences;
  const N = first.length;
  const startInfo = () => text("start-info");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const spokenCount = () => ev(`window.__spoken.length`);
  const lastSpoken = () => ev(`window.__spoken.at(-1)`);
  const btn = (id) => ev(`(() => { const b = document.getElementById("${id}"); return { text: b.textContent, disabled: b.disabled, primary: b.classList.contains("primary") }; })()`);
  // 読み終わって、「わかった / わからない」の、判定待ちになるまで待つ
  const waitJudging = () => waitFor(`!document.getElementById("judge-row").hidden && !document.getElementById("btn-understood").disabled`, "判定待ち");
  const waitRevealed = () => waitFor(`!document.getElementById("reveal").hidden`, "解説の表示");
  const understood = async () => { await waitJudging(); await click("btn-understood"); };
  // 聞き始めて、準備の画面で、左上の「スタート」まで、押す
  const begin = async () => {
    await click("btn-start");
    await waitFor(`!document.getElementById("screen-play").hidden`, "聞く画面(節のファイルの読み込み)");
    await click("btn-go");
  };
  // 最後まで、「わかった」で、進める
  const finishAll = async (timeoutMs = 60000) => {
    const t0 = Date.now();
    while (!(await visible("finish"))) {
      if (Date.now() - t0 > timeoutMs) throw new Error("時間切れ: finishAll");
      const ready = await ev(`!document.getElementById("judge-row").hidden && !document.getElementById("btn-understood").disabled`);
      if (ready) await click("btn-understood"); else await sleep(5);
    }
  };

  // ---- A. はじめの画面 ----
  await load();
  await resetStorage();
  storyRequests.length = 0;
  await load();
  check("A1 はじめの画面が、見えている", (await visible("start")) && !(await visible("play")));
  check("A2 レベル1と、今回の長さ(1節・5文)が、出ている", /レベル: 1/.test(await startInfo()) && /5 文\(1節\)/.test(await startInfo()), await startInfo());
  check("A3 記録は、まだ無い", /まだ、記録がありません/.test(await text("history")));
  check("A4 声の警告は、出ていない", await ev(`document.getElementById("voice-note").hidden`));
  check("A4b 起動時に読むのは、目次(index.json)だけ。節のファイルは、まだ読まない", JSON.stringify(storyRequests) === JSON.stringify(["index.json"]), JSON.stringify(storyRequests));
  await key("Space");
  check("A5 はじめの画面で Space を押しても、何も起きない", await visible("start"));

  // ---- A6. 読む速さのボタン: 0.5 / 0.8 / 1.0 / 1.2 / 1.5倍。はじめは、0.8倍 ----
  const speedBtns = () => ev(`[...document.querySelectorAll(".speed-btn")].map((b) => ({ text: b.textContent, on: b.classList.contains("primary"), pressed: b.getAttribute("aria-pressed") }))`);
  let sb = await speedBtns();
  check("A6 速度ボタンは、5つ(0.5 / 0.8 / 1.0 / 1.2 / 1.5倍)。はじめは、0.8倍が、選ばれている", JSON.stringify(sb.map((b) => b.text)) === JSON.stringify(["0.5倍", "0.8倍", "1.0倍", "1.2倍", "1.5倍"]) && JSON.stringify(sb.map((b) => b.on)) === JSON.stringify([false, true, false, false, false]) && sb[1].pressed === "true", JSON.stringify(sb));
  check("A6b 「節の数」の行と、「次の節にする」ボタンは、もう無い", (await ev(`["sec-count", "btn-sec-minus", "btn-sec-plus", "btn-story"].every((id) => document.getElementById(id) === null)`)), "");
  const lenBefore = await text("start-info");
  await ev(`document.querySelector('.speed-btn[data-rate="1.5"]').click(); true`);
  sb = await speedBtns();
  check("A7 1.5倍を押すと、1.5倍だけが、選ばれる。保存も、1.5になる。「今回の長さ」(秒)も、変わる", sb[4].on && sb.filter((b) => b.on).length === 1 && (await stored()).rate === 1.5 && (await text("start-info")) !== lenBefore, JSON.stringify(sb) + " " + (await text("start-info")));
  await ev(`document.querySelector('.speed-btn[data-rate="0.5"]').click(); true`);
  check("A8 0.5倍にすると、保存は 0.5", (await stored()).rate === 0.5 && (await speedBtns())[0].on);
  await ev(`document.querySelector('.speed-btn[data-rate="0.8"]').click(); true`);
  check("A9 0.8倍に戻す。保存は 0.8", (await stored()).rate === 0.8 && (await speedBtns())[1].on);
  await setProgress(BASE);   // これ以降の、主な流れは、1節(5文)で行う
  storyRequests.length = 0;
  await load();

  // ---- B0. 聞き始める → 準備の画面。左上の「スタート」を押すまで、読み出されない ----
  await click("btn-start");
  await sleep(700);
  const goInfo = await ev(`(() => { const b = document.getElementById("btn-go"); const r = b.getBoundingClientRect(); const p = document.getElementById("screen-play").getBoundingClientRect(); return { shown: !b.hidden && b.offsetParent !== null, nearLeft: r.left < p.left + p.width * 0.4, nearTop: r.top < p.top + 80 }; })()`);
  check("B0g 聞き始めると、今回の範囲の節のファイルだけを、読み込む(01-01-01 から)", JSON.stringify([...storyRequests].sort()) === JSON.stringify(["index.json", ...FIRST.sections.map((x) => x.file)].sort()), JSON.stringify(storyRequests));
  check("B0a 聞く画面になったが、1文目は、まだ読まれない", (await visible("play")) && (await spokenCount()) === 0, String(await spokenCount()));
  check("B0b 左上に、「スタート」ボタンが、出ている", goInfo.shown && goInfo.nearLeft && goInfo.nearTop, JSON.stringify(goInfo));
  check("B0c 準備中の表示が、出ている", /スタートを押すと/.test(await text("play-status")), await text("play-status"));
  const rb = [await btn("btn-understood"), await btn("btn-not"), await btn("btn-repeat"), await btn("btn-slow")];
  check("B0d 準備中は、「わかった」「わからない」「もう一度」「ゆっくり」は、押せない", rb.every((b) => b.disabled), JSON.stringify(rb));
  await key("Space"); await key("KeyR"); await key("KeyS");
  await sleep(200);
  check("B0e 準備中に、Space / R / S を押しても、何も起きない", (await spokenCount()) === 0 && (await ev(`document.getElementById("reveal").hidden`)));
  await click("btn-go");
  await waitFor(`window.__spoken.length >= 1`, "1文目の読み上げ");
  check("B0f スタートを押すと、1文目が、読まれ、スタートボタンは、隠れる", (await ev(`document.getElementById("btn-go").hidden`)) && (await spokenCount()) >= 1);

  // ---- B. 1文読んだら、止まる ----
  check("B1 聞いている画面に、変わった", (await visible("play")) && !(await visible("start")));
  const s0 = await ev(`window.__spoken[0]`);
  check("B2 1文目が、読まれた(英語、固定の速さ)", s0.text === first[0].text && s0.lang === "en-US" && s0.rate === READING_RATE, JSON.stringify(s0));
  check("B3 文の英語は、聞いている間は、画面に出ない", !(await ev(`document.body.innerText.includes(${JSON.stringify(first[0].text)})`)));
  await waitJudging();
  await sleep(800);
  check("B4 1文読んだら、止まる(自動では、次の文へ進まない)", (await spokenCount()) === 1, String(await spokenCount()));
  check("B5 「わかりましたか?」と、出ている。解説の欄は、まだ、隠れている", /わかりましたか/.test(await text("play-status")) && (await ev(`document.getElementById("reveal").hidden`)), await text("play-status"));

  // ---- C. わかった(Enter) → 次の文。わからない(Space) → 下に、英文と解説 ----
  await key("Enter");
  await waitFor(`window.__spoken.length >= 2`, "2文目の読み上げ");
  check("C1 「わかった」で、次の文(2文目)が、読まれる", (await lastSpoken()).text === first[1].text);
  await waitJudging();
  await key("Space");
  const stopIndex = 1;
  check("C2 「わからない」で、英文の欄が、出る", !(await ev(`document.getElementById("reveal").hidden`)) && (await text("reveal-text")) === first[stopIndex].text, await text("reveal-text"));
  check("C3 その下に、解説が、出る", (await text("reveal-note")) === "解説: " + first[stopIndex].note, await text("reveal-note"));
  check("C3b 英文と解説の間に、日本語訳が、出る", (await text("reveal-ja")) === "日本語: " + JA[first[stopIndex].text] && JA[first[stopIndex].text].length > 0, await text("reveal-ja"));
  check("C3c 英文 → 日本語 → 解説 の、順に、並ぶ", await ev(`(() => { const ids = ["reveal-text", "reveal-ja", "reveal-note"]; const ys = ids.map(i => document.getElementById(i).getBoundingClientRect().top); return ys[0] < ys[1] && ys[1] < ys[2]; })()`));
  check("C4 「わかった / わからない」は、隠れて、「次へ」が、出ている", (await ev(`document.getElementById("judge-row").hidden`)) && !(await ev(`document.getElementById("btn-next").offsetParent === null`)));
  await sleep(800);
  check("C5 解説を見ている間は、次の文へ進まない", (await spokenCount()) === 2, String(await spokenCount()));

  // ---- D. 解説を見ながら、もう一度(R)・ゆっくり(S) ----
  await key("KeyR");
  const rep = await lastSpoken();
  check("D1 R: 同じ文が、ふつうの速さで、もう一度読まれた", (await spokenCount()) === 3 && rep.text === first[stopIndex].text && rep.rate === READING_RATE, JSON.stringify(rep));
  await key("KeyS");
  const slow = await lastSpoken();
  check("D2 S: 同じ文を、ゆっくり(0.8 × 0.75)読んだ", (await spokenCount()) === 4 && slow.text === first[stopIndex].text && Math.abs(slow.rate - SLOW_RATE) < 1e-9, JSON.stringify(slow));
  check("D3 聞き直しても、解説の画面のまま", !(await ev(`document.getElementById("reveal").hidden`)));

  // ---- E. 次へ(Enter) → 残りは、わかった → おわり ----
  await key("Enter");
  await waitFor(`window.__spoken.length >= 5`, "次の文の読み上げ");
  check("E1 「次へ」で、次の文(3文目)が、読まれる。解説の欄は、隠れる", (await lastSpoken()).text === first[2].text && (await ev(`document.getElementById("reveal").hidden`)));
  await finishAll();
  check("E2 おわりの画面に、変わった", await visible("finish"));
  check("E3 結果の文(全文のうち1文)", (await text("finish-stats")) === N + " 文のうち、わからなかった文: 1(" + Math.round(100 / N) + "%)", await text("finish-stats"));
  check("E4 わからなかった割合による、レベルの自動の上げ下げは、もう無い(理由の文も、出ない)", (await ev(`document.getElementById("finish-reason")`)) === null, "");
  const unclearText = await text("finish-unclear");
  check("E5 わからなかった文と、日本語訳と、解説が、出ている", unclearText.includes(first[stopIndex].text) && unclearText.includes(JA[first[stopIndex].text]) && unclearText.includes(first[stopIndex].note));
  check("E6 全文が、出ている", (await ev(`document.querySelectorAll("#finish-all p").length`)) === N, String(N));
  const p1 = await stored();
  check("E7 保存: レベル1(そのまま)・ケンの、続きの節から、履歴1件(完了)",
    p1.level === 1 && p1.storyName === "ken" && p1.sceneIndex === FIRST.nextIndex && p1.history.length === 1 && p1.history[0].completed === true &&
    p1.history[0].stops === 1 && p1.history[0].sentences === N && p1.history[0].date === todayString(), JSON.stringify(p1));

  const finishButtons = await ev(`[...document.querySelectorAll("#screen-finish button")].map((b) => b.id)`);
  check("E8 おわりの画面のボタンは、3つだけ(次の節に進む / 同じ節を繰り返す / 表紙に戻る。この順)", JSON.stringify(finishButtons) === JSON.stringify(["btn-continue", "btn-again", "btn-cover"]), JSON.stringify(finishButtons));
  const cont = await btn("btn-continue");
  const kk = FIRST.nextIndex;
  check("E9 「次の節に進む」には、次の1節(レベル1・ケンの続き)の番号と題名が出ている。おすすめ印の、押せるボタン", cont.text.startsWith("次の節に進む(" + sectionCode(1, 1, kk + 1) + "  ") && cont.primary && !cont.disabled, JSON.stringify(cont));
  check("E10 上げる・そのまま・下げる のボタンは、もう無い", (await ev(`["btn-up", "btn-same", "btn-down"].every((id) => document.getElementById(id) === null)`)), "");
  check("E11 物語の途中なので、「物語が終わりました」は、出ない", (await text("finish-story")) === "", await text("finish-story"));

  // ---- F. 表紙に戻る(レベルは、変わらない。位置だけ、一覧の順で、進んでいる) ----
  await click("btn-cover");
  check("F1 レベルは、1のまま(わからなかった文が少なくても、自動では、上がらない)", /レベル: 1/.test(await startInfo()), await startInfo());
  check("F2 今日の行が、記録に出ている", (await text("history")).includes(todayString()));
  check("F3 次の範囲は、レベル1・ケンの、続きの節から", (await startInfo()).includes("今回の範囲: " + sectionCode(1, 1, FIRST.nextIndex + 1)), await startInfo());
  const sideLayout = await ev(`(() => { const m = document.querySelector(".main-col").getBoundingClientRect(); const s = document.querySelector(".side-col").getBoundingClientRect(); return { sideRight: s.left >= m.right - 1, sameTop: Math.abs(s.top - m.top) < 40 }; })()`);
  check("F5 一覧は、画面の右側に、ある(左の欄と、同じ高さ)", sideLayout.sideRight && sideLayout.sameTop, JSON.stringify(sideLayout));
  await setWidth(600);   // 狭い画面(スマホなど)
  const narrow = await ev(`(() => { const m = document.querySelector(".main-col").getBoundingClientRect(); const s = document.querySelector(".side-col").getBoundingClientRect(); return { stacked: s.top >= m.bottom - 1, noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 }; })()`);
  check("F7 狭い画面では、一覧が、下に回る(横にはみ出さない)", narrow.stacked && narrow.noHScroll, JSON.stringify(narrow));
  await setWidth(1200);
  const goodCodes = () => ev(`[...document.querySelectorAll("#level-list button.good .no")].map((e) => e.textContent)`);
  const tip = (code) => ev(`[...document.querySelectorAll("#level-list button")].find((b) => b.querySelector(".no").textContent === ${JSON.stringify(code)}).title`);
  check("F8 最初の練習(わからなかったのは、1文だけ)で聞いた節は、全部、題名が緑(20%以下)", JSON.stringify(await goodCodes()) === JSON.stringify(FIRST.sections.map((x) => x.code)), JSON.stringify(await goodCodes()));
  check("F9 緑の節に、前回の結果が、出る(01-01-01 は、5文のうち1文 = 20%)", /前回\(\d{4}-\d{2}-\d{2}\): わからなかった文 1\/5\(20%\)/.test(await tip("01-01-01")), await tip("01-01-01"));
  check("F10 まだ聞いていない節は、緑にならず、結果も、出ない", (await tip("01-02-01")) === "" && !(await goodCodes()).includes("01-02-01"));
  check("F11 説明(緑 = 20%以下)が、右の列に、出ている", /20%以下/.test(await ev(`document.querySelector(".side-col .good-note").textContent`)));

  // ---- G. 途中でやめる(1文だけ、答えて、やめる)。スタートは、Enter キーで ----
  await click("btn-start");
  await waitFor(`!document.getElementById("screen-play").hidden`, "聞く画面");
  await key("Enter");
  await understood();
  await waitFor(`window.__spoken.length >= 2`, "2文目の読み上げ");
  await click("btn-quit-play");
  check("G1 はじめの画面に、戻った", await visible("start"));
  const p2 = await stored();
  check("G2 途中の回は、履歴に残る(未完了)が、レベルと場面は、変わらない",
    p2.history.length === 2 && p2.history[1].completed === false && p2.level === 1 && p2.sceneIndex === FIRST.nextIndex, JSON.stringify(p2));
  check("G3 やめたあとは、読み上げが、止まっている", await (async () => { const n = await spokenCount(); await sleep(700); return (await spokenCount()) === n; })());
  check("G4 答えた文の数(1文)が、記録されている", p2.history[1].sentences === 1 && p2.history[1].stops === 0, JSON.stringify(p2.history[1]));

  // ---- H. 再読み込みしても、記録が残る ----
  await load();
  check("H1 再読み込み後も、レベル1・続きの節", /レベル: 1/.test(await startInfo()), await startInfo());
  const rowsInfo = await ev(`[...document.querySelectorAll("#history tr")].map(tr => tr.textContent)`);
  check("H3 記録の表は、日付 × ストーリーごとに、1行(同じ日の、同じストーリーの2回は、1行にまとまる)", rowsInfo.length === 2 && rowsInfo[1].includes(todayString()), JSON.stringify(rowsInfo));
  check("H4 まとまった行: 回数は2回。途中でやめた回が混ざるので、「途中でやめた分あり」", rowsInfo[1].includes("2回") && rowsInfo[1].includes("途中でやめた分あり"), JSON.stringify(rowsInfo));
  check("H5 行に、日付・物語名・範囲(最後まで聞いた節。やめた回の予定の範囲は、入れない)・回数・わからなかった文(合計)が、出ている", rowsInfo[1].includes(titleOf(1, "ken")) && /Ken and the Mountain01-01-0112回17%\(1\/6\)/.test(rowsInfo[1]), JSON.stringify(rowsInfo[1]));
  check("H6 見出しの列は、日付・物語・範囲・レベル・回数・わからなかった文・状態", rowsInfo[0] === "日付物語範囲レベル回数わからなかった文状態", rowsInfo[0]);

  // ---- I. 壊れた記録は、はじめに戻す ----
  await setRawProgress("これは壊れた記録");
  await load();
  check("I1 壊れた記録は、はじめの状態に戻る(レベル1)", /レベル: 1/.test(await startInfo()), await startInfo());
  check("I2 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- J. 途中でやめた回が、記録に残る ----
  await ev(`window.confirm = () => true; true`);
  await begin();
  await understood();
  await waitFor(`window.__spoken.length >= 1`, "読み上げ");
  await click("btn-quit-play");
  check("J1 記録が、増えている", (await stored()).history.length === 1);
  await resetStorage();   // (記録を消すボタンは、無い。試験の道具で、初期化する)
  await setProgress(BASE);

  // ---- K. 5文目だけ、「わからない」→ 「次へ」(Enter)で、進む ----
  await load();   // J で記録を消したので、レベル1・場面1から
  await begin();
  for (let i = 0; i < N; i++) {
    await waitJudging();
    if (i === 4) {
      await key("Space");
      await waitRevealed();
      check("K1 5文目で、英文と解説が、出た", (await text("reveal-text")) === first[4].text && (await text("reveal-note")) === "解説: " + first[4].note);
      await key("Enter");
    } else {
      await key("Enter");
    }
  }
  await waitFor(`!document.getElementById("screen-finish").hidden`, "おわりの画面");
  check("K2 結果: 全文のうち1文", (await text("finish-stats")) === N + " 文のうち、わからなかった文: 1(" + Math.round(100 / N) + "%)", await text("finish-stats"));
  const kUnclear = await text("finish-unclear");
  check("K3 おわりの画面には、5文目の英文と解説だけが、出る", kUnclear.includes(first[4].text) && kUnclear.includes(first[4].note) && !kUnclear.includes(first[3].text), kUnclear);
  check("K4 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- M. 最上位のレベルでも、わからなかった文が少なくて、節の数は、自動では、増えない ----
  await setProgress({ version: 1, level: 3, sectionCount: 1, storyName: "ken", sceneIndex: 0, history: [] });
  await load();
  await begin();
  await finishAll();
  const p3 = await stored();
  check("M1 保存: レベルは、3のまま。位置だけ、1つ先(03-01-02)", p3.level === 3 && p3.storyName === "ken" && p3.sceneIndex === 1, JSON.stringify(p3));
  const cont3 = await btn("btn-continue");
  check("M2 「次の節に進む」は、次の1節(03-01-02)を示す", cont3.text.startsWith("次の節に進む(03-01-02"), cont3.text);
  await click("btn-cover");
  check("M4 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- N. 道具(位置を読む・「ここから」の節の番号を読む) ----
  await resetStorage();
  await load();
  const positionOf = async () => { const p = await stored(); return p.level + "/" + p.storyName + "/" + p.sceneIndex; };
  const nowCode = () => ev(`document.querySelector("#level-list button.now .no").textContent`);
  check("N1 表紙に、「次の節にする」ボタンは、無い(節を選ぶのは、右の列だけ)", (await ev(`document.getElementById("btn-story")`)) === null && (await nowCode()) === "01-01-01", await nowCode());
  check("N2 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- Q. The Open Boat の6番目の節(03-04-06)から。「わからない」で、日本語訳も出る ----
  await setProgress({ version: 1, level: 3, sectionCount: 1, storyName: "openboat", sceneIndex: 5, history: [] });
  await load();
  check("Q1 6番目の節(03-04-06)から、始まる", (await startInfo()).includes("今回の範囲: 03-04-06"), await startInfo());
  await begin();
  await waitFor(`window.__spoken.length >= 1`, "VOA 6番目の節の1文目");
  const q0 = await ev(`window.__spoken[0]`);
  check("Q2 固定の速さで、6番目の節の1文目が読まれる", q0.rate === READING_RATE && q0.text === sectionSentences(3, "openboat", 5, CATALOG)[0].text, JSON.stringify(q0));
  await waitJudging();
  await key("Space");
  check("Q3 「わからない」で、その文の英文と、日本語訳と、日本語の解説が、出る", (await text("reveal-text")) === q0.text && (await text("reveal-ja")) === "日本語: " + JA[q0.text] && /^解説: .+/.test(await text("reveal-note")), await text("reveal-ja"));
  await click("btn-quit-play");
  check("Q4 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- R. 読んでいる途中: 「わかった」は、まだ押せない。「わからない」は、押せる ----
  await ev(`window.__hold = true; true`);   // 偽の声が、読み終わらない状態にする
  await begin();
  await waitFor(`window.__spoken.length >= 1`, "読み上げの開始");
  const rb1 = await btn("btn-understood"), rb2 = await btn("btn-not");
  check("R1 読んでいる途中は、「わかった」は押せず、「わからない」は押せる", rb1.disabled && !rb2.disabled, JSON.stringify([rb1, rb2]));
  await key("Enter");
  check("R2 読んでいる途中の Enter は、無視される", /聞いています/.test(await text("play-status")), await text("play-status"));
  const nHold = await spokenCount();
  await key("Space");
  check("R3 読んでいる途中でも、Space(わからない)で、英文と解説が、出る", !(await ev(`document.getElementById("reveal").hidden`)) && (await text("reveal-note")).startsWith("解説: "), await text("reveal-note"));
  check("R4 そのまま、次の文へは、進まない", (await spokenCount()) === nHold);
  await ev(`window.__hold = false; true`);
  await click("btn-quit-play");

  // ---- O. 物語の終わりまで聞くと、自動で、次の物語になる ----
  await setProgress({ version: 1, level: 1, storyName: "ken", sceneIndex: 7, history: [] });   // 最後の節(01-01-08)
  await load();
  await begin();
  await finishAll();
  check("O1 物語の最後まで聞くと、「次の物語」(赤い傘)の案内が、出る", (await text("finish-story")).includes(titleOf(2, "umbrella")), await text("finish-story"));
  const po = await stored();
  check("O2 保存: 次の物語(赤い傘)の、最初の節。レベルは、1のまま", po.storyName === "umbrella" && po.sceneIndex === 0 && po.level === 1, JSON.stringify(po));
  await click("btn-cover");
  check("O3 表紙に戻ると、レベル1の、赤い傘(01-02)になる", (await startInfo()).includes("ストーリー: 01-02 " + titleOf(1, "umbrella")) && /レベル: 1/.test(await startInfo()), await startInfo());
  check("O4 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- P. もう一度聞く(R)・ゆっくり聞く(S)は、「わからない」に、数えない ----
  await begin();
  await waitJudging();
  const n0 = await spokenCount();
  const t0 = (await lastSpoken()).text;
  await click("btn-repeat");
  const pr = await lastSpoken();
  check("P1 ボタンで、同じ文が、すぐ、もう一度読まれた(ふつうの速さ)", (await spokenCount()) === n0 + 1 && pr.text === t0 && pr.rate === READING_RATE, JSON.stringify(pr));
  await waitJudging();
  await sleep(600);
  check("P2 聞き直した後も、止まっている(自動では、進まない)", (await spokenCount()) === n0 + 1);
  await key("KeyR");
  check("P3 R キーでも、同じ文が、もう一度読まれた", (await spokenCount()) === n0 + 2 && (await lastSpoken()).text === t0);
  await waitJudging();
  await key("KeyS");
  const ps = await lastSpoken();
  check("P4 S キーで、同じ文が、ゆっくり読まれた", (await spokenCount()) === n0 + 3 && ps.text === t0 && Math.abs(ps.rate - SLOW_RATE) < 1e-9, JSON.stringify(ps));
  await understood();
  await waitFor(`window.__spoken.length >= ${n0 + 4}`, "次の文");
  check("P5 「わかった」で、次の文へ進む", (await lastSpoken()).text !== t0);
  await click("btn-quit-play");
  const pp = await stored();
  check("P6 繰り返しは、「わからなかった」に、数えない(1文答えて、0文)", pp.history.at(-1).stops === 0 && pp.history.at(-1).sentences === 1, JSON.stringify(pp.history.at(-1)));
  check("P7 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- S. 右の列: レベル → ストーリー → 節 の順に並べて、選べる ----
  await resetStorage();
  await load();
  const expectedCodes = [];
  for (const lv of CATALOG.levels) for (const st of lv.stories) for (const sec of st.sections) expectedCodes.push(sectionCode(lv.level, st.no, sec.no));
  const listButtons = () => ev(`[...document.querySelectorAll("#level-list button")].map(b => ({ code: b.querySelector(".no").textContent, text: b.textContent, now: b.classList.contains("now") }))`);
  const groups = () => ev(`[...document.querySelectorAll("#level-list .level-group")].map(d => ({ open: d.open, summary: d.querySelector("summary").textContent }))`);
  let lb = await listButtons();
  check("S1 全部の節(94個)が、並ぶ", lb.length === expectedCodes.length && lb.length === 94, String(lb.length));
  check("S2 並びは、レベル → ストーリー → 節 の順(ファイル名の番号の順)", JSON.stringify(lb.map((b) => b.code)) === JSON.stringify(expectedCodes) && expectedCodes[0] === "01-01-01" && expectedCodes.at(-1) === "03-04-22", JSON.stringify(lb.slice(0, 3).map((b) => b.code)));
  check("S3 番号は、全部、2けた(レベル-ストーリー-節)", lb.every((b) => /^\d{2}-\d{2}-\d{2}$/.test(b.code)));
  check("S3b 各行は、「番号  題名(節の番号)  約○秒」の形。「1/2」や「5文」は、出さない", lb[0].text === "01-01-01The Morning(1)  約" + lb[0].text.split("約")[1] && /^\d{2}-\d{2}-\d{2}.+\(\d+\)  約\d+(秒|分)/.test(lb[0].text.replace("← ここから", "")) && lb.every((b) => !/\d\/\d/.test(b.text) && !/\d+文/.test(b.text)), JSON.stringify(lb.slice(0, 2).map((b) => b.text)));
  let gs = await groups();
  check("S4 3つのレベルの見出しがあり、いまのレベル(1)だけ、開いている", gs.length === 3 && gs[0].open && !gs[1].open && !gs[2].open && /レベル 01/.test(gs[0].summary) && /レベル 03/.test(gs[2].summary), JSON.stringify(gs));
  check("S5 いまの位置(01-01-01)に、「ここから」の印", lb[0].now && lb.filter((b) => b.now).length === 1 && lb[0].text.includes("ここから"));
  const headings = await ev(`[...document.querySelectorAll("#level-list .story-head")].map(h => h.textContent)`);
  check("S6 ストーリーの見出しに、番号と名前が出ている(例: 03-04  openboat)", headings.length === 10 && headings.at(-1).startsWith("03-04  openboat") && headings[0].startsWith("01-01  ken"), JSON.stringify(headings));
  const storyStates = () => ev(`[...document.querySelectorAll("#level-list .story-group")].map(d => ({ open: d.open, head: d.querySelector("summary").textContent }))`);
  let ss = await storyStates();
  check("S6b ストーリーの見出しは、折りたたみ式。いまのストーリー(01-01 ken)だけ、開いている", ss.length === 10 && ss.filter((x) => x.open).length === 1 && ss[0].open && ss[0].head.includes("← いま") && ss.filter((x) => x.head.includes("← いま")).length === 1, JSON.stringify(ss.map((x) => x.open)));
  await ev(`document.querySelectorAll("#level-list .story-group")[1].querySelector("summary").click(); true`);
  ss = await storyStates();
  check("S6c 別のストーリーの見出しを押すと、開く(いまのストーリーは、開いたまま)", ss[0].open && ss[1].open, JSON.stringify(ss.map((x) => x.open)));
  const side = await ev(`(() => { const m = document.querySelector(".main-col").getBoundingClientRect(); const c = document.getElementById("level-list").getBoundingClientRect(); return c.left >= m.right - 1; })()`);
  check("S7 一覧は、画面の右の列に、ある", side);
  // 別のレベルの節を選ぶ: 02-02-05(レベル2・赤い傘・5節目)
  await ev(`document.querySelectorAll("#level-list .level-group")[1].querySelector("summary").click(); true`);
  gs = await groups();
  check("S8 レベル2の見出しを押すと、開く", gs[1].open, JSON.stringify(gs));
  await ev(`[...document.querySelectorAll("#level-list button")].find(b => b.querySelector(".no").textContent === "02-02-05").click(); true`);
  const sp = await stored();
  check("S9 02-02-05 を押すと、レベル2・umbrella・節(番号 4)が、まとめて決まる", sp.level === 2 && sp.storyName === "umbrella" && sp.sceneIndex === 4, JSON.stringify(sp));
  check("S10 「今回の範囲」は 02-02-05 から。レベルも 2 になる", (await startInfo()).includes("今回の範囲: 02-02-05") && /レベル: 2/.test(await startInfo()), await startInfo());
  lb = await listButtons();
  gs = await groups();
  check("S11 印は、その節に移り、そのレベルの見出しは、開いている", lb.find((b) => b.now).code === "02-02-05" && gs[1].open, JSON.stringify(gs));
  ss = await storyStates();
  const openHeads = ss.filter((x) => x.open).map((x) => x.head);
  check("S11b いまのストーリーが、変わると、それ以外は、たたまれる(いまの 02-02 umbrella だけ、開く)", openHeads.length === 1 && openHeads[0].startsWith("02-02  umbrella") && openHeads[0].includes("← いま"), JSON.stringify(openHeads));
  check("S12 押しただけでは、練習は、始まらない", (await visible("start")) && (await spokenCount()) === 0);
  const plan25 = planSession(CATALOG, { level: 2, storyName: "umbrella", sceneIndex: 4 }, { sectionCount: 1 });
  storyRequests.length = 0;
  await begin();
  await waitFor(`window.__spoken.length >= 1`, "02-02-05 の1文目");
  check("S13 聞き始めると、その節の1文目が読まれ、読み込むのは、その節からのファイルだけ", (await lastSpoken()).text === sectionSentences(2, "umbrella", 4, CATALOG)[0].text && JSON.stringify([...storyRequests].sort()) === JSON.stringify(plan25.sections.map((x) => x.file).sort()), JSON.stringify(storyRequests) + " " + (await lastSpoken()).text);
  check("S14 読み込んだファイル名は、レベル-ストーリー番号-節番号-名前(2けた)", storyRequests.length >= 1 && storyRequests.every((f) => /^02-02-0[5-9]-umbrella\.json$/.test(f)), JSON.stringify(storyRequests));
  await click("btn-quit-play");
  storyRequests.length = 0;
  await begin();
  check("S15 同じ節を、もう一度聞く時は、読み込み済みを使う(ファイルを、もう一度読まない)", storyRequests.length === 0, JSON.stringify(storyRequests));
  await click("btn-quit-play");
  // レベル3の The Open Boat の、最後の節(03-04-22)
  await ev(`document.querySelectorAll("#level-list .level-group")[2].querySelector("summary").click(); true`);
  await ev(`[...document.querySelectorAll("#level-list button")].find(b => b.querySelector(".no").textContent === "03-04-22").click(); true`);
  const sl = await stored();
  check("S16 03-04-22(The Open Boat の最後の節)を選ぶと、レベル3・openboat・節(番号 21)", sl.level === 3 && sl.storyName === "openboat" && sl.sceneIndex === 21, JSON.stringify(sl));
  check("S17 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- T. おわりの画面の「表紙に戻る」(自動の判定のまま) ----
  await resetStorage();
  await load();
  await begin();
  await finishAll();
  const pT = await stored();
  check("T0b 1節の練習の後は、ちょうど1つ先の節(番号 1)から。レベルは、1のまま", pT.sceneIndex === 1 && pT.level === 1 && pT.history.at(-1).sectionCount === 1 && pT.history.at(-1).sentences === 5, JSON.stringify(pT));
  const cover = await btn("btn-cover");
  check("T1 おわりの画面に、「表紙に戻る」ボタンが、ある", cover.text === "表紙に戻る" && !cover.disabled, JSON.stringify(cover));
  await click("btn-cover");
  check("T2 押すと、表紙(はじめの画面)に、戻る", (await visible("start")) && !(await visible("finish")));
  check("T3 次の回は、レベル1のまま", /レベル: 1/.test(await startInfo()) && (await stored()).level === 1, await startInfo());
  check("T4 表紙では、「表紙に戻る」を押しても、何も起きない(おわりの画面でだけ、効く)", await (async () => { await click("btn-cover"); return await visible("start"); })());
  check("T5 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- U. おわりの画面の、「次の節に進む」: そのまま、次の練習(準備の画面)へ。飛ばさない ----
  await resetStorage();
  await setProgress(BASE);
  await load();
  await begin();
  await finishAll();
  check("U1 おわりの画面に、「次の節にする」ボタンは、無い(「次の節に進む」と「表紙に戻る」がある)", (await visible("finish")) && (await ev(`document.getElementById("btn-story-finish")`)) === null && (await ev(`!!document.getElementById("btn-continue") && !!document.getElementById("btn-cover")`)), "");
  const k = FIRST.nextIndex;   // 2節の練習の後の、位置(レベル1・ケン)
  const pu0 = await stored();
  check("U2 聞いた直後の位置は、ちょうど次のまとまり(2節ぶん進んだ位置)", pu0.level === 1 && pu0.storyName === "ken" && pu0.sceneIndex === k, JSON.stringify(pu0));
  storyRequests.length = 0;
  const spokenU0 = await ev(`window.__spoken.length`);
  await click("btn-continue");
  await waitFor(`!document.getElementById("screen-play").hidden`, "次の練習の画面");
  const planU = planSession(CATALOG, { level: 1, storyName: "ken", sceneIndex: k }, { sectionCount: 1 });
  const nextFirst = sectionSentences(1, "ken", k, CATALOG)[0];
  check("U3 押すと、次の練習の、準備の画面になる(まだ、何も読まれない)。読み込んだのは、次の1節のファイルだけ",
    (await visible("play")) && !(await visible("finish")) && (await ev(`window.__spoken.length`)) === spokenU0 &&
    JSON.stringify([...storyRequests].sort()) === JSON.stringify(planU.sections.map((x) => x.file).sort()), JSON.stringify(storyRequests));
  await click("btn-go");
  await waitFor(`window.__spoken.length > ${spokenU0}`, "スタートの後の読み上げ");
  check("U4 スタートで、次の節の、最初の文が、読まれる", (await lastSpoken()).text === nextFirst.text, JSON.stringify(await lastSpoken()));
  check("U5 位置は、すでに進んでいるので、飛ばさない(保存は、そのまま)", JSON.stringify(await stored()) === JSON.stringify(pu0), JSON.stringify(await stored()));
  await click("btn-quit-play");
  check("U6 途中でやめると、表紙に戻り、「ここから」は、同じ節(01-01-03)", (await visible("start")) && (await nowCode()) === sectionCode(1, 1, k + 1), await nowCode());
  check("U7 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- UR. 「同じ節を繰り返す」: いま聞いた節を、もう一度、はじめから。位置は、次の節のまま ----
  await resetStorage();
  await setProgress(BASE);
  await load();
  await begin();
  await finishAll();
  const againBtn = await btn("btn-again");
  check("UR1 「次の節に進む」の右に、「同じ節を繰り返す」がある。聞いた節の番号と題名が、出ている", againBtn.text === "同じ節を繰り返す(01-01-01  The Morning(1))" && !againBtn.disabled && (await ev(`document.getElementById("btn-continue").nextElementSibling.id`)) === "btn-again", JSON.stringify(againBtn));
  const pr0 = await stored();
  storyRequests.length = 0;
  const nUR = await spokenCount();
  await click("btn-again");
  check("UR2 押すと、同じ節の、準備の画面になる(まだ読まれない)。節のファイルは、読み直さない", (await visible("play")) && !(await visible("finish")) && (await spokenCount()) === nUR && storyRequests.length === 0 && /準備ができました/.test(await text("play-status")), await text("play-status"));
  await click("btn-go");
  await waitFor(`window.__spoken.length > ${nUR}`, "繰り返しの1文目");
  check("UR3 スタートで、同じ節の、1文目が、読まれる", (await lastSpoken()).text === first[0].text, JSON.stringify(await lastSpoken()));
  await finishAll();
  const pr1 = await stored();
  check("UR4 繰り返して聞き終えても、位置は、同じ(次の節のまま)。履歴は、2回分になる", pr1.level === pr0.level && pr1.storyName === pr0.storyName && pr1.sceneIndex === pr0.sceneIndex && pr1.history.length === 2, JSON.stringify(pr1));
  check("UR5 繰り返し後の、おわりの画面にも、3つのボタンが、ある", JSON.stringify(await ev(`[...document.querySelectorAll("#screen-finish button")].map((b) => b.id)`)) === JSON.stringify(["btn-continue", "btn-again", "btn-cover"]));
  await click("btn-cover");
  const rowsUR = await ev(`[...document.querySelectorAll("#history tr")].map((tr) => tr.textContent)`);
  check("UR6 記録の表は、同じ日・同じストーリーなので、1行(2回)にまとまる", rowsUR.length === 2 && rowsUR[1].includes("01-01-01") && rowsUR[1].includes("2回"), JSON.stringify(rowsUR));
  check("UR7 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- U2. レベルの最後の物語を、聞き終えると、次のレベルの、最初の物語へ(レベルが変わるのは、ここだけ) ----
  await setProgress({ version: 1, level: 1, storyName: "bakery", sceneIndex: 7, history: [] });
  await load();
  await begin();
  await finishAll();
  const pb = await stored();
  check("UB1 レベル1の最後の物語(bakery)を、聞き終えると、レベル2の、最初の物語(ken)の、最初の節", pb.level === 2 && pb.storyName === "ken" && pb.sceneIndex === 0, JSON.stringify(pb));
  check("UB2 おわりの画面に、「物語は、ここまで」と「レベルは、2になります」が出る", /この物語は、ここまでです/.test(await text("finish-story")) && /レベルは、2 になります/.test(await text("finish-story")), await text("finish-story"));
  check("UB3 「次の節に進む」は、02-01-01 から", (await text("btn-continue")).startsWith("次の節に進む(02-01-01"), await text("btn-continue"));
  await click("btn-cover");
  check("UB4 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- X. 節ごとの結果: 20%を超えた節は、緑にならない。途中の節は、記録しない。やり直すと、置き換わる ----
  await resetStorage();
  await setProgress(BASE);
  await load();
  await begin();
  for (let i = 0; i < 2; i++) { await waitJudging(); await key("Space"); await waitRevealed(); await key("Enter"); }   // 最初の2文は、「わからない」
  await finishAll();
  await click("btn-cover");
  const sx = (await stored()).sectionStats;
  check("X1 01-01-01 は、5文のうち2文(40%)。結果が、記録される", sx["01-01-01"] && sx["01-01-01"].stops === 2 && sx["01-01-01"].sentences === 5, JSON.stringify(sx));
  const gx = await goodCodes();
  check("X2 40%の節(01-01-01)は、緑にならない", !gx.includes("01-01-01") && gx.length === 0, JSON.stringify(gx));
  check("X3 40%の節にも、前回の結果は、出る(2/5(40%))", /わからなかった文 2\/5\(40%\)/.test(await tip("01-01-01")), await tip("01-01-01"));
  // やり直すと、いちばん新しい結果に、置き換わる(01-01-01 から、全部「わかった」)
  await ev(`[...document.querySelectorAll("#level-list button")].find((b) => b.querySelector(".no").textContent === "01-01-01").click(); true`);
  await begin();
  await finishAll();
  await click("btn-cover");
  check("X4 やり直して、0文になると、01-01-01 は、緑になる(置き換わる)", (await goodCodes()).includes("01-01-01") && /わからなかった文 0\/5\(0%\)/.test(await tip("01-01-01")), await tip("01-01-01"));
  await load();
  check("X5 開き直しても、緑は、残る", JSON.stringify(await goodCodes()) === JSON.stringify(["01-01-01"]), JSON.stringify(await goodCodes()));

  // 途中でやめた時: 最後まで答え終えた節だけが、記録される(3文だけ答えて、やめる = 記録される節は、無い)
  await resetStorage();
  await setProgress(BASE);
  await load();
  await begin();
  for (let i = 0; i < 3; i++) await understood();
  await click("btn-quit-play");
  check("X6 3文だけ答えて、やめると、節の結果は、記録されない(途中の節は、入らない)", Object.keys((await stored()).sectionStats).length === 0, JSON.stringify((await stored()).sectionStats));
  check("X7 そのため、緑になる節は、無い", (await goodCodes()).length === 0, JSON.stringify(await goodCodes()));
  check("X8 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- Z. 全部の節が緑のストーリーとレベルは、たたんだ見出しも、緑 ----
  const codesOf = (level, name) => findStory(CATALOG, level, name).sections.map((sec) => sectionCode(level, findStory(CATALOG, level, name).no, sec.no));
  const goodStat = { sentences: 5, stops: 0, date: "2026-11-17" };
  const statsFor = (codes) => Object.fromEntries(codes.map((c) => [c, goodStat]));
  const lv1Codes = ["ken", "umbrella", "bakery"].flatMap((n) => codesOf(1, n));
  await resetStorage();
  await setProgress({ version: 1, level: 1, sectionCount: 1, storyName: "ken", sceneIndex: 0, sectionStats: statsFor(codesOf(1, "ken").slice(0, 7)), history: [] });
  await load();
  const greens = () => ev(`({ stories: [...document.querySelectorAll("#level-list .story-head")].map((h) => h.classList.contains("all-good")), levels: [...document.querySelectorAll("#level-list .level-group > summary")].map((h) => h.classList.contains("all-good")) })`);
  let gr = await greens();
  check("Z1 8節のうち7節だけ緑なら、見出しは、緑にならない", !gr.stories[0] && !gr.levels[0], JSON.stringify(gr));
  await setProgress({ version: 1, level: 1, sectionCount: 1, storyName: "ken", sceneIndex: 0, sectionStats: statsFor(codesOf(1, "ken")), history: [] });
  await load();
  gr = await greens();
  check("Z2 8節が、全部緑なら、そのストーリー(01-01)の見出しだけ、緑。レベルは、まだ", gr.stories[0] && !gr.stories[1] && !gr.stories[2] && !gr.levels[0], JSON.stringify(gr));
  const headColor = await ev(`getComputedStyle(document.querySelector("#level-list .story-head.all-good")).color`);
  const okColor = await ev(`getComputedStyle(document.documentElement).getPropertyValue("--ok").trim()`);
  check("Z3 緑の見出しの色は、緑(題名と、同じ色)", okColor !== "" && headColor === "rgb(76, 195, 138)", headColor + " " + okColor);
  await setProgress({ version: 1, level: 1, sectionCount: 1, storyName: "ken", sceneIndex: 0, sectionStats: statsFor(lv1Codes), history: [] });
  await load();
  gr = await greens();
  check("Z4 レベル1の全部のストーリーが、緑なら、レベル1の見出しも、緑(他のレベルは、まだ)", gr.levels[0] && !gr.levels[1] && !gr.levels[2] && gr.stories.slice(0, 3).every(Boolean) && !gr.stories[3], JSON.stringify(gr));
  const bad = { ...statsFor(lv1Codes), [lv1Codes[5]]: { sentences: 5, stops: 2, date: "2026-11-17" } };   // 40% → 緑ではない
  await setProgress({ version: 1, level: 1, sectionCount: 1, storyName: "ken", sceneIndex: 0, sectionStats: bad, history: [] });
  await load();
  gr = await greens();
  check("Z5 1節でも、20%を超えたら、そのストーリーと、レベルの緑は、消える(他のストーリーは、緑のまま)", !gr.stories[0] && gr.stories[1] && gr.stories[2] && !gr.levels[0], JSON.stringify(gr));
  check("Z6 説明に、「見出しが緑 = 中の節が、全部、緑」が、出ている", /見出しが緑/.test(await ev(`document.querySelector(".side-col .good-note").textContent`)), "");
  check("Z7 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- BK. 「前の文に戻る」: ひとつ前の文から、やり直す(答えは、取り消す) ----
  await resetStorage();
  await setProgress(BASE);
  await load();
  await click("btn-start");
  await waitFor(`!document.getElementById("screen-play").hidden`, "聞く画面");
  const backBtn = () => ev(`(() => { const b = document.getElementById("btn-back"); return { text: b.textContent, disabled: b.disabled, hidden: b.hidden, beforeQuit: b.nextElementSibling && b.nextElementSibling.id }; })()`);
  let bb = await backBtn();
  check("BK1 「やめる」の隣(左)に、「前の文に戻る」ボタンが、ある。準備の画面では、押せない", bb.text === "前の文に戻る" && bb.beforeQuit === "btn-quit-play" && bb.disabled, JSON.stringify(bb));
  await click("btn-go");
  await waitJudging();
  check("BK2 1文目では、押せない(戻る先が、無い)", (await backBtn()).disabled);
  await click("btn-not");   // 1文目: わからない
  await waitRevealed();
  await click("btn-next");
  await waitJudging();
  check("BK3 2文目では、押せる", !(await backBtn()).disabled && /2 \/ /.test(await text("play-status")), await text("play-status"));
  const nBK = await spokenCount();
  await click("btn-back");
  await waitFor(`window.__spoken.length > ${nBK}`, "戻った文の読み上げ");
  check("BK4 押すと、1文目に戻り、もう一度、読まれる。解説の欄は、隠れる", (await lastSpoken()).text === first[0].text && /1 \/ /.test(await text("play-status")) && (await ev(`document.getElementById("reveal").hidden`)), await text("play-status"));
  await waitJudging();
  check("BK5 1文目に戻ったので、また、押せない", (await backBtn()).disabled);
  await finishAll();
  check("BK6 戻る前の「わからない」は、取り消される(今回は、全部「わかった」 → わからなかった文: 0)", (await text("finish-stats")).includes("わからなかった文: 0(0%)"), await text("finish-stats"));
  const pbk = await stored();
  check("BK7 記録も、同じ(わからなかった文 0、文の数は、5文)", pbk.history.at(-1).stops === 0 && pbk.history.at(-1).sentences === 5, JSON.stringify(pbk.history.at(-1)));
  // 解説を見ている時にも、戻れる。やめた時の、答えた数は、戻った分だけ、減る
  await click("btn-cover");
  await begin();
  await understood();
  await understood();
  await waitJudging();
  await click("btn-not");   // 3文目: わからない
  await waitRevealed();
  check("BK8 解説を見ている時も、押せる", !(await backBtn()).disabled);
  await click("btn-back");
  await waitJudging();
  check("BK9 2文目に戻る(3文目の「わからない」は、取り消し)。画面は、判定待ちに戻る", /2 \/ /.test(await text("play-status")) && (await ev(`document.getElementById("reveal").hidden`)), await text("play-status"));
  const pq0 = (await stored()).history.length;
  await click("btn-quit-play");
  const pq = await stored();
  check("BK10 ここでやめると、答えた文は、1文だけ(1文目)。わからなかった文は、0", pq.history.length === pq0 + 1 && pq.history.at(-1).sentences === 1 && pq.history.at(-1).stops === 0 && pq.history.at(-1).completed === false, JSON.stringify(pq.history.at(-1)));
  check("BK11 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- SP. 選んだ速さで読まれる・ボタンの位置(もう一度聞く は、わかった / 次へ の、左) ----
  await resetStorage();
  await setProgress({ ...BASE, rate: 1.5 });
  await load();
  const secsText = () => ev(`[...document.querySelectorAll("#level-list button")][0].textContent`);
  const at15 = await secsText();
  check("SP1 開き直しても、選んだ速さ(1.5倍)が、残っている", (await speedBtns())[4].on && (await stored()).rate === 1.5, JSON.stringify(await speedBtns()));
  await setProgress({ ...BASE, rate: 0.5 });
  await load();
  check("SP2 一覧の「約○秒」は、選んだ速さで、変わる(0.5倍は、1.5倍より、長い)", (await secsText()) !== at15, at15 + " / " + (await secsText()));
  await setProgress({ ...BASE, rate: 1.2 });
  await load();
  await begin();
  await waitFor(`window.__spoken.length >= 1`, "1文目の読み上げ");
  check("SP3 1.2倍を選ぶと、1.2倍の速さで、読まれる", (await lastSpoken()).rate === 1.2, JSON.stringify(await lastSpoken()));
  await waitJudging();
  await click("btn-slow");
  await waitFor(`window.__spoken.length >= 2`, "ゆっくり");
  check("SP4 「ゆっくり聞く」は、選んだ速さの、さらに遅い版(1.2倍 × 0.75 = 0.9)", Math.abs((await lastSpoken()).rate - 0.9) < 1e-9, JSON.stringify(await lastSpoken()));
  await waitJudging();
  const order = await ev(`(() => { const ids = (rowId) => [...document.getElementById(rowId).querySelectorAll("button")].map((b) => b.id); return { judge: ids("judge-row"), reveal: ids("reveal"), bottom: [...document.getElementById("btn-slow").parentElement.querySelectorAll("button")].map((b) => b.id) }; })()`);
  check("SP5 「わかった」の左に、「もう一度聞く」がある(1行目: もう一度聞く → わかった → わからない)", JSON.stringify(order.judge) === JSON.stringify(["btn-repeat", "btn-understood", "btn-not"]), JSON.stringify(order));
  check("SP6 下の段は、ゆっくり聞く・前の文に戻る・やめる(もう一度聞く は、移った)", JSON.stringify(order.bottom) === JSON.stringify(["btn-slow", "btn-back", "btn-quit-play"]), JSON.stringify(order));
  const nSP = await spokenCount();
  await click("btn-repeat");
  await waitFor(`window.__spoken.length > ${nSP}`, "もう一度");
  check("SP7 判定待ちの「もう一度聞く」で、同じ文が、選んだ速さで、もう一度読まれる", (await lastSpoken()).text === first[0].text && (await lastSpoken()).rate === 1.2, JSON.stringify(await lastSpoken()));
  await waitJudging();
  await click("btn-not");
  await waitRevealed();
  check("SP8 「わからない」の画面では、「次へ」の左に、「もう一度聞く」がある", JSON.stringify(order.reveal) === JSON.stringify(["btn-repeat-reveal", "btn-next"]) && !(await ev(`document.getElementById("btn-repeat-reveal").disabled`)), JSON.stringify(order.reveal));
  const nSP2 = await spokenCount();
  await click("btn-repeat-reveal");
  await waitFor(`window.__spoken.length > ${nSP2}`, "解説画面のもう一度");
  check("SP9 解説の画面の「もう一度聞く」で、もう一度読まれる。画面は、解説のまま", (await lastSpoken()).text === first[0].text && !(await ev(`document.getElementById("reveal").hidden`)), JSON.stringify(await lastSpoken()));
  await click("btn-quit-play");
  check("SP10 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- SY. 記録の同期(GitHub。偽の GitHub で確かめる。サーバ版(serve.py)では、偽の GitHub が無いので、行わない) ----
  if (!SERVER_MODE) {
    const SYNC_KEY = "english-listening-sync-v1";
    const syncSummary = () => text("sync-summary");
    const syncStatus = () => text("sync-status");
    const ghReset = (over = {}) => { Object.assign(gh, { token: GH_TOKEN, repoExists: true, file: null, sha: null, mode: "ok", requests: [], puts: 0 }, over); };
    const putRemote = (obj) => { gh.file = JSON.stringify(obj); gh.sha = ghSha(gh.file); };
    const fill = (id, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; return true; })()`);
    const waitSync = (what, ms = 8000) => waitFor(`!/同期中|同期しています/.test(document.getElementById("sync-summary").textContent + document.getElementById("sync-status").textContent)`, what, ms);
    const localHistoryLen = async () => (await stored()).history.length;
    const hrow = (date, time, range) => ({ date, time, story: "Ken and the Mountain", range, level: 1, sectionCount: 1, sentences: 5, stops: 0, completed: true });

    // SY1: はじめは、オフ
    ghReset();
    await resetStorage();
    await setProgress({ ...BASE, history: [hrow("2026-11-16", "21:00", "01-01-01")], updatedAt: "2026-11-16T12:00:00.000Z" });
    await load();
    check("SY1 同期は、はじめは、オフ。合鍵の欄は、伏せ字(password)", /同期: オフ/.test(await syncSummary()) && (await ev(`document.getElementById("sync-token").type`)) === "password" && gh.requests.length === 0, await syncSummary());
    check("SY1b 同期の欄は、たたまれている(開くと、リポジトリと合鍵を、入れられる)", (await ev(`document.getElementById("sync-panel").open`)) === false);

    // SY2: 形の違う入力は、通信せずに、断る
    await fill("sync-repo", "records");
    await fill("sync-token", GH_TOKEN);
    await click("btn-sync-save");
    check("SY2 リポジトリが、「所有者/名前」の形でなければ、断る。通信しない。設定も、保存しない", /所有者\/名前/.test(await syncStatus()) && gh.requests.length === 0 && (await ev(`window.localStorage.getItem(${JSON.stringify(SYNC_KEY)})`)) === null, await syncStatus());
    await fill("sync-repo", "someone/records");
    await fill("sync-token", "合鍵 です");
    await click("btn-sync-save");
    check("SY2b 合鍵に、空白や日本語が、入っていれば、断る。通信しない", /合鍵を/.test(await syncStatus()) && gh.requests.length === 0, await syncStatus());

    // SY3: 設定して、はじめての同期(同期先は、空 → 端末の記録を、書く)
    await fill("sync-repo", "someone/records");
    await fill("sync-token", GH_TOKEN);
    await click("btn-sync-save");
    await waitSync("はじめての同期");
    await waitFor(`/同期: オン/.test(document.getElementById("sync-summary").textContent)`, "同期: オン");
    const remote1 = gh.file ? JSON.parse(gh.file) : null;
    check("SY3 設定して同期すると、同期先に、端末の記録(履歴1行)が、書かれる。表示は「オン」", !!remote1 && remote1.history.length === 1 && /同期: オン\(someone\/records/.test(await syncSummary()), JSON.stringify(remote1));
    check("SY3b 合鍵の欄は、空に戻る。設定は、この端末の中(localStorage)に、保存される", (await ev(`document.getElementById("sync-token").value`)) === "" && JSON.parse(await ev(`window.localStorage.getItem(${JSON.stringify(SYNC_KEY)})`)).token === GH_TOKEN);
    check("SY3c 合鍵は、画面のどこにも、出ない(文字にも、入力欄の値にも)", !(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(GH_TOKEN)}) || [...document.querySelectorAll("input")].some((i) => i.value.includes(${JSON.stringify(GH_TOKEN)}))`)), "");
    check("SY3d 同期先の記録にも、合鍵は、入っていない。リクエストの宛先にも、中身にも、合鍵は、無い(ヘッダーだけ)", !gh.file.includes(GH_TOKEN) && gh.requests.every((q) => !q.url.includes(GH_TOKEN) && !q.body.includes(GH_TOKEN) && q.auth === "Bearer " + GH_TOKEN), JSON.stringify(gh.requests.map((q) => q.method + " " + q.url)));

    // SY4: 別の端末が、先に進めていた → 取り込む(位置と履歴)
    putRemote({ ...JSON.parse(gh.file), level: 2, storyName: "umbrella", sceneIndex: 3, updatedAt: "2026-11-17T20:00:00.000Z", history: [hrow("2026-11-16", "21:00", "01-01-01"), hrow("2026-11-17", "19:00", "02-02-03")] });
    await click("btn-sync-now");
    await waitSync("今すぐ同期");
    await waitFor(`/レベル: 2/.test(document.getElementById("start-info").textContent)`, "取り込んだ記録の、反映");
    const merged4 = await stored();
    check("SY4 同期先が、新しければ、位置(レベル2・赤い傘)と、履歴(2行)を、取り込む。表紙の表示も、変わる", merged4.level === 2 && merged4.storyName === "umbrella" && merged4.sceneIndex === 3 && merged4.history.length === 2 && (await startInfo()).includes("ストーリー: 02-02"), JSON.stringify(merged4));

    // SY5: 練習が終わると、自動で、同期先に、書く
    gh.requests.length = 0;
    const putsBefore = gh.puts;
    await begin();
    const reqsPlaying = gh.requests.length;
    await ev(`window.dispatchEvent(new Event("online")); true`);   // 練習中に、「ネットが戻った」合図が来ても、同期しない
    await new Promise((r) => setTimeout(r, 400));
    const noReqWhilePlaying = gh.requests.length === reqsPlaying;
    await finishAll();
    await click("btn-cover");
    const t0 = Date.now();
    while (gh.puts === putsBefore && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
    const remote5 = JSON.parse(gh.file);
    check("SY5 練習が、終わると、少し待って、自動で、同期先に書かれる(履歴が、3行に)", gh.puts === putsBefore + 1 && remote5.history.length === 3 && remote5.history.at(-1).completed === true, JSON.stringify(remote5.history.length) + " puts " + gh.puts);
    check("SY5b 練習している間は、同期の合図(ネットが戻った)が来ても、通信しない", noReqWhilePlaying, String(gh.requests.length - reqsPlaying));

    // SY6: 合鍵が、だめ → 理由を出す。端末の記録は、そのまま
    const before6 = JSON.stringify(await stored());
    gh.token = "someone-changed-it";
    await click("btn-sync-now");
    await waitSync("失敗する同期");
    check("SY6 合鍵が使えない時は、理由を、出す。端末の記録は、変わらない", /合鍵が、使えません/.test(await syncStatus()) && /うまくいきませんでした/.test(await syncSummary()) && JSON.stringify(await stored()) === before6, await syncStatus());
    ghReset({ file: gh.file, sha: gh.sha });

    // SY7: リポジトリが見つからない
    gh.repoExists = false;
    await click("btn-sync-now");
    await waitSync("リポジトリ無し");
    check("SY7 リポジトリが、見つからない時は、その理由を、出す", /リポジトリが、見つかりません/.test(await syncStatus()), await syncStatus());
    gh.repoExists = true;

    // SY8: 通信が切れた → 端末の記録で、動き続ける(開き直しても、表紙が出る)
    gh.mode = "drop";
    await load();
    check("SY8 同期先に、つながらなくても、表紙は、出る。端末の記録が、使われる(レベル2・赤い傘)", (await startInfo()).includes("ストーリー: 02-02") && /つながりません/.test(await syncStatus()), (await startInfo()) + " / " + (await syncStatus()));
    gh.mode = "ok";

    // SY9: 開いた時に、同期する(同期先が、新しければ、表紙を出す前に、取り込む)
    putRemote({ ...JSON.parse(gh.file), level: 3, storyName: "bakery", sceneIndex: 2, updatedAt: "2026-11-18T09:00:00.000Z" });
    await load();
    check("SY9 開いた時に、同期して、新しい記録(レベル3・パン屋)で、表紙が、出る", /レベル: 3/.test(await startInfo()) && (await startInfo()).includes("ストーリー: 03-03"), await startInfo());

    // SY10: 同期をやめる
    gh.requests.length = 0;
    await click("sync-summary");
    await click("btn-sync-off");
    check("SY10 「同期を、やめる」で、合鍵が、端末から、消える。端末の記録は、そのまま。表示は、オフ", (await ev(`window.localStorage.getItem(${JSON.stringify(SYNC_KEY)})`)) === null && /同期: オフ/.test(await syncSummary()) && (await stored()).level === 3, await syncSummary());
    await begin();
    await finishAll();
    await click("btn-cover");
    await new Promise((r) => setTimeout(r, 2500));
    check("SY10b やめた後は、練習が終わっても、通信しない", gh.requests.length === 0, JSON.stringify(gh.requests.map((q) => q.method + q.url)));

    // SY11: 通信の守り(CSP): GitHub と、この画面の置き場所以外へは、つながらない
    const nErr = pageErrors.length;
    const csp = await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
    const outside = await ev(`fetch("https://example.com/").then(() => "つながった").catch(() => "ふさがれた")`);
    const same = await ev(`fetch("stories/index.json").then((r) => r.ok ? "ok" : "ng").catch(() => "ふさがれた")`);
    pageErrors.length = nErr;   // 守りの確認で、わざと、出した、エラー
    check("SY11 通信の守り: 外のサイトへは、つながらない。この画面の置き場所へは、つながる。許す送り先は、GitHub の API だけ", outside === "ふさがれた" && same === "ok" && /connect-src 'self' https:\/\/api\.github\.com;/.test(csp) && /script-src 'self';/.test(csp), outside + " " + same + " " + csp);
    check("SY12 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));
  }

  // ---- AU. 録音した音声ファイル(audio/)で、読む。無い・鳴らせない文は、読み上げに、戻る ----
  await send("Network.setBlockedURLs", { urls: [] });
  await resetStorage();
  await setProgress({ ...BASE, rate: 1.5 });
  audioRequests.length = 0;
  await load();
  check("AU1 音声ファイルの目次(manifest.json)を、読む。声の心配のメモ(voice-note)は、出ない", audioRequests.includes("manifest.json") && (await ev(`document.getElementById("voice-note").hidden`)), JSON.stringify(audioRequests));
  audioRequests.length = 0;
  await click("btn-start");
  await waitFor(`!document.getElementById("screen-play").hidden`, "聞く画面");
  const wanted = FIRST.sentences.map((x, i) => "01-01-01-ken-0" + (i + 1) + ".mp3");
  check("AU2 聞き始めに、今回の5文の音声ファイルだけを、読み込む(先に)", JSON.stringify([...audioRequests].sort()) === JSON.stringify(wanted), JSON.stringify(audioRequests));
  const plays0 = await ev(`window.__audioPlays.length`);
  const spoken0 = await spokenCount();
  await click("btn-go");
  await waitFor(`window.__audioPlays.length > ${plays0}`, "音声の再生");
  const ap = await ev(`window.__audioPlays.at(-1)`);
  check("AU3 スタートで、1文目の音声(blob)が、選んだ速さ(1.5倍)で、再生される。読み上げは、使わない", /^blob:/.test(ap.src) && ap.rate === 1.5 && (await spokenCount()) === spoken0, JSON.stringify(ap));
  await waitJudging();
  await click("btn-understood");
  await waitFor(`window.__audioPlays.length > ${plays0 + 1}`, "2文目の音声");
  await waitJudging();
  const apCount = await ev(`window.__audioPlays.length`);
  await click("btn-slow");
  await waitFor(`window.__audioPlays.length > ${apCount}`, "ゆっくり");
  check("AU4 「ゆっくり聞く」は、速さ × 0.75(1.5 × 0.75 = 1.125)で、同じ音声を、もう一度", Math.abs((await ev(`window.__audioPlays.at(-1).rate`)) - 1.125) < 1e-9 && (await ev(`window.__audioPlays.at(-1).src`)) === (await ev(`window.__audioPlays.at(-2).src`)), JSON.stringify(await ev(`window.__audioPlays.slice(-2)`)));
  await waitJudging();
  // 再生できない(__audioFail)→ 読み上げに、切り替わる
  await ev(`window.__audioFail = true; true`);
  const sp1 = await spokenCount();
  await click("btn-repeat");
  await waitFor(`window.__spoken.length > ${sp1}`, "読み上げへの切り替え");
  check("AU5 音声が、鳴らせない時は、同じ文を、読み上げで、読む(画面は、止まらない)", (await lastSpoken()).text === first[1].text, JSON.stringify(await lastSpoken()));
  await waitJudging();
  await ev(`window.__audioFail = false; true`);
  await finishAll();
  check("AU6 最後まで、進める。おわりの画面になる", await visible("finish"));
  await click("btn-cover");
  // 一部の音声ファイルが、読み込めない(3文目)→ その文だけ、読み上げ
  await send("Network.setBlockedURLs", { urls: ["*/01-01-01-ken-03.mp3"] });
  await ev(`window.__audioPlays.length = 0; window.__spoken.length = 0; true`);
  await setProgress({ ...BASE, rate: 1 });
  await load();
  await begin();
  for (let i = 0; i < 5; i++) await understood();
  await waitFor(`!document.getElementById("screen-finish").hidden`, "おわりの画面", 8000);
  const plays = await ev(`window.__audioPlays.length`);
  const spokenAfter = await ev(`window.__spoken.map((x) => x.text)`);
  check("AU7 3文目の音声だけ、読み込めない時は、4文が音声、3文目だけ読み上げ", plays === 4 && JSON.stringify(spokenAfter) === JSON.stringify([first[2].text]), plays + " " + JSON.stringify(spokenAfter));
  await click("btn-cover");
  await send("Network.setBlockedURLs", { urls: ["*/audio/*"] });   // 音声が、無い時: これまでと、同じ(読み上げ)
  await setProgress(BASE);
  await load();
  await begin();
  await waitFor(`window.__spoken.length >= 1`, "読み上げ");
  check("AU8 音声ファイルが、全部、使えない時は、すべて、読み上げ(音声の再生は、0)", (await ev(`window.__audioPlays.length`)) === 0 && (await lastSpoken()).text === first[0].text);
  await click("btn-quit-play");
  check("AU9 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- V. 声が黙った時の立て直し・記録の保存の表示 ----
  await resetStorage();
  await load();
  // 声が、エラーで、黙った時 → 別の声で、やり直し → それでもだめなら、理由を出して、先へ進める
  await ev(`window.__failWith = "synthesis-failed"; true`);
  const f0 = await spokenCount();
  await begin();
  await waitJudging();
  const fvoices = await ev(`window.__spoken.slice(${f0}).map(s => s.voice)`);
  check("V7 エラーの時、別の声に、切り替えて、やり直した(この PC の声 Fake B → Fake A)", fvoices.length === 2 && fvoices[0] === "Fake B" && fvoices[1] === "Fake A", JSON.stringify(fvoices));
  check("V8 それでもだめなら、理由が、画面に出て、判定の画面に、進む", !(await ev(`document.getElementById("play-note").hidden`)) && /synthesis-failed/.test(await text("play-note")), await text("play-note"));
  await ev(`window.__failWith = null; true`);
  await click("btn-repeat");
  await waitJudging();
  check("V9 声が直ると、「もう一度聞く」で、読まれ、メッセージは、消える", await ev(`document.getElementById("play-note").hidden`));
  await click("btn-quit-play");

  // 声が、始まらない時(通知が、来ない)→ 4秒待って、別の声で、やり直し → 8秒で、あきらめて、先へ
  await ev(`window.__noStart = true; true`);
  const g0 = await spokenCount();
  await begin();
  await waitFor(`!document.getElementById("btn-understood").disabled`, "始まらない声の、あきらめ", 15000);
  const gvoices = await ev(`window.__spoken.slice(${g0}).map(s => s.voice)`);
  check("V10 始まらない時も、別の声で、やり直して、あきらめて、先へ進める", gvoices.length === 2 && gvoices[0] !== gvoices[1] && /始まりませんでした/.test(await text("play-note")), JSON.stringify(gvoices) + " " + (await text("play-note")));
  await ev(`window.__noStart = false; true`);
  await click("btn-quit-play");

  // 記録の保存の表示
  await resetStorage();
  await load();
  if (!SERVER_MODE) {
    check("V11 はじめての起動: 「前回の起動の記録は、ありません」", /使えます/.test(await text("storage-status")) && /前回の起動の記録は、ありません/.test(await text("storage-status")), await text("storage-status"));
    await load();
    check("V12 2回目の起動: 「前回の起動: 日付」が、出る", /前回の起動: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(await text("storage-status")), await text("storage-status"));
  } else {
    check("V11 サーバ版: 「ファイルに、保存しています」と、出る", /ファイル\(data\/progress\.json\)に、保存しています/.test(await text("storage-status")), await text("storage-status"));
  }
  check("V13 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // 別の保存場所の記録(W の試験で使う)
  const other = {
    version: 1, level: 3, sectionCount: 3, storyName: "ken", sceneIndex: 1, voiceName: "Fake A", updatedAt: "2999-01-01T00:00:00.000Z",
    history: [
      { date: "2026-11-15", time: "08:00", story: "Ken and the Mountain", range: "01-01-01", level: 1, targetSeconds: 30, sentences: 10, stops: 2, completed: true },
      { date: "2026-11-15", time: "20:30", story: "The Red Umbrella", range: "02-02-01〜02-02-02", level: 2, targetSeconds: 60, sentences: 20, stops: 1, completed: true },
    ],
  };

  // ---- W. 記録は、ファイルに、保存される(サーバ版だけ)----
  if (SERVER_MODE) {
    await resetStorage();
    await load();
    await begin();
    await understood();
    await click("btn-quit-play");
    await waitFor(`true`, "");
    let fileText = "";
    for (let i = 0; i < 40 && !fileText; i++) { try { fileText = fs.readFileSync(DATA_FILE, "utf8"); } catch { await sleep(50); } }
    const saved = fileText ? JSON.parse(fileText) : null;
    check("W1 練習すると、記録が、ファイル(progress.json)に、保存される", saved && saved.history.length === 1 && saved.history[0].story === titleOf(1, "ken"), fileText.slice(0, 120));

    // いちばん大事な試験: ブラウザの保存データを、全部消しても、記録は、ファイルから、戻る
    await ev(`window.localStorage.clear(); true`);
    await load();
    const rowsBack = await ev(`[...document.querySelectorAll("#history tr")].length - 1`);
    check("W2 ブラウザの保存データを、消して、開き直しても、記録が、ファイルから、戻る", rowsBack === 1, String(rowsBack));

    // はじめての取り込み: ファイルが無く、ブラウザの中に記録がある → ファイルに、取り込まれる
    fs.rmSync(DATA_FILE, { force: true });
    await ev(`window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ ...other, updatedAt: "2026-11-16T00:00:00.000Z" }))}); true`);
    await load();
    let migrated = "";
    for (let i = 0; i < 40 && !migrated; i++) { try { migrated = fs.readFileSync(DATA_FILE, "utf8"); } catch { await sleep(50); } }
    check("W3 ファイルが無く、ブラウザの中に記録がある時は、ファイルに、取り込まれる", migrated && JSON.parse(migrated).history.length === 2, migrated.slice(0, 100));

    // ファイルのほうが、新しい時は、ファイルを使う(別の画面で、練習した後など)
    const newer = { ...other, level: 2, updatedAt: "2999-12-31T00:00:00.000Z", history: [other.history[0]] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(newer));
    await ev(`window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ ...other, updatedAt: "2026-11-16T00:00:00.000Z" }))}); true`);
    await load();
    check("W4 ファイルのほうが新しければ、ファイルの記録(レベル2・1行)を、使う", /レベル: 2/.test(await startInfo()) && (await ev(`[...document.querySelectorAll("#history tr")].length - 1`)) === 1, await startInfo());

    // 壊れたファイルでは、いまの記録を、つぶさない
    fs.writeFileSync(DATA_FILE, "これは壊れたファイル");
    await ev(`window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ ...other, updatedAt: "2026-11-16T00:00:00.000Z" }))}); true`);
    await load();
    check("W5 ファイルが壊れていても、ブラウザの中の記録を、使い続けられる", /レベル: 3/.test(await startInfo()) && (await ev(`[...document.querySelectorAll("#history tr")].length - 1`)) === 2, await startInfo());

    // 控え(バックアップ): 同じ日の、2回目の書き込みの前に、できる
    const bdir = path.join(DATA_DIR, "backups");
    await begin();
    await understood();
    await click("btn-quit-play");
    for (let i = 0; i < 40 && !(fs.existsSync(bdir) && fs.readdirSync(bdir).length > 0); i++) await sleep(50);
    check("W6 控え(backups)が、できている", fs.existsSync(bdir) && fs.readdirSync(bdir).some((n) => /^progress-\d{8}\.json$/.test(n)), fs.existsSync(bdir) ? String(fs.readdirSync(bdir)) : "なし");

    // サーバが止まった時: 保存に失敗したと、画面に出て、練習は、続けられる
    try { pyServer.kill(); } catch {}
    await sleep(500);
    await begin();
    await understood();
    await click("btn-quit-play");
    await waitFor(`/保存できませんでした/.test(document.getElementById("storage-status").textContent)`, "保存失敗の表示", 8000);
    check("W7 サーバが止まると、「ファイルに保存できませんでした」と出て、ブラウザの中には、保存される", /保存できませんでした/.test(await text("storage-status")) && (await stored()).history.length >= 3, await text("storage-status"));
    check("W8 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));
  }

  ws.close();
} catch (e) {
  console.log("試験が、途中で止まりました: " + e.message);
  failures.push("途中停止");
} finally {
  await cleanup();
}

console.log(failures.length === 0 ? "\napp_smoke_test: すべて通りました" : "\napp_smoke_test: 失敗 " + failures.length + " 件: " + failures.join(" / "));
process.exit(failures.length === 0 ? 0 : 1);
