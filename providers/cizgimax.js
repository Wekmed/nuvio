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
// Hem TR hem EN başlıkları çek — site Türkçe isim kullanıyor olabilir
function fetchTmdbInfo(tmdbId, mediaType) {
  var ep   = (mediaType === 'movie') ? 'movie' : 'tv';
  var base = 'https://api.themoviedb.org/3/' + ep + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  var trFetch = fetch(base + '&language=tr-TR').then(function(r) { return r.json(); }).catch(function() { return {}; });
  var enFetch = fetch(base + '&language=en-US').then(function(r) { return r.json(); }).catch(function() { return {}; });
  return Promise.all([trFetch, enFetch]).then(function(res) {
    var tr = res[0], en = res[1];
    return {
      titleTr: tr.title || tr.name || '',
      titleEn: en.title || en.name || '',
      titleOr: tr.original_title || tr.original_name || ''
    };
  });
}

// ── Arama ─────────────────────────────────────────────────────
// /api/search/suggest/?q= → {animes:[{name, url, kind}]}
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

  // Önce tam eşleşme dene
  var best = null, bestScore = 0;
  results.forEach(function(r) {
    var ni = normalizeStr(r.name), sc = 0;
    if (ni === nEn || ni === nTr)                                        sc += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc += 60;
    // URL'den slug kontrolü — /diziler/regular-show-izle/ içinde "regular" geçiyor mu?
    var urlSlug = normalizeStr((r.url || '').replace(/[/-]/g, ' '));
    if (nEn && urlSlug.indexOf(nEn.split(' ')[0]) !== -1) sc += 30;
    if (sc > bestScore) { bestScore = sc; best = r; }
  });
  if (bestScore >= 55) return best;

  // Eşleşme yoksa — arama API'si zaten ilgili sonuçları döndürüyor
  // İlk dizi/cizgi-film sonucunu al (film değil)
  var firstAnime = null;
  results.forEach(function(r) {
    if (!firstAnime && r.kind !== 'film') firstAnime = r;
  });
  if (firstAnime) return firstAnime;

  // Film de yoksa ilk sonucu al
  return results.length ? results[0] : null;
}

// ── Bölüm URL oluştur ─────────────────────────────────────────
// /diziler/regular-show-izle/ → /regular-show-S-sezon-E-bolum-izle/
function buildEpisodeUrl(diziUrl, season, episode) {
  // slug çıkar: /diziler/regular-show-izle/ → regular-show
  var m = diziUrl.match(/\/diziler\/(.+?)-izle\//);
  if (!m) return null;
  var slug = m[1];
  return MAIN_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
}

// ── İndir butonlarını parse et ───────────────────────────────
// <a class="dl-btn" href="/api/indir/sibnet/?t=...">
// Sibnet için /api/indir/sibnet/ → /api/stream/sibnet/ olarak kullan
// Vidmoly ve diğerleri atla — çalışmıyor
function parseDownloadLinks(html) {
  var links = [];
  var re = new RegExp('<a[^>]+class="dl-btn"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', 'g');
  var m;
  while ((m = re.exec(html)) !== null) {
    var href  = m[1].replace(/&amp;/g, '&');
    var label = m[2].replace(/<[^>]+>/g, '').trim();
    // Sadece sibnet kabul et
    if (href.indexOf('/api/indir/sibnet/') !== -1) {
      // indir → stream
      var streamUrl = href.replace('/api/indir/sibnet/', '/api/stream/sibnet/');
      // filename param'ı kaldır (stream URL'de gerek yok)
      streamUrl = streamUrl.split('&filename=')[0];
      links.push({ url: MAIN_URL + streamUrl, label: label || 'Sibnet' });
    }
    // vidmoly, youtube vs. → atla
  }
  return links;
}

// ── servers JSON parse ────────────────────────────────────────
// HTML'de: var servers = JSON.parse(atob("BASE64"))
// Decode → [{type:"sibnet",streamUrl:"/api/stream/sibnet/?t=...",...}]
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
// /oynat/?t=TOKEN → 302 → https://dzen.ru/embed/ID
// Dzen embed HTML → MPD URL → XML parse → en yüksek bandwidth Representation
function extractDzen(oynatUrl, epUrl) {
  var fullUrl = oynatUrl.startsWith('http') ? oynatUrl : MAIN_URL + oynatUrl;

  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': epUrl })
  })
  .then(function(r) {
    // 302 redirect → dzen.ru/embed/ID
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

    // MPD URL'ini bul: dzen embed HTML'inde
    // NOT: Nuvio fetch 256KB ile sınırlı — büyük HTML'lerde truncation olabilir
    // Bu yüzden birden fazla pattern dene
    var mpdUrl = regexFirst(d.html, '"(https?://vd[^"]+\.okcdn\.ru[^"]+dzen_dash=dash[^"]*)"')
              || regexFirst(d.html, '"(https?://vd[^"]+\.okcdn\.ru[^"]+\?[^"]+)"')
              || regexFirst(d.html, '"contentUrl"\s*:\s*"([^"]+\.mpd[^"]*)"')
              || regexFirst(d.html, '(https?://vd\\d+\\.okcdn\\.ru/[^"\\s]+)');

    if (!mpdUrl) {
      console.log('[CizgiMax] Dzen MPD URL bulunamadi');
      return null;
    }

    console.log('[CizgiMax] Dzen MPD: ' + mpdUrl.slice(0, 80));

    // MPD fetch → XML parse → en yüksek kalite URL
    return fetch(mpdUrl, {
      headers: { 'Referer': 'https://dzen.ru/', 'Origin': 'https://dzen.ru' }
    })
    .then(function(r2) { return r2.text(); })
    .then(function(xml) {
      // Representation'ları bul — bandwidth'e göre sırala
      var repRe = /Representation[^>]+bandwidth="(\d+)"[^>]+quality="([^"]+)"[^>]*>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/g;
      var reps = [], m;
      while ((m = repRe.exec(xml)) !== null) {
        reps.push({
          bandwidth: parseInt(m[1]),
          quality:   m[2],
          params:    m[3]  // query string kısmı
        });
      }

      if (!reps.length) {
        console.log('[CizgiMax] Dzen MPD Representation bulunamadi');
        return null;
      }

      // Sadece video track'leri al (audio değil)
      var videoReps = reps.filter(function(r) { return r.bandwidth > 100000; });
      if (!videoReps.length) videoReps = reps;

      // Yüksekten düşüğe sırala — en yüksek kalite
      videoReps.sort(function(a, b) { return b.bandwidth - a.bandwidth; });

      var best = videoReps[0];
      // BaseURL genellikle query string — tam URL = mpdUrl'nin base'i + params
      // XML entity decode: &amp; → &
      var params = best.params.replace(/&amp;/g, '&');
      var baseUrl = mpdUrl.split('?')[0];
      var finalUrl = baseUrl + params;

      var qualityMap = {
        'full': '1080p', 'hd': '720p', 'sd': '480p',
        'low': '360p', 'lowest': '240p', 'mobile': '144p'
      };
      var quality = qualityMap[best.quality] || best.quality || 'Auto';

      console.log('[CizgiMax] Dzen stream: ' + quality + ' → ' + finalUrl.slice(0, 80));
      return { url: finalUrl, quality: quality, referer: 'https://dzen.ru/' };
    });
  })
  .catch(function(e) {
    console.log('[CizgiMax] Dzen hata: ' + (e.message || String(e)));
    return null;
  });
}

// ── Bölüm stream'lerini çıkar ────────────────────────────────
function fetchEpisodeStreams(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // Önce indir butonlarını dene — daha hızlı ve 256KB limit öncesinde geliyor
      var dlLinks = parseDownloadLinks(html);
      if (dlLinks.length) {
        console.log('[CizgiMax] ' + dlLinks.length + ' indir linki bulundu');
        return dlLinks.map(function(dl) {
          return {
            name:    'CizgiMax',
            title:   '⌜ CİZGİMAX ⌟ | ' + dl.label,
            url:     dl.url,
            quality: 'Auto',
            headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
          };
        });
      }

      var servers = parseServers(html);
      console.log('[CizgiMax] ' + servers.length + ' server: ' + epUrl);

      if (!servers.length) {
        console.log('[CizgiMax] servers bulunamadi');
        return [];
      }

      var results = [];
      var chain   = Promise.resolve();

      servers.forEach(function(server) {
        chain = chain.then(function() {

          // iframe (Dzen) — /oynat/?t= → 302 → MPD
          // Dzen öncelikli çünkü Sibnet CF korumasıyla timeout yapabiliyor
          if (server.type === 'iframe' && server.src) {
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

          // Sibnet — direkt streamUrl MP4 (fallback)
          if (server.type === 'sibnet' && server.streamUrl) {
            var streamUrl = server.streamUrl.startsWith('http')
              ? server.streamUrl
              : MAIN_URL + server.streamUrl;
            var label = server.label || 'Sibnet';
            // Direkt URL olarak ekle — Nuvio player retry yapacak
            results.push({
              name:    'CizgiMax',
              title:   '⌜ CİZGİMAX ⌟ | ' + label,
              url:     streamUrl,
              quality: 'Auto',
              headers: { 'Referer': epUrl, 'User-Agent': HEADERS['User-Agent'] }
            });
            return Promise.resolve();
          }

          return Promise.resolve();
        });
      });

      return chain.then(function() { return results; });
    })
    .catch(function(e) {
      console.log('[CizgiMax] Sayfa hata: ' + (e.message || String(e)));
      return [];
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log('[CizgiMax] Baslatiliyor: ' + tmdbId + ' ' + mediaType);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      console.log('[CizgiMax] TMDB: TR=' + info.titleTr + ' EN=' + info.titleEn + ' OR=' + info.titleOr);
      if (!info.titleEn && !info.titleTr) return [];

      // Birden fazla arama stratejisi — site Türkçe isim kullanıyor
      // EN ile ara başarısız olursa TR ile, olmaz EN'in ilk kelimesiyle dene
      // Arama sırası: TR isim → EN isim → orijinal isim → EN'in son anlamlı kelimesi
      var queries = [];
      if (info.titleTr) queries.push(info.titleTr);
      if (info.titleEn && info.titleEn !== info.titleTr) queries.push(info.titleEn);
      if (info.titleOr && info.titleOr !== info.titleEn && info.titleOr !== info.titleTr) queries.push(info.titleOr);
      // Son anlamlı kelime: "The Amazing World of Gumball" → "Gumball"
      var lastWord = (info.titleEn || info.titleOr || '').split(' ').filter(function(w) {
        return w.length > 3 && w !== 'The' && w !== 'Show';
      });
      if (lastWord.length) {
        var lw = lastWord[lastWord.length - 1];
        if (queries.indexOf(lw) === -1) queries.push(lw);
      }

      function tryQueries(idx) {
        if (idx >= queries.length) return Promise.resolve(null);
        return searchSite(queries[idx]).then(function(results) {
          console.log('[CizgiMax] "' + queries[idx] + '" → ' + results.length + ' sonuc');
          if (results.length) {
            var best = findBestMatch(results, info.titleEn, info.titleTr);
            if (best) { console.log('[CizgiMax] Eslesti: ' + best.name); return best; }
          }
          return tryQueries(idx + 1);
        });
      }

      return tryQueries(0)
        .then(function(best) {
          if (!best) {
            console.log('[CizgiMax] Bulunamadi: ' + (info.titleEn || info.titleTr));
            return [];
          }
          console.log('[CizgiMax] Eslesti: ' + best.name + ' -> ' + best.url);

          var sNum = parseInt(seasonNum)  || 1;
          var eNum = parseInt(episodeNum) || 1;

          var diziUrl = best.url.startsWith('http') ? best.url : MAIN_URL + best.url;
          var epUrl   = buildEpisodeUrl(diziUrl, sNum, eNum);

          if (!epUrl) {
            console.log('[CizgiMax] Bolum URL olusturulamadi: ' + diziUrl);
            return [];
          }

          console.log('[CizgiMax] Bolum URL: ' + epUrl);
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
