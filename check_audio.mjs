// check_audio.mjs — 録音した音声ファイル(audio/)が、いまの物語と、合っているかの点検。
//   欠けている音声、文を直したのに作り直していない(古い)音声、物語に無い音声、壊れた音声を、見つける。
//   使い方: node check_audio.mjs      (問題があれば、一覧を出して、終了コード 1)
//   直し方: make_audio.py を、実行する(変わった文だけ、作り直す)。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audioName } from "./logic.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const textMark = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);

// 戻り値: { total(文の数), missing, stale, orphan, broken }(どれも、ファイル名の配列)
export function checkAudio(storiesDir = path.join(ROOT, "stories"), audioDir = path.join(ROOT, "audio")) {
  const manifestPath = path.join(audioDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const files = manifest.files ?? {};
  const wanted = new Map();
  for (const f of fs.readdirSync(storiesDir).filter((n) => /^\d{2}-\d{2}-\d{2}-[a-z]+\.json$/.test(n)).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(storiesDir, f), "utf8"));
    data.sentences.forEach((s, i) => wanted.set(audioName(f, i), textMark(s.text)));
  }
  const missing = [], stale = [], broken = [];
  for (const [name, mark] of wanted) {
    const p = path.join(audioDir, name);
    if (!files[name] || !fs.existsSync(p)) { missing.push(name); continue; }
    if (files[name] !== mark) { stale.push(name); continue; }
    const b = fs.readFileSync(p);
    const isMp3 = b.length > 1000 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));   // ID3、または、フレームの先頭
    if (!isMp3) broken.push(name);
  }
  const orphan = [...new Set([...Object.keys(files), ...fs.readdirSync(audioDir).filter((n) => n.endsWith(".mp3"))])].filter((n) => !wanted.has(n)).sort();
  return { total: wanted.size, missing, stale, orphan, broken };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = checkAudio();
  const bad = r.missing.length + r.stale.length + r.orphan.length + r.broken.length;
  console.log("文: " + r.total + " / 欠け: " + r.missing.length + " / 古い: " + r.stale.length + " / 余り: " + r.orphan.length + " / 壊れ: " + r.broken.length);
  for (const [k, list] of Object.entries({ 欠け: r.missing, 古い: r.stale, 余り: r.orphan, 壊れ: r.broken })) if (list.length) console.log(k + ": " + list.slice(0, 10).join(", ") + (list.length > 10 ? " …" : ""));
  process.exit(bad === 0 ? 0 : 1);
}
