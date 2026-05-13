// ============================================================
//  CizgiVeDizi — Nuvio Provider  (v6)
//  TV dizileri + filmler destekler
// ============================================================

var BASE_URL       = 'https://www.cizgivedizi.com';
var TMDB_KEY       = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST    = 'https://video.sibnet.ru';
var SIBNET_REFERER = 'https://video.sibnet.ru/';

var SEARCH_ANCHOR      = BASE_URL + '/dizi/gmb/gumball';
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

var STOP_WORDS = ['the','a','an','of','in','on','at','to','and','or','for',
                  've','bir','ile','bu','mi','mu','mı','mü','da','de'];

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
 * Sorgu listesi oluşturur.
 *
 * Site API'si sadece `name` alanına göre eşleşiyor.
 * "Regular Show" → sitede "sürekli dizi" → EN başlıkla bulunamaz.
 * Bu yüzden TR başlık ÖNCE ve öncelikli denenir.
 *
 * Strateji sırası:
 *   1. TR tam başlık       ("Sürekli Dizi")
 *   2. EN tam başlık       ("Regular Show")    ← sitede EN isimle de olabilir
 *   3. TR anlamlı kelimeler ("Sürekli")
 *   4. EN son kelime       ("Show")            ← genelde özel isim sonda
 *   5. EN ilk anlamlı      ("Regular")
 */
function buildQueries(titleTr, titleEn) {
  var out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && out.indexOf(q) === -1) out.push(q);
  }

  // TR önce
  add(titleTr);

  // EN tam
  add(titleEn);

  // TR anlamlı kelimeler
  var trWords = (titleTr || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (trWords.length > 1) add(trWords.join(' '));
  if (trWords.length > 0) add(trWords[trWords.length - 1]);
  if (trWords.length > 1) add(trWords[0]);

  // EN anlamlı kelimeler
  var enWords = (titleEn || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (enWords.length > 1) add(enWords.join(' '));
  if (enWords.length > 0) add(enWords[enWords.length - 1]);
  if (enWords.length > 1) add(enWords[0]);

  return out;
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
  if (n.indexOf(nt) !== -1 || nt.indexOf(n) !== -1)      return 80;
  return 0;
}

function fetchContentYear(item, mediaType) {
  var type = mediaType === 'movie' ? 'film' : 'dizi';
  var url  = BASE_URL + '/' + type + '/' +
             encodeURIComponent(item.id) + '/' + encodeURIComponent(item.slug);
  return fetchHtml(url)
    .then(function(html) {
      var years = html.match(/\b(19[89]\d|20[0-3]\d)\b/g);
      return years ? years[0] : null;
    })
    .catch(function() { return null; });
}

function resolveCandidates(candidates, info, mediaType) {
  if (!candidates.length) return Promise.resolve(null);
  if (candidates.length === 1) return Promise.resolve(candidates[0].item);
  if (candidates[0].score === 100 && candidates[1].score < 100)
    return Promise.resolve(candidates[0].item);

  if (!info.year) return Promise.resolve(candidates[0].item);

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
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);

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
        return resolveCandidates(candidates, info, mediaType);
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

// ── 4. HTML → __embeds_b64 ────────────────────────────────────

function parseEmbeds(html) {
  var m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
       || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (!m) return [];
  try {
    var decoded = decodeURIComponent(escape(atob(m[1])));
    var arr     = JSON.parse(decoded);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return []; }
}

function parseSourceNames(html) {
  var names = [];
  var re    = /data-kaynak="(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    names[parseInt(m[1])] = m[2].trim();
  }
  return names;
}

// ── 5. Embed → Stream ─────────────────────────────────────────

function toAbsolute(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

/** Gerçek video URL mi? (CSS/JS/font gibi static dosyalar değil) */
function isVideoUrl(url) {
  var lower = (url || '').toLowerCase().split('?')[0];
  var badExts = ['.css','.js','.woff','.woff2','.ttf','.eot','.png',
                 '.jpg','.jpeg','.gif','.svg','.ico','.map','.json'];
  for (var i = 0; i < badExts.length; i++) {
    if (lower.slice(-badExts[i].length) === badExts[i]) return false;
  }
  return lower.indexOf('.m3u8') !== -1 || lower.indexOf('.mp4') !== -1;
}

function extractSibnet(embedUrl) {
  var full = toAbsolute(embedUrl);
  return fetchHtml(full, HEADERS_SIBNET)
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)["']/i)
           || html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4)["']/i);
      if (!m) return null;
      var path = m[1];
      var mp4  = path.indexOf('http') === 0 ? path : SIBNET_HOST + path;
      return { url: mp4, type: 'direct', headers: { 'Referer': full } };
    })
    .catch(function() { return null; });
}

function extractVidmoly(embedUrl) {
  var full = toAbsolute(embedUrl);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!m) return null;
      return { url: m[1], type: 'hls', headers: { 'Referer': full } };
    })
    .catch(function() { return null; });
}

/**
 * mp4upload: Sayfada obfuscated JS var.
 * Önce sources:[{file:"URL"}] pattern'ini ara.
 * Sonra .mp4 URL'lerini filtrele (CSS/JS gibi statik dosyaları dışla).
 */
function extractMp4upload(embedUrl) {
  var full = toAbsolute(embedUrl);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      // Pattern 1: sources:[{file:"URL"}] veya file:"URL"
      var m1 = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
            || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i)
            || html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
      if (m1 && isVideoUrl(m1[1]))
        return { url: m1[1], type: m1[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };

      // Pattern 2: Tüm https URL'leri bul, video olanı al
      var allUrls = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (var i = 0; i < allUrls.length; i++) {
        var u = allUrls[i];
        if (isVideoUrl(u) && (u.indexOf('mp4upload') !== -1 || u.indexOf('storage') !== -1)) {
          return { url: u, type: u.indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
        }
      }
      return null;
    })
    .catch(function() { return null; });
}

function extractMailRu(embedUrl) {
  var full = toAbsolute(embedUrl);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!m) return null;
      return { url: m[1], type: 'hls', headers: { 'Referer': full } };
    })
    .catch(function() { return null; });
}

function extractStream(embedUrl) {
  var full  = toAbsolute(embedUrl);
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
  var infoP  = fetchTmdbInfo(tmdbId, mediaType);
  var epNoP  = mediaType === 'tv'
    ? fetchGlobalEpNo(tmdbId, season, episode)
    : Promise.resolve(null);

  return Promise.all([infoP, epNoP])
    .then(function(res) {
      var info     = res[0];
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
