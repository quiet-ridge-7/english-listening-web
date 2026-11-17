// sync_test.mjs — 同期(sync.mjs)の試験。本物の GitHub には、つながない。偽の GitHub(メモリの中だけ)で、確かめる。
//   実行: node sync_test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SyncError, parseRepo, toBase64, fromBase64, pullRemote, pushRemote, syncRecords } from "./sync.mjs";
import { createProgress, readProgress, mergeProgress } from "./logic.mjs";

const failures = [];
const test = async (name, fn) => {
  try { await fn(); console.log("OK " + name); } catch (e) { console.log("NG " + name + "  <- " + (e && e.message)); failures.push(name); }
};

const TOKEN = "ghp_TESTTOKEN_0123456789";
const REPO = { owner: "someone", repo: "records" };

// 偽の GitHub: Contents API の、読む・書く(sha の食い違いは 409)だけ。リクエストを、全部、記録する。
function fakeGitHub({ repoExists = true, token = TOKEN, file = null, rejectFirstPut = 0 } = {}) {
  const state = { file, sha: file ? sha(file) : null, requests: [], putCount: 0, rejectFirstPut, onBeforePut: null };
  function sha(text) { return createHash("sha1").update(text).digest("hex"); }
  state.fetchFn = async (url, options = {}) => {
    const method = options.method || "GET";
    const headers = options.headers || {};
    state.requests.push({ url: String(url), method, headers, body: options.body });
    const json = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (headers.Authorization !== "Bearer " + token) return json(401, { message: "Bad credentials" });
    const u = new URL(url);
    if (u.host !== "api.github.com") return json(404, {});
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/contents\/progress\.json)?$/.exec(u.pathname);
    if (!m || !repoExists || m[1] !== REPO.owner || m[2] !== REPO.repo) return json(404, { message: "Not Found" });
    if (!m[3]) return json(200, { full_name: m[1] + "/" + m[2], private: true });
    if (method === "GET") {
      if (state.file === null) return json(404, { message: "Not Found" });
      return json(200, { encoding: "base64", content: toBase64(state.file).replace(/(.{60})/g, "$1\n"), sha: state.sha });
    }
    if (method === "PUT") {
      state.putCount++;
      if (state.onBeforePut) { const f = state.onBeforePut; state.onBeforePut = null; f(state); }
      if (state.rejectFirstPut > 0) { state.rejectFirstPut--; return json(409, { message: "conflict" }); }
      const body = JSON.parse(options.body);
      if (state.file !== null && body.sha !== state.sha) return json(409, { message: "does not match" });
      if (state.file === null && body.sha) return json(422, { message: "sha not needed" });
      state.file = fromBase64(body.content);
      state.sha = sha(state.file);
      return json(state.putCount === 1 && body.sha === undefined ? 201 : 200, { content: { sha: state.sha } });
    }
    return json(405, {});
  };
  return state;
}

const rec = (over = {}) => ({ ...createProgress(), storyName: "ken", ...over });
const row = (date, time, range, stops = 0) => ({ date, time, story: "Ken", range, level: 1, sectionCount: 1, sentences: 5, stops, completed: true });

await test("parseRepo: 「所有者/名前」だけ受ける", () => {
  assert.deepEqual(parseRepo("someone/records"), { owner: "someone", repo: "records" });
  assert.deepEqual(parseRepo("  a-b/c.d_e  "), { owner: "a-b", repo: "c.d_e" });
  for (const bad of ["", "records", "a/b/c", "/b", "a/", "a b/c", "https://github.com/a/b", "a/b?x=1", null, undefined]) assert.equal(parseRepo(bad), null, String(bad));
});

await test("base64: 日本語も、そのまま、往復できる。改行入りも、読める", () => {
  const s = JSON.stringify({ story: "ケンと山", n: "x".repeat(200000) });
  assert.equal(fromBase64(toBase64(s)), s);
  assert.equal(fromBase64(toBase64("あいう").replace(/(.{4})/g, "$1\n")), "あいう");
});

await test("pull: ファイルが、まだ無い → record は null(リポジトリは、ある)", async () => {
  const gh = fakeGitHub();
  const r = await pullRemote({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN });
  assert.deepEqual(r, { record: null, sha: null });
});

await test("pull: リポジトリが、見つからない → kind=repo。合鍵が、だめ → kind=auth", async () => {
  await assert.rejects(pullRemote({ fetchFn: fakeGitHub({ repoExists: false }).fetchFn, repo: REPO, token: TOKEN }), (e) => e instanceof SyncError && e.kind === "repo");
  await assert.rejects(pullRemote({ fetchFn: fakeGitHub().fetchFn, repo: REPO, token: "wrong" }), (e) => e instanceof SyncError && e.kind === "auth");
});

await test("pull: つながらない → kind=network。記録の形でない物 → kind=data(上書きしない)", async () => {
  await assert.rejects(pullRemote({ fetchFn: async () => { throw new TypeError("Failed to fetch"); }, repo: REPO, token: TOKEN }), (e) => e.kind === "network");
  const gh = fakeGitHub({ file: JSON.stringify({ hello: 1 }) });
  await assert.rejects(pullRemote({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN }), (e) => e.kind === "data");
  const gh2 = fakeGitHub({ file: "これは JSON ではない" });
  await assert.rejects(syncRecords({ fetchFn: gh2.fetchFn, repo: REPO, token: TOKEN, local: rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] }) }), (e) => e.kind === "data");
  assert.equal(gh2.putCount, 0, "壊れた同期先には、書かない");
});

await test("sync: 同期先が空で、端末に記録がある → 同期先に、書く(はじめての同期)", async () => {
  const gh = fakeGitHub();
  const local = rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  const r = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local });
  assert.equal(r.pushed, true);
  assert.deepEqual(readProgress(gh.file).history, local.history);
  assert.deepEqual(r.record.history, local.history);
});

await test("sync: 同期先も、端末も、空 → 何も、書かない", async () => {
  const gh = fakeGitHub();
  const r = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local: createProgress() });
  assert.equal(r.pushed, false);
  assert.equal(gh.putCount, 0);
});

await test("sync: 同期先に記録があり、端末が空 → 同期先の記録を、使う。書かない", async () => {
  const remote = rec({ level: 2, storyName: "umbrella", sceneIndex: 3, updatedAt: "2026-11-17T02:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  const gh = fakeGitHub({ file: JSON.stringify(remote) });
  const r = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local: createProgress() });
  assert.equal(r.pushed, false);
  assert.equal(r.record.level, 2);
  assert.equal(r.record.storyName, "umbrella");
  assert.equal(r.record.history.length, 1);
  assert.equal(gh.putCount, 0);
});

await test("sync: 両方に、別の練習がある → 合わせて、両方に、反映(履歴は、足し合わせ。位置は、新しい方)", async () => {
  const pc = rec({ sceneIndex: 2, updatedAt: "2026-11-17T05:00:00Z", history: [row("2026-11-17", "09:00", "01-01-01"), row("2026-11-17", "09:10", "01-01-02")], sectionStats: { "01-01-01": { sentences: 5, stops: 2, date: "2026-11-17" } } });
  const phone = rec({ sceneIndex: 5, updatedAt: "2026-11-17T08:00:00Z", history: [row("2026-11-17", "09:00", "01-01-01"), row("2026-11-17", "07:30", "01-01-04")], sectionStats: { "01-01-04": { sentences: 5, stops: 0, date: "2026-11-17" } } });
  const gh = fakeGitHub({ file: JSON.stringify(phone) });
  const r = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local: pc });
  assert.equal(r.pushed, true);
  assert.deepEqual(r.record.history.map((h) => h.time + " " + h.range), ["07:30 01-01-04", "09:00 01-01-01", "09:10 01-01-02"], "同じ練習は、1つ。時刻の順");
  assert.equal(r.record.sceneIndex, 5, "位置は、更新の新しい方(iPhone)");
  assert.deepEqual(Object.keys(r.record.sectionStats).sort(), ["01-01-01", "01-01-04"]);
  assert.deepEqual(readProgress(gh.file).history, r.record.history, "同期先にも、同じ中身");
});

await test("sync: 同期して、同じなら、書かない(2回目は、通信が、読むだけ)", async () => {
  const gh = fakeGitHub();
  const local = rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local });
  const puts = gh.putCount;
  const r2 = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local: readProgress(gh.file) });
  assert.equal(r2.pushed, false);
  assert.equal(gh.putCount, puts);
});

await test("sync: 同時に書かれた(409)→ 読み直して、合わせ直して、書く。相手の記録も、消えない", async () => {
  const base = rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "08:00", "01-01-01")] });
  const gh = fakeGitHub({ file: JSON.stringify(base) });
  const other = rec({ updatedAt: "2026-11-17T03:00:00Z", history: [row("2026-11-17", "08:00", "01-01-01"), row("2026-11-17", "08:30", "01-01-02")] });
  // こちらが、書く直前に、別の端末が、書く
  gh.onBeforePut = (st) => { st.file = JSON.stringify(other); st.sha = createHash("sha1").update(st.file).digest("hex"); };
  const mine = rec({ updatedAt: "2026-11-17T02:00:00Z", history: [row("2026-11-17", "08:00", "01-01-01"), row("2026-11-17", "08:45", "01-01-03")] });
  const r = await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local: mine });
  assert.equal(r.pushed, true);
  assert.deepEqual(readProgress(gh.file).history.map((h) => h.range), ["01-01-01", "01-01-02", "01-01-03"]);
});

await test("sync: 何度も、書き換えられ続けたら、あきらめる(kind=conflict)。端末の記録は、呼ぶ側に、残る", async () => {
  const gh = fakeGitHub({ file: JSON.stringify(rec({ updatedAt: "2026-11-17T01:00:00Z" })), rejectFirstPut: 99 });
  const local = rec({ updatedAt: "2026-11-17T02:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  await assert.rejects(syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local, tries: 3 }), (e) => e.kind === "conflict");
  assert.equal(gh.putCount, 3);
});

await test("合鍵: Authorization ヘッダーにだけ、ある。アドレスにも、中身にも、エラーの文にも、出ない。送り先は、api.github.com だけ", async () => {
  const gh = fakeGitHub();
  const local = rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  await syncRecords({ fetchFn: gh.fetchFn, repo: REPO, token: TOKEN, local });
  for (const q of gh.requests) {
    assert.ok(q.url.startsWith("https://api.github.com/repos/someone/records"), q.url);
    assert.ok(!q.url.includes(TOKEN), "アドレスに、合鍵が、ある");
    assert.ok(!(q.body ?? "").includes(TOKEN), "中身に、合鍵が、ある");
    assert.equal(q.headers.Authorization, "Bearer " + TOKEN);
  }
  assert.ok(!gh.file.includes(TOKEN), "同期先の記録に、合鍵が、ある");
  const errors = [];
  for (const f of [fakeGitHub({ repoExists: false }).fetchFn, async () => { throw new TypeError("boom " + TOKEN); }, fakeGitHub({ token: "other" }).fetchFn]) {
    try { await syncRecords({ fetchFn: f, repo: REPO, token: TOKEN, local }); } catch (e) { errors.push(e.message); }
  }
  assert.equal(errors.length, 3);
  assert.ok(errors.every((m) => !m.includes(TOKEN)), errors.join(" / "));
});

await test("合わせ方: 元の記録は、書き換えない。同じ記録同士なら、同じ記録", () => {
  const a = rec({ updatedAt: "2026-11-17T01:00:00Z", history: [row("2026-11-17", "10:00", "01-01-01")] });
  const copy = JSON.stringify(a);
  const m = mergeProgress(a, a);
  assert.equal(JSON.stringify(a), copy);
  assert.deepEqual(m.history, a.history);
});

console.log(failures.length === 0 ? "\nsync_test: すべて通りました" : "\nsync_test: 失敗 " + failures.length + " 件: " + failures.join(" / "));
process.exit(failures.length === 0 ? 0 : 1);
