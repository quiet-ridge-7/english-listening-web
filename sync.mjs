// sync.mjs — 練習の記録を、GitHub の非公開リポジトリの1つのファイル(progress.json)に、同期する。
//   GitHub の API(Contents API)だけを使う。合鍵(アクセストークン)は、Authorization ヘッダーにだけ入れる。
//   エラーの文や、画面や、記録に、合鍵は、出さない。
//   fetchFn と apiBase は、差し替えられる(試験用。画面側では、同じ場所(/ で始まる)か、api.github.com だけを許す)。
import { readProgress, mergeProgress, sameProgress, hasProgressData } from "./logic.mjs";

export const SYNC_FILE = "progress.json";
export const GITHUB_API = "https://api.github.com";

// kind: "auth"(合鍵が、だめ) | "repo"(リポジトリが、見つからない) | "conflict"(同時に、書かれた) | "network"(つながらない) | "http"(その他) | "data"(記録が、読めない)
export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// 「所有者/名前」を、取り出す。形が違えば、null。
export function parseRepo(text) {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\s*$/.exec(String(text ?? ""));
  return m ? { owner: m[1], repo: m[2] } : null;
}

// 文字(UTF-8)と、base64 の、変換
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function headers(token, withBody) {
  const h = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (withBody) h["Content-Type"] = "application/json";
  return h;
}

async function call({ fetchFn, url, method = "GET", token, body, timeoutMs = 8000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { method, headers: headers(token, body !== undefined), body, cache: "no-store", signal: ctl.signal });
  } catch {
    throw new SyncError("network", "つながりませんでした");
  } finally {
    clearTimeout(timer);
  }
}

// 同期先の、記録を、読む。 戻り値: { record(記録 | null), sha(ファイルの印 | null) }
export async function pullRemote({ fetchFn = fetch, apiBase = GITHUB_API, repo, token }) {
  const { owner, repo: name } = repo;
  const base = apiBase + "/repos/" + owner + "/" + name;
  const r = await call({ fetchFn, url: base + "/contents/" + SYNC_FILE, token });
  if (r.status === 404) {
    // ファイルが無いのか、リポジトリが、見えないのか、見分ける
    const r2 = await call({ fetchFn, url: base, token });
    if (r2.status === 200) return { record: null, sha: null };
    if (r2.status === 401 || r2.status === 403) throw new SyncError("auth", "合鍵が、使えません");
    throw new SyncError("repo", "リポジトリが、見つかりません");
  }
  if (r.status === 401 || r.status === 403) throw new SyncError("auth", "合鍵が、使えません");
  if (r.status !== 200) throw new SyncError("http", "読めませんでした(" + r.status + ")");
  let info;
  try { info = await r.json(); } catch { throw new SyncError("data", "同期先の記録が、読めません"); }
  if (!info || info.encoding !== "base64" || typeof info.content !== "string" || typeof info.sha !== "string") throw new SyncError("data", "同期先の記録が、読めません");
  let record;
  try { record = readProgress(fromBase64(info.content)); } catch { record = null; }
  if (!record) throw new SyncError("data", "同期先の記録が、記録の形では、ありません(上書きは、しません)");
  return { record, sha: info.sha };
}

// 同期先に、記録を、書く。 sha = いま読んだ、ファイルの印(ファイルが、まだ無ければ、null)。 戻り値: 新しい印
export async function pushRemote({ fetchFn = fetch, apiBase = GITHUB_API, repo, token, record, sha }) {
  const { owner, repo: name } = repo;
  const body = { message: "update progress", content: toBase64(JSON.stringify(record)) };
  if (sha) body.sha = sha;
  const r = await call({ fetchFn, url: apiBase + "/repos/" + owner + "/" + name + "/contents/" + SYNC_FILE, method: "PUT", token, body: JSON.stringify(body) });
  if (r.status === 200 || r.status === 201) {
    try { return (await r.json()).content.sha; } catch { return null; }
  }
  if (r.status === 401 || r.status === 403) throw new SyncError("auth", "合鍵が、使えません(書き込みの権限が、必要です)");
  if (r.status === 404) throw new SyncError("repo", "リポジトリが、見つかりません");
  if (r.status === 409 || r.status === 422) throw new SyncError("conflict", "同時に、書き換えられました");
  throw new SyncError("http", "書けませんでした(" + r.status + ")");
}

// 端末の記録 local と、同期先の記録を、合わせて、(違いがあれば)同期先に、書く。
//   戻り値: { record(合わせた記録), pushed(書いたか) }
//   同期先の記録が、読めない時は、上書きしない(エラー)。端末の記録は、いつも、そのまま、残る(呼ぶ側が、結果を、使うかを、決める)。
export async function syncRecords({ fetchFn = fetch, apiBase = GITHUB_API, repo, token, local, tries = 3 }) {
  for (let i = 0; i < tries; i++) {
    const remote = await pullRemote({ fetchFn, apiBase, repo, token });
    if (!remote.record && !hasProgressData(local)) return { record: local, pushed: false };   // どちらも、空: 何もしない
    const merged = mergeProgress(local, remote.record);
    if (remote.record && sameProgress(merged, remote.record)) return { record: merged, pushed: false };
    try {
      await pushRemote({ fetchFn, apiBase, repo, token, record: merged, sha: remote.sha });
      return { record: merged, pushed: true };
    } catch (e) {
      if (e instanceof SyncError && e.kind === "conflict" && i < tries - 1) continue;   // 読み直して、合わせ直す
      throw e;
    }
  }
  throw new SyncError("conflict", "同時に、書き換えられました");
}
