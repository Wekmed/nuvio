/**
 * DiziYou Provider for Nuvio
 *
 * Gerçek yapı:
 *   Bölüm sayfası → iframe#diziyouPlayer src="/player/{id}.html"
 *   Player HTML   → <source src="storage.diziyou.one/episodes/{id}/play.m3u8">
 *                 → <track srclang="tr" src="storage.diziyou.one/subtitles/{id}/tr.vtt">
 *                 → <track srclang="en" src="storage.diziyou.one/subtitles/{id}/en.vtt">
 *   Dublaj        → /player/{id}_tr.html → episodes/{id}_tr/play.m3u8
 *                                        → subtitles/{id}_tr/tr.vtt
 *
 * Subtitle formatı (animekai/vidnest provider'larından öğrenildi):
 *   subtitles: [{ language: 'Türkçe', url: '...tr.vtt', default: true }]
 *
 * Stream URL: Gerçek HTTPS URL (data: URI değil)
 */

"use strict";

// ─── Sabitler ─────────────────────────────────────────────────────────────────

var DOMAIN_LIST_URL = "https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt";
var BASE_URL    = "https://www.diziyou.one";
var STORAGE_URL = "https://storage.diziyou.one";
var TMDB_KEY    = "c4ffcab48dfaa7b41625ac13d61aec31";
var CACHE_MS    = 3600000;
var UA          = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Domain cache ─────────────────────────────────────────────────────────────

var _domain = null;
var _domainTs = 0;

function getBaseUrl() {
  var now = Date.now();
  if (_domain && (now - _domainTs) < CACHE_MS) return Promise.resolve(_domain);
  return fetch(DOMAIN_LIST_URL, { headers: { "User-Agent": UA } })
    .then(function(r) { return r.ok ? r.text() : ""; })
    .then(function(text) {
      var lines = text.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l.toLowerCase().indexOf("diziyou=") === 0) {
          var d = l.substring(8).trim().replace(/\/$/, "");
          if (d) { _domain = d; _domainTs = Date.now(); return d; }
        }
      }
      _domain = BASE_URL; _domainTs = Date.now(); return BASE_URL;
    })
    .catch(function() { return _domain || BASE_URL; });
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function get(url, referer) {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      "Referer": referer || BASE_URL + "/",
    }
  }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}

// ─── Slug ─────────────────────────────────────────────────────────────────────

var TR_MAP = {"ğ":"g","ü":"u","ş":"s","ı":"i","ö":"o","ç":"c","Ğ":"g","Ü":"u","Ş":"s","İ":"i","Ö":"o","Ç":"c"};
function trSlug(s) {
  return s.replace(/[ğüşıöçĞÜŞİÖÇ]/g, function(c) { return TR_MAP[c] || c; })
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function epSlug(show, s, e) { return show + "-" + s + "-sezon-" + e + "-bolum"; }

// ─── TMDB ─────────────────────────────────────────────────────────────────────

function getTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === "movie" ? "movie" : "tv";
  return fetch("https://api.themoviedb.org/3/" + ep + "/" + tmdbId +
    "?api_key=" + TMDB_KEY + "&language=tr-TR")
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title:     (d.name || d.title || "").trim(),
        origTitle: (d.original_name || d.original_title || "").trim(),
      };
    });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function extractPlayerId(html) {
  var pats = [
    /id=["']diziyouPlayer["'][^>]+src=["'][^"']*\/player\/(\d+(?:_tr)?)\.html/i,
    /src=["'][^"']*\/player\/(\d+(?:_tr)?)\.html["'][^>]*id=["']diziyouPlayer["']/i,
    /["']https?:\/\/[^"']*\/player\/(\d+(?:_tr)?)\.html["']/i,
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = html.match(pats[i]);
    if (m) return m[1];
  }
  return null;
}

function parseEpisodes(html) {
  var list = [];
  var re = /<div[^>]+class="[^"]*otherepisodes[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];
    var hM = block.match(/href=["']([^"']+)["']/i);
    var nM = block.match(/class="[^"]*epidosename[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a)>/i);
    if (!hM || !nM) continue;
    var name = nM[1].replace(/<[^>]+>/g, "").trim();
    var sM = name.match(/(\d+)\.\s*Sezon/i);
    var eM = name.match(/(\d+)\.\s*B[oö]l[uü]m/i);
    if (sM && eM) list.push({ season: +sM[1], episode: +eM[1], url: hM[1] });
  }
  return list;
}

// ─── Similarity ───────────────────────────────────────────────────────────────

function sim(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.8;
  var aw = a.split(/\s+/), bw = b.split(/\s+/), c = 0;
  aw.forEach(function(w) { if (bw.indexOf(w) !== -1 && w.length > 1) c++; });
  return c / Math.max(aw.length, bw.length);
}

// ─── URL resolution ───────────────────────────────────────────────────────────

function tryGet(url, referer) {
  return get(url, referer)
    .then(function(html) {
      var id = extractPlayerId(html);
      return id ? { playerId: id, html: html, url: url } : null;
    })
    .catch(function() { return null; });
}

function resolveEpisodeUrl(baseUrl, info, season, episode) {
  var slugEn = trSlug(info.origTitle);
  var slugTr = trSlug(info.title);
  var ref = baseUrl + "/";

  // 1. Direkt slug dene
  var candidates = [];
  if (slugEn) candidates.push(baseUrl + "/" + epSlug(slugEn, season, episode) + "/");
  if (slugTr && slugTr !== slugEn) candidates.push(baseUrl + "/" + epSlug(slugTr, season, episode) + "/");

  function tryList(i) {
    if (i >= candidates.length) return Promise.resolve(null);
    return tryGet(candidates[i], ref).then(function(r) { return r || tryList(i + 1); });
  }

  return tryList(0).then(function(r) {
    if (r) return r;

    // 2. Dizi ana sayfası → bölüm listesi
    var showCands = [];
    if (slugEn) showCands.push(baseUrl + "/" + slugEn + "/");
    if (slugTr && slugTr !== slugEn) showCands.push(baseUrl + "/" + slugTr + "/");

    function tryShow(i) {
      if (i >= showCands.length) return Promise.resolve(null);
      return get(showCands[i], ref)
        .then(function(html) {
          var eps = parseEpisodes(html);
          for (var k = 0; k < eps.length; k++) {
            if (eps[k].season === season && eps[k].episode === episode)
              return tryGet(eps[k].url, ref);
          }
          return null;
        })
        .catch(function() { return null; })
        .then(function(r) { return r || tryShow(i + 1); });
    }

    return tryShow(0);
  }).then(function(r) {
    if (r) return r;

    // 3. Arama
    var q = info.title || info.origTitle;
    return get(baseUrl + "/?s=" + encodeURIComponent(q), ref)
      .then(function(html) {
        var re2 = /href=["'](https?:\/\/(?:www\.)?diziyou\.[a-z]+\/([^"'\/]+)\/)[^>]*title=["']([^"']+)["']/gi;
        var shows = [], sm;
        while ((sm = re2.exec(html)) !== null) shows.push({ url: sm[1], title: sm[3] });
        var best = null, bestScore = 0.3;
        shows.forEach(function(s) {
          var sc = Math.max(sim(s.title, info.title), sim(s.title, info.origTitle));
          if (sc > bestScore) { bestScore = sc; best = s; }
        });
        if (!best) return null;
        return get(best.url, ref).then(function(showHtml) {
          var eps = parseEpisodes(showHtml);
          for (var k = 0; k < eps.length; k++) {
            if (eps[k].season === season && eps[k].episode === episode)
              return tryGet(eps[k].url, ref);
          }
          var sl = best.url.replace(/\/$/, "").split("/").pop();
          return tryGet(baseUrl + "/" + epSlug(sl, season, episode) + "/", ref);
        });
      });
  });
}

// ─── Stream builder ───────────────────────────────────────────────────────────

function buildSingleStream(playerId, isDub, episodeUrl) {
  var suffix   = isDub ? "_tr" : "";
  // Eğer playerId zaten _tr içeriyorsa (dublaj sayfasından geldiyse) suffix ekleme
  var pid      = playerId.replace(/_tr$/, "");
  var epBase   = STORAGE_URL + "/episodes/" + pid + suffix;
  var subBase  = STORAGE_URL + "/subtitles/" + pid + suffix;
  var subOrig  = STORAGE_URL + "/subtitles/" + pid;
  var playerUrl = BASE_URL + "/player/" + pid + suffix + ".html";
  var label    = isDub ? "DiziYou - Turkce Dublaj" : "DiziYou - Turkce Altyazili";
  var hdrs     = { "Referer": BASE_URL + "/", "Origin": BASE_URL, "User-Agent": UA };

  return get(playerUrl, episodeUrl)
    .then(function(ph) {
      // M3U8 URL
      var srcM = ph.match(/id=["']diziyouSource["'][^>]*src=["']([^"']+)["']/i)
              || ph.match(/src=["']([^"']+\.m3u8[^"']*)["'][^>]*type=["']application\/x-mpegURL["']/i);
      var m3u8 = srcM ? srcM[1] : (epBase + "/play.m3u8");

      // Altyazı URL'leri — player HTML'inden çek
      var trM = ph.match(/<track[^>]+src=["']([^"']+)["'][^>]*srclang=["']tr["']/i)
             || ph.match(/<track[^>]+srclang=["']tr["'][^>]*src=["']([^"']+)["']/i);
      var enM = ph.match(/<track[^>]+src=["']([^"']+)["'][^>]*srclang=["']en["']/i)
             || ph.match(/<track[^>]+srclang=["']en["'][^>]*src=["']([^"']+)["']/i);

      var trVtt = trM ? trM[1] : (subBase + "/tr.vtt");
      var enVtt = enM ? enM[1] : (subOrig + "/en.vtt");

      // Subtitle formatı: animekai provider örneğinden: { language, url, default }
      var subtitles = isDub
        ? [{ language: "Turkce", url: trVtt, default: true }]
        : [
            { language: "Turkce",  url: trVtt, default: true  },
            { language: "English", url: enVtt, default: false },
          ];

      console.log("[DiziYou] " + label + " m3u8=" + m3u8);

      return {
        name:      "DiziYou",
        title:     label,
        url:       m3u8,
        quality:   "1080p",
        headers:   hdrs,
        subtitles: subtitles,
      };
    })
    .catch(function() {
      // Player HTML alınamazsa fallback URL'ler
      var subtitles = isDub
        ? [{ language: "Turkce", url: subBase + "/tr.vtt", default: true }]
        : [
            { language: "Turkce",  url: subOrig + "/tr.vtt", default: true  },
            { language: "English", url: subOrig + "/en.vtt", default: false },
          ];
      return {
        name:      "DiziYou",
        title:     label,
        url:       epBase + "/play.m3u8",
        quality:   "1080p",
        headers:   hdrs,
        subtitles: subtitles,
      };
    });
}

function buildStreams(playerId, episodeUrl) {
  console.log("[DiziYou] player_id=" + playerId);
  return Promise.all([
    buildSingleStream(playerId, false, episodeUrl),
    buildSingleStream(playerId, true,  episodeUrl),
  ]).then(function(results) {
    return results.filter(Boolean);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DiziYou] " + tmdbId + " " + mediaType + " S" + season + "E" + episode);
  return getBaseUrl()
    .then(function(baseUrl) {
      return getTmdbInfo(tmdbId, mediaType)
        .then(function(info) {
          console.log("[DiziYou] " + info.title + " / " + info.origTitle);
          if (mediaType === "movie") {
            var slugEn = trSlug(info.origTitle);
            var slugTr = trSlug(info.title);
            var cands  = [baseUrl + "/" + slugEn + "/", baseUrl + "/" + slugTr + "/"];
            function tryMovie(i) {
              if (i >= cands.length) return Promise.resolve(null);
              return tryGet(cands[i], baseUrl + "/").then(function(r) { return r || tryMovie(i + 1); });
            }
            return tryMovie(0);
          }
          return resolveEpisodeUrl(baseUrl, info, season, episode);
        });
    })
    .then(function(result) {
      if (!result) { console.warn("[DiziYou] bulunamadi"); return []; }
      return buildStreams(result.playerId, result.url);
    })
    .catch(function(err) {
      console.error("[DiziYou] " + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
