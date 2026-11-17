// voice_check.js — iPhone で、声が出ない原因を、調べるための、小さなページの動き。
//   何も、保存も、送信も、しない。結果は、画面の枠に、出すだけ。
const logEl = document.getElementById("log");
const t0 = () => performance.now();
function log(line) {
  logEl.textContent += line + "\n";
}
const ms = (start) => String(Math.round(performance.now() - start)).padStart(5, " ") + "ms ";
const synth = typeof window.speechSynthesis !== "undefined" ? window.speechSynthesis : null;

function voiceLine(v) {
  return "  " + v.name + " / " + v.lang + " / " + (v.localService ? "本体の声" : "通信の声") + (v.default ? " / 既定" : "");
}

function showInfo() {
  log("== 状態 ==");
  log("画面: " + window.innerWidth + "x" + window.innerHeight + " / 安全な接続: " + window.isSecureContext);
  log("端末の情報: " + navigator.userAgent);
  log("読み上げの機能: " + (synth && typeof window.SpeechSynthesisUtterance !== "undefined" ? "ある" : "ない"));
  if (!synth) return;
  const voices = synth.getVoices();
  const en = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
  log("声の数: " + voices.length + "(英語: " + en.length + ")");
  en.slice(0, 8).forEach((v) => log(voiceLine(v)));
  if (en.length > 8) log("  …ほか " + (en.length - 8) + " 個");
  log("speaking=" + synth.speaking + " pending=" + synth.pending + " paused=" + synth.paused);
  log("");
}

// 声を出して、起きたことを、全部、書く(押した直後の、同じ動きの中で、speak を呼ぶ)
function speakTest(title, text, { lang, voice, rate } = {}) {
  if (!synth) { log("【" + title + "】読み上げの機能が、ありません"); return; }
  const start = t0();
  log("【" + title + "】");
  const u = new window.SpeechSynthesisUtterance(text);
  if (lang) u.lang = lang;
  if (rate) u.rate = rate;
  if (voice) { u.voice = voice; log(ms(start) + "声を指定: " + voice.name + " / " + voice.lang); }
  u.onstart = () => log(ms(start) + "始まった(onstart)");
  let ended = false;
  u.onend = () => { ended = true; log(ms(start) + "終わった(onend)"); };
  u.onerror = (e) => log(ms(start) + "エラー: " + e.error);
  u.onpause = () => log(ms(start) + "一時停止");
  u.onresume = () => log(ms(start) + "再開");
  log(ms(start) + "speak を呼ぶ(呼ぶ前: speaking=" + synth.speaking + " pending=" + synth.pending + ")");
  try { synth.speak(u); } catch (e) { log(ms(start) + "speak が、例外: " + e.name); return; }
  log(ms(start) + "speak を呼んだ(呼んだ後: speaking=" + synth.speaking + " pending=" + synth.pending + ")");
  window.__keep = u;   // 読み上げの途中で、捨てられないように、持っておく
  setTimeout(() => log(ms(start) + "3秒後: speaking=" + synth.speaking + " pending=" + synth.pending + " paused=" + synth.paused), 3000);
  setTimeout(() => log(ms(start) + "6秒後: " + (ended ? "終わりの通知は、来ている" : "終わりの通知は、まだ、来ていない")), 6000);
}

// ① 音声ファイル(<audio>)の、ピッ。消音スイッチの影響を、受けにくい。 440Hz、0.5秒の、WAV を、その場で作る。
function beepWav() {
  const rate = 22050, n = Math.floor(rate * 0.5);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}

document.getElementById("t-beep-audio").addEventListener("click", () => {
  const start = t0();
  log("【① 音声ファイルの、ピッ】");
  const audio = new Audio(URL.createObjectURL(beepWav()));
  audio.onended = () => log(ms(start) + "終わった");
  audio.onerror = () => log(ms(start) + "エラー");
  let settled = false;
  audio.play().then(() => { settled = true; log(ms(start) + "再生を始めた(play が、成功)"); }).catch((e) => { settled = true; log(ms(start) + "再生できない: " + e.name); });
  setTimeout(() => { if (!settled) log(ms(start) + "5秒たっても、play の結果が、出ません"); }, 5000);
});

document.getElementById("t-beep-web").addEventListener("click", () => {
  const start = t0();
  log("【② Web Audio の、ピッ】");
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { log("Web Audio が、ありません"); return; }
  const ctx = new Ctx();
  log(ms(start) + "状態: " + ctx.state);
  ctx.resume().then(() => {
    log(ms(start) + "再開後の状態: " + ctx.state);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    osc.frequency.value = 440;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => { log(ms(start) + "終わった"); ctx.close(); };
  }).catch((e) => log(ms(start) + "エラー: " + e.name));
});

document.getElementById("t-speak-min").addEventListener("click", () => speakTest("③ いちばん簡単な出し方", "Hello. This is a test of the English voice.", { lang: "en-US" }));
document.getElementById("t-speak-voice").addEventListener("click", () => {
  const en = synth ? synth.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("en")) : [];
  speakTest("④ 声を指定", "Hello. This is a test of the English voice.", { lang: "en-US", voice: en[0] });
  if (!en[0]) log("(英語の声が、見つかりません)");
});
document.getElementById("t-speak-rate").addEventListener("click", () => speakTest("⑤ 速さ 0.8", "Hello. This is a test of the English voice.", { lang: "en-US", rate: 0.8 }));
document.getElementById("t-speak-ja").addEventListener("click", () => speakTest("⑥ 日本語", "こんにちは。声の確認です。", { lang: "ja-JP" }));
document.getElementById("t-info").addEventListener("click", showInfo);
document.getElementById("t-clear").addEventListener("click", () => { logEl.textContent = ""; });

showInfo();
if (synth && synth.addEventListener) synth.addEventListener("voiceschanged", () => log("(声の一覧が、更新されました: " + synth.getVoices().length + " 個)"));
