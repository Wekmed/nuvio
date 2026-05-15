// ============================================================
//  CizgiVeDizi — Nuvio Provider  (v9)
//  TV + Film destekler | Hermes uyumlu
// ============================================================

var BASE_URL       = 'https://www.cizgivedizi.com';
var TMDB_KEY       = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST    = 'https://video.sibnet.ru';
var SIBNET_REFERER = 'https://video.sibnet.ru/';

// Arama anchor — dizi/_/_ 404, gerçek path lazım
var SEARCH_DIZI = BASE_URL + '/dizi/gmb/gumball';
var SEARCH_FILM = BASE_URL + '/film/_/_';

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

var STOP = ['the','a','an','of','in','on','at','to','and','or','for',
            've','bir','ile','bu','mi','mu','mı','mü','da','de'];

// ── Norm ─────────────────────────────────────────────────────

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
 * Sorgu listesi — sıra önemli:
 * 1. TR tam ("Sürekli Dizi" → sd bulunur, "Macera Zamanı" → 0 sonuç)
 * 2. EN tam ("Adventure Time" → at bulunur, "Regular Show" → 0 sonuç)
 * 3. EN son anlamlı kelime ("Gumball" → gmb bulunur)
 * 4. EN ilk anlamlı kelime
 * 5. TR son anlamlı kelime (fallback)
 * 6. TR ilk anlamlı kelime (fallback)
 */
function buildQueries(titleTr, titleEn) {
  var seen = {};
  var out  = [];
  function add(q) {
    q = (q || '').trim();
    if (q && !seen[q]) { seen[q] = true; out.push(q); }
  }

  add(titleTr);
  add(titleEn);

  var enWords = (titleEn || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (enWords.length > 1) add(enWords[enWords.length - 1]);
  if (enWords.length > 1) add(enWords[0]);
  if (enWords.length > 2) add(enWords.slice(0, 2).join(' '));

  var trWords = (titleTr || '').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  if (trWords.length > 1) add(trWords[trWords.length - 1]);
  if (trWords.length > 1) add(trWords[0]);

  return out;
}

function searchSite(query, mediaType) {
  var anchor = mediaType === 'movie' ? SEARCH_FILM : SEARCH_DIZI;
  var url    = anchor + '?ajax=search&q=' + encodeURIComponent(query);
  return fetch(url, { headers: HEADERS_SEARCH })
    .then(function(r) { return r.ok ? r.json() : []; })
    .catch(function() { return []; });
}

/**
 * Skorlama mantığı:
 *
 * Site item name'leri:
 *   "gumball"                          → kısa EN isim
 *   "gumball'ın muhteşem tuhaf dünyası"→ uzun TR isim
 *   "sürekli dizi"                     → TR isim (EN: Regular Show)
 *   "ducktales (2017)"                 → EN isim + YIL
 *   "adventure time"                   → EN isim
 *
 * Kural 1: name içinde yıl varsa → yıl eşleşmesi belirleyici
 *   duckt17 + TMDB year=2017 → 100 puan
 *   duckt87 + TMDB year=2017 → 5 puan (elendi)
 *
 * Kural 2: Yıl yoksa isim benzerliği
 *   EXACT: nc == nec veya nc == ntc → 80
 *   EN içinde name var: "theamazingworldofgumball" ⊃ "gumball" → 80
 *   TR içinde name var → 75
 *   Name uzunsa ve içinde ne/nt var → 70
 *
 * Kural 3: name TR, TMDB EN (Regular Show → sürekli dizi)
 *   Bunlar hiç eşleşmez ama "Sürekli Dizi" sorgusundan gelir
 *   ve nc="sureklidizi" == ntc="sureklidizi" → 80 ✓
 */
function scoreItem(item, titleEn, titleTr, year) {
  var rawName = item.name || '';
  var n  = norm(rawName);
  var ne = norm(titleEn);
  var nt = norm(titleTr);

  // Yıl: name içinden çıkar
  var nyM  = rawName.match(/\b(19[89]\d|20[0-3]\d)\b/);
  var ny   = nyM ? nyM[1] : null;

  // Yılsız temiz isimler
  var nc  = n.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var nec = ne.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var ntc = nt.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');

  // İsim skoru
  var s = 0;
  if (nc === nec || nc === ntc)                         s = 80; // tam
  else if (nec.length > 2 && nec.indexOf(nc) !== -1)   s = 80; // EN ⊃ name
  else if (ntc.length > 2 && ntc.indexOf(nc) !== -1)   s = 75; // TR ⊃ name
  else if (nc.length > 4  && nc.indexOf(nec) !== -1)   s = 70; // name ⊃ EN
  else if (nc.length > 4  && nc.indexOf(ntc) !== -1)   s = 70; // name ⊃ TR

  if (s === 0) return 0;

  // Yıl bonusu/cezası
  if (ny && year) {
    return ny === year ? s + 20 : 5;
  }
  return s;
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

        return candidates.length ? candidates[0].item : null;
      });
    });
  }, Promise.resolve(null));
}

// ── 3. Global bölüm no ───────────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  if (seasonNum <= 1) return Promise.resolve(episodeNum);

  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    (function(sNum) {
      promises.push(
        fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sNum +
              '?api_key=' + TMDB_KEY)
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

function parseEmbeds(html) {
  // A: window.__embeds_b64 = 'BASE64'
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    try {
      var arr = JSON.parse(decodeURIComponent(escape(atob(b64m[1]))));
      if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
    } catch(e) {}
  }

  // B: window.__embeds = [...]
  var dm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dm) {
    try {
      var arr2 = JSON.parse(dm[1]);
      if (Array.isArray(arr2) && arr2.length) return arr2.filter(Boolean);
    } catch(e) {}
  }

  // C: Script içinden embed host URL'lerini topla
  var urls = [];
  var seen = {};
  var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    var urlRe = /["'`]((?:https?:)?\/\/(?:video\.sibnet\.ru\/shell\.php[^"'`\s<>]+|my\.mail\.ru\/video\/embed\/[^"'`\s<>]+|www\.mp4upload\.com\/embed-[^"'`\s<>]+|vidmoly\.to\/e\/[^"'`\s<>]+|ok\.ru\/videoembed\/[^"'`\s<>]+|vk\.com\/video_ext[^"'`\s<>]+))/gi;
    var um;
    while ((um = urlRe.exec(sm[1])) !== null) {
      var u = um[1];
      if (!seen[u]) { seen[u] = true; urls.push(u); }
    }
  }
  return urls;
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

function toAbs(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

function isVideoUrl(url) {
  var p = (url || '').toLowerCase().split('?')[0];
  var bad = ['.css','.js','.woff','.woff2','.ttf','.eot','.png','.jpg','.jpeg','.gif','.svg','.ico','.map','.json'];
  for (var i = 0; i < bad.length; i++) if (p.slice(-bad[i].length) === bad[i]) return false;
  return p.indexOf('.m3u8') !== -1 || p.indexOf('.mp4') !== -1;
}

function extractSibnet(url) {
  var full = toAbs(url);
  return fetchHtml(full, HEADERS_SIBNET).then(function(html) {
    var m = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)["']/i)
         || html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4)["']/i);
    if (!m) return null;
    var mp4 = m[1].indexOf('http') === 0 ? m[1] : SIBNET_HOST + m[1];
    return { url: mp4, type: 'direct', headers: { 'Referer': full } };
  }).catch(function() { return null; });
}

function extractVidmoly(url) {
  var full = toAbs(url);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractMp4upload(url) {
  var full = toAbs(url);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
           || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i)
           || html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
      if (m && isVideoUrl(m[1]))
        return { url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
      var all = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (var i = 0; i < all.length; i++) {
        if (isVideoUrl(all[i]) && all[i].indexOf('mp4upload') !== -1)
          return { url: all[i], type: all[i].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
      }
      return null;
    }).catch(function() { return null; });
}

function extractMailRu(url) {
  var full = toAbs(url);
  return fetchHtml(full, { 'User-Agent': HEADERS['User-Agent'], 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractStream(url) {
  var full  = toAbs(url);
  if (!full) return Promise.resolve(null);
  var lo    = full.toLowerCase();
  if (lo.indexOf('sibnet')    !== -1) return extractSibnet(url);
  if (lo.indexOf('vidmoly')   !== -1) return extractVidmoly(url);
  if (lo.indexOf('mp4upload') !== -1) return extractMp4upload(url);
  if (lo.indexOf('mail.ru')   !== -1) return extractMailRu(url);
  return Promise.resolve(null);
}

// ── Ana Akış ─────────────────────────────────────────────────

function buildEpUrl(item, mediaType, epGlobalNo) {
  // Slug'ı olduğu gibi kullan — site slug'ları zaten URL-safe
  // Özel char encode: sadece boşluk ve ASCII-dışı
  var id   = (item.id   || '').replace(/ /g,'%20');
  var slug = (item.slug || '').replace(/ /g,'%20');
  // Türkçe ve diğer ASCII-dışı karakterleri encode et
  function enc(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i], code = s.charCodeAt(i);
      if (code > 127) out += encodeURIComponent(c);
      else out += c;
    }
    return out;
  }
  if (mediaType === 'movie')
    return BASE_URL + '/film/' + enc(id) + '/' + enc(slug);
  return BASE_URL + '/dizi/' + enc(id) + '/' + enc(slug) + '/' + epGlobalNo + '/-';
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
          var embeds  = parseEmbeds(html);
          var srcNames = parseSourceNames(html);
          if (!embeds.length) return [];

          return Promise.all(
            embeds.map(function(embedUrl, idx) {
              return extractStream(embedUrl).then(function(stream) {
                if (!stream) return null;
                return {
                  name:    info.title,
                  title:   '⌜ ÇİZGİVEDİZİ ⌟ | ' + (srcNames[idx] || 'Kaynak ' + idx) + ' | Auto',
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

// ── Export ───────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
