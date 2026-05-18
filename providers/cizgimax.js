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

// ── Base64 decode (Hermes uyumlu — atob yok) ──────────────────
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64Decode(str) {
  try {
    str = str.replace(/[^A-Za-z0-9+/]/g, '');
    var out = '', bits = 0, buf = 0;
    for (var i = 0; i < str.length; i++) {
      buf = (buf << 6) | B64.indexOf(str[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 0xFF); }
    }
    return out;
  } catch(e) { return null; }
}

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

// ── servers JSON parse ────────────────────────────────────────
function parseServers(html) {
  var b64 = regexFirst(html, 'var servers\\s*=\\s*JSON\\.parse\\(atob\\("([^"]+)"\\)\\)');
  if (!b64) return [];
  var decoded = b64Decode(b64);
  if (!decoded) return [];
  try {
    var servers = JSON.parse(decoded);
    return Array.isArray(servers) ? servers : [];
  } catch(e) { return []; }
}

// ── Dzen embed → DASH MPD → en iyi kalite URL ────────────────
function extractDzen(oynatUrl, epUrl) {
  var fullUrl = oynatUrl.startsWith('http') ? oynatUrl : MAIN_URL + oynatUrl;

  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': epUrl })
  })
  .then(function(r) {
    var dzenUrl = r.url;
    if (dzenUrl.indexOf('dzen.ru') === -1) {
      console.log('[CizgiMax] Dzen redirect bekleniyordu: ' + dzenUrl);
      return null;
    }
    return r.text().then(function(html) {
      return { dzenUrl: dzenUrl, html: html };
    });
  })
  .then(function(d) {
    if (!d) return null;

    var mpdUrl = regexFirst(d.html, '"(https?://vd[^"]+\\.okcdn\\.ru[^"]+dzen_dash=dash[^"]*)"')
              || regexFirst(d.html, '"contentUrl"\\s*:\\s*"([^"]+\\.mpd[^"]*)"')
              || regexFirst(d.html, '(https?://vd\\d+\\.okcdn\\.ru/[^"\'\\s]+)');

    if (!mpdUrl) {
      console.log('[CizgiMax] Dzen MPD URL bulunamadi');
      return null;
    }

    return fetch(mpdUrl, {
      headers: { 'Referer': 'https://dzen.ru/', 'Origin': 'https://dzen.ru' }
    })
    .then(function(r2) { return r2.text(); })
    .then(function(xml) {
      var repRe = /Representation[^>]+bandwidth="(\d+)"[^>]+quality="([^"]+)"[^>]*>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/g;
      var reps = [], m;
      while ((m = repRe.exec(xml)) !== null) {
        reps.push({ bandwidth: parseInt(m[1]), quality: m[2], params: m[3] });
      }

      if (!reps.length) return null;
      var videoReps = reps.filter(function(r) { return r.bandwidth > 100000; });
      if (!videoReps.length) videoReps = reps;
      videoReps.sort(function(a, b) { return b.bandwidth - a.bandwidth; });

      var best = videoReps[0];
      var baseUrl = mpdUrl.split('?')[0];
      var finalUrl = baseUrl + best.params;

      var qualityMap = { 'full': '1080p', 'hd': '720p', 'sd': '480p', 'low': '360p' };
      var quality = qualityMap[best.quality] || best.quality || 'Auto';

      return { url: finalUrl, quality: quality, referer: 'https://dzen.ru/' };
    });
  })
  .catch(function() { return null; });
}

// ── Bölüm stream'lerini çıkar ────────────────────────────────
function fetchEpisodeStreams(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var servers = parseServers(html);
      console.log('[CizgiMax] ' + servers.length + ' server: ' + epUrl);

      if (!servers.length) return [];

      var results = [];
      var chain   = Promise.resolve();

      servers.forEach(function(server) {
        chain = chain.then(function() {

          // Sibnet — Direkt Akış Çekimi
          if (server.type === 'sibnet' && server.streamUrl) {
            var streamUrl = server.streamUrl.startsWith('http') ? server.streamUrl : MAIN_URL + server.streamUrl;
            var label = server.label || 'Sibnet';
            results.push({
              name:    'CizgiMax',
              title:   '⌜ CİZGİMAX ⌟ | ' + label,
              url:     streamUrl,
              quality: 'Auto',
              headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
            });
            return Promise.resolve();
          }

          // Dzen (iframe)
          if (server.type === 'iframe' && server.src && server.src.indexOf('dzen.ru') !== -1) {
            var label = server.label || 'Dzen';
            return extractDzen(server.src, epUrl).then(function(dzen) {
              if (!dzen) return;
              results.push({
                name:    'CizgiMax',
                title:   '⌜ CİZGİMAX ⌟ | ' + label,
                url:     dzen.url,
                quality: dzen.quality || 'Auto',
                headers: { 'Referer': dzen.referer, 'Origin': 'https://dzen.ru' }
              });
            });
          }

          // ── Vidmoly Stream Çözücü Motoru (Yönlendirmeyi İzle → Embed Yap → .m3u8 Çek) ──
          if (server.type === 'vidmoly' || 
              (server.streamUrl && server.streamUrl.indexOf('vidmoly') !== -1) || 
              (server.src && server.src.indexOf('vidmoly') !== -1)) {
            
            var targetUrl = server.streamUrl || server.src;
            var fullUrl = targetUrl.startsWith('http') ? targetUrl : MAIN_URL + targetUrl;
            var label = server.label || 'VidMoly';
            
            // 1. Adım: CizgiMax API linkine istek atıp bizi fırlattığı gerçek Vidmoly linkini yakalıyoruz
            return fetch(fullUrl, { headers: HEADERS })
              .then(function(r) {
                var finalUrl = r.url || fullUrl;
                
                // 2. Adım: Linkin içinden 12 karakterli benzersiz video ID'sini cımbızlıyoruz
                var idMatch = finalUrl.match(/(?:embed-|dl\/|w\/|v\/)?([a-zA-Z0-9]{12})/);
                if (!idMatch) return null;
                
                var id = idMatch[1];
                // 3. Adım: Cloudflare engeli bulunmayan temiz .biz embed linkini inşa ediyoruz
                var embedUrl = 'https://vidmoly.biz/embed-' + id + '.html';
                
                // 4. Adım: Embed sayfasına fetch atarak arka plandaki kaynak kodunu indiriyoruz
                return fetch(embedUrl, {
                  headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
                })
                .then(function(r2) { return r2.text(); })
                .then(function(html) {
                  // 5. Adım: Kaynak kodundan jwplayer'ın oynattığı gerçek master .m3u8 stream linkini süzüyoruz
                  var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
                  if (!m) return;
                  
                  var streamUrl = m[1].replace(/&amp;/g, '&');
                  
                  // 6. Adım: Ayıklanan canlı stream linkini doğrudan listeye ekliyoruz
                  results.push({
                    name:    'CizgiMax',
                    title:   '⌜ CİZGİMAX ⌟ | ' + label,
                    url:     streamUrl,
                    quality: 'Auto',
                    headers: { 'Referer': embedUrl, 'User-Agent': HEADERS['User-Agent'] }
                  });
                });
              })
              .catch(function(e) {
                console.log('[CizgiMax] Vidmoly stream ayıklama hatası: ' + e.message);
              });
          }

          return Promise.resolve();
        });
      });

      return chain.then(function() { return results; });
    })
    .catch(function() { return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
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
