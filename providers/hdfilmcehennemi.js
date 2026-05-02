// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var TMDB_API_KEY   = '500330721680edb6d5f7f12ba7cd9023';
var AH_HASH        = 'hash=408307737dacb42e3bbac1f77b4a4dab';
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';

// Bilinen CDN host'ları - /ah/ 0 byte dönerse bunları dene
var CDN_HOSTS = [
  'https://srv12.cdnimages1128.shop',
  'https://srv1.cdnimages391.shop',
  'https://srv2.cdnimages391.shop',
  'https://srv3.cdnimages391.shop',
  'https://cdn1.cdnimages1128.shop',
  'https://srv10.cdnimages1128.shop',
  'https://srv11.cdnimages1128.shop'
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

// Tarayıcıdaki TAM header seti (sec-ch-ua dahil)
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

var AH_HEADERS_EXTRA = {
  'User-Agent':               'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':                   '*/*',
  'Accept-Language':          'tr-TR,tr;q=0.9',
  'Content-Type':             'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With':         'XMLHttpRequest',
  'Sec-Ch-Ua':                '"Chromium";v="146", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile':         '?1',
  'Sec-Ch-Ua-Platform':       '"Android"',
  'Sec-Fetch-Dest':           'empty',
  'Sec-Fetch-Mode':           'cors',
  'Sec-Fetch-Site':           'same-origin',
  'Sec-Fetch-Storage-Access': 'none',
  'Sec-Gpc':                  '1'
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
          console.log('[HDFC] Domain: ' + PRIMARY_DOMAIN);
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
                console.log('[HDFC] Domain: ' + d);
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
      console.log('[HDFC] "' + query + '": ' + results.length + ' sonuç');
      return results;
    })
    .catch(function(e) { console.log('[HDFC] Arama hata: ' + e.message); return []; });
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
  console.log('[HDFC] Seçildi (skor=' + scored[0].score + '): ' + scored[0].r.href);
  return scored[0].r.href;
}

function buildEpisodeUrl(url, s, e) {
  return url.replace(/\/$/, '') + '/' + s + '-sezon-' + e + '-bolum/';
}

// ── Embed sayfası → CDN URL ───────────────────────────────────

function fetchStreamsFromEmbed(embedUrl, pageReferer) {
  console.log('[HDFC] Embed: ' + embedUrl);

  var hdrs = Object.assign({}, EMBED_HEADERS, {
    'Referer': pageReferer,
    'Origin':  pageReferer.split('/').slice(0, 3).join('/')
  });

  return fetch(embedUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      var cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      return r.text().then(function(html) { return { html: html, cookie: cookie }; });
    })
    .then(function(res) {
      var html   = res.html;
      var cookie = res.cookie;

      // Altyazılar — attribute sırası farklı olabilir, her birini ayrı ara
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
      console.log('[HDFC] Altyazı: ' + subtitles.length);

      // Thumbnail'dan dosya adını çıkar
      // <thumbnailUrl>: "hdfilmcehennemi.mobi/img/{filename}.jpg"
      var thumbM   = html.match(/hdfilmcehennemi\.mobi\/img\/([^"'\s]+)\.(?:jpg|webp)/i);
      var filename = thumbM ? thumbM[1] : null;
      console.log('[HDFC] Filename: ' + (filename || 'bulunamadı'));

      var videoId = (embedUrl.match(/\/video\/embed\/([^\/\?]+)/) || [])[1];

      // YOL 1: POST /ah/ (tam browser headers ile)
      // YOL 2: CDN host'larını thumbnail filename ile dene
      return Promise.all([
        tryAhEndpoint(videoId, cookie, embedUrl, subtitles, filename),
        filename ? tryCdnHosts(filename, subtitles) : Promise.resolve([])
      ]).then(function(results) {
        var all = (results[0] || []).concat(results[1] || []);
        // Deduplicate
        var seen = {}, out = [];
        all.forEach(function(s) { if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); } });
        return out;
      });
    })
    .catch(function(e) { console.log('[HDFC] Embed hata: ' + e.message); return []; });
}

// YOL 1: POST /ah/ ile CDN URL al
function tryAhEndpoint(videoId, cookie, embedUrl, subtitles, filename) {
  if (!videoId) return Promise.resolve([]);

  var ahUrl  = 'https://hdfilmcehennemi.mobi/video/embed/' + videoId + '/ah/';
  var ahHdrs = Object.assign({}, AH_HEADERS_EXTRA, {
    'Origin':  'https://hdfilmcehennemi.mobi',
    'Referer': embedUrl
  });
  if (cookie) ahHdrs['Cookie'] = cookie;

  console.log('[HDFC] POST /ah/...');

  return fetch(ahUrl, { method: 'POST', headers: ahHdrs, body: AH_HASH })
    .then(function(r) {
      console.log('[HDFC] /ah/ HTTP: ' + r.status);
      return r.text();
    })
    .then(function(body) {
      console.log('[HDFC] /ah/ body (' + body.length + 'b): ' + body.slice(0, 150));

      if (!body || body.length < 5) return [];

      // M3U8 direkt
      if (body.indexOf('#EXTM3U') !== -1) {
        console.log('[HDFC] /ah/ M3U8 direkt!');
        return buildStreamsFromM3u8(body, ahUrl, subtitles);
      }

      // CDN URL
      var urlM = body.match(/(https?:\/\/[^\s"'<>\n]+(?:master\.txt|\.m3u8)[^\s"'<>\n]*)/i);
      if (urlM) {
        console.log('[HDFC] /ah/ CDN URL: ' + urlM[1]);
        return fetchMasterAndBuild(urlM[1], subtitles);
      }

      // Response body bir CDN URL (salt string) olabilir
      var trimmed = body.trim();
      if (trimmed.startsWith('http') && trimmed.indexOf(' ') === -1) {
        console.log('[HDFC] /ah/ direkt URL: ' + trimmed);
        return fetchMasterAndBuild(trimmed, subtitles);
      }

      return [];
    })
    .catch(function(e) { console.log('[HDFC] /ah/ hata: ' + e.message); return []; });
}

// YOL 2: Thumbnail filename'den CDN URL üret, host'ları dene
function tryCdnHosts(filename, subtitles) {
  console.log('[HDFC] CDN host denemesi: ' + filename);

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
              console.log('[HDFC] CDN host bulundu: ' + host);
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

// M3U8 → stream'lere çevir
// CloudStream'de master.txt URL direkt kaynak olarak kullanılıyor
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

  // Kalite bilgisini parse et ama URL olarak master.txt kullan
  var quality = 'Auto';
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    var resM = lines[i].match(/RESOLUTION=(\d+x\d+)/i);
    var w    = resM ? parseInt(resM[1].split('x')[0]) : 0;
    quality  = w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';
    break; // İlk stream'den kaliteyi al
  }

  var base = { name: 'HDFilmCehennemi', quality: quality, type: 'hls', headers: hlsHdrs };
  if (subtitles.length) base.subtitles = subtitles;

  var hasTr   = hasAudio['Turkish']       || hasAudio['Türkçe'];
  var hasOrig = hasAudio['Original Audio'] || hasAudio['Original'];

  // master.txt URL'ini direkt kaynak olarak kullan (CloudStream gibi)
  if (hasTr)   streams.push(Object.assign({}, base, { title: 'HDFC TR Dublaj ' + quality, url: masterUrl }));
  if (hasOrig) streams.push(Object.assign({}, base, { title: 'HDFC Orijinal ' + quality,  url: masterUrl }));
  if (!hasTr && !hasOrig) streams.push(Object.assign({}, base, { title: 'HDFC ' + quality, url: masterUrl }));

  console.log('[HDFC] Streams: ' + streams.length + ' | URL: ' + masterUrl.slice(0, 60));
  return streams;
}

function fetchMasterAndBuild(masterUrl, subtitles) {
  return fetch(masterUrl, {
    headers: {
      'User-Agent': EMBED_HEADERS['User-Agent'], 'Accept': '*/*',
      'Origin': 'https://hdfilmcehennemi.mobi', 'Referer': 'https://hdfilmcehennemi.mobi/'
    }
  })
  .then(function(r) { return r.ok ? r.text() : null; })
  .then(function(m3u8) {
    if (!m3u8 || m3u8.indexOf('#EXTM3U') === -1) return [{ name:'HDFilmCehennemi', title:'HDFC Auto', url: masterUrl, quality:'Auto', type:'hls', headers:{}, subtitles: subtitles.length?subtitles:undefined }];
    return buildStreamsFromM3u8(m3u8, masterUrl, subtitles);
  })
  .catch(function() { return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[HDFilmCehennemi] TMDB:' + tmdbId + ' ' + mediaType + (season ? ' S'+season+'E'+episode : ''));

  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0], info = init[1];
      console.log('[HDFC] ' + info.titleEn + ' / ' + info.titleTr + ' (' + info.year + ')');

      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) searches.push(searchSite(domain, info.titleEn));

      return Promise.all(searches).then(function(all) {
        var seen = {}, combined = [];
        (all[0]||[]).concat(all[1]||[]).forEach(function(r) { if (!seen[r.href]) { seen[r.href]=true; combined.push(r); } });
        if (!combined.length) { console.log('[HDFC] Bulunamadı'); return null; }

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (mediaType === 'tv' && season && episode) pageUrl = buildEpisodeUrl(pageUrl, season, episode);

        console.log('[HDFC] Sayfa: ' + pageUrl);
        return fetch(pageUrl, { headers: Object.assign({}, PAGE_HEADERS, {'Referer': domain+'/'}) })
          .then(function(r) { return r.text().then(function(h) { return { html: h, url: pageUrl }; }); });
      });
    })
    .then(function(result) {
      if (!result) return [];
      var embedM = result.html.match(/data-src="(https?:\/\/hdfilmcehennemi\.mobi\/video\/embed\/[^"]+)"/i);
      if (!embedM) { console.log('[HDFC] Embed URL yok'); return []; }
      return fetchStreamsFromEmbed(embedM[1], result.url);
    })
    .then(function(streams) {
      var seen = {}, out = [];
      (streams||[]).forEach(function(s) { if (s && !seen[s.url]) { seen[s.url]=true; out.push(s); } });
      console.log('[HDFilmCehennemi] Toplam: ' + out.length);
      return out;
    })
    .catch(function(e) { console.error('[HDFilmCehennemi] Hata: ' + e.message); return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
