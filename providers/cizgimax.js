// ============================================================
//  Cizgimax — Nuvio Provider
//  Site: https://cizgimax.online
//
//  Akış:
//  1) TMDB'den başlık al
//  2) /api/search/suggest/?q={baslik} → slug bul
//  3) /{slug}-{s}-sezon-{e}-bolum-izle/ → HTML fetch
//  4) var servers = JSON.parse(atob("...")) → sunucuları çöz
//  5) Sibnet: proxy URL'i direkt dön (Nuvio player 302'yi takip eder)
// ============================================================

var BASE_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
      + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.name  || d.title  || '',
        titleEn: d.original_name || d.original_title || '',
        year:    (d.first_air_date || d.release_date || '').slice(0, 4)
      };
    });
}

// ── Metin normalize ──────────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

// ── Arama → slug ────────────────────────────────────────────
function searchAnime(titleTr, titleEn) {
  var query = titleTr || titleEn;
  return fetch(BASE_URL + '/api/search/suggest/?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Accept': 'application/json' })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var items = data.animes || [];
    if (!items.length) throw new Error('Cizgimax: anime bulunamadi');

    var nTr = normalize(titleTr);
    var nEn = normalize(titleEn);
    var best = items[0], bestScore = -1;
    items.forEach(function(item) {
      var nItem = normalize(item.name);
      var score = 0;
      if (nItem === nTr || nItem === nEn) score = 100;
      else if (nTr && nItem.indexOf(nTr) !== -1) score = 60;
      else if (nEn && nItem.indexOf(nEn) !== -1) score = 60;
      if (score > bestScore) { bestScore = score; best = item; }
    });

    // /diziler/the-amazing-world-of-gumball-izle/ → the-amazing-world-of-gumball
    var urlSlug = (best.url || '')
      .replace(/^\/diziler\/|^\/film\//, '')
      .replace(/\/$/, '')
      .replace(/-izle$/, '');

    console.log('[Cizgimax] Bulunan: ' + best.name + ' → slug=' + urlSlug);
    return { id: best.id, slug: urlSlug, kind: best.kind, name: best.name };
  });
}

// ── Bölüm sayfası HTML'ini al ────────────────────────────────
function fetchEpisodePage(slug, season, episode) {
  var url = BASE_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
  console.log('[Cizgimax] Episode URL: ' + url);
  return fetch(url, { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

// ── servers değişkenini parse et ─────────────────────────────
// HTML: var servers = JSON.parse(atob("BASE64"));
function parseServers(html) {
  var m = html.match(/var\s+servers\s*=\s*JSON\.parse\s*\(\s*atob\s*\(\s*["']([^"']+)["']\s*\)/);
  if (!m) return [];
  try {
    return JSON.parse(atob(m[1])) || [];
  } catch(e) {
    console.error('[Cizgimax] servers parse hata:', e.message);
    return [];
  }
}

// ── Dil label'ından bayrak üret ──────────────────────────────
// lang alanı null gelebilir, label'a bak
function getLangStr(srv) {
  var label = (srv.label || '').toLowerCase();
  var lang  = (srv.lang  || '').toLowerCase();
  if (label.indexOf('altyaz') !== -1 || lang === 'sub') return '🌐 TR Altyazı';
  return '🇹🇷 TR Dublaj';
}

// ── Ana fonksiyon ────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var movieName = info.titleTr || info.titleEn;
      return searchAnime(info.titleTr, info.titleEn)
        .then(function(anime) {
          return fetchEpisodePage(anime.slug, season || 1, episode || 1);
        })
        .then(function(html) {
          var servers = parseServers(html);
          console.log('[Cizgimax] ' + servers.length + ' sunucu bulundu');

          var streams = [];

          servers.forEach(function(srv) {
            var langStr  = getLangStr(srv);
            var titleStr = '⌜ CİZGİMAX ⌟ | ' + (srv.label || srv.type) + ' | ' + langStr;

            // ── Sibnet ─────────────────────────────────────
            // Proxy URL direkt dönülüyor — Nuvio player 302 redirect'i takip eder
            // Token süreli ama episode sayfası fetch edildiği anda taze gelir
            if (srv.type === 'sibnet' && srv.streamUrl) {
              var proxyUrl = srv.streamUrl.startsWith('http')
                ? srv.streamUrl
                : BASE_URL + srv.streamUrl;

              console.log('[Cizgimax] Sibnet proxy URL: ' + proxyUrl.slice(0, 80));

              streams.push({
                url:     proxyUrl,
                name:    movieName,
                title:   titleStr,
                quality: '1080p',
                type:    'direct',
                headers: {
                  'Referer':    BASE_URL + '/',
                  'User-Agent': HEADERS['User-Agent']
                }
              });
            }
          });

          return streams;
        });
    })
    .catch(function(e) {
      console.error('[Cizgimax] hata:', e.message || e);
      return [];
    });
}

module.exports = { getStreams: getStreams };
