// check_stories.mjs — stories/ フォルダ(物語のデータ)の、点検。
//   logic_test.mjs(いまのデータの点検)と、add_story.mjs(物語を足す前の、点検)で、使う。
//   決まりに合わない物があれば、例外を投げる。軽い注意(境目に近いレベルなど)は、warnings に入れて返す。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LEVEL_BOUNDS, SECTION_FILE_PATTERN, countWords, averageWords, detectLevel,
  parseSectionFileName, sectionFileName, sectionSeconds, levelsOf, maxLevelOf,
} from "./logic.mjs";

const ASCII_TEXT = /^[\x20-\x7E“”]+$/;
const JAPANESE = /[぀-ヿ一-鿿]/;

// 節の中の、文の点検(英文は、半角英数と、引用符 “ ” だけ。日本語訳と解説が、必要)
export function checkSentences(sentences, where) {
  assert.ok(Array.isArray(sentences) && sentences.length >= 3, where + ": 文が、少ない(3文以上)");
  for (const x of sentences) {
    assert.ok(typeof x.text === "string" && x.text.trim().length > 0, where + ": 英文が、空");
    assert.ok(ASCII_TEXT.test(x.text), where + ": 英文に、想定外の文字(半角英数と “ ” だけ): " + x.text);
    assert.ok(!x.text.includes('"'), where + ": 半角の引用符(“ ” を使う): " + x.text);
    assert.ok(typeof x.note === "string" && x.note.trim().length > 0, where + ": 解説が、空: " + x.text);
    assert.ok(typeof x.ja === "string" && JAPANESE.test(x.ja), where + ": 日本語訳が、無い: " + x.text);
  }
}

// 新しい物語の定義(add_story.mjs に渡す物)の点検
//   { name, title, titleJa, summaryJa, credit?, sourceUrl?, sections: [ { title, titleJa, sentences: [ { text, ja, note } ] } ] }
export function checkDefinition(def) {
  assert.ok(def && typeof def === "object", "定義が、オブジェクトではありません");
  assert.match(String(def.name), /^[a-z]+$/, "ストーリー名は、英小文字だけ(ハイフンや数字は、使えません): " + def.name);
  for (const key of ["title", "titleJa", "summaryJa"]) {
    assert.ok(typeof def[key] === "string" && def[key].trim().length > 0, key + " が、必要");
  }
  assert.ok(Array.isArray(def.sections) && def.sections.length >= 1, "節が、必要");
  assert.ok(def.sections.length <= 99, "節は、99個まで(番号が、2けたのため)");
  def.sections.forEach((sec, i) => {
    const where = "節 " + (i + 1);
    assert.ok(typeof sec.title === "string" && sec.title.trim() && typeof sec.titleJa === "string" && sec.titleJa.trim(), where + ": 題名(title と titleJa)が、必要");
    checkSentences(sec.sentences, where);
  });
}

// フォルダ全体の点検。戻り値: { warnings, stories, sections }
export function checkStories(dir) {
  const warnings = [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

  // フォルダは、階層にしない(サブフォルダが、無い)。ファイル名は、決まりどおり
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  assert.ok(entries.every((e) => e.isFile()), "stories/ の中に、サブフォルダが、ある(階層に、しない)");
  const names = entries.map((e) => e.name).sort();
  assert.ok(names.includes("index.json"), "目次(index.json)が、無い");
  const sectionFiles = names.filter((n) => n !== "index.json");
  for (const n of sectionFiles) assert.ok(SECTION_FILE_PATTERN.test(n), "ファイル名の決まり([レベル]-[ストーリー番号]-[節番号]-[ストーリー名].json、数字は2けた)に合わない: " + n);
  // 名前順 = レベル → ストーリー → 節 の順
  const parsed = sectionFiles.map(parseSectionFileName);
  const ordered = [...parsed].sort((a, b) => a.level - b.level || a.story - b.story || a.section - b.section);
  assert.deepEqual(parsed, ordered, "名前順が、レベル → ストーリー → 節 の順に、なっていない");

  const catalog = read("index.json");
  assert.equal(catalog.version, 2, "目次の版が、2ではない");
  assert.deepEqual(levelsOf(catalog), [1, 2, 3], "レベルは、1〜3 が、順に、ある");
  assert.equal(maxLevelOf(catalog), 3);
  const referenced = new Set(["index.json"]);
  let storyCount = 0;
  let sectionCount = 0;
  for (const lv of catalog.levels) {
    assert.ok(lv.stories.length >= 1, "レベル " + lv.level + ": 物語が、無い");
    assert.deepEqual(lv.stories.map((s) => s.no), lv.stories.map((_, i) => i + 1), "レベル " + lv.level + ": ストーリー番号は、1 から、抜けなく、順に(レベルごとに、付け直す)");
    assert.equal(new Set(lv.stories.map((s) => s.name)).size, lv.stories.length, "レベル " + lv.level + ": ストーリー名が、重なっている");
    for (const st of lv.stories) {
      storyCount++;
      const id = "レベル " + lv.level + " " + st.name;
      assert.match(st.name, /^[a-z]+$/, id + ": 名前は、英小文字だけ");
      assert.ok(st.title && st.titleJa && st.summaryJa, id + ": 題名、日本語の題名、あらすじが、必要");
      assert.deepEqual(st.sections.map((x) => x.no), st.sections.map((_, i) => i + 1), id + ": 節番号は、1 から、抜けなく、順に");
      const all = [];
      for (const sec of st.sections) {
        sectionCount++;
        assert.equal(sec.file, sectionFileName(lv.level, st.no, sec.no, st.name), id + ": ファイル名の決まりと、違う: " + sec.file);
        assert.ok(names.includes(sec.file), id + ": ファイルが、無い: " + sec.file);
        referenced.add(sec.file);
        assert.ok(sec.title && sec.titleJa, id + " " + sec.no + "節: 題名が、必要");
        const data = read(sec.file);
        assert.deepEqual([data.level, data.story, data.section, data.name], [lv.level, st.no, sec.no, st.name], sec.file + ": 中身の、レベル・番号・名前が、ファイル名と、違う");
        checkSentences(data.sentences, sec.file);
        assert.equal(data.sentences.length, sec.sentences, sec.file + ": 目次の文の数と、違う");
        assert.equal(data.sentences.reduce((n, x) => n + countWords(x.text), 0), sec.words, sec.file + ": 目次の単語数と、違う");
        const secs = sectionSeconds(sec);
        assert.ok(secs >= 8 && secs <= 45, sec.file + ": 1節の長さが、範囲外(8〜45秒): " + Math.round(secs) + "秒");
        all.push(...data.sentences);
      }
      // いちばん大事: 「1つの物語は、1つのレベルに属する」。自動判定が、ファイル名のレベルと、一致する
      assert.equal(detectLevel(all), lv.level, id + ": 自動判定(平均 " + averageWords(all).toFixed(1) + " 語)が、ファイル名のレベルと、違う");
      // 境目に近いと、少しの書き換えで、レベルが変わる(注意だけ)
      const avg = averageWords(all);
      const bounds = [0, ...LEVEL_BOUNDS, Infinity];
      if (lv.level > 1 && avg - bounds[lv.level - 1] < 1) warnings.push(id + ": 下の境目に、近い(平均 " + avg.toFixed(2) + " 語)");
      if (lv.level < 3 && bounds[lv.level] - avg < 1) warnings.push(id + ": 上の境目に、近い(平均 " + avg.toFixed(2) + " 語)");
    }
  }
  assert.deepEqual(names.filter((n) => !referenced.has(n)), [], "目次に、載っていないファイルが、ある");
  return { warnings, stories: storyCount, sections: sectionCount };
}
