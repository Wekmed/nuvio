// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var TMDB_API_KEY   = '500330721680edb6d5f7f12ba7cd9023';
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';

// CDN host pattern'leri — network'ten gördüğümüz tüm olası hostlar
var CDN_HOSTS = [
  'https://srv12.cdnimages96.shop',
  'https://srv12.cdnimages1128.shop',
  'https://srv1.cdnimages96.shop',
  'https://srv1.cdnimages391.shop',
  'https://srv2.cdnimages391.shop',
  'https://srv2.cdnimages96.shop',
  'https://srv3.cdnimages391.shop',
  'https://srv3.cdnimages96.shop',
  'https://cdn1.cdnimages1128.shop',
  'https://srv10.cdnimages1128.shop',
  'https://srv11.cdnimages1128.shop',
  'https://srv13.cdnimages96.shop',
  'https://srv14.cdnimages96.shop'
];

var FALLBACK_DOMAINS = [
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.ws',
  'https://hdfilmcehennemi.mobi'
];

var SEARCH_HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':           '*/*',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'Content-Type':     'application/json',
  'X-Requested-With': 'fetch',
  'Sec-Fetch-Dest':   'empty',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin'
};

var PAGE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Upgrade-Insecure-Requests': '1'
};

var EMBED_HEADERS = {
  'User-Agent':               'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':          'tr-TR,tr;q=0.9',
  'Sec-Ch-Ua':                '"Chromium";v="146", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile':         '?1',
  'Sec-Ch-Ua-Platform':       '"Android"',
  'Sec-Fetch-Dest':           'iframe',
  'Sec-Fetch-Mode':           'navigate',
  'Sec-Fetch-Site':           'cross-site',
  'Sec-Fetch-Storage-Access': 'none',
  'Sec-Gpc':                  '1',
  'Upgrade-Insecure-Requests': '1'
};

// ── Domain ────────────────────────────────────────────────────

var _activeDomain = null;

function getActiveDomain() {
  if (_activeDomain) return Promise.resolve(_activeDomain);
  return fetch(PRIMARY_DOMAIN + '/', { headers: PAGE_HEADERS })
    .then(function(r) {
      if (!r.ok) return _tryFallbacks();
      return r.text().then(function(html) {
        if (html.indexOf('Just a moment') === -1) {
          _activeDomain = PRIMARY_DOMAIN;
          return PRIMARY_DOMAIN;
        }
        return _tryFallbacks();
      });
    })
    .catch(function() { return _tryFallbacks(); });
}

function _tryFallbacks() {
  return new Promise(function(resolve) {
    var done = 0, settled = false;
    FALLBACK_DOMAINS.forEach(function(d) {
      fetch(d + '/', { headers: PAGE_HEADERS })
        .then(function(r) {
          done++;
          if (settled) return;
          if (r.ok) {
            return r.text().then(function(html) {
              if (html.indexOf('Just a moment') === -1) {
                settled = true; _activeDomain = d;
                resolve(d);
              } else if (done >= FALLBACK_DOMAINS.length) resolve(PRIMARY_DOMAIN);
            });
          } else if (done >= FALLBACK_DOMAINS.length) resolve(PRIMARY_DOMAIN);
        })
        .catch(function() {
          done++;
          if (!settled && done >= FALLBACK_DOMAINS.length) resolve(PRIMARY_DOMAIN);
        });
    });
  });
}

// ── TMDB ──────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title  || d.name  || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Normalize ─────────────────────────────────────────────────

function norm(s) {
  return (s||'').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u')
    .replace(/&[a-z]+;/g,'').replace(/[^a-z0-9]/g,'');
}

// ── Arama ─────────────────────────────────────────────────────

function searchSite(domain, query) {
  var hdrs = Object.assign({}, SEARCH_HEADERS, { 'Referer': domain + '/' });
  return fetch(domain + '/search/?q=' + encodeURIComponent(query), { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var results = (data.results || []).map(function(html) {
        var hM = html.match(/href="([^"]+)"/);
        if (!hM) return null;
        var tM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i) || html.match(/alt="([^"]+)"/);
        var yM = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
        var pM = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
        return { href: hM[1], title: tM ? tM[1].trim() : '', year: yM ? yM[1] : '', type: pM ? pM[1].trim().toLowerCase() : '' };
      }).filter(Boolean);
      return results;
    })
    .catch(function() { return []; });
}

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);
  var scored = results.map(function(r) {
    var score = 0, nt = norm(r.title), nh = norm(r.href);
    if (mediaType === 'movie' && (r.type === 'film' || r.type === 'movie')) score += 100;
    if (mediaType === 'tv'    && (r.type === 'dizi' || r.type === 'series')) score += 100;
    if (nt === nTr || nt === nEn)                                 score += 50;
    else if (nt.indexOf(nTr) !== -1 || nt.indexOf(nEn) !== -1)   score += 20;
    else if (nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1)   score += 10;
    if (year && r.year === year)                                  score += 30;
    else if (year && r.year && Math.abs(parseInt(r.year||0)-parseInt(year))<=1) score += 10;
    return { r: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored[0].r.href;
}

function buildEpisodeUrl(url, s, e) {
  return url.replace(/\/$/, '') + '/' + s + '-sezon-' + e + '-bolum/';
}

// ── Embed sayfası → CDN URL ───────────────────────────────────

function fetchStreamsFromEmbed(embedUrl, pageReferer) {
  var hdrs = Object.assign({}, EMBED_HEADERS, {
    'Referer': pageReferer,
    'Origin':  pageReferer.split('/').slice(0, 3).join('/')
  });

  return fetch(embedUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      return r.text().then(function(html) { return { html: html }; });
    })
    .then(function(res) {
      var html = res.html;

      // Altyazılar
      var subtitles = [];
      var tRe = /<track[^>]+>/gi;
      var tm;
      while ((tm = tRe.exec(html)) !== null) {
        var tag  = tm[0];
        if (tag.indexOf('captions') === -1 && tag.indexOf('subtitles') === -1) continue;
        var srcM   = tag.match(/\bsrc="([^"]+)"/i);
        var labelM = tag.match(/\blabel="([^"]+)"/i);
        if (!srcM) continue;
        var tUrl = srcM[1].startsWith('http') ? srcM[1] : 'https://hdfilmcehennemi.mobi' + srcM[1];
        var lang = labelM ? labelM[1] : 'Bilinmeyen';
        subtitles.push({ url: tUrl, language: lang, label: lang });
      }

      // Thumbnail'dan dosya adını çıkar
      var thumbM   = html.match(/hdfilmcehennemi\.mobi\/img\/([^"'\s]+)\.(?:jpg|webp)/i);
      var filename = thumbM ? thumbM[1] : null;

      // Doğrudan CDN host'larını dene (network'teki gibi)
      if (!filename) return [];
      return tryCdnHosts(filename, subtitles);
    })
    .catch(function() { return []; });
}

// CDN host'larını paralel dene — ilk başarılı olanı al
function tryCdnHosts(filename, subtitles) {
  return new Promise(function(resolve) {
    var done = 0, settled = false;
    CDN_HOSTS.forEach(function(host) {
      var masterUrl = host + '/hls/' + filename + '.mp4/txt/master.txt';
      fetch(masterUrl, {
        headers: {
          'User-Agent':  EMBED_HEADERS['User-Agent'],
          'Accept':      '*/*',
          'Origin':      'https://hdfilmcehennemi.mobi',
          'Referer':     'https://hdfilmcehennemi.mobi/'
        }
      })
      .then(function(r) {
        done++;
        if (settled) return;
        if (r.ok) {
          return r.text().then(function(m3u8) {
            if (m3u8.indexOf('#EXTM3U') !== -1) {
              settled = true;
              resolve(buildStreamsFromM3u8(m3u8, masterUrl, subtitles));
            } else if (done >= CDN_HOSTS.length) resolve([]);
          });
        } else if (done >= CDN_HOSTS.length && !settled) resolve([]);
      })
      .catch(function() {
        done++;
        if (!settled && done >= CDN_HOSTS.length) resolve([]);
      });
    });
  });
}

// M3U8 → stream'lere çevir (Nuvio formatı: name=film adı, title=kaynak bilgisi)
function buildStreamsFromM3u8(m3u8Text, masterUrl, subtitles) {
  var hlsHdrs = {
    'User-Agent': EMBED_HEADERS['User-Agent'],
    'Accept':     '*/*',
    'Origin':     'https://hdfilmcehennemi.mobi',
    'Referer':    'https://hdfilmcehennemi.mobi/'
  };

  var lines    = m3u8Text.split('\n').map(function(l) { return l.trim(); });
  var hasAudio = {};
  var streams  = [];

  lines.forEach(function(line) {
    var am = line.match(/#EXT-X-MEDIA:.*?NAME="([^"]+)"/i);
    if (am) hasAudio[am[1]] = true;
  });

  var quality = 'Auto';
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    var resM = lines[i].match(/RESOLUTION=(\d+x\d+)/i);
    var w    = resM ? parseInt(resM[1].split('x')[0]) : 0;
    quality  = w >= 3840 ? '4K' : w >= 2560 ? '1440p' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';
    break;
  }

  var base = { quality: quality, type: 'hls', headers: hlsHdrs };
  if (subtitles.length) base.subtitles = subtitles;

  var hasTr   = hasAudio['Turkish']       || hasAudio['Türkçe'];
  var hasOrig = hasAudio['Original Audio'] || hasAudio['Original'];

  if (hasTr)   streams.push(Object.assign({}, base, {
    name:  'HDFC ' + quality,
    title: '⌜ HDFILMCEHENNEMI ⌟ | 🇹🇷 TR Dublaj',
    url:   masterUrl
  }));
  if (hasOrig) streams.push(Object.assign({}, base, {
    name:  'HDFC ' + quality,
    title: '⌜ HDFILMCEHENNEMI ⌟ | 🌐 Orijinal',
    url:   masterUrl
  }));
  if (!hasTr && !hasOrig) streams.push(Object.assign({}, base, {
    name:  'HDFC ' + quality,
    title: '⌜ HDFILMCEHENNEMI ⌟ | 🌐 Video',
    url:   masterUrl
  }));

  return streams;
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0], info = init[1];

      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) searches.push(searchSite(domain, info.titleEn));

      return Promise.all(searches).then(function(all) {
        var seen = {}, combined = [];
        (all[0]||[]).concat(all[1]||[]).forEach(function(r) { if (!seen[r.href]) { seen[r.href]=true; combined.push(r); } });
        if (!combined.length) return null;

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (mediaType === 'tv' && season && episode) pageUrl = buildEpisodeUrl(pageUrl, season, episode);

        return fetch(pageUrl, { headers: Object.assign({}, PAGE_HEADERS, {'Referer': domain+'/'}) })
          .then(function(r) { return r.text().then(function(h) { return { html: h, url: pageUrl }; }); });
      });
    })
    .then(function(result) {
      if (!result) return [];
      var embedM = result.html.match(/data-src="(https?:\/\/hdfilmcehennemi\.mobi\/video\/embed\/[^"]+)"/i);
      if (!embedM) return [];
      return fetchStreamsFromEmbed(embedM[1], result.url);
    })
    .then(function(streams) {
      var seen = {}, out = [];
      (streams||[]).forEach(function(s) { if (s && !seen[s.url]) { seen[s.url]=true; out.push(s); } });
      return out;
    })
    .catch(function() { return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
