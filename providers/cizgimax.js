// ============================================================
//  CizgiVeDizi — Nuvio Provider
// ============================================================

var BASE_URL       = 'https://www.cizgivedizi.com';
var TMDB_KEY       = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST    = 'https://video.sibnet.ru';
var SIBNET_REFERER = 'https://video.sibnet.ru/';

// Arama için sabit anchor (/_/ 404 veriyor)
var SEARCH_ANCHOR  = BASE_URL + '/dizi/gmb/gumball';
var SEARCH_ANCHOR_FILM = BASE_URL + '/film/_/_';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         BASE_URL + '/'
};

var HEADERS_SEARCH = {
  'User-Agent':       HEADERS['User-Agent'],
  'Accept':           'application/json, */*',
  'Accept-Language':  HEADERS['Accept-Language'],
  'X-Requested-With': 'XMLHttpRequest',
  'Referer':          BASE_URL + '/'
};

var HEADERS_SIBNET = {
  'User-Agent': HEADERS['User-Agent'],
  'Accept':     HEADERS['Accept'],
  'Referer':    SIBNET_REFERER
};

// Aramada atlanacak doldurma kelimeleri
var STOP_WORDS = ['the','a','an','of','in','on','at','to','and','or','for',
                  've','bir','ile','bu','mi','mu','mı','mü'];

// ── Yardımcılar ───────────────────────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9]/g,'');
}

function fetchHtml(url, headers) {
  return fetch(url, { headers: headers || HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

// ── 1. TMDB ──────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch(
    'https://api.themoviedb.org/3/' + ep + '/' + tmdbId +
    '?api_key=' + TMDB_KEY + '&language=tr-TR'
  )
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title:   d.title   || d.name                 || '',
        titleTr: d.title   || d.name                 || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date  || '').slice(0, 4)
      };
    });
}

// ── 2. Arama ─────────────────────────────────────────────────

/**
 * "The Amazing World of Gumball" → ["The Amazing World of Gumball",
 *  "Amazing World Gumball", "Gumball"] gibi sırayla denenir.
 */
function buildQueries(title) {
  var words = (title || '').split(/[\s\-:,]+/).filter(Boolean);
  var meaningful = words.filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  var out = [title];
  if (meaningful.length && meaningful.join(' ') !== title)
    out.push(meaningful.join(' '));
  if (meaningful.length > 1)
    out.push(meaningful[meaningful.length - 1]); // son kelime (genelde özel isim)
  if (meaningful.length > 1)
    out.push(meaningful[0]);
  // yinelenenleri kaldır
  return out.filter(function(q, i, a) { return a.indexOf(q) === i && q; });
}

function searchSite(query, mediaType) {
  var anchor = mediaType === 'movie' ? SEARCH_ANCHOR_FILM : SEARCH_ANCHOR;
  var url    = anchor + '?ajax=search&q=' + encodeURIComponent(query);
  return fetch(url, { headers: HEADERS_SEARCH })
    .then(function(r) { return r.ok ? r.json() : []; })
    .catch(function() { return []; });
}

function scoreItem(item, titleEn, titleTr) {
  var n  = norm(item.name || '');
  var ne = norm(titleEn);
  var nt = norm(titleTr);
  if (n === ne || n === nt)                               return 100;
  if (n.indexOf(ne) !== -1 || ne.indexOf(n) !== -1)      return 80;
  if (n.indexOf(nt) !== -1 || nt.indexOf(n) !== -1)      return 75;
  return 0;
}

function fetchContentYear(item, mediaType) {
  var type = mediaType === 'movie' ? 'film' : 'dizi';
  var url  = BASE_URL + '/' + type + '/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(item.slug);
  return fetchHtml(url)
    .then(function(html) {
      var m = html.match(/(\d{4})/); // yıl geçen ilk sayı (badge veya meta)
      // daha spesifik: 4 haneli sayı 1990-2030 arasında
      var years = html.match(/\b(19[89]\d|20[0-3]\d)\b/g);
      return years ? years[0] : null;
    })
    .catch(function() { return null; });
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleEn);
  if (info.titleTr && info.titleTr !== info.titleEn) {
    queries = queries.concat(buildQueries(info.titleTr));
  }
  // yineleme kaldır
  var seen = {};
  queries = queries.filter(function(q) {
    if (!q || seen[q]) return false;
    seen[q] = true;
    return true;
  });

  return queries.reduce(function(chain, query) {
    return chain.then(function(found) {
      if (found) return found;
      return searchSite(query, mediaType).then(function(results) {
        var candidates = results
          .map(function(item) {
            return { item: item, score: scoreItem(item, info.titleEn, info.titleTr) };
          })
          .filter(function(c) { return c.score >= 75; })
          .sort(function(a, b) { return b.score - a.score; });

        if (!candidates.length) return null;

        // Tek aday veya ilki 100 puan → direkt al
        if (candidates.length === 1) return candidates[0].item;
        if (candidates[0].score === 100 && candidates[1].score < 100) return candidates[0].item;

        // Birden fazla → yıl ile ayırt et
        if (!info.year) return candidates[0].item;

        return Promise.all(
          candidates.slice(0, 4).map(function(c) {
            return fetchContentYear(c.item, mediaType).then(function(yr) {
              return { item: c.item, year: yr };
            });
          })
        ).then(function(withYears) {
          var exact = withYears.find(function(c) { return c.year === info.year; });
          if (exact) return exact.item;
          var close = withYears.filter(function(c) {
            return c.year && Math.abs(parseInt(c.year) - parseInt(info.year)) <= 2;
          });
          return close.length ? close[0].item : withYears[0].item;
        });
      });
    });
  }, Promise.resolve(null));
}

// ── 3. Global bölüm numarası ──────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  if (seasonNum <= 1) return Promise.resolve(episodeNum);

  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    promises.push(
      fetch(
        'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + s +
        '?api_key=' + TMDB_KEY
      )
        .then(function(r) { return r.json(); })
        .then(function(d) { return (d.episodes && d.episodes.length) || 0; })
        .catch(function() { return 0; })
    );
  }

  return Promise.all(promises).then(function(counts) {
    return counts.reduce(function(a, b) { return a + b; }, 0) + episodeNum;
  });
}

// ── 4. HTML → __embeds_b64 parse ─────────────────────────────

/**
 * HTML'den window.__embeds_b64 değerini çıkarır ve decode eder.
 * Örnek:
 *   window.__embeds_b64 = 'WyIvL3ZpZ...';
 *   → ["//video.sibnet.ru/shell.php?videoid=5884015", "//my.mail.ru/...", ...]
 */
function parseEmbeds(html) {
  var m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/);
  if (!m) {
    // Çift tırnaklı versiyon da dene
    m = html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  }
  if (!m) return [];

  try {
    // Base64 → binary → UTF-8 string → JSON parse
    var b64     = m[1];
    var binary  = atob(b64);
    var decoded = decodeURIComponent(escape(binary));
    var arr     = JSON.parse(decoded);
    if (!Array.isArray(arr)) return [];
    return arr.filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Kaynak isimlerini HTML'den alır (sırası __embeds ile eşleşiyor).
 * [Max, CartoonNetwork, mailru, mp4upload, ...]
 */
function parseSourceNames(html) {
  var names  = [];
  var btnRe  = /data-kaynak="(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  var m;
  while ((m = btnRe.exec(html)) !== null) {
    names[parseInt(m[1])] = m[2].trim();
  }
  return names;
}

// ── 5. Embed → Stream ─────────────────────────────────────────

function embedToAbsolute(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

function extractSibnet(embedUrl) {
  var fullUrl = embedToAbsolute(embedUrl);
  return fetchHtml(fullUrl, HEADERS_SIBNET)
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)["']/i)
           || html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4)["']/i);
      if (!m) return null;
      var path = m[1];
      var mp4  = path.indexOf('http') === 0 ? path : SIBNET_HOST + path;
      return { url: mp4, type: 'direct', headers: { 'Referer': fullUrl } };
    })
    .catch(function() { return null; });
}

function extractVidmoly(embedUrl) {
  var fullUrl = embedToAbsolute(embedUrl);
  return fetchHtml(fullUrl, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!m) return null;
      return { url: m[1], type: 'hls', headers: { 'Referer': fullUrl } };
    })
    .catch(function() { return null; });
}

function extractMp4upload(embedUrl) {
  var fullUrl = embedToAbsolute(embedUrl);
  return fetchHtml(fullUrl, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m3u8 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m3u8) return { url: m3u8[1], type: 'hls', headers: { 'Referer': fullUrl } };
      var mp4 = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
      if (mp4) return { url: mp4[1], type: 'direct', headers: { 'Referer': fullUrl } };
      return null;
    })
    .catch(function() { return null; });
}

function extractMailRu(embedUrl) {
  var fullUrl = embedToAbsolute(embedUrl);
  return fetchHtml(fullUrl, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!m) return null;
      return { url: m[1], type: 'hls', headers: { 'Referer': fullUrl } };
    })
    .catch(function() { return null; });
}

function extractStream(embedUrl) {
  var full  = embedToAbsolute(embedUrl);
  if (!full) return Promise.resolve(null);
  var lower = full.toLowerCase();

  if (lower.indexOf('sibnet')    !== -1) return extractSibnet(embedUrl);
  if (lower.indexOf('vidmoly')   !== -1) return extractVidmoly(embedUrl);
  if (lower.indexOf('mp4upload') !== -1) return extractMp4upload(embedUrl);
  if (lower.indexOf('mail.ru')   !== -1) return extractMailRu(embedUrl);

  return Promise.resolve(null);
}

// ── Ana Akış ─────────────────────────────────────────────────

function buildEpUrl(item, mediaType, epGlobalNo) {
  if (mediaType === 'movie')
    return BASE_URL + '/film/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(item.slug);
  return BASE_URL + '/dizi/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(item.slug)
       + '/' + epGlobalNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  var infoPromise = fetchTmdbInfo(tmdbId, mediaType);
  var epNoPromise = mediaType === 'tv'
    ? fetchGlobalEpNo(tmdbId, season, episode)
    : Promise.resolve(null);

  return Promise.all([infoPromise, epNoPromise])
    .then(function(res) {
      var info    = res[0];
      var epGlobal = res[1];

      return findContent(info, mediaType).then(function(item) {
        if (!item) return [];

        var epUrl = buildEpUrl(item, mediaType, epGlobal);
        return fetchHtml(epUrl).then(function(html) {
          var embeds      = parseEmbeds(html);
          var sourceNames = parseSourceNames(html);
          if (!embeds.length) return [];

          return Promise.all(
            embeds.map(function(embedUrl, idx) {
              return extractStream(embedUrl).then(function(stream) {
                if (!stream) return null;
                var srcName = sourceNames[idx] || ('Kaynak ' + idx);
                return {
                  name:    info.title,
                  title:   '⌜ ÇİZGİVEDİZİ ⌟ | ' + srcName + ' | Auto',
                  url:     stream.url,
                  quality: 'Auto',
                  type:    stream.type,
                  headers: stream.headers || {}
                };
              });
            })
          ).then(function(all) { return all.filter(Boolean); });
        });
      });
    })
    .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
