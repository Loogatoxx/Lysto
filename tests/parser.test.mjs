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
  // Cas réel senpai-stream : épisode uniquement dans l'URL, format /1-2
  {
    title: "Emily in Paris - 2020",
    url: "https://senpai-stream.gay/episode/emily-in-paris/1-2",
    expect: { showTitle: "Emily in Paris", season: 1, episode: 2, episodeKey: "S01E002" },
  },
  // Titre de lecteur générique → nom de série depuis le slug /episode/<slug>/
  {
    title: "Lecteur vidéo",
    url: "https://senpai-stream.gay/episode/emily-in-paris/2-5",
    expect: { showTitle: "Emily In Paris", season: 2, episode: 5, episodeKey: "S02E005" },
  },
  // wiflix style
  {
    title: "The Last of Us Saison 1 Épisode 3 VF - Wiflix",
    url: "https://wiflix.tv/serie/the-last-of-us-saison-1-episode-3",
    expect: { showTitle: "The Last of Us", season: 1, episode: 3, episodeKey: "S01E003" },
  },
  // URL avec saison-episode en segments
  {
    title: "Lecteur vidéo",
    url: "https://site.tv/anime/demon-slayer/saison-3-episode-11",
    expect: { showTitle: "Demon Slayer", season: 3, episode: 11, episodeKey: "S03E011" },
  },
  // Format compact EP5
  {
    title: "Naruto Shippuden EP 345",
    url: "https://anime.example/naruto-shippuden",
    expect: { showTitle: "Naruto Shippuden", season: null, episode: 345, episodeKey: "E0345" },
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

// parseMediaMulti : le nom vient du titre de page, les numéros du h2
// (cas senpai-stream : h2 = « <titre d'épisode> Saison 1 Épisode 2 »)
const multi = P.parseMediaMulti(
  ["Emily in Paris - 2020", "Emily in Paris", "Masculin Féminin Saison 1 Épisode 2"],
  "https://senpai-stream.gay/episode/emily-in-paris/prochain"
);
assert.strictEqual(multi.showTitle, "Emily in Paris", "multi: showTitle → " + multi.showTitle);
assert.strictEqual(multi.season, 1, "multi: season");
assert.strictEqual(multi.episode, 2, "multi: episode");
assert.strictEqual(multi.episodeKey, "S01E002", "multi: episodeKey");

// Cas réel anime-sama : saison dans l'URL, épisode dans un <select>,
// titre sans numéros
const anime = P.parseMediaMulti(
  [
    "One Piece - Saga 1 (East Blue) | Anime-Sama - Streaming et catalogage d'animes et scans.",
    "One Piece",
    "Saga 1 (East Blue)",
    "Episode 5",
  ],
  "https://anime-sama.to/catalogue/one-piece/saison1/vostfr/"
);
assert.strictEqual(anime.showTitle, "One Piece", "anime-sama: showTitle → " + anime.showTitle);
assert.strictEqual(anime.season, 1, "anime-sama: season → " + anime.season);
assert.strictEqual(anime.episode, 5, "anime-sama: episode → " + anime.episode);
assert.strictEqual(anime.episodeKey, "S01E005", "anime-sama: episodeKey → " + anime.episodeKey);

// makeMeta : utilisé par l'ajout manuel et l'assistance IA
const manual = P.makeMeta("Dark", 2, 3, "https://x.example/watch");
assert.strictEqual(manual.episodeKey, "S02E003");
assert.strictEqual(manual.episodeLabel, "Saison 2 · Épisode 3");
assert.strictEqual(manual.showId, "dark");

// cleanShowTitle : doit retirer les noms de sites connus
assert.strictEqual(P.cleanShowTitle("The Bear - Wiflix"), "The Bear");
assert.strictEqual(P.cleanShowTitle("Demon Slayer - French Stream"), "Demon Slayer");

// Année en fin de titre
assert.strictEqual(P.cleanShowTitle("Emily in Paris - 2020"), "Emily in Paris");

// Mots parasites seuls
assert.strictEqual(P.cleanShowTitle("Regarder Severance en streaming"), "Severance");

if (failed) {
  console.error(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log("\nTous les tests passent ✓");
