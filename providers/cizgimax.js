// ============================================================
//  CizgiVeDizi — Nuvio Provider  (v8)
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

/**
 * URL path segmenti için encode.
 * ':' → %3A dahil özel karakterler encode edilir.
 * Parantez, tire, alt çizgi, nokta olduğu gibi kalır.
 */
function encodePath(s) {
  var safe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~()\'!*';
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c    = s[i];
    var code = s.charCodeAt(i);
    if (safe.indexOf(c) !== -1) {
      out += c;
    } else if (code > 127) {
      out += encodeURIComponent(c);
    } else {
      // ASCII özel karakterler: : @ # $ & + , ; = ? ^ ` { | } vs
      out += '%' + ('0' + code.toString(16).toUpperCase()).slice(-2);
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

function buildQueries(titleTr, titleEn) {
  var out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && out.indexOf(q) === -1) out.push(q);
  }

  // TR tam → EN tam → EN son anlamlı → TR son anlamlı
  add(titleTr);
  add(titleEn);

  var enWords = (titleEn || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP_WORDS.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (enWords.length > 1) add(enWords[enWords.length - 1]);
  if (enWords.length > 1) add(enWords[0]);

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
 * Skorlama:
 * - name içinde yıl varsa (ducktales (2017)): yıl eşleşmesi kesin belirleyici
 * - name yılsız (gumball, adventure time): isim benzerliği ile
 *
 * Önemli kural: ne.indexOf(n) kontrolü
 * "theamazingworldofgumball".indexOf("gumball") = pozitif → 80 puan
 * Bu şekilde site kısa isimleri (gmb=gumball) doğru eşleşiyor.
 */
function scoreItem(item, titleEn, titleTr, year) {
  var n  = norm(item.name || '');
  var ne = norm(titleEn);
  var nt = norm(titleTr);

  // Name içindeki yıl
  var nameYearM = (item.name || '').match(/\b(19[89]\d|20[0-3]\d)\b/);
  var nameYear  = nameYearM ? nameYearM[1] : null;

  // Yılsız isim (karşılaştırma için)
  var nClean  = n.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var neClean = ne.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var ntClean = nt.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');

  // İsim benzerlik skoru
  var nameScore = 0;
  if (nClean === neClean || nClean === ntClean) {
    nameScore = 80; // tam eşleşme (yılsız)
  } else if (neClean.length > 2 && neClean.indexOf(nClean) !== -1) {
    nameScore = 80; // en içinde n var: "theamazingworldofgumball" ⊃ "gumball"
  } else if (ntClean.length > 2 && ntClean.indexOf(nClean) !== -1) {
    nameScore = 75;
  } else if (nClean.length > 4 && neClean.indexOf(nClean) !== -1) {
    nameScore = 70;
  } else if (nClean.length > 4 && ntClean.indexOf(nClean) !== -1) {
    nameScore = 70;
  }

  if (nameScore === 0) return 0;

  // Yıl kontrolü
  if (nameYear && year) {
    if (nameYear === year)  return nameScore + 20; // tam yıl eşleşmesi
    else                    return 5;              // yıl var ama yanlış → elendi
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
            return { item: item, score: scoreItem(item, info.titleEn, info.titleTr, info.year) };
          })
          .filter(function(c) { return c.score >= 70; })
          .sort(function(a, b) { return b.score - a.score; });

        if (!candidates.length) return null;
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

// ── 4. HTML → embed URL'leri ─────────────────────────────────

/**
 * window.__embeds_b64 veya script içi embed URL array'ini parse eder.
 *
 * Strateji A: window.__embeds_b64 = 'BASE64...' → atob → JSON
 * Strateji B: window.__embeds = ["//sibnet...", ...] (zaten decode edilmiş)
 * Strateji C: script içindeki sibnet/mailru/mp4upload URL'lerini regex ile topla
 */
function parseEmbeds(html) {
  // A: Base64
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    try {
      var arr = JSON.parse(decodeURIComponent(escape(atob(b64m[1]))));
      if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
    } catch(e) {}
  }

  // B: Doğrudan array
  var dirm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dirm) {
    try {
      var arr2 = JSON.parse(dirm[1]);
      if (Array.isArray(arr2) && arr2.length) return arr2.filter(Boolean);
    } catch(e) {}
  }

  // C: Script taglarından URL toplama
  var embedUrls = [];
  var seen      = {};
  var scriptRe  = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    var script = sm[1];
    var urlRe  = /["'`]((?:https?:)?\/\/(?:video\.sibnet\.ru\/shell\.php[^"'`\s]+|my\.mail\.ru\/video\/embed\/[^"'`\s]+|www\.mp4upload\.com\/embed-[^"'`\s]+|vidmoly\.to\/e\/[^"'`\s]+|ok\.ru\/videoembed\/[^"'`\s]+|vk\.com\/video_ext[^"'`\s]+))/gi;
    var um;
    while ((um = urlRe.exec(script)) !== null) {
      var u = um[1];
      if (!seen[u]) { seen[u] = true; embedUrls.push(u); }
    }
  }

  return embedUrls;
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
      var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
           || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i)
           || html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
      if (m && isVideoUrl(m[1]))
        return { url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
      var allUrls = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (var i = 0; i < allUrls.length; i++) {
        if (isVideoUrl(allUrls[i]) && allUrls[i].indexOf('mp4upload') !== -1)
          return { url: allUrls[i], type: allUrls[i].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
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
    return BASE_URL + '/film/' + encodePath(item.id) + '/' + encodePath(item.slug);
  return BASE_URL + '/dizi/' + encodePath(item.id) + '/' + encodePath(item.slug)
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
