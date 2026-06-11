// ============================================================
//  Cizgimax — Nuvio Provider
//  Site: https://cizgimax.online
// ============================================================

var BASE_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── Pure-JS Base64 decode (Hermes'te atob yok) ───────────────
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64decode(str) {
  var s = str.replace(/=/g, '');
  var out = '';
  for (var i = 0; i < s.length; i += 4) {
    var n = (_B64.indexOf(s[i])   << 18) | (_B64.indexOf(s[i+1]) << 12)
          | (_B64.indexOf(s[i+2]) <<  6) |  _B64.indexOf(s[i+3]);
    out += String.fromCharCode((n >> 16) & 0xFF);
    if (s[i+2] !== undefined) out += String.fromCharCode((n >> 8) & 0xFF);
    if (s[i+3] !== undefined) out += String.fromCharCode(n & 0xFF);
  }
  return out;
}

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
      + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.name  || d.title  || '',
        titleEn: d.original_name || d.original_title || ''
      };
    });
}

// ── Normalize ────────────────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

// ── Arama → slug ─────────────────────────────────────────────
function searchAnime(titleTr, titleEn) {
  var query = titleTr || titleEn;
  return fetch(BASE_URL + '/api/search/suggest/?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Accept': 'application/json' })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var items = data.animes || [];
    if (!items.length) throw new Error('Cizgimax: bulunamadi');

    var nTr = normalize(titleTr), nEn = normalize(titleEn);
    var best = items[0], bestScore = -1;
    items.forEach(function(item) {
      var n = normalize(item.name), score = 0;
      if (n === nTr || n === nEn) score = 100;
      else if (nTr && n.indexOf(nTr) !== -1) score = 60;
      else if (nEn && n.indexOf(nEn) !== -1) score = 60;
      if (score > bestScore) { bestScore = score; best = item; }
    });

    var urlSlug = (best.url || '')
      .replace(/^\/diziler\/|^\/film\//, '')
      .replace(/\/$/, '')
      .replace(/-izle$/, '');

    console.log('[Cizgimax] ' + best.name + ' → ' + urlSlug);
    return urlSlug;
  });
}

// ── Bölüm sayfası ────────────────────────────────────────────
function fetchEpisodePage(slug, season, episode) {
  var url = BASE_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
  console.log('[Cizgimax] ' + url);
  return fetch(url, { headers: HEADERS }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

// ── servers parse — pure-JS base64 ───────────────────────────
function parseServers(html) {
  var m = html.match(/var\s+servers\s*=\s*JSON\.parse\s*\(\s*atob\s*\(\s*["']([^"']+)["']\s*\)/);
  if (!m) { console.error('[Cizgimax] servers bulunamadi'); return []; }
  try {
    var decoded = b64decode(m[1]);
    return JSON.parse(decoded) || [];
  } catch(e) {
    console.error('[Cizgimax] parse hata: ' + e.message);
    return [];
  }
}

function getLangStr(srv) {
  var label = (srv.label || '').toLowerCase();
  return label.indexOf('altyaz') !== -1 ? '🌐 TR Altyazı' : '🇹🇷 TR Dublaj';
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var movieName = info.titleTr || info.titleEn;
      return searchAnime(info.titleTr, info.titleEn)
        .then(function(slug) {
          return fetchEpisodePage(slug, season || 1, episode || 1);
        })
        .then(function(html) {
          var servers = parseServers(html);
          console.log('[Cizgimax] ' + servers.length + ' sunucu');

          var streams = [];
          servers.forEach(function(srv) {
            if (srv.type === 'sibnet' && srv.streamUrl) {
              var proxyUrl = srv.streamUrl.startsWith('http')
                ? srv.streamUrl : BASE_URL + srv.streamUrl;
              streams.push({
                url:     proxyUrl,
                name:    movieName,
                title:   '⌜ CİZGİMAX ⌟ | Sibnet | ' + getLangStr(srv),
                quality: '1080p',
                type:    'direct',
                headers: { 'Referer': BASE_URL + '/', 'User-Agent': HEADERS['User-Agent'] }
              });
            }
          });

          console.log('[Cizgimax] ' + streams.length + ' stream döndü');
          return streams;
        });
    })
    .catch(function(e) {
      console.error('[Cizgimax] hata: ' + (e.message || e));
      return [];
    });
}

module.exports = { getStreams: getStreams };
