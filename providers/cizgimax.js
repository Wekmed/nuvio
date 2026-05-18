// ============================================================
//  CizgiMax — Nuvio Provider
//  HTML
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ── İSTİSNA SÖZLÜĞÜ (Yedek Mekanizma) ────────────────────────
var CUSTOM_MAPPINGS = {
  '1615': 'Chip İle Dale Kurtarma Ekibi'
};

// ── Yardımcı Fonksiyonlar ─────────────────────────────────────
function normalizeStr(s) {
  return (s || '').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ı]/g,'i').replace(/[İ]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

// ── TMDB Veri Çekme ──────────────────────────────────────────
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

// ── Site İçi Arama Motoru ─────────────────────────────────────
function searchSite(query) {
  if (!query || query.trim() === '') return Promise.resolve([]);
  return fetch(MAIN_URL + '/api/search/suggest/?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Accept': 'application/json' })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) { return d.animes || []; })
  .catch(function() { return []; });
}

// ── En İyi Eşleşmeyi Bulma Algoritması ─────────────────────────
function findBestMatch(results, en, tr) {
  var nEn = normalizeStr(en), nTr = normalizeStr(tr);
  var best = null, bestScore = 0;
  
  results.forEach(function(r) {
    if (r.kind === 'film') return; // Sadece dizileri hedef alıyoruz
    var ni = normalizeStr(r.name), sc = 0;
    
    if (ni === nEn || ni === nTr)                                        sc += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc += 60;
    
    if (sc > bestScore) { bestScore = sc; best = r; }
  });
  
  return bestScore >= 55 ? best : null;
}

// ── Bölüm URL'i İnşa Etme ─────────────────────────────────────
function buildEpisodeUrl(diziUrl, season, episode) {
  var m = diziUrl.match(/\/diziler\/(.+?)-izle\//);
  if (!m) return null;
  var slug = m[1];
  return MAIN_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
}

// ── Bölüm Stream Linklerini Çıkarma (SADECE SIBNET BUTONU) ────
function fetchEpisodeStreams(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      
      // Sadece sibnet indirme butonlarını yakalayan regex (Vidmoly elendi)
      var pattern = /href="([^"]*?\/api\/indir\/sibnet\/\?t=[^"]+)"/g;
      var match;
      
      while ((match = pattern.exec(html)) !== null) {
        var dlPath = match[1];
        if (!dlPath) continue;
        
        // HTML entity temizliği ve dosya adı parametresinin kırpılması
        dlPath = dlPath.replace(/&amp;/g, '&').split('&filename=')[0];
        
        // İndirme linkini doğrudan stream linkine dönüştür
        var streamPath = dlPath.replace('/api/indir/', '/api/stream/');
        var streamUrl = streamPath.startsWith('http') ? streamPath : MAIN_URL + streamPath;
        
        // Mükerrer link kontrolü
        var isDuplicate = results.some(function(r) { return r.url === streamUrl; });
        
        if (!isDuplicate) {
          results.push({
            name:    'CizgiMax',
            title:   '⌜ CİZGİMAX ⌟ | Sibnet',
            url:     streamUrl,
            quality: 'Auto',
            headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
          });
          console.log('[CizgiMax] Butondan Sibnet linki başarıyla eklendi.');
        }
      }
      
      if (results.length === 0) {
        console.log('[CizgiMax] Sayfada uygun Sibnet indirme butonu bulunamadı.');
      }
      
      return results;
    })
    .catch(function(e) {
      console.log('[CizgiMax] Sayfa çekilirken hata oluştu: ' + (e.message || String(e)));
      return [];
    });
}

// ── Ana Giriş Fonksiyonu ───────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log('[CizgiMax] Başlatılıyor: ' + tmdbId + ' ' + mediaType);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      // Özel eşleştirme (Custom Mappings) kontrolü
      var customTitle = CUSTOM_MAPPINGS[String(tmdbId)];
      if (customTitle) {
        info.titleEn = customTitle;
        info.titleTr = customTitle;
      }

      console.log('[CizgiMax] TMDB Verileri -> EN: ' + info.titleEn + ' | TR: ' + info.titleTr);
      if (!info.titleEn && !info.titleTr) return [];

      // Eşzamanlı (Paralel) arama isteği hazırlığı
      var searchPromises = [
        searchSite(info.titleEn),
        searchSite(info.titleTr)
      ];

      // İki arama sonucunu da bekleyip tek çatı altında birleştiriyoruz
      return Promise.all(searchPromises)
        .then(function(searchResultsArray) {
          var allResults = [];
          if (searchResultsArray[0]) allResults = allResults.concat(searchResultsArray[0]);
          if (searchResultsArray[1]) allResults = allResults.concat(searchResultsArray[1]);
          
          console.log('[CizgiMax] Toplam birleşik arama sonucu: ' + allResults.length);
          
          var best = findBestMatch(allResults, info.titleEn, info.titleTr);
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[CizgiMax] İki dilde de uygun dizi eşleşmesi bulunamadı.');
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
      console.log('[CizgiMax] Genel Hata: ' + (err.message || String(err)));
      return [];
    });
}

// ── Export / Global Tanımlamalar ──────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
