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
function regexFirst(html, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(html);
  return m ? m[1] : null;
}

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

// ── Bölüm stream'lerini çıkar (SADECE İNDİRME BUTONU) ────────
function fetchEpisodeStreams(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];

      // Sadece indirme butonundan tokenı arıyoruz
      var dlPath = regexFirst(html, 'href="([^"]*?/api/indir/sibnet/\\?t=[^"]+)"');
      
      if (dlPath) {
        // Gereksiz parametreleri temizle ve stream linkine çevir
        dlPath = dlPath.replace(/&amp;/g, '&').split('&filename=')[0];
        var streamPath = dlPath.replace('/api/indir/', '/api/stream/');
        var streamUrl = streamPath.startsWith('http') ? streamPath : MAIN_URL + streamPath;

        results.push({
          name:    'CizgiMax',
          title:   '⌜ CİZGİMAX ⌟ | Sibnet',
          url:     streamUrl,
          quality: 'Auto',
          headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
        });
        
        console.log('[CizgiMax] İndirme butonundan Sibnet linki başarıyla eklendi.');
      } else {
        console.log('[CizgiMax] İndirme butonu (veya Sibnet linki) bulunamadı.');
      }

      return results; // Başka hiçbir şey eklemeden direkt döndür
    })
    .catch(function(e) {
      console.log('[CizgiMax] Sayfa hata: ' + (e.message || String(e)));
      return [];
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log('[CizgiMax] Başlatılıyor: ' + tmdbId + ' ' + mediaType);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      console.log('[CizgiMax] TMDB: ' + info.titleEn + ' / ' + info.titleTr);
      if (!info.titleEn && !info.titleTr) return [];

      return searchSite(info.titleEn || info.titleTr)
        .then(function(results) {
          console.log('[CizgiMax] Arama: ' + results.length + ' sonuç');
          var best = findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchSite(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[CizgiMax] Bulunamadı: ' + (info.titleEn || info.titleTr));
            return [];
          }
          console.log('[CizgiMax] Eşleşti: ' + best.name + ' -> ' + best.url);

          var sNum = parseInt(seasonNum)  || 1;
          var eNum = parseInt(episodeNum) || 1;

          var diziUrl = best.url.startsWith('http') ? best.url : MAIN_URL + best.url;
          var epUrl   = buildEpisodeUrl(diziUrl, sNum, eNum);

          if (!epUrl) {
            console.log('[CizgiMax] Bölüm URL oluşturulamadı: ' + diziUrl);
            return [];
          }

          console.log('[CizgiMax] Bölüm URL: ' + epUrl);
          return fetchEpisodeStreams(epUrl);
        });
    })
    .catch(function(err) {
      console.log('[CizgiMax] Hata: ' + (err.message || String(err)));
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
