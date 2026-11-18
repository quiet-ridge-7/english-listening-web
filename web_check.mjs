// web_check.mjs — Web 版(静的サイト)の、確認: 圏外でも開けるか・iPhone の幅で、はみ出さないか・通信先は、同じ場所だけか。
//   ヘッドレス Edge と、自前の簡易サーバ(Cache-Control: no-store。途中で、止める)で、行う。声は、偽物。
//   使い方: node web_check.mjs        (この道具の、あるフォルダ = Web 版のフォルダを、調べる)
//   ポート: 8795(サーバ)、9342(Edge の遠隔操作)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8795;
const CDP_PORT = 9342;
const URL_ROOT = "http://127.0.0.1:" + PORT + "/";
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png" };

const failures = [];
const check = (name, cond, detail = "") => {
  console.log((cond ? "OK " : "NG ") + name + (cond ? "" : "  <- " + detail));
  if (!cond) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 簡易サーバ(止められる) ----
const served = [];
let server = null;
function startServer() {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, name === "/" ? "index.html" : name);
    served.push(name);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", r));
}
async function stopServer() {
  await new Promise((r) => { server.closeAllConnections(); server.close(r); });
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "el_webcheck_"));
let edge = null;
async function cleanup() {
  try { if (edge) execSync("taskkill /PID " + edge.pid + " /T /F", { stdio: "ignore" }); } catch {}
  try { if (server && server.listening) { server.closeAllConnections(); server.close(); } } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

try {
  await startServer();
  edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try { targets = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json")).json(); } catch { await sleep(250); }
  }
  if (!targets) throw new Error("Edge に、つながりません");
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  const hosts = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Network.requestWillBeSent") { try { const u = new URL(d.params.request.url); if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.host); } catch {} }   // blob:(ブラウザの中の一時的なアドレス)や data: は、通信では、ない
    if (d.method === "Runtime.exceptionThrown") {
      const ex = d.params.exceptionDetails;
      pageErrors.push((ex.exception && ex.exception.description ? ex.exception.description : ex.text).split("\n")[0]);
    }
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") pageErrors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error("評価エラー: " + expression + " → " + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const waitFor = async (expression, what, timeoutMs = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { try { if (await ev(expression)) return true; } catch {} await sleep(80); }
    throw new Error("時間切れ: " + what);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__audioPlays = [];
      HTMLMediaElement.prototype.play = function () { window.__audioPlays.push({ src: this.src, rate: this.playbackRate }); const el = this; setTimeout(() => el.dispatchEvent(new Event("playing")), 1); setTimeout(() => el.dispatchEvent(new Event("ended")), 6); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () {};
      window.__spoken = [];
      class FakeUtterance { constructor(t) { this.text = t; } }
      let current = null;
      const fake = {
        speak(u) { window.__spoken.push({ text: u.text, rate: u.rate }); current = u; setTimeout(() => { if (current === u) u.onstart && u.onstart({}); }, 1); setTimeout(() => { if (current === u) { current = null; u.onend && u.onend({}); } }, 5); },
        cancel() { if (current) { const u = current; current = null; u.onerror && u.onerror({ error: "interrupted" }); } },
        resume() {}, getVoices() { return [{ lang: "en-US", name: "Fake", localService: true }]; }, addEventListener() {},
      };
      Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
    `,
  });
  const load = async () => {
    await send("Page.navigate", { url: URL_ROOT });
    await waitFor(`document.readyState === "complete" && document.getElementById("start-info") && document.getElementById("start-info").textContent.length > 0`, "画面の読み込み");
  };

  // ---- 1. 最初の読み込み: sw.js が、全部のファイルを、覚える ----
  await load();
  const swText = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const FILES = [...JSON.parse(swText.match(/const FILES = (\[[\s\S]*?\]);/)[1]), ...JSON.parse(swText.match(/const AUDIO = (\[[^\n]*\]);/)[1])];   // 画面・物語と、録音した音声
  await waitFor(`navigator.serviceWorker.ready.then(() => true)`, "sw.js の準備");
  await waitFor(`caches.keys().then((ks) => ks.length > 0 && caches.open(ks[0]).then((c) => c.keys()).then((r) => r.length >= ${FILES.length}))`, "ファイルを、覚えるのを、待つ", 60000);
  const cacheInfo = await ev(`caches.keys().then(async (ks) => ({ names: ks, count: (await (await caches.open(ks[0])).keys()).length }))`);
  check("W1 sw.js が、動いている。覚えた箱は、1つ。覚えたファイルの数は、一覧(" + FILES.length + ")と、同じ", cacheInfo.names.length === 1 && /^english-listening-web-[0-9a-f]{10}$/.test(cacheInfo.names[0]) && cacheInfo.count >= FILES.length, JSON.stringify(cacheInfo));
  const manifestLink = await ev(`document.querySelector('link[rel="manifest"]').getAttribute("href")`);
  const manifest = await (await fetch(URL_ROOT + manifestLink)).json();
  check("W2 manifest がある。名前・開始位置・standalone・アイコン2つ(192 / 512)", manifest.name === "英語リスニング練習" && manifest.start_url === "./" && manifest.display === "standalone" && manifest.icons.length === 2, JSON.stringify(manifest));
  const icons = await Promise.all(["icon-192.png", "icon-512.png", "apple-touch-icon.png"].map(async (f) => { const r = await fetch(URL_ROOT + f); return r.status === 200 && (await r.arrayBuffer()).byteLength > 1000; }));
  check("W3 アイコン3つ(192 / 512 / apple-touch)が、ある", icons.every(Boolean), JSON.stringify(icons));
  check("W3b ホーム画面の、アイコンと、色の指定がある(apple-touch-icon、theme-color)", (await ev(`!!document.querySelector('link[rel="apple-touch-icon"]') && !!document.querySelector('meta[name="theme-color"]')`)) === true);
  check("W3c 「このアプリについて」が、ある(記録は、端末の中、VOA の出典)", /この端末の中/.test(await ev(`document.querySelector(".about").textContent`)) && /VOA/.test(await ev(`document.querySelector(".about").textContent`)));
  check("W3d ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- 2. サーバを止めて(圏外)、開き直す ----
  await stopServer();
  const servedBefore = served.length;
  await load();
  const info = await ev(`({ start: document.getElementById("start-info").textContent, sections: document.querySelectorAll("#level-list button").length, sw: !!navigator.serviceWorker.controller })`);
  check("W4 圏外(サーバを止めた)でも、開ける。右の一覧に、94個の節が並ぶ。sw.js が、画面を、管理している", info.start.length > 0 && info.sections === 94 && info.sw, JSON.stringify(info));
  await ev(`document.getElementById("btn-start").click(); true`);
  await waitFor(`!document.getElementById("screen-play").hidden`, "圏外での、聞く画面(節のファイルは、覚えた物から)");
  await ev(`document.getElementById("btn-go").click(); true`);
  await waitFor(`window.__audioPlays.length >= 1 || window.__spoken.length >= 1`, "圏外での、1文目");
  const play = await ev(`window.__audioPlays[0] || null`);
  check("W5 圏外でも、練習できる(1文目が、録音した音声で、再生される。読み上げは、使わない)。サーバには、1回も、つながっていない", !!play && /^blob:/.test(play.src) && (await ev(`window.__spoken.length`)) === 0 && served.length === servedBefore, JSON.stringify(play) + " " + (served.length - servedBefore));
  await ev(`document.getElementById("btn-quit-play").click(); true`);
  check("W5b ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));

  // ---- 3. 通信先 ----
  const external = [...hosts].filter((h) => h !== "127.0.0.1:" + PORT);
  check("W6 通信した先は、この画面の置き場所だけ(外のサイトへの、通信は、無い)", external.length === 0, JSON.stringify(external));

  // ---- 4. iPhone の幅(390 × 844、タッチ)で、はみ出さない ----
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await load();
  const overflow = () => ev(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })`);
  let o = await overflow();
  check("W7 iPhone の幅(390)で、表紙が、横に、はみ出さない", o.sw <= o.iw + 1, JSON.stringify(o));
  const stack = await ev(`(() => { const m = document.querySelector(".main-col").getBoundingClientRect(); const s = document.querySelector(".side-col").getBoundingClientRect(); return s.top >= m.bottom - 1; })()`);
  check("W7b 一覧は、下に、回る(1列)", stack);
  await ev(`document.getElementById("sync-panel").open = true; true`);
  o = await overflow();
  const syncFits = await ev(`(() => { const r = document.getElementById("sync-token").getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0; })()`);
  check("W7c 同期の欄を開いても、はみ出さない。入力欄が、画面に収まる", o.sw <= o.iw + 1 && syncFits, JSON.stringify(o));
  const smallButtons = await ev(`[...document.querySelectorAll("#screen-start button:not([hidden])")].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 30).map((b) => b.id || b.textContent.slice(0, 12))`);
  check("W7d 表紙のボタンは、どれも、高さ30px以上(指で、押せる)", smallButtons.length === 0, JSON.stringify(smallButtons));
  await ev(`document.getElementById("btn-start").click(); true`);
  await waitFor(`!document.getElementById("screen-play").hidden`, "聞く画面");
  o = await overflow();
  check("W8 iPhone の幅で、準備の画面が、はみ出さない。スタートボタンが、画面の中に、ある", o.sw <= o.iw + 1 && (await ev(`document.getElementById("btn-go").getBoundingClientRect().right <= window.innerWidth`)), JSON.stringify(o));
  await ev(`document.getElementById("btn-go").click(); true`);
  await waitFor(`!document.getElementById("btn-understood").disabled`, "判定待ち");
  o = await overflow();
  const rowFits = await ev(`[...document.querySelectorAll("#judge-row button, #screen-play .row button")].filter((b) => b.offsetParent !== null).every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })`);
  check("W9 iPhone の幅で、判定の画面(もう一度聞く / わかった / わからない)が、はみ出さない", o.sw <= o.iw + 1 && rowFits, JSON.stringify(o));
  for (let i = 0; i < 12; i++) { // 最後まで進める
    if (await ev(`!document.getElementById("screen-finish").hidden`)) break;
    await waitFor(`!document.getElementById("btn-understood").disabled || !document.getElementById("screen-finish").hidden`, "次の文");
    if (await ev(`!document.getElementById("screen-finish").hidden`)) break;
    await ev(`document.getElementById("btn-understood").click(); true`);
    await sleep(30);
  }
  await waitFor(`!document.getElementById("screen-finish").hidden`, "おわりの画面");
  o = await overflow();
  const finishFits = await ev(`[...document.querySelectorAll("#screen-finish button")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })`);
  check("W10 iPhone の幅で、おわりの画面(3つのボタン)が、はみ出さない", o.sw <= o.iw + 1 && finishFits, JSON.stringify(o));
  check("W11 ページのエラーは、出ていない", pageErrors.length === 0, pageErrors.join(" | "));
  await send("Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: 0, mobile: false });
} catch (e) {
  console.log("試験が、途中で止まりました: " + e.message);
  failures.push("途中停止");
} finally {
  await cleanup();
}

console.log(failures.length === 0 ? "\nweb_check: すべて通りました" : "\nweb_check: 失敗 " + failures.length + " 件: " + failures.join(" / "));
process.exit(failures.length === 0 ? 0 : 1);
