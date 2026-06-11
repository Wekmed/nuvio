// ============================================================
//  CizgiMax — Nuvio Provider.
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

  // Önce dizileri dene (kind !== 'film')
  results.forEach(function(r) {
    if (r.kind === 'film') return;
    var ni = normalizeStr(r.name), sc = 0;
    if (ni === nEn || ni === nTr)                                        sc += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc += 60;
    if (sc > bestScore) { bestScore = sc; best = r; }
  });

  // Bulamazsan filmleri de dene
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
      if (r.body && r.body.getReader) {
        return extractStreamUrlFromBody(r.body, epUrl);
      }
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

    var PATTERNS = [
      { re: /\/api\/stream\/sibnet\?t=([\w\-\.]+)/g, label: 'Sibnet'  },
      { re: /\/api\/stream\/([\w]+)\?t=([\w\-\.]+)/g, label: 'Stream' }
    ];

    function pump() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          results = results.concat(parseStreamTokens(buffer, epUrl));
          resolve(dedupe(results));
          return;
        }

        buffer += decoder.decode(chunk.value, { stream: true });

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

        if (results.length >= 2) {
          reader.cancel();
          resolve(dedupe(results));
          return;
        }

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
    { re: /\/api\/stream\/sibnet\?t=([\w\-\.]+)/g, label: 'Sibnet'  },
    { re: /\/api\/stream\/([\w]+)\?t=([\w\-\.]+)/g, label: 'Stream' }
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

// ── İsim İstisnaları ─────────────────────────────────────────
function applyNameOverrides(info) {
  var check = (info.titleEn || '').toLowerCase();
  if (check.indexOf('chip n dale') !== -1 || check.indexOf('chip dale') !== -1) {
    info.titleEn = 'Chip ve Dale';
    info.titleTr = 'Chip ve Dale';
  }
  // Buraya başka istisnalar eklenebilir:
  // if (check.indexOf('xxx') !== -1) { info.titleEn = 'YYY'; }
  return info;
}

// ── Ana fonksiyon (Nuvio çağırır) ────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      info = applyNameOverrides(info);

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

// ── Poster-Gate tıklama entegrasyonu (Standalone / WebView) ──
//
//  Sayfanda şu yapı varsa otomatik çalışır:
//
//  <div class="player-wrap"
//       data-wp-tmdb-id="12345"
//       data-wp-media-type="tv"
//       data-wp-season="1"
//       data-wp-episode-no="1">
//    <div class="cz-poster-gate" id="czPosterGate">
//      <!-- play ikonu -->
//    </div>
//  </div>
//
//  Tıklandığında: gate gizlenir → yükleniyor gösterilir →
//  getStreams() çağrılır → ilk link varsa otomatik oynatılır.
// ──────────────────────────────────────────────────────────────
function initPlayerGate(options) {
  var opts = options || {};

  // Callback'ler — dışarıdan override edilebilir
  var onStreamsFound = opts.onStreamsFound || function(streams, playerWrap) {
    // Varsayılan: ilk stream'i iframe olarak yerleştir
    if (!streams.length) return onError('Stream bulunamadı.');
    var s = streams[0];
    var iframe = document.createElement('iframe');
    iframe.src             = s.url;
    iframe.allowFullscreen = true;
    iframe.style.cssText   = 'width:100%;height:100%;border:none;display:block;';
    playerWrap.innerHTML   = '';
    playerWrap.appendChild(iframe);
  };

  var onLoading = opts.onLoading || function(playerWrap) {
    playerWrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;'
      + 'height:100%;color:#fff;font-family:sans-serif;font-size:14px;gap:10px;">'
      + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" style="animation:czSpin 1s linear infinite">'
      + '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83'
      + 'M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>'
      + '</svg>Stream yükleniyor...</div>'
      + '<style>@keyframes czSpin{to{transform:rotate(360deg)}}</style>';
  };

  var onError = opts.onError || function(msg, playerWrap) {
    if (playerWrap) {
      playerWrap.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;'
        + 'height:100%;color:#f87171;font-family:sans-serif;font-size:14px;">'
        + '⚠ ' + msg + '</div>';
    }
  };

  var gate = document.getElementById('czPosterGate');
  if (!gate) return;

  var playerWrap = gate.closest('.player-wrap') || gate.parentElement;

  // data-wp-* attribute'larını oku
  var tmdbId    = playerWrap.dataset.wpTmdbId    || opts.tmdbId;
  var mediaType = playerWrap.dataset.wpMediaType || opts.mediaType || 'tv';
  var season    = playerWrap.dataset.wpSeason    || opts.season    || '1';
  var episode   = playerWrap.dataset.wpEpisodeNo || opts.episode   || '1';

  gate.style.cursor = 'pointer';

  gate.addEventListener('click', function onGateClick() {
    gate.removeEventListener('click', onGateClick); // tek seferlik
    onLoading(playerWrap);

    getStreams(tmdbId, mediaType, season, episode)
      .then(function(streams) {
        onStreamsFound(streams, playerWrap);
      })
      .catch(function(err) {
        onError('Bağlantı hatası: ' + (err && err.message || err), playerWrap);
      });
  });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams, initPlayerGate: initPlayerGate };
} else {
  (typeof globalThis !== 'undefined' ? globalThis : window).getStreams    = getStreams;
  (typeof globalThis !== 'undefined' ? globalThis : window).initPlayerGate = initPlayerGate;
}
