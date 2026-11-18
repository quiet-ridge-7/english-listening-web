// logic_test.mjs — logic.mjs と、stories/ フォルダ(物語のデータ)の、テスト。
//   実行: node logic_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkAudio } from "./check_audio.mjs";
import {
  READING_RATE, SPEEDS, isSpeed, LEVEL_BOUNDS, LEGACY_STORY_NAMES, LIMITS, DEFAULT_SECTION_COUNT, LEGACY_TARGET_SECONDS,
  countWords, estimateSeconds, formatSeconds, todayString, averageWords, detectLevel,
  pad2, sectionCode, sectionFileName, SECTION_FILE_PATTERN, parseSectionFileName,
  levelsOf, maxLevelOf, storiesOfLevel, findStory, flattenSections, sectionSeconds,
  planSession, assembleSession, audioName, rangeLabel, rangeKey,
  resolvePosition, nextSectionPosition, nextBlockPosition, positionAfterSession,
  createProgress, readProgress, parseProgress, hasProgressData, chooseSource, recordSession, groupHistory, mergeProgress, sameProgress,
  GOOD_RATE, sectionResults, updateSectionStats, isGoodSection,
} from "./logic.mjs";
import { STORIES_DIR, loadCatalog, loadSection, allStories, sessionOf } from "./test_data.mjs";
import { checkStories } from "./check_stories.mjs";

const CATALOG = loadCatalog();

// ---- countWords ----
assert.equal(countWords("Ken wakes up early today."), 5);
assert.equal(countWords("  It's   fine. "), 2);            // アポストロフィは、単語の一部
assert.equal(countWords(""), 0);
assert.equal(countWords("“Yes, I am,” says Ken."), 5);     // 引用符と、コンマは、数えない

// ---- estimateSeconds(速いほど、短く) ----
{
  const s = [{ text: "one two three four five six seven eight nine ten" }];   // 10語
  assert.equal(Math.round(estimateSeconds(s, 1.0)), 4);                         // 150語/分 → 10語 = 4秒
  assert.ok(estimateSeconds(s, 0.5) > estimateSeconds(s, 1.0), "ゆっくりなら、長くかかる");
  assert.equal(estimateSeconds(s), estimateSeconds(s, READING_RATE), "速さを省くと、固定の速さ");
}
assert.equal(READING_RATE, 0.8, "読む速さは、レベルと関係なく、固定(速度ボタンを足すまで)");

// ---- formatSeconds / todayString ----
assert.equal(formatSeconds(30), "30秒");
assert.equal(formatSeconds(60), "1分");
assert.equal(formatSeconds(90), "1分30秒");
assert.equal(todayString(new Date(2026, 10, 5)), "2026-11-05");   // 月は、0 から数える(10 = 11月)

// ---- レベルの自動判定 ----
{
  const s = (n) => [{ text: Array.from({ length: n }, (_, i) => "w" + String.fromCharCode(97 + (i % 26))).join(" ") }];
  assert.equal(averageWords(s(5)), 5);
  assert.equal(detectLevel(s(5)), 1);
  assert.equal(detectLevel(s(6)), 1, "6.5語未満は、レベル1");
  assert.equal(detectLevel(s(7)), 2, "6.5語以上は、レベル2");
  assert.equal(detectLevel(s(9)), 2, "9.5語未満は、レベル2");
  assert.equal(detectLevel(s(10)), 3, "9.5語以上は、レベル3");
  assert.equal(detectLevel(s(30)), 3);
  assert.deepEqual(LEVEL_BOUNDS, [6.5, 9.5]);
  assert.equal(averageWords([]), 0);
  // 文ごとの平均(長い文と短い文が、まざった時)
  assert.equal(detectLevel([...s(4), ...s(10)]), 2, "平均 7 語 → レベル2");
}

// ---- ファイル名の決まり ----
{
  assert.equal(pad2(1), "01");
  assert.equal(pad2(12), "12");
  assert.equal(sectionCode(1, 2, 3), "01-02-03");
  assert.equal(sectionFileName(3, 4, 22, "openboat"), "03-04-22-openboat.json");
  assert.deepEqual(parseSectionFileName("02-03-05-bakery.json"), { level: 2, story: 3, section: 5, name: "bakery" });
  for (const bad of ["1-1-1-ken.json", "01-01-01-ken-and.json", "01-01-01-Ken.json", "01-01-01-ken.txt", "01-01-ken.json", "001-01-01-ken.json", "01-01-01-.json", "index.json"]) {
    assert.equal(SECTION_FILE_PATTERN.test(bad), false, "決まりに合わない名前を、通してしまう: " + bad);
    assert.equal(parseSectionFileName(bad), null);
  }
}

// ---- 物語のデータ(stories/ フォルダ): 点検(check_stories.mjs)と、このアプリの物語の、決まり ----
{
  const result = checkStories(STORIES_DIR);   // ファイル名の決まり、目次との一致、自動判定 = ファイル名のレベル、など
  assert.deepEqual(result.warnings, [], "境目に近い物語が、ある: " + result.warnings.join(" / "));
  assert.equal(result.stories, 10);
  assert.equal(result.sections, 94);
  // 節の題名は、「題名(番号)」の形(例: The Morning(1))。「1/2」のような、分数は、使わない
  for (const { level, story } of allStories(CATALOG)) {
    for (const sec of story.sections) {
      for (const t of [sec.title, sec.titleJa]) assert.match(t, /^.*\S\(\d+\)$/, "節の題名は「題名(番号)」の形: レベル " + level + " " + story.name + " " + sec.no + "節 " + t);
      assert.ok(!sec.title.includes("/") && !sec.titleJa.includes("/"), "節の題名に、分数(1/2)を、使わない");
    }
  }

  // 取り込んだ物語: 出典の表示
  const boat = findStory(CATALOG, 3, "openboat");
  assert.ok(boat, "The Open Boat は、レベル3にある");
  assert.ok(boat.credit && boat.credit.includes("learningenglish.voanews.com"), "出典の表示が、必要");
  assert.ok(boat.sourceUrl.startsWith("https://learningenglish.voanews.com/"), "出典のURLが、VOAではない");
  assert.equal(boat.sections.reduce((n, s) => n + s.sentences, 0), 129, "The Open Boat の文の数が、取り出した時(129文)と、違う");
  assert.equal(storiesOfLevel(CATALOG, 1).some((s) => s.name === "openboat"), false, "The Open Boat は、レベル3だけ");
  // 同じ筋の、3つの難しさの版: ケン・赤い傘・パン屋は、3つのレベル全部にある(合計 3×3 + 1 = 10 のストーリー)
  for (const name of ["ken", "umbrella", "bakery"]) {
    for (const level of [1, 2, 3]) assert.ok(findStory(CATALOG, level, name), name + " が、レベル " + level + " に、無い");
  }
  assert.equal(allStories(CATALOG).length, 10);
}

// ---- 目次の、道具 ----
{
  const ken1 = findStory(CATALOG, 1, "ken");
  assert.equal(findStory(CATALOG, 1, "openboat"), null);
  const flat = flattenSections(ken1, 1);
  assert.equal(flat.length, 8);
  assert.deepEqual(flat.slice(0, 3).map((x) => x.code), ["01-01-01", "01-01-02", "01-01-03"]);
  assert.deepEqual(flat.map((x) => x.index), [0, 1, 2, 3, 4, 5, 6, 7], "通し番号は、0 から");
  assert.equal(flattenSections(findStory(CATALOG, 3, "openboat"), 3).at(-1).code, "03-04-22");
  assert.deepEqual(storiesOfLevel(CATALOG, 9), []);
}

// ---- readProgress / hasProgressData / chooseSource(記録を、ファイルと、画面の間で、やりとりする時の判断) ----
{
  assert.equal(readProgress(null), null);
  assert.equal(readProgress(""), null);
  assert.equal(readProgress("壊れた"), null, "壊れた物は、null(はじめの状態には、しない)");
  assert.equal(readProgress(JSON.stringify({ level: 0, targetSeconds: 30, sceneIndex: 0, history: [] })), null);
  const ok = readProgress(JSON.stringify({ level: 2, targetSeconds: 60, sceneIndex: 1, storyName: "umbrella", history: [], voiceName: "X", updatedAt: "2026-11-17T00:00:00.000Z" }));
  assert.deepEqual([ok.level, ok.voiceName, ok.updatedAt, ok.storyName], [2, "X", "2026-11-17T00:00:00.000Z", "umbrella"], "余分な項目(声、更新時刻)も、残る");

  // 以前の記録: 物語の番号(storyIndex)は、名前に、直す
  const legacy = (i) => readProgress(JSON.stringify({ level: 2, targetSeconds: 30, sceneIndex: 3, storyIndex: i, history: [] }));
  assert.deepEqual(LEGACY_STORY_NAMES, ["ken", "umbrella", "bakery", "openboat"]);
  assert.equal(legacy(0).storyName, "ken");
  assert.equal(legacy(2).storyName, "bakery");
  assert.equal(legacy(3).storyName, "openboat");
  assert.equal("storyIndex" in legacy(1), false, "storyIndex は、残さない");
  assert.equal(readProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0, history: [] })).storyName, "ken", "物語の指定が、全く無い古い記録は、ken");

  assert.equal(hasProgressData(createProgress()), false, "はじめの状態は、中身なし");
  assert.equal(hasProgressData({ ...createProgress(), updatedAt: "2026-11-17T00:00:00.000Z" }), true);
  assert.equal(hasProgressData({ ...createProgress(), history: [{}] }), true);
  assert.equal(hasProgressData(null), false);

  const empty = createProgress();
  const old = { ...createProgress(), updatedAt: "2026-11-16T10:00:00.000Z", history: [{}] };
  const newer = { ...createProgress(), updatedAt: "2026-11-17T10:00:00.000Z", history: [{}] };
  assert.equal(chooseSource(null, empty), "none", "ファイルも画面も、空 → 何もしない");
  assert.equal(chooseSource(null, old), "local", "ファイルが無く、画面に記録がある → ファイルへ、取り込む");
  assert.equal(chooseSource(old, empty), "remote", "画面が空 → ファイルを使う(ブラウザの保存データが、消えても、記録は、戻る)");
  assert.equal(chooseSource(newer, old), "remote", "ファイルのほうが、新しい → ファイル");
  assert.equal(chooseSource(old, newer), "local", "画面のほうが、新しい(ファイルに書けなかった時)→ 画面の記録を、ファイルへ");
  assert.equal(chooseSource(old, { ...old }), "remote", "同じ時刻 → ファイル");
  assert.equal(chooseSource({ ...createProgress(), history: [{}] }, newer), "local", "ファイルに更新時刻が無い古い記録 → 画面が、新しい扱い");
}

// ---- resolvePosition / nextSectionPosition / nextBlockPosition / positionAfterSession(レベル・ストーリー・節の、位置) ----
{
  const pos = (level, storyName, sceneIndex) => ({ level, storyName, sceneIndex });
  // 位置を、目次に合わせる
  assert.deepEqual(resolvePosition(CATALOG, pos(2, "umbrella", 3)), pos(2, "umbrella", 3), "正しい位置は、そのまま");
  assert.deepEqual(resolvePosition(CATALOG, pos(1, "", 0)), pos(1, "ken", 0), "物語が、空なら、そのレベルの01番");
  assert.deepEqual(resolvePosition(CATALOG, pos(1, "nothing", 5)), pos(1, "ken", 0), "目次に無い名前は、そのレベルの01番(節も、先頭)");
  assert.deepEqual(resolvePosition(CATALOG, pos(1, "openboat", 5)), pos(3, "openboat", 5), "そのレベルに無く、別のレベルにある物語は、そのレベルへ");
  assert.deepEqual(resolvePosition(CATALOG, pos(9, "ken", 2)), pos(1, "ken", 2), "目次に無いレベルは、最初のレベルへ");
  assert.deepEqual(resolvePosition(CATALOG, pos(1, "ken", 8)), pos(1, "ken", 0), "節の番号が、節の数を超えたら、先頭へ(剰余)");
  assert.deepEqual(resolvePosition(CATALOG, pos(1, "ken", 19)), pos(1, "ken", 3));

  // 次のストーリー(同じレベルの中で、1周する)

  // 右の列の並びで、1つ先の節
  assert.deepEqual(nextSectionPosition(CATALOG, pos(1, "ken", 0)), pos(1, "ken", 1), "同じ物語の、次の節");
  assert.deepEqual(nextSectionPosition(CATALOG, pos(1, "ken", 6)), pos(1, "ken", 7));
  assert.deepEqual(nextSectionPosition(CATALOG, pos(1, "ken", 7)), pos(1, "umbrella", 0), "物語の最後の節の次は、次の物語の、最初の節");
  assert.deepEqual(nextSectionPosition(CATALOG, pos(1, "bakery", 7)), pos(2, "ken", 0), "レベルの最後の物語の、最後の節の次は、次のレベルの、最初の節");
  assert.deepEqual(nextSectionPosition(CATALOG, pos(2, "bakery", 7)), pos(3, "ken", 0));
  assert.deepEqual(nextSectionPosition(CATALOG, pos(3, "bakery", 7)), pos(3, "openboat", 0), "レベル3は、4本目(openboat)が、ある");
  assert.deepEqual(nextSectionPosition(CATALOG, pos(3, "openboat", 20)), pos(3, "openboat", 21));
  assert.deepEqual(nextSectionPosition(CATALOG, pos(3, "openboat", 21)), pos(1, "ken", 0), "いちばん最後の次は、いちばん最初(1周する)");
  // 右の列を、頭から、最後まで、たどると、全部の節を、1回ずつ通って、元に戻る
  {
    let cur = pos(1, "ken", 0);
    const seen = [];
    do { seen.push(cur.level + "/" + cur.storyName + "/" + cur.sceneIndex); cur = nextSectionPosition(CATALOG, cur); } while (cur.level !== 1 || cur.storyName !== "ken" || cur.sceneIndex !== 0);
    assert.equal(seen.length, 94, "全部の節(94個)を、1回ずつ");
    assert.equal(new Set(seen).size, 94);
  }

  // 「次の節にする」: 節の数ぶん進む(次のまとまりの、最初の節)
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 0), 1), pos(1, "ken", 1), "1節なら、1つ先");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 0), 2), pos(1, "ken", 2), "2節なら、2つ先(範囲が、重ならない)");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 0), 3), pos(1, "ken", 3));
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 5), 2), pos(1, "ken", 7), "最後の、半端なまとまり(07 のみ)へ");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 6), 2), pos(1, "umbrella", 0), "物語の最後のまとまり(07〜08)の次は、次の物語");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "ken", 5), 3), pos(1, "umbrella", 0), "06〜08 で、物語が終わる → 次の物語");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "bakery", 6), 2), pos(2, "ken", 0), "レベルの最後のまとまりの次は、次のレベル");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(3, "openboat", 20), 3), pos(1, "ken", 0), "いちばん最後の次は、最初");
  assert.deepEqual(nextBlockPosition(CATALOG, pos(1, "nothing", 0), 2), nextSectionPosition(CATALOG, pos(1, "nothing", 0)), "物語が、目次に無い時は、1つ先と同じ(止まらない)");
  for (const c of [1, 2, 3, 4, 5]) {
    // 右の列を、頭から、節の数ごとに、たどる: 全部の節を、1回ずつ(重ならず、抜けず)通って、元に戻る
    let cur = pos(1, "ken", 0);
    let covered = 0;
    const seen = new Set();
    do {
      const story = findStory(CATALOG, cur.level, cur.storyName);
      for (let i = cur.sceneIndex; i < Math.min(cur.sceneIndex + c, story.sections.length); i++) {
        const key = cur.level + "/" + cur.storyName + "/" + i;
        assert.ok(!seen.has(key), c + "節ずつ: 重なっている: " + key);
        seen.add(key);
        covered++;
      }
      cur = nextBlockPosition(CATALOG, cur, c);
    } while (cur.level !== 1 || cur.storyName !== "ken" || cur.sceneIndex !== 0);
    assert.equal(covered, 94, c + "節ずつ: 全部の節(94個)を、1回ずつ");
  }

  // 練習の後の位置 = 聞いた節の、すぐ後ろ(表紙の「次の節にする」と、同じ)
  const after = (level, name, idx, count) => positionAfterSession(CATALOG, planSession(CATALOG, pos(level, name, idx), { sectionCount: count }));
  assert.deepEqual(after(1, "ken", 0, 1), pos(1, "ken", 1), "1節の練習の後は、1つ先の節");
  assert.deepEqual(after(1, "ken", 0, 2), pos(1, "ken", 2), "2節の練習の後は、2つ先");
  assert.deepEqual(after(1, "ken", 6, 3), pos(1, "umbrella", 0), "物語の最後まで聞いた → 次のストーリーの、最初の節");
  assert.deepEqual(after(1, "ken", 7, 1), pos(1, "umbrella", 0));
  assert.deepEqual(after(1, "bakery", 7, 1), pos(2, "ken", 0), "レベルの最後の物語の最後 → 次のレベルの、最初の節(レベルが変わるのは、ここだけ)");
  assert.deepEqual(after(3, "openboat", 21, 1), pos(1, "ken", 0), "いちばん最後の次は、最初");
  // どの節の数でも、「練習の後の位置」は、表紙の「次の節にする」と、一致する
  for (const c of [1, 2, 3, 4, 5]) {
    for (const lv of CATALOG.levels) for (const st of lv.stories) for (let i = 0; i < st.sections.length; i += c) {
      assert.deepEqual(after(lv.level, st.name, i, c), nextBlockPosition(CATALOG, pos(lv.level, st.name, i), c));
    }
  }
  // 1節ずつ、一覧の順に、94回で、1周する(レベルが、勝手に、飛ばない)
  {
    const order = [];
    for (const lv of CATALOG.levels) for (const st of lv.stories) for (let i = 0; i < st.sections.length; i++) order.push(lv.level + "/" + st.name + "/" + i);
    let cur = pos(1, "ken", 0);
    for (const want of order) {
      assert.equal(cur.level + "/" + cur.storyName + "/" + cur.sceneIndex, want);
      cur = after(cur.level, cur.storyName, cur.sceneIndex, 1);
    }
    assert.deepEqual(cur, pos(1, "ken", 0), "1周して、元に戻る");
  }
}

// ---- planSession / assembleSession(どの節を読み込むか。読み込んだ節から、文を組み立てる) ----
{
  const load = (plan) => plan.sections.map((sec) => loadSection(sec.file));
  const pos = (level, storyName, sceneIndex) => ({ level, storyName, sceneIndex });
  // 1回の練習 = 1つの節(はじめの設定)
  assert.equal(DEFAULT_SECTION_COUNT, 1);
  assert.deepEqual(LIMITS, { minSections: 1, maxSections: 5 });
  const p1 = planSession(CATALOG, pos(1, "ken", 0));
  assert.equal(p1.sections.length, 1, "設定を省くと、1節");
  assert.deepEqual(p1.sections.map((x) => x.file), ["01-01-01-ken.json"]);
  assert.equal(p1.nextIndex, 1);
  assert.equal(p1.storyEnded, false);
  assert.equal(p1.rate, READING_RATE);
  assert.equal(p1.story.name, "ken");
  // 節の数を、指定する(続けて聞く節)
  for (const n of [1, 2, 3, 5]) {
    const pn = planSession(CATALOG, pos(1, "ken", 0), { sectionCount: n });
    assert.deepEqual(pn.sections.map((x) => x.file), Array.from({ length: n }, (_, i) => sectionFileName(1, 1, i + 1, "ken")), n + "節: 先頭から、順に、必要なファイルだけ");
    assert.equal(pn.nextIndex, n);
  }
  // 物語の終わりを、越えない
  const pEnd = planSession(CATALOG, pos(1, "ken", 6), { sectionCount: 5 });
  assert.deepEqual([pEnd.sections.length, pEnd.nextIndex, pEnd.storyEnded], [2, 8, true], "残りは、2節だけ");
  assert.equal(planSession(CATALOG, pos(1, "ken", 7), { sectionCount: 1 }).storyEnded, true, "最後の節を聞けば、物語の終わり");
  assert.equal(planSession(CATALOG, pos(1, "ken", 6), { sectionCount: 1 }).storyEnded, false);

  // 組み立て
  const p2 = planSession(CATALOG, pos(1, "ken", 0), { sectionCount: 2 });
  const s2 = assembleSession(p2, load(p2));
  assert.equal(s2.sentences.length, p2.sections.reduce((n, x) => n + x.sentences, 0));
  assert.deepEqual([s2.sentences[0].number, s2.sentences.at(-1).number], [1, s2.sentences.length], "番号は、1 からの、連番");
  assert.equal(s2.sentences[0].sectionCode, "01-01-01");
  assert.equal(s2.sentences[5].sectionCode, "01-01-02", "6文目から、2つ目の節");
  assert.ok(s2.sentences.every((x) => x.ja && x.note), "日本語訳と、解説が、付いている");
  assert.equal(rangeLabel(p2), "01-01-01 〜 01-01-02");
  assert.equal(rangeKey(p2), "01-01-01〜01-01-02");
  assert.equal(rangeLabel(p1), "01-01-01", "1つの節だけなら、「〜」は、付けない");
  assert.equal(rangeKey(p1), "01-01-01");
  assert.ok(Math.abs(p2.estimatedSeconds - p2.sections.reduce((n, x) => n + sectionSeconds(x), 0)) < 1e-9);

  // 途中の節から / 取り込んだ物語(レベル3の4番)
  assert.equal(planSession(CATALOG, pos(2, "umbrella", 4), { sectionCount: 1 }).sections[0].code, "02-02-05", "指定した節から、始める");
  const pb = planSession(CATALOG, pos(3, "openboat", 5), { sectionCount: 1 });
  assert.equal(pb.sections[0].code, "03-04-06");
  assert.equal(pb.sections[0].file, "03-04-06-openboat.json");
  // 読む速さは、レベルと関係ない
  assert.equal(planSession(CATALOG, pos(1, "ken", 0)).rate, planSession(CATALOG, pos(3, "ken", 0)).rate);
  // 速さを、指定できる(速度ボタンを足す時の、準備): ゆっくりなら、同じ節でも、時間が、長い
  const slow = planSession(CATALOG, pos(1, "ken", 0), { rate: 0.5 });
  assert.ok(slow.estimatedSeconds > p1.estimatedSeconds);
  assert.equal(slow.rate, 0.5);
  // 位置が、おかしい時は、止まる
  assert.throws(() => planSession(CATALOG, pos(1, "openboat", 0)), /ありません/);
  assert.throws(() => planSession(CATALOG, pos(9, "ken", 0)), /ありません/);

  // 目次からの見積もりと、読み込んだ文からの見積もりが、近い(どの物語でも)
  for (const { level, story } of allStories(CATALOG)) {
    const sess = sessionOf(level, story.name, 0, 2, CATALOG);
    assert.ok(Math.abs(estimateSeconds(sess.sentences) - sess.estimatedSeconds) < 0.5, story.name + ": 目次からの見積もりと、文からの見積もりが、ずれている");
  }
  // データが、足りない時は、止まる
  assert.throws(() => assembleSession(p2, p2.sections.map(() => ({}))), /文が/);
}

// ---- 節ごとの結果(わからなかった文が 20% 以下の節 = 緑) ----
{
  assert.equal(GOOD_RATE, 0.2);
  // 3つの節(各5文)を、続けて聞く練習
  const sents = [];
  for (const code of ["01-01-01", "01-01-02", "01-01-03"]) for (let i = 0; i < 5; i++) sents.push({ sectionCode: code });
  const R = (judged, ...stopList) => sectionResults(sents, judged, new Set(stopList));
  assert.deepEqual(R(15, 1, 7, 8), [{ code: "01-01-01", sentences: 5, stops: 1 }, { code: "01-01-02", sentences: 5, stops: 2 }, { code: "01-01-03", sentences: 5, stops: 0 }], "全部答えた");
  assert.deepEqual(R(12, 1, 7, 8), [{ code: "01-01-01", sentences: 5, stops: 1 }, { code: "01-01-02", sentences: 5, stops: 2 }], "3つ目の節は、途中までなので、入れない");
  assert.deepEqual(R(5), [{ code: "01-01-01", sentences: 5, stops: 0 }], "ちょうど1つ目の節を、答え終えた");
  assert.deepEqual(R(4, 0), [], "1つ目の節も、途中なら、空");
  assert.deepEqual(R(0), []);
  assert.deepEqual(sectionResults([], 0, new Set()), []);
  // 「いまの位置」より後の、わからなかった印は、数えない(答えていない文の印)
  assert.deepEqual(R(5, 9), [{ code: "01-01-01", sentences: 5, stops: 0 }]);

  // 表の更新: 新しい結果で、置き換える。元の表は、書き換えない
  const a = updateSectionStats({}, R(15, 1, 7, 8), "2026-11-17");
  assert.deepEqual(a["01-01-02"], { sentences: 5, stops: 2, date: "2026-11-17" });
  const b = updateSectionStats(a, [{ code: "01-01-02", sentences: 5, stops: 0 }], "2026-11-18");
  assert.deepEqual(b["01-01-02"], { sentences: 5, stops: 0, date: "2026-11-18" }, "やり直した結果に、置き換わる");
  assert.deepEqual(a["01-01-02"].stops, 2, "元の表は、書き換えない");
  assert.deepEqual(b["01-01-01"], a["01-01-01"], "ほかの節は、そのまま");
  assert.deepEqual(updateSectionStats(undefined, [], "x"), {});

  // 緑の判定: 20% 以下(ちょうど 20% も、緑)
  assert.equal(isGoodSection({ sentences: 5, stops: 0 }), true, "0%");
  assert.equal(isGoodSection({ sentences: 5, stops: 1 }), true, "ちょうど 20% は、緑");
  assert.equal(isGoodSection({ sentences: 5, stops: 2 }), false, "40%");
  assert.equal(isGoodSection({ sentences: 10, stops: 2 }), true);
  assert.equal(isGoodSection({ sentences: 10, stops: 3 }), false, "30%");
  assert.equal(isGoodSection({ sentences: 7, stops: 1 }), true, "14%");
  assert.equal(isGoodSection({ sentences: 4, stops: 1 }), false, "25%");
  assert.equal(isGoodSection(undefined), false, "結果が無い節は、緑にしない");
  assert.equal(isGoodSection({ sentences: 0, stops: 0 }), false);

  // 記録の読み書き: 節ごとの結果の、表が、残る。形が壊れていたら、空にする
  const p = readProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0, history: [], sectionStats: { "01-01-01": { sentences: 5, stops: 1, date: "d" } } }));
  assert.deepEqual(p.sectionStats, { "01-01-01": { sentences: 5, stops: 1, date: "d" } });
  assert.deepEqual(readProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0, history: [] })).sectionStats, {}, "古い記録には、無い → 空");
  assert.deepEqual(readProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0, history: [], sectionStats: "壊れた" })).sectionStats, {});
  assert.deepEqual(readProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0, history: [], sectionStats: [1] })).sectionStats, {});
  // 練習を記録しても、節ごとの結果の表は、消えない
  const withStats = { ...createProgress(), sectionStats: { x: { sentences: 5, stops: 0, date: "d" } } };
  const rec = { date: "2026-11-17", level: 1, targetSeconds: 30, sentences: 10, stops: 0, completed: true };
  assert.deepEqual(recordSession(withStats, rec, { level: 1, storyName: "ken", sceneIndex: 2 }).sectionStats, withStats.sectionStats);
  assert.deepEqual(recordSession(withStats, { ...rec, completed: false }, null).sectionStats, withStats.sectionStats);
}

// ---- 記録の表: 日付 × ストーリーごとに、まとめる ----
{
  const row = (date, story, level, range, sentences, stops, completed) => ({ date, story, level, range, sentences, stops, completed, sectionCount: 1 });
  assert.deepEqual(groupHistory([]), []);
  // 同じ日の、同じストーリーは、1行(範囲は、つながっていれば、1つに)
  let g = groupHistory([
    row("2026-11-17", "Ken", 1, "01-01-01〜01-01-02", 10, 1, true),
    row("2026-11-17", "Ken", 1, "01-01-03", 5, 0, true),
    row("2026-11-17", "Ken", 1, "01-01-04〜01-01-05", 10, 2, true),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].date, g[0].story, g[0].level, g[0].range, g[0].count, g[0].sentences, g[0].stops, g[0].status], ["2026-11-17", "Ken", 1, "01-01-01〜01-01-05", 3, 25, 3, "all"]);
  // つながっていない節は、「, 」で、分ける。重なる範囲(同じ節を、もう一度)は、1つにまとめる
  g = groupHistory([row("d", "Ken", 1, "01-01-01〜01-01-02", 10, 0, true), row("d", "Ken", 1, "01-01-02", 5, 0, true), row("d", "Ken", 1, "01-01-05", 5, 0, true)]);
  assert.equal(g[0].range, "01-01-01〜01-01-02, 01-01-05");
  assert.equal(g[0].count, 3);
  // 日付が違えば、別の行。レベルが違っても、別の行。新しい練習が、先
  g = groupHistory([
    row("2026-11-16", "Ken", 1, "01-01-01", 5, 0, true),
    row("2026-11-17", "Ken", 1, "01-01-02", 5, 0, true),
    row("2026-11-17", "Red", 1, "01-02-01", 5, 0, true),
    row("2026-11-17", "Ken", 2, "02-01-01", 5, 0, true),
  ]);
  assert.deepEqual(g.map((x) => x.story + x.level + x.date), ["Ken22026-11-17", "Red12026-11-17", "Ken12026-11-17", "Ken12026-11-16"]);
  // 同じ日に、ケン → 傘 → ケン、と練習したら、ケンの行は、新しい方(最後の練習の位置)
  g = groupHistory([row("d", "Ken", 1, "01-01-01", 5, 0, true), row("d", "Red", 1, "01-02-01", 5, 0, true), row("d", "Ken", 1, "01-01-02", 5, 0, true)]);
  assert.deepEqual(g.map((x) => x.story), ["Ken", "Red"]);
  // 範囲は、最後まで聞いた回だけ(途中でやめた回の、予定の範囲は、入れない)。最後まで聞いた回が無ければ、その予定の範囲
  g = groupHistory([row("d", "K", 1, "01-01-01〜01-01-02", 10, 0, true), row("d", "K", 1, "01-01-03〜01-01-04", 2, 0, false)]);
  assert.equal(g[0].range, "01-01-01〜01-01-02");
  assert.equal(g[0].status, "some");
  assert.equal(groupHistory([row("d", "K", 1, "01-01-03〜01-01-04", 2, 0, false)])[0].range, "01-01-03〜01-01-04");
  // 状態: 全部最後まで = all / 途中でやめた回が混ざる = some / 全部、途中 = none
  assert.equal(groupHistory([row("d", "K", 1, "01-01-01", 5, 0, true), row("d", "K", 1, "01-01-02", 2, 0, false)])[0].status, "some");
  assert.equal(groupHistory([row("d", "K", 1, "01-01-01", 2, 0, false)])[0].status, "none");
  // 読めない範囲(古い形)は、そのまま。範囲が無ければ、「-」。元の履歴は、書き換えない
  const old = [{ date: "d", story: "Old", level: 1, chapters: "1〜2章", sentences: 4, stops: 1, completed: true }, { date: "d", story: "Old", level: 1, sentences: 4, stops: 0, completed: true }];
  const copy = JSON.stringify(old);
  g = groupHistory(old);
  assert.equal(g[0].range, "1〜2章");
  assert.equal(JSON.stringify(old), copy);
  assert.equal(groupHistory([{ date: "d", story: "X", level: 1, sentences: 1, stops: 0, completed: true }])[0].range, "-");
  // 別のストーリーの範囲(レベル-ストーリーが違う記号)は、それぞれ、まとめる
  g = groupHistory([row("d", "Ken", 1, "01-01-01", 5, 0, true), row("d", "Ken", 1, "01-02-01", 5, 0, true)]);
  assert.equal(g[0].range, "01-01-01, 01-02-01");
}

// ---- 読む速さ(0.5 / 0.8 / 1.0 / 1.2 / 1.5) ----
{
  assert.deepEqual(SPEEDS, [0.5, 0.8, 1, 1.2, 1.5]);
  assert.equal(READING_RATE, 0.8, "はじめの速さ");
  assert.ok(isSpeed(1) && isSpeed(1.5) && !isSpeed(0.9) && !isSpeed("1") && !isSpeed(undefined));
  assert.equal(createProgress().rate, 0.8);
  const base = { level: 1, targetSeconds: 30, sceneIndex: 0, history: [] };
  assert.equal(readProgress(JSON.stringify({ ...base, rate: 1.5 })).rate, 1.5, "選べる値は、そのまま");
  assert.equal(readProgress(JSON.stringify(base)).rate, 0.8, "古い記録には、無い → 0.8");
  assert.equal(readProgress(JSON.stringify({ ...base, rate: 3 })).rate, 0.8, "範囲外は、0.8");
  assert.equal(readProgress(JSON.stringify({ ...base, rate: "1.2" })).rate, 0.8, "文字は、0.8");
  // 速さで、練習の長さ(秒)の、見積もりが、変わる
  const at = { level: 1, storyName: "ken", sceneIndex: 0 };
  assert.ok(planSession(CATALOG, at, { rate: 0.5 }).estimatedSeconds > planSession(CATALOG, at, { rate: 1.5 }).estimatedSeconds);
  assert.equal(planSession(CATALOG, at, { rate: 1.2 }).rate, 1.2);
}

// ---- 2つの記録を、合わせる(mergeProgress) ----
{
  const row = (date, time, range, stops = 0) => ({ date, time, story: "Ken", range, level: 1, sectionCount: 1, sentences: 5, stops, completed: true });
  const base = (over = {}) => ({ ...createProgress(), storyName: "ken", ...over });
  assert.equal(mergeProgress(null, null), null);
  const one = base({ updatedAt: "2026-11-17T01:00:00Z" });
  assert.deepEqual(mergeProgress(one, null), one);
  assert.deepEqual(mergeProgress(null, one), one);
  assert.notEqual(mergeProgress(one, null), one, "元の物を、そのまま返さない(コピー)");
  // 履歴: 足し合わせ。同じ行は、増えない。時刻の順
  let m = mergeProgress(
    base({ updatedAt: "2026-11-17T05:00:00Z", history: [row("2026-11-16", "21:00", "01-01-01"), row("2026-11-17", "09:00", "01-01-02")] }),
    base({ updatedAt: "2026-11-17T04:00:00Z", history: [row("2026-11-16", "21:00", "01-01-01"), row("2026-11-17", "08:00", "01-01-03")] }),
  );
  assert.deepEqual(m.history.map((h) => h.date + " " + h.time), ["2026-11-16 21:00", "2026-11-17 08:00", "2026-11-17 09:00"]);
  // 同じ行が、1つの側に、2つあれば、2つ残す(時刻の無い、古い記録の、同じ内容の2回)
  const old = { date: "2026-11-10", story: "Old", level: 1, range: "01-01-01", sentences: 5, stops: 0, completed: true };
  m = mergeProgress(base({ history: [old, old] }), base({ history: [old] }));
  assert.equal(m.history.length, 2);
  m = mergeProgress(base({ history: [old, old] }), base({ history: [old, old] }));
  assert.equal(m.history.length, 2, "同じ物を、何度、合わせても、増えない");
  // 最新の 200 件
  const many = (n, day) => Array.from({ length: n }, (_, i) => row(day, String(i).padStart(2, "0") + ":" + "00", "01-01-0" + (i % 8 + 1), i % 5));
  m = mergeProgress(base({ history: many(150, "2026-11-01") }), base({ history: many(150, "2026-11-02") }));
  assert.equal(m.history.length, 200);
  assert.equal(m.history.at(-1).date, "2026-11-02");
  // 節ごとの結果: 日付の新しい方。同じ日は、更新の新しい記録の方
  m = mergeProgress(
    base({ updatedAt: "2026-11-17T05:00:00Z", sectionStats: { A: { sentences: 5, stops: 0, date: "2026-11-15" }, B: { sentences: 5, stops: 2, date: "2026-11-17" }, C: { sentences: 5, stops: 1, date: "2026-11-16" } } }),
    base({ updatedAt: "2026-11-17T06:00:00Z", sectionStats: { A: { sentences: 5, stops: 3, date: "2026-11-16" }, B: { sentences: 5, stops: 0, date: "2026-11-17" }, D: { sentences: 5, stops: 0, date: "2026-11-14" } } }),
  );
  assert.equal(m.sectionStats.A.stops, 3, "新しい日付(b)");
  assert.equal(m.sectionStats.B.stops, 0, "同じ日は、更新の新しい記録(b)の方");
  assert.equal(m.sectionStats.C.stops, 1, "片方だけ");
  assert.equal(m.sectionStats.D.stops, 0, "片方だけ");
  // 位置・速さ: 更新の新しい方。同じなら、a
  m = mergeProgress(base({ level: 2, storyName: "umbrella", sceneIndex: 3, rate: 1.2, updatedAt: "2026-11-17T05:00:00Z" }), base({ level: 1, storyName: "ken", sceneIndex: 0, rate: 0.8, updatedAt: "2026-11-17T04:00:00Z" }));
  assert.deepEqual([m.level, m.storyName, m.sceneIndex, m.rate, m.updatedAt], [2, "umbrella", 3, 1.2, "2026-11-17T05:00:00Z"]);
  m = mergeProgress(base({ level: 2, updatedAt: "2026-11-17T05:00:00Z" }), base({ level: 3, updatedAt: "2026-11-17T05:00:00Z" }));
  assert.equal(m.level, 2, "同じ時刻なら、a");
  m = mergeProgress(base({ level: 2 }), base({ level: 3, updatedAt: "2026-11-17T01:00:00Z" }));
  assert.equal(m.level, 3, "更新の無い記録(はじめの状態)より、更新のある記録");
  // 元の記録は、書き換えない
  const a = base({ updatedAt: "2026-11-17T05:00:00Z", history: [row("2026-11-17", "09:00", "01-01-01")], sectionStats: { A: { sentences: 5, stops: 0, date: "d" } } });
  const b = base({ updatedAt: "2026-11-17T06:00:00Z", history: [row("2026-11-17", "10:00", "01-01-02")], sectionStats: { A: { sentences: 5, stops: 1, date: "e" } } });
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  mergeProgress(a, b);
  assert.equal(JSON.stringify(a), sa);
  assert.equal(JSON.stringify(b), sb);
  // 合わせる順を、入れ替えても、同じ記録(履歴と、節ごとの結果は、交換できる)
  assert.ok(sameProgress(mergeProgress(a, b), mergeProgress(b, a)));
  // sameProgress: キーの順番は、問わない
  assert.ok(sameProgress({ x: 1, y: { p: 1, q: 2 } }, { y: { q: 2, p: 1 }, x: 1 }));
  assert.ok(!sameProgress({ x: 1 }, { x: 2 }));
}

// ---- 録音した音声ファイル(audio/): 名前と、いまの物語との一致 ----
{
  assert.equal(audioName("01-01-01-ken.json", 0), "01-01-01-ken-01.mp3");
  assert.equal(audioName("03-04-22-openboat.json", 9), "03-04-22-openboat-10.mp3");
  const plan = planSession(CATALOG, { level: 1, storyName: "ken", sceneIndex: 1 }, { sectionCount: 2 });
  const loaded = plan.sections.map((sec) => ({ sentences: Array.from({ length: sec.sentences }, (_, i) => ({ text: "t" + i, ja: "", note: "" })) }));
  const s = assembleSession(plan, loaded);
  assert.deepEqual(s.sentences.map((x) => x.audio).slice(0, 2), ["01-01-02-ken-01.mp3", "01-01-02-ken-02.mp3"], "各文に、音声ファイルの名前が、付く");
  assert.equal(s.sentences[plan.sections[0].sentences].audio, "01-01-03-ken-01.mp3", "2つ目の節は、その節の1文目から数える(通し番号では、ない)");
  if (fs.existsSync(new URL("./audio/manifest.json", import.meta.url))) {
    const r = checkAudio();
    assert.equal(r.total, 489);
    assert.deepEqual([r.missing.length, r.stale.length, r.orphan.length, r.broken.length], [0, 0, 0, 0], "音声が、いまの物語と、合っていない: " + JSON.stringify(r).slice(0, 300));
  }
}

// ---- 記録 ----
{
  const p0 = createProgress();
  assert.deepEqual([p0.level, p0.sectionCount, p0.storyName, p0.sceneIndex, p0.history.length], [1, 1, "", 0, 0]);
  assert.equal(p0.targetSeconds, LEGACY_TARGET_SECONDS, "古いサーバの検査を通すための、互換の値(いまは、使わない)");

  const rec = { date: "2026-11-16", level: 1, targetSeconds: 30, sentences: 10, stops: 0, completed: true };
  const place = { level: 2, storyName: "umbrella", sceneIndex: 3 };
  const p1 = recordSession(p0, { ...rec, sectionCount: 2 }, place);
  assert.deepEqual([p1.level, p1.sectionCount, p1.storyName, p1.sceneIndex, p1.history.length], [2, 1, "umbrella", 3, 1], "節の数は、変えない");
  assert.equal(p1.targetSeconds, 30, "互換の値は、そのまま");
  assert.equal(p0.history.length, 0, "元の記録は、書き換えない");

  // 途中でやめた回は、履歴だけ増やして、レベルも、物語も、節も、変えない
  const p2 = recordSession(p1, { ...rec, date: "2026-11-17", level: 2, sentences: 3, completed: false }, null);
  assert.deepEqual([p2.level, p2.storyName, p2.sceneIndex, p2.history.length], [2, "umbrella", 3, 2]);

  // 履歴は、最新の 200 件だけ
  let p = p0;
  for (let i = 0; i < 250; i++) p = recordSession(p, rec, place);
  assert.equal(p.history.length, 200);

  // 保存の文字 → 読み取り
  assert.deepEqual(parseProgress(JSON.stringify(p1)), p1);
  assert.deepEqual(parseProgress(null), createProgress());
  assert.deepEqual(parseProgress("これは JSON ではない"), createProgress());
  assert.deepEqual(parseProgress(JSON.stringify({ level: 0, targetSeconds: 30, sceneIndex: 0, history: [] })), createProgress(), "レベルが 0 は、不正");
  assert.deepEqual(parseProgress(JSON.stringify({ level: 1, targetSeconds: 5, sceneIndex: 0, history: [] })), createProgress(), "(古い)長さが、範囲外は、不正");

  // 節の数: 古い記録には、無い(1にする)。正しい値は、残る。範囲外や、おかしな値は、1にする
  const sc = (v) => readProgress(JSON.stringify({ level: 1, sceneIndex: 0, history: [], sectionCount: v })).sectionCount;
  assert.equal(readProgress(JSON.stringify({ level: 1, targetSeconds: 120, sceneIndex: 0, history: [] })).sectionCount, 1, "古い記録(秒だけ)は、1節から");
  assert.equal(readProgress(JSON.stringify({ level: 1, targetSeconds: 120, sceneIndex: 0, history: [] })).targetSeconds, 120, "古い値は、そのまま、残る(使わない)");
  assert.deepEqual([sc(1), sc(3), sc(5)], [1, 3, 5]);
  assert.deepEqual([sc(0), sc(6), sc("x"), sc(2.5), sc(null)], [1, 1, 1, 1, 1]);
  assert.equal(readProgress(JSON.stringify({ level: 1, sceneIndex: 0, history: [] })).targetSeconds, LEGACY_TARGET_SECONDS, "秒が、無い新しい記録も、読める(互換の値が、入る)")
  assert.deepEqual(parseProgress(JSON.stringify({ level: 1, targetSeconds: 30, sceneIndex: 0 })), createProgress(), "history が無いのは、不正");
}

console.log("logic_test: すべて通りました");
