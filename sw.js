// sw.js — オフラインでも開けるようにする(make_web.mjs が、自動で、作る。直接、直さない)。
//   起動時に、全部のファイル(コードと、物語)を、端末に、覚えさせる。
//   開く時は、ネットを先に見て(最新を、確かめて)、つながらなければ、覚えた物を使う。
const CACHE_NAME = "english-listening-web-902a79594c";
const FILES = [
  "./",
  "index.html",
  "app.js",
  "logic.mjs",
  "sync.mjs",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "stories/01-01-01-ken.json",
  "stories/01-01-02-ken.json",
  "stories/01-01-03-ken.json",
  "stories/01-01-04-ken.json",
  "stories/01-01-05-ken.json",
  "stories/01-01-06-ken.json",
  "stories/01-01-07-ken.json",
  "stories/01-01-08-ken.json",
  "stories/01-02-01-umbrella.json",
  "stories/01-02-02-umbrella.json",
  "stories/01-02-03-umbrella.json",
  "stories/01-02-04-umbrella.json",
  "stories/01-02-05-umbrella.json",
  "stories/01-02-06-umbrella.json",
  "stories/01-02-07-umbrella.json",
  "stories/01-02-08-umbrella.json",
  "stories/01-03-01-bakery.json",
  "stories/01-03-02-bakery.json",
  "stories/01-03-03-bakery.json",
  "stories/01-03-04-bakery.json",
  "stories/01-03-05-bakery.json",
  "stories/01-03-06-bakery.json",
  "stories/01-03-07-bakery.json",
  "stories/01-03-08-bakery.json",
  "stories/02-01-01-ken.json",
  "stories/02-01-02-ken.json",
  "stories/02-01-03-ken.json",
  "stories/02-01-04-ken.json",
  "stories/02-01-05-ken.json",
  "stories/02-01-06-ken.json",
  "stories/02-01-07-ken.json",
  "stories/02-01-08-ken.json",
  "stories/02-02-01-umbrella.json",
  "stories/02-02-02-umbrella.json",
  "stories/02-02-03-umbrella.json",
  "stories/02-02-04-umbrella.json",
  "stories/02-02-05-umbrella.json",
  "stories/02-02-06-umbrella.json",
  "stories/02-02-07-umbrella.json",
  "stories/02-02-08-umbrella.json",
  "stories/02-03-01-bakery.json",
  "stories/02-03-02-bakery.json",
  "stories/02-03-03-bakery.json",
  "stories/02-03-04-bakery.json",
  "stories/02-03-05-bakery.json",
  "stories/02-03-06-bakery.json",
  "stories/02-03-07-bakery.json",
  "stories/02-03-08-bakery.json",
  "stories/03-01-01-ken.json",
  "stories/03-01-02-ken.json",
  "stories/03-01-03-ken.json",
  "stories/03-01-04-ken.json",
  "stories/03-01-05-ken.json",
  "stories/03-01-06-ken.json",
  "stories/03-01-07-ken.json",
  "stories/03-01-08-ken.json",
  "stories/03-02-01-umbrella.json",
  "stories/03-02-02-umbrella.json",
  "stories/03-02-03-umbrella.json",
  "stories/03-02-04-umbrella.json",
  "stories/03-02-05-umbrella.json",
  "stories/03-02-06-umbrella.json",
  "stories/03-02-07-umbrella.json",
  "stories/03-02-08-umbrella.json",
  "stories/03-03-01-bakery.json",
  "stories/03-03-02-bakery.json",
  "stories/03-03-03-bakery.json",
  "stories/03-03-04-bakery.json",
  "stories/03-03-05-bakery.json",
  "stories/03-03-06-bakery.json",
  "stories/03-03-07-bakery.json",
  "stories/03-03-08-bakery.json",
  "stories/03-04-01-openboat.json",
  "stories/03-04-02-openboat.json",
  "stories/03-04-03-openboat.json",
  "stories/03-04-04-openboat.json",
  "stories/03-04-05-openboat.json",
  "stories/03-04-06-openboat.json",
  "stories/03-04-07-openboat.json",
  "stories/03-04-08-openboat.json",
  "stories/03-04-09-openboat.json",
  "stories/03-04-10-openboat.json",
  "stories/03-04-11-openboat.json",
  "stories/03-04-12-openboat.json",
  "stories/03-04-13-openboat.json",
  "stories/03-04-14-openboat.json",
  "stories/03-04-15-openboat.json",
  "stories/03-04-16-openboat.json",
  "stories/03-04-17-openboat.json",
  "stories/03-04-18-openboat.json",
  "stories/03-04-19-openboat.json",
  "stories/03-04-20-openboat.json",
  "stories/03-04-21-openboat.json",
  "stories/03-04-22-openboat.json",
  "stories/index.json",
  "audio/manifest.json"
];
const AUDIO = ["audio/01-01-01-ken-01.mp3","audio/01-01-01-ken-02.mp3","audio/01-01-01-ken-03.mp3","audio/01-01-01-ken-04.mp3","audio/01-01-01-ken-05.mp3","audio/01-01-02-ken-01.mp3","audio/01-01-02-ken-02.mp3","audio/01-01-02-ken-03.mp3","audio/01-01-02-ken-04.mp3","audio/01-01-02-ken-05.mp3","audio/01-01-03-ken-01.mp3","audio/01-01-03-ken-02.mp3","audio/01-01-03-ken-03.mp3","audio/01-01-03-ken-04.mp3","audio/01-01-03-ken-05.mp3","audio/01-01-04-ken-01.mp3","audio/01-01-04-ken-02.mp3","audio/01-01-04-ken-03.mp3","audio/01-01-04-ken-04.mp3","audio/01-01-04-ken-05.mp3","audio/01-01-05-ken-01.mp3","audio/01-01-05-ken-02.mp3","audio/01-01-05-ken-03.mp3","audio/01-01-05-ken-04.mp3","audio/01-01-05-ken-05.mp3","audio/01-01-06-ken-01.mp3","audio/01-01-06-ken-02.mp3","audio/01-01-06-ken-03.mp3","audio/01-01-06-ken-04.mp3","audio/01-01-06-ken-05.mp3","audio/01-01-07-ken-01.mp3","audio/01-01-07-ken-02.mp3","audio/01-01-07-ken-03.mp3","audio/01-01-07-ken-04.mp3","audio/01-01-07-ken-05.mp3","audio/01-01-08-ken-01.mp3","audio/01-01-08-ken-02.mp3","audio/01-01-08-ken-03.mp3","audio/01-01-08-ken-04.mp3","audio/01-01-08-ken-05.mp3","audio/01-02-01-umbrella-01.mp3","audio/01-02-01-umbrella-02.mp3","audio/01-02-01-umbrella-03.mp3","audio/01-02-01-umbrella-04.mp3","audio/01-02-01-umbrella-05.mp3","audio/01-02-02-umbrella-01.mp3","audio/01-02-02-umbrella-02.mp3","audio/01-02-02-umbrella-03.mp3","audio/01-02-02-umbrella-04.mp3","audio/01-02-02-umbrella-05.mp3","audio/01-02-03-umbrella-01.mp3","audio/01-02-03-umbrella-02.mp3","audio/01-02-03-umbrella-03.mp3","audio/01-02-03-umbrella-04.mp3","audio/01-02-03-umbrella-05.mp3","audio/01-02-04-umbrella-01.mp3","audio/01-02-04-umbrella-02.mp3","audio/01-02-04-umbrella-03.mp3","audio/01-02-04-umbrella-04.mp3","audio/01-02-04-umbrella-05.mp3","audio/01-02-05-umbrella-01.mp3","audio/01-02-05-umbrella-02.mp3","audio/01-02-05-umbrella-03.mp3","audio/01-02-05-umbrella-04.mp3","audio/01-02-05-umbrella-05.mp3","audio/01-02-06-umbrella-01.mp3","audio/01-02-06-umbrella-02.mp3","audio/01-02-06-umbrella-03.mp3","audio/01-02-06-umbrella-04.mp3","audio/01-02-06-umbrella-05.mp3","audio/01-02-07-umbrella-01.mp3","audio/01-02-07-umbrella-02.mp3","audio/01-02-07-umbrella-03.mp3","audio/01-02-07-umbrella-04.mp3","audio/01-02-07-umbrella-05.mp3","audio/01-02-08-umbrella-01.mp3","audio/01-02-08-umbrella-02.mp3","audio/01-02-08-umbrella-03.mp3","audio/01-02-08-umbrella-04.mp3","audio/01-02-08-umbrella-05.mp3","audio/01-03-01-bakery-01.mp3","audio/01-03-01-bakery-02.mp3","audio/01-03-01-bakery-03.mp3","audio/01-03-01-bakery-04.mp3","audio/01-03-01-bakery-05.mp3","audio/01-03-02-bakery-01.mp3","audio/01-03-02-bakery-02.mp3","audio/01-03-02-bakery-03.mp3","audio/01-03-02-bakery-04.mp3","audio/01-03-02-bakery-05.mp3","audio/01-03-03-bakery-01.mp3","audio/01-03-03-bakery-02.mp3","audio/01-03-03-bakery-03.mp3","audio/01-03-03-bakery-04.mp3","audio/01-03-03-bakery-05.mp3","audio/01-03-04-bakery-01.mp3","audio/01-03-04-bakery-02.mp3","audio/01-03-04-bakery-03.mp3","audio/01-03-04-bakery-04.mp3","audio/01-03-04-bakery-05.mp3","audio/01-03-05-bakery-01.mp3","audio/01-03-05-bakery-02.mp3","audio/01-03-05-bakery-03.mp3","audio/01-03-05-bakery-04.mp3","audio/01-03-05-bakery-05.mp3","audio/01-03-06-bakery-01.mp3","audio/01-03-06-bakery-02.mp3","audio/01-03-06-bakery-03.mp3","audio/01-03-06-bakery-04.mp3","audio/01-03-06-bakery-05.mp3","audio/01-03-07-bakery-01.mp3","audio/01-03-07-bakery-02.mp3","audio/01-03-07-bakery-03.mp3","audio/01-03-07-bakery-04.mp3","audio/01-03-07-bakery-05.mp3","audio/01-03-08-bakery-01.mp3","audio/01-03-08-bakery-02.mp3","audio/01-03-08-bakery-03.mp3","audio/01-03-08-bakery-04.mp3","audio/01-03-08-bakery-05.mp3","audio/02-01-01-ken-01.mp3","audio/02-01-01-ken-02.mp3","audio/02-01-01-ken-03.mp3","audio/02-01-01-ken-04.mp3","audio/02-01-01-ken-05.mp3","audio/02-01-02-ken-01.mp3","audio/02-01-02-ken-02.mp3","audio/02-01-02-ken-03.mp3","audio/02-01-02-ken-04.mp3","audio/02-01-02-ken-05.mp3","audio/02-01-03-ken-01.mp3","audio/02-01-03-ken-02.mp3","audio/02-01-03-ken-03.mp3","audio/02-01-03-ken-04.mp3","audio/02-01-03-ken-05.mp3","audio/02-01-04-ken-01.mp3","audio/02-01-04-ken-02.mp3","audio/02-01-04-ken-03.mp3","audio/02-01-04-ken-04.mp3","audio/02-01-04-ken-05.mp3","audio/02-01-05-ken-01.mp3","audio/02-01-05-ken-02.mp3","audio/02-01-05-ken-03.mp3","audio/02-01-05-ken-04.mp3","audio/02-01-05-ken-05.mp3","audio/02-01-06-ken-01.mp3","audio/02-01-06-ken-02.mp3","audio/02-01-06-ken-03.mp3","audio/02-01-06-ken-04.mp3","audio/02-01-06-ken-05.mp3","audio/02-01-07-ken-01.mp3","audio/02-01-07-ken-02.mp3","audio/02-01-07-ken-03.mp3","audio/02-01-07-ken-04.mp3","audio/02-01-07-ken-05.mp3","audio/02-01-08-ken-01.mp3","audio/02-01-08-ken-02.mp3","audio/02-01-08-ken-03.mp3","audio/02-01-08-ken-04.mp3","audio/02-01-08-ken-05.mp3","audio/02-02-01-umbrella-01.mp3","audio/02-02-01-umbrella-02.mp3","audio/02-02-01-umbrella-03.mp3","audio/02-02-01-umbrella-04.mp3","audio/02-02-01-umbrella-05.mp3","audio/02-02-02-umbrella-01.mp3","audio/02-02-02-umbrella-02.mp3","audio/02-02-02-umbrella-03.mp3","audio/02-02-02-umbrella-04.mp3","audio/02-02-02-umbrella-05.mp3","audio/02-02-03-umbrella-01.mp3","audio/02-02-03-umbrella-02.mp3","audio/02-02-03-umbrella-03.mp3","audio/02-02-03-umbrella-04.mp3","audio/02-02-03-umbrella-05.mp3","audio/02-02-04-umbrella-01.mp3","audio/02-02-04-umbrella-02.mp3","audio/02-02-04-umbrella-03.mp3","audio/02-02-04-umbrella-04.mp3","audio/02-02-04-umbrella-05.mp3","audio/02-02-05-umbrella-01.mp3","audio/02-02-05-umbrella-02.mp3","audio/02-02-05-umbrella-03.mp3","audio/02-02-05-umbrella-04.mp3","audio/02-02-05-umbrella-05.mp3","audio/02-02-06-umbrella-01.mp3","audio/02-02-06-umbrella-02.mp3","audio/02-02-06-umbrella-03.mp3","audio/02-02-06-umbrella-04.mp3","audio/02-02-06-umbrella-05.mp3","audio/02-02-07-umbrella-01.mp3","audio/02-02-07-umbrella-02.mp3","audio/02-02-07-umbrella-03.mp3","audio/02-02-07-umbrella-04.mp3","audio/02-02-07-umbrella-05.mp3","audio/02-02-08-umbrella-01.mp3","audio/02-02-08-umbrella-02.mp3","audio/02-02-08-umbrella-03.mp3","audio/02-02-08-umbrella-04.mp3","audio/02-02-08-umbrella-05.mp3","audio/02-03-01-bakery-01.mp3","audio/02-03-01-bakery-02.mp3","audio/02-03-01-bakery-03.mp3","audio/02-03-01-bakery-04.mp3","audio/02-03-01-bakery-05.mp3","audio/02-03-02-bakery-01.mp3","audio/02-03-02-bakery-02.mp3","audio/02-03-02-bakery-03.mp3","audio/02-03-02-bakery-04.mp3","audio/02-03-02-bakery-05.mp3","audio/02-03-03-bakery-01.mp3","audio/02-03-03-bakery-02.mp3","audio/02-03-03-bakery-03.mp3","audio/02-03-03-bakery-04.mp3","audio/02-03-03-bakery-05.mp3","audio/02-03-04-bakery-01.mp3","audio/02-03-04-bakery-02.mp3","audio/02-03-04-bakery-03.mp3","audio/02-03-04-bakery-04.mp3","audio/02-03-04-bakery-05.mp3","audio/02-03-05-bakery-01.mp3","audio/02-03-05-bakery-02.mp3","audio/02-03-05-bakery-03.mp3","audio/02-03-05-bakery-04.mp3","audio/02-03-05-bakery-05.mp3","audio/02-03-06-bakery-01.mp3","audio/02-03-06-bakery-02.mp3","audio/02-03-06-bakery-03.mp3","audio/02-03-06-bakery-04.mp3","audio/02-03-06-bakery-05.mp3","audio/02-03-07-bakery-01.mp3","audio/02-03-07-bakery-02.mp3","audio/02-03-07-bakery-03.mp3","audio/02-03-07-bakery-04.mp3","audio/02-03-07-bakery-05.mp3","audio/02-03-08-bakery-01.mp3","audio/02-03-08-bakery-02.mp3","audio/02-03-08-bakery-03.mp3","audio/02-03-08-bakery-04.mp3","audio/02-03-08-bakery-05.mp3","audio/03-01-01-ken-01.mp3","audio/03-01-01-ken-02.mp3","audio/03-01-01-ken-03.mp3","audio/03-01-01-ken-04.mp3","audio/03-01-01-ken-05.mp3","audio/03-01-02-ken-01.mp3","audio/03-01-02-ken-02.mp3","audio/03-01-02-ken-03.mp3","audio/03-01-02-ken-04.mp3","audio/03-01-02-ken-05.mp3","audio/03-01-03-ken-01.mp3","audio/03-01-03-ken-02.mp3","audio/03-01-03-ken-03.mp3","audio/03-01-03-ken-04.mp3","audio/03-01-03-ken-05.mp3","audio/03-01-04-ken-01.mp3","audio/03-01-04-ken-02.mp3","audio/03-01-04-ken-03.mp3","audio/03-01-04-ken-04.mp3","audio/03-01-04-ken-05.mp3","audio/03-01-05-ken-01.mp3","audio/03-01-05-ken-02.mp3","audio/03-01-05-ken-03.mp3","audio/03-01-05-ken-04.mp3","audio/03-01-05-ken-05.mp3","audio/03-01-06-ken-01.mp3","audio/03-01-06-ken-02.mp3","audio/03-01-06-ken-03.mp3","audio/03-01-06-ken-04.mp3","audio/03-01-06-ken-05.mp3","audio/03-01-07-ken-01.mp3","audio/03-01-07-ken-02.mp3","audio/03-01-07-ken-03.mp3","audio/03-01-07-ken-04.mp3","audio/03-01-07-ken-05.mp3","audio/03-01-08-ken-01.mp3","audio/03-01-08-ken-02.mp3","audio/03-01-08-ken-03.mp3","audio/03-01-08-ken-04.mp3","audio/03-01-08-ken-05.mp3","audio/03-02-01-umbrella-01.mp3","audio/03-02-01-umbrella-02.mp3","audio/03-02-01-umbrella-03.mp3","audio/03-02-01-umbrella-04.mp3","audio/03-02-01-umbrella-05.mp3","audio/03-02-02-umbrella-01.mp3","audio/03-02-02-umbrella-02.mp3","audio/03-02-02-umbrella-03.mp3","audio/03-02-02-umbrella-04.mp3","audio/03-02-02-umbrella-05.mp3","audio/03-02-03-umbrella-01.mp3","audio/03-02-03-umbrella-02.mp3","audio/03-02-03-umbrella-03.mp3","audio/03-02-03-umbrella-04.mp3","audio/03-02-03-umbrella-05.mp3","audio/03-02-04-umbrella-01.mp3","audio/03-02-04-umbrella-02.mp3","audio/03-02-04-umbrella-03.mp3","audio/03-02-04-umbrella-04.mp3","audio/03-02-04-umbrella-05.mp3","audio/03-02-05-umbrella-01.mp3","audio/03-02-05-umbrella-02.mp3","audio/03-02-05-umbrella-03.mp3","audio/03-02-05-umbrella-04.mp3","audio/03-02-05-umbrella-05.mp3","audio/03-02-06-umbrella-01.mp3","audio/03-02-06-umbrella-02.mp3","audio/03-02-06-umbrella-03.mp3","audio/03-02-06-umbrella-04.mp3","audio/03-02-06-umbrella-05.mp3","audio/03-02-07-umbrella-01.mp3","audio/03-02-07-umbrella-02.mp3","audio/03-02-07-umbrella-03.mp3","audio/03-02-07-umbrella-04.mp3","audio/03-02-07-umbrella-05.mp3","audio/03-02-08-umbrella-01.mp3","audio/03-02-08-umbrella-02.mp3","audio/03-02-08-umbrella-03.mp3","audio/03-02-08-umbrella-04.mp3","audio/03-02-08-umbrella-05.mp3","audio/03-03-01-bakery-01.mp3","audio/03-03-01-bakery-02.mp3","audio/03-03-01-bakery-03.mp3","audio/03-03-01-bakery-04.mp3","audio/03-03-01-bakery-05.mp3","audio/03-03-02-bakery-01.mp3","audio/03-03-02-bakery-02.mp3","audio/03-03-02-bakery-03.mp3","audio/03-03-02-bakery-04.mp3","audio/03-03-02-bakery-05.mp3","audio/03-03-03-bakery-01.mp3","audio/03-03-03-bakery-02.mp3","audio/03-03-03-bakery-03.mp3","audio/03-03-03-bakery-04.mp3","audio/03-03-03-bakery-05.mp3","audio/03-03-04-bakery-01.mp3","audio/03-03-04-bakery-02.mp3","audio/03-03-04-bakery-03.mp3","audio/03-03-04-bakery-04.mp3","audio/03-03-04-bakery-05.mp3","audio/03-03-05-bakery-01.mp3","audio/03-03-05-bakery-02.mp3","audio/03-03-05-bakery-03.mp3","audio/03-03-05-bakery-04.mp3","audio/03-03-05-bakery-05.mp3","audio/03-03-06-bakery-01.mp3","audio/03-03-06-bakery-02.mp3","audio/03-03-06-bakery-03.mp3","audio/03-03-06-bakery-04.mp3","audio/03-03-06-bakery-05.mp3","audio/03-03-07-bakery-01.mp3","audio/03-03-07-bakery-02.mp3","audio/03-03-07-bakery-03.mp3","audio/03-03-07-bakery-04.mp3","audio/03-03-07-bakery-05.mp3","audio/03-03-08-bakery-01.mp3","audio/03-03-08-bakery-02.mp3","audio/03-03-08-bakery-03.mp3","audio/03-03-08-bakery-04.mp3","audio/03-03-08-bakery-05.mp3","audio/03-04-01-openboat-01.mp3","audio/03-04-01-openboat-02.mp3","audio/03-04-01-openboat-03.mp3","audio/03-04-01-openboat-04.mp3","audio/03-04-01-openboat-05.mp3","audio/03-04-01-openboat-06.mp3","audio/03-04-02-openboat-01.mp3","audio/03-04-02-openboat-02.mp3","audio/03-04-02-openboat-03.mp3","audio/03-04-02-openboat-04.mp3","audio/03-04-02-openboat-05.mp3","audio/03-04-02-openboat-06.mp3","audio/03-04-03-openboat-01.mp3","audio/03-04-03-openboat-02.mp3","audio/03-04-03-openboat-03.mp3","audio/03-04-03-openboat-04.mp3","audio/03-04-03-openboat-05.mp3","audio/03-04-03-openboat-06.mp3","audio/03-04-04-openboat-01.mp3","audio/03-04-04-openboat-02.mp3","audio/03-04-04-openboat-03.mp3","audio/03-04-04-openboat-04.mp3","audio/03-04-04-openboat-05.mp3","audio/03-04-05-openboat-01.mp3","audio/03-04-05-openboat-02.mp3","audio/03-04-05-openboat-03.mp3","audio/03-04-05-openboat-04.mp3","audio/03-04-05-openboat-05.mp3","audio/03-04-06-openboat-01.mp3","audio/03-04-06-openboat-02.mp3","audio/03-04-06-openboat-03.mp3","audio/03-04-06-openboat-04.mp3","audio/03-04-06-openboat-05.mp3","audio/03-04-06-openboat-06.mp3","audio/03-04-07-openboat-01.mp3","audio/03-04-07-openboat-02.mp3","audio/03-04-07-openboat-03.mp3","audio/03-04-07-openboat-04.mp3","audio/03-04-07-openboat-05.mp3","audio/03-04-07-openboat-06.mp3","audio/03-04-07-openboat-07.mp3","audio/03-04-08-openboat-01.mp3","audio/03-04-08-openboat-02.mp3","audio/03-04-08-openboat-03.mp3","audio/03-04-08-openboat-04.mp3","audio/03-04-09-openboat-01.mp3","audio/03-04-09-openboat-02.mp3","audio/03-04-09-openboat-03.mp3","audio/03-04-09-openboat-04.mp3","audio/03-04-09-openboat-05.mp3","audio/03-04-10-openboat-01.mp3","audio/03-04-10-openboat-02.mp3","audio/03-04-10-openboat-03.mp3","audio/03-04-10-openboat-04.mp3","audio/03-04-11-openboat-01.mp3","audio/03-04-11-openboat-02.mp3","audio/03-04-11-openboat-03.mp3","audio/03-04-11-openboat-04.mp3","audio/03-04-11-openboat-05.mp3","audio/03-04-12-openboat-01.mp3","audio/03-04-12-openboat-02.mp3","audio/03-04-12-openboat-03.mp3","audio/03-04-12-openboat-04.mp3","audio/03-04-12-openboat-05.mp3","audio/03-04-12-openboat-06.mp3","audio/03-04-13-openboat-01.mp3","audio/03-04-13-openboat-02.mp3","audio/03-04-13-openboat-03.mp3","audio/03-04-13-openboat-04.mp3","audio/03-04-14-openboat-01.mp3","audio/03-04-14-openboat-02.mp3","audio/03-04-14-openboat-03.mp3","audio/03-04-14-openboat-04.mp3","audio/03-04-14-openboat-05.mp3","audio/03-04-14-openboat-06.mp3","audio/03-04-15-openboat-01.mp3","audio/03-04-15-openboat-02.mp3","audio/03-04-15-openboat-03.mp3","audio/03-04-15-openboat-04.mp3","audio/03-04-15-openboat-05.mp3","audio/03-04-15-openboat-06.mp3","audio/03-04-15-openboat-07.mp3","audio/03-04-16-openboat-01.mp3","audio/03-04-16-openboat-02.mp3","audio/03-04-16-openboat-03.mp3","audio/03-04-16-openboat-04.mp3","audio/03-04-16-openboat-05.mp3","audio/03-04-16-openboat-06.mp3","audio/03-04-16-openboat-07.mp3","audio/03-04-16-openboat-08.mp3","audio/03-04-17-openboat-01.mp3","audio/03-04-17-openboat-02.mp3","audio/03-04-17-openboat-03.mp3","audio/03-04-17-openboat-04.mp3","audio/03-04-17-openboat-05.mp3","audio/03-04-17-openboat-06.mp3","audio/03-04-17-openboat-07.mp3","audio/03-04-18-openboat-01.mp3","audio/03-04-18-openboat-02.mp3","audio/03-04-18-openboat-03.mp3","audio/03-04-18-openboat-04.mp3","audio/03-04-18-openboat-05.mp3","audio/03-04-19-openboat-01.mp3","audio/03-04-19-openboat-02.mp3","audio/03-04-19-openboat-03.mp3","audio/03-04-19-openboat-04.mp3","audio/03-04-19-openboat-05.mp3","audio/03-04-19-openboat-06.mp3","audio/03-04-20-openboat-01.mp3","audio/03-04-20-openboat-02.mp3","audio/03-04-20-openboat-03.mp3","audio/03-04-20-openboat-04.mp3","audio/03-04-20-openboat-05.mp3","audio/03-04-20-openboat-06.mp3","audio/03-04-20-openboat-07.mp3","audio/03-04-21-openboat-01.mp3","audio/03-04-21-openboat-02.mp3","audio/03-04-21-openboat-03.mp3","audio/03-04-21-openboat-04.mp3","audio/03-04-21-openboat-05.mp3","audio/03-04-21-openboat-06.mp3","audio/03-04-21-openboat-07.mp3","audio/03-04-21-openboat-08.mp3","audio/03-04-22-openboat-01.mp3","audio/03-04-22-openboat-02.mp3","audio/03-04-22-openboat-03.mp3","audio/03-04-22-openboat-04.mp3","audio/03-04-22-openboat-05.mp3","audio/03-04-22-openboat-06.mp3"];   // 録音した音声。覚えるのは、あとから、1つずつ

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(FILES);   // 画面と物語: 全部、覚えられなければ、入れ替えない
    await Promise.allSettled(AUDIO.map((f) => cache.add(f)));   // 録音した音声: 1つ失敗しても、続ける(足りない分は、使う時に、取る)
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("english-listening-web-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const KNOWN = new Set([...FILES, ...AUDIO].map((f) => new URL(f, self.registration.scope).href));   // 覚えるファイルの、アドレス

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 外のサイト(GitHub の API など)・GET 以外・一覧に無い物は、触らない
  if (event.request.method !== "GET" || url.origin !== location.origin || !KNOWN.has(url.origin + url.pathname)) return;
  event.respondWith((async () => {
    if (url.pathname.endsWith(".mp3")) {   // 録音した音声: 覚えた物を、先に使う(版が変われば、箱ごと、新しくなる)
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res.ok) { const cache = await caches.open(CACHE_NAME); cache.put(event.request, res.clone()); }
      return res;
    }
    try {
      const fresh = await fetch(event.request, { cache: "no-cache" });          // 最新を、確かめる
      if (fresh.ok) { const cache = await caches.open(CACHE_NAME); cache.put(event.request, fresh.clone()); }
      return fresh;
    } catch {
      return (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match("index.html")) || Response.error();
    }
  })());
});
