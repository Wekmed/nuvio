// ============================================================
//  CizgiVeDizi — Nuvio Provider  (v7)
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

/** URL path için güvenli encode: sadece boşluk + ASCII-dışı karakterler */
function encodePath(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    if (s[i] === ' ') {
      out += '%20';
    } else if (code > 127) {
      out += encodeURIComponent(s[i]);
    } else {
      out += s[i];  // parantez, tire, nokta, alt çizgi olduğu gibi
    }
  }
  return out;
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

// ── 2. Arama + Skorlama ──────────────────────────────────────

/**
 * Sorgu listesi oluşturur.
 * TR önce: Regular Show → "Sürekli Dizi" ile bulunur.
 * EN de denenir: Adventure Time → EN ile direkt bulunur.
 */
function buildQueries(titleTr, titleEn) {
  var out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && out.indexOf(q) === -1) out.push(q);
  }

  // TR tam → EN tam → EN son anlamlı kelime → TR anlamlı kelimeler
  add(titleTr);
  add(titleEn);

  var enWords = (titleEn || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (enWords.length > 1) add(enWords[enWords.length - 1]); // son kelime: "Gumball"
  if (enWords.length > 1) add(enWords[0]);                  // ilk kelime

  var trWords = (titleTr || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (trWords.length > 1) add(trWords[trWords.length - 1]);
  if (trWords.length > 1) add(trWords[0]);

  return out;
}

function searchSite(query, mediaType) {
  var anchor = mediaType === 'movie' ? SEARCH_ANCHOR_FILM : SEARCH_ANCHOR;
  var url    = anchor + '?ajax=search&q=' + encodeURIComponent(query);
  return fetch(url, { headers: HEADERS_SEARCH })
    .then(function(r) { return r.ok ? r.json() : []; })
    .catch(function() { return []; });
}

/**
 * API yanıtındaki item'ı TMDB bilgisiyle karşılaştırır.
 *
 * Önemli: site name'leri:
 *   "gumball"              → EN isim kısa
 *   "ducktales (2017)"     → yıl parantez içinde
 *   "sürekli dizi"         → TR isim (EN: Regular Show)
 *   "adventure time"       → EN isim
 *
 * Skor:
 *   100 = kesin eşleşme (isim + yıl uyumu)
 *    90 = isim tam eşleşme, yıl kontrolü başarılı
 *    80 = isim tam eşleşme, yılsız
 *    70 = kısmi eşleşme
 *     0 = eşleşme yok
 */
function scoreItem(item, titleEn, titleTr, year) {
  var n      = norm(item.name || '');
  var ne     = norm(titleEn);
  var nt     = norm(titleTr);

  // Name içindeki yıl: "ducktales (2017)" → "2017"
  var nameYear = (item.name || '').match(/\b(19[89]\d|20[0-3]\d)\b/);
  nameYear = nameYear ? nameYear[1] : null;

  // İsim eşleşme skoru
  var nameScore = 0;
  if (n === ne || n === nt) {
    nameScore = 80;
  } else {
    // Name yıl içeriyorsa temizle: "ducktales (2017)" → "ducktales"
    var nClean = n.replace(/\d{4}/g, '').replace(/[^a-z0-9]/g, '');
    var neClean = ne.replace(/\d{4}/g, '').replace(/[^a-z0-9]/g, '');
    var ntClean = nt.replace(/\d{4}/g, '').replace(/[^a-z0-9]/g, '');
    if (nClean === neClean || nClean === ntClean) {
      nameScore = 75;
    } else if (nClean.length > 3 && (neClean.indexOf(nClean) !== -1 || nClean.indexOf(neClean) !== -1)) {
      nameScore = 70;
    } else if (nClean.length > 3 && (ntClean.indexOf(nClean) !== -1 || nClean.indexOf(ntClean) !== -1)) {
      nameScore = 70;
    }
  }

  if (nameScore === 0) return 0;

  // Yıl bonusu / cezası
  if (nameYear && year) {
    if (nameYear === year) {
      return nameScore + 20; // yıl tam eşleşme → büyük bonus (100 veya 90+)
    } else {
      return 10; // yıl var ama yanlış → neredeyse elendi
    }
  }

  return nameScore;
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);

  return queries.reduce(function(chain, query) {
    return chain.then(function(found) {
      if (found) return found;
      return searchSite(query, mediaType).then(function(results) {
        if (!results.length) return null;

        var candidates = results
          .map(function(item) {
            return {
              item:  item,
              score: scoreItem(item, info.titleEn, info.titleTr, info.year)
            };
          })
          .filter(function(c) { return c.score >= 70; })
          .sort(function(a, b) { return b.score - a.score; });

        if (!candidates.length) return null;

        // En yüksek skorlu adayı al
        // Eşit skorlu birden fazla varsa ilkini al (score yeterince ayırt edici)
        return candidates[0].item;
      });
    });
  }, Promise.resolve(null));
}

// ── 3. Global bölüm numarası ──────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  if (seasonNum <= 1) return Promise.resolve(episodeNum);

  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    // IIFE ile closure hatası önlenir (var s loop içinde değişiyor)
    (function(sNum) {
      promises.push(
        fetch(
          'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sNum +
          '?api_key=' + TMDB_KEY
        )
          .then(function(r) { return r.json(); })
          .then(function(d) { return (d.episodes && d.episodes.length) || 0; })
          .catch(function() { return 0; })
      );
    })(s);
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

function isVideoUrl(url) {
  var lower = (url || '').toLowerCase().split('?')[0];
  var bad   = ['.css','.js','.woff','.woff2','.ttf','.eot',
               '.png','.jpg','.jpeg','.gif','.svg','.ico','.map','.json'];
  for (var i = 0; i < bad.length; i++) {
    if (lower.slice(-bad[i].length) === bad[i]) return false;
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

function extractMp4upload(embedUrl) {
  var full = toAbsolute(embedUrl);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      // sources:[{file:"URL"}] veya file:"URL"
      var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
           || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i)
           || html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
      if (m && isVideoUrl(m[1]))
        return {
          url:  m[1],
          type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
          headers: { 'Referer': full }
        };

      // Fallback: tüm URL'leri tara, video olanı seç
      var allUrls = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (var i = 0; i < allUrls.length; i++) {
        if (isVideoUrl(allUrls[i]) && allUrls[i].indexOf('mp4upload') !== -1) {
          return {
            url:  allUrls[i],
            type: allUrls[i].indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
            headers: { 'Referer': full }
          };
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
  var id   = item.id;
  var slug = item.slug;

  if (mediaType === 'movie') {
    return BASE_URL + '/film/' + encodePath(id) + '/' + encodePath(slug);
  }
  return BASE_URL + '/dizi/' + encodePath(id) + '/' + encodePath(slug)
       + '/' + epGlobalNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  var infoP = fetchTmdbInfo(tmdbId, mediaType);
  var epNoP = mediaType === 'tv'
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
