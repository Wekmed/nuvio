// ============================================================
//  CizgiMax — Nuvio Provider
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ── Yardımcı ─────────────────────────────────────────────────
function normalizeStr(s) {
  return (s || '').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ı]/g,'i').replace(/[İ]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = (mediaType === 'movie') ? 'movie' : 'tv';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || ''
      };
    });
}

// ── Arama ─────────────────────────────────────────────────────
function searchSite(query) {
  return fetch(MAIN_URL + '/api/search/suggest/?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Accept': 'application/json' })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) { return d.animes || []; })
  .catch(function() { return []; });
}

function findBestMatch(results, en, tr) {
  var nEn = normalizeStr(en), nTr = normalizeStr(tr);
  var best = null, bestScore = 0;

  results.forEach(function(r) {
    if (r.kind === 'film') return;
    var ni = normalizeStr(r.name), sc = 0;
    if (ni === nEn || ni === nTr)                                        sc += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc += 60;
    if (sc > bestScore) { bestScore = sc; best = r; }
  });

  if (!best) {
    results.forEach(function(r) {
      var ni = normalizeStr(r.name), sc = 0;
      if (ni === nEn || ni === nTr) sc += 100;
      else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc += 65;
      else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc += 60;
      if (sc > bestScore) { bestScore = sc; best = r; }
    });
  }
  return bestScore >= 55 ? best : null;
}

// ── Bölüm URL oluştur ─────────────────────────────────────────
function buildEpisodeUrl(diziUrl, season, episode) {
  var m = diziUrl.match(/\/diziler\/(.+?)-izle\//);
  if (!m) return null;
  var slug = m[1];
  return MAIN_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
}

// ── Stream linkini streaming ile çek (256KB sınırını aşmaz) ──
function fetchEpisodeStreams(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) {
      // Streaming destekleniyorsa ReadableStream kullan
      if (r.body && r.body.getReader) {
        return extractStreamUrlFromBody(r.body, epUrl);
      }
      // Fallback: streaming yoksa tüm text'i oku
      return r.text().then(function(html) {
        return parseStreamTokens(html, epUrl);
      });
    })
    .catch(function() { return []; });
}

// ── ReadableStream ile token avı ─────────────────────────────
function extractStreamUrlFromBody(body, epUrl) {
  return new Promise(function(resolve) {
    var reader  = body.getReader();
    var decoder = new TextDecoder();
    var buffer  = '';
    var results = [];

    // Token regex'leri — birden fazla provider olabilir
    var PATTERNS = [
      // /api/stream/sibnet?t=...
      { re: /\/api\/stream\/sibnet\?t=([\w\-\.]+)/g, label: 'Sibnet' },
      // /api/stream/... genel
      { re: /\/api\/stream\/[\w]+\?t=([\w\-\.]+)/g,  label: 'Stream' }
    ];

    function pump() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          // Akış bitti, son buffer'ı tara
          results = results.concat(parseStreamTokens(buffer, epUrl));
          resolve(dedupe(results));
          return;
        }

        buffer += decoder.decode(chunk.value, { stream: true });

        // Her pattern için kontrol et
        PATTERNS.forEach(function(p) {
          var m;
          p.re.lastIndex = 0;
          while ((m = p.re.exec(buffer)) !== null) {
            var fullUrl = MAIN_URL + m[0].replace(/&amp;/g, '&');
            results.push({
              name:    'CizgiMax',
              title:   '⌜ CİZGİMAX ⌟ | ' + p.label,
              url:     fullUrl,
              quality: 'Auto',
              headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
            });
          }
        });

        // Yeterli sonuç bulduk — gerisini okuma
        if (results.length >= 2) {
          reader.cancel();
          resolve(dedupe(results));
          return;
        }

        // Buffer'ı temizle; regex sınırda kaçmasın diye son 512 char'ı koru
        if (buffer.length > 32768) {
          buffer = buffer.slice(-512);
        }

        pump();
      }).catch(function() {
        resolve(dedupe(results));
      });
    }

    pump();
  });
}

// ── Düz HTML'den token parse et (fallback) ───────────────────
function parseStreamTokens(html, epUrl) {
  var results = [];
  var PATTERNS = [
    { re: /\/api\/stream\/sibnet\?t=([\w\-\.]+)/g, label: 'Sibnet' },
    { re: /\/api\/stream\/[\w]+\?t=([\w\-\.]+)/g,  label: 'Stream' }
  ];
  PATTERNS.forEach(function(p) {
    var m;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(html)) !== null) {
      var fullUrl = MAIN_URL + m[0].replace(/&amp;/g, '&');
      results.push({
        name:    'CizgiMax',
        title:   '⌜ CİZGİMAX ⌟ | ' + p.label,
        url:     fullUrl,
        quality: 'Auto',
        headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
      });
    }
  });
  return results;
}

// ── Duplicate URL temizle ─────────────────────────────────────
function dedupe(arr) {
  var seen = {};
  return arr.filter(function(item) {
    if (seen[item.url]) return false;
    seen[item.url] = true;
    return true;
  });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      // ── ÖZEL İSİM AYARLARI (İSTİSNALAR / MANUEL DÜZELTMELER) ──
      var checkName = (info.titleEn || '').toLowerCase();
      if (checkName.indexOf('chip n dale') !== -1 || checkName.indexOf('chip dale') !== -1) {
        info.titleEn = 'Chip ve Dale';
        info.titleTr = 'Chip ve Dale';
      }
      // ─────────────────────────────────────────────────────────

      return searchSite(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchSite(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) return [];
          var sNum = parseInt(seasonNum)  || 1;
          var eNum = parseInt(episodeNum) || 1;
          var diziUrl = best.url.startsWith('http') ? best.url : MAIN_URL + best.url;
          var epUrl   = buildEpisodeUrl(diziUrl, sNum, eNum);
          if (!epUrl) return [];
          return fetchEpisodeStreams(epUrl);
        });
    })
    .catch(function() { return []; });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
