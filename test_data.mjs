// test_data.mjs — 試験用: stories/ フォルダ(目次と、節ごとのファイル)を、読む道具。
//   アプリ本体では、使わない(アプリは、聞き始める時に、必要な節のファイルだけを、読み込む)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planSession, assembleSession, findStory, storiesOfLevel, levelsOf } from "./logic.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const STORIES_DIR = process.env.EL_STORIES_DIR || path.join(ROOT, "stories");

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(STORIES_DIR, "index.json"), "utf8"));
}

export function loadSection(file) {
  return JSON.parse(fs.readFileSync(path.join(STORIES_DIR, file), "utf8"));
}

// 1つの物語(レベル・名前)の、全部の文(節の順に、つないだ物)
export function storySentences(level, name, catalog = loadCatalog()) {
  const story = findStory(catalog, level, name);
  return story.sections.flatMap((sec) => loadSection(sec.file).sentences);
}

// 1つの節の文
export function sectionSentences(level, name, index, catalog = loadCatalog()) {
  const story = findStory(catalog, level, name);
  return loadSection(story.sections[index].file).sentences;
}

// 実際の練習で、読まれる文(位置と、節の数から、必要な節を読んで、組み立てる)
export function sessionOf(level, name, sceneIndex, sectionCount, catalog = loadCatalog()) {
  const plan = planSession(catalog, { level, storyName: name, sceneIndex }, { sectionCount });
  return assembleSession(plan, plan.sections.map((sec) => loadSection(sec.file)));
}

// 全部の物語(レベルの順、番号の順)。{ level, story(目次の物), sentences }
export function allStories(catalog = loadCatalog()) {
  const out = [];
  for (const level of levelsOf(catalog)) {
    for (const story of storiesOfLevel(catalog, level)) {
      out.push({ level, story, sentences: story.sections.flatMap((sec) => loadSection(sec.file).sentences) });
    }
  }
  return out;
}

// 英文 → 日本語訳 の表
export const JA = (() => {
  const map = {};
  for (const { sentences } of allStories()) for (const s of sentences) map[s.text] = s.ja;
  return map;
})();
