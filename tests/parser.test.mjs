/* Tests du parser de titres — `node tests/parser.test.mjs` */
import { createRequire } from "module";
import assert from "assert";

const require = createRequire(import.meta.url);
const P = require("../extension/parser.js");

const cases = [
  {
    title: "Breaking Bad S01E03 en streaming VF | StreamSite",
    url: "https://streamsite.tv/series/breaking-bad/s01e03",
    expect: { showTitle: "Breaking Bad", season: 1, episode: 3, episodeKey: "S01E003" },
  },
  {
    title: "Regarder The Bear saison 2 épisode 5 en streaming vostfr gratuit",
    url: "https://site.example/the-bear",
    expect: { showTitle: "The Bear", season: 2, episode: 5, episodeKey: "S02E005" },
  },
  {
    title: "One Piece 1x1071 VOSTFR",
    url: "https://anime.example/one-piece-episode-1071",
    expect: { showTitle: "One Piece", season: 1, episode: 1071, episodeKey: "S01E1071" },
  },
  {
    title: "Dark - Épisode 7 - MonSite Streaming",
    url: "https://monsite.example/dark-episode-7",
    expect: { showTitle: "Dark", season: null, episode: 7, episodeKey: "E0007" },
  },
  {
    title: "Lecteur vidéo",
    url: "https://site.tv/series/stranger-things/saison-4-episode-8",
    expect: { showTitle: "Stranger Things", season: 4, episode: 8, episodeKey: "S04E008" },
  },
  {
    title: "S02E10 - Severance | UltraStream",
    url: "https://ultra.example/watch/severance",
    expect: { showTitle: "Severance", season: 2, episode: 10, episodeKey: "S02E010" },
  },
  {
    title: "Better Call Saul (2015) Saison 6 Episode 13 VF - Streaming HD",
    url: "https://x.example/bcs",
    expect: { showTitle: "Better Call Saul", season: 6, episode: 13, episodeKey: "S06E013" },
  },
];

let failed = 0;
for (const c of cases) {
  const got = P.parseMedia(c.title, c.url);
  try {
    for (const [k, v] of Object.entries(c.expect)) {
      assert.deepStrictEqual(got[k], v, `${k}: attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(got[k])}`);
    }
    console.log(`✓ ${c.title}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${c.title}\n   ${e.message}\n   résultat: ${JSON.stringify(got)}`);
  }
}

// Le slug doit être stable (id de série)
assert.strictEqual(P.slugify("Étoile Brillante !"), "etoile-brillante");

if (failed) {
  console.error(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log("\nTous les tests passent ✓");
