// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

// Sabit domain — test sonuçlarına göre en iyi çalışan
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';
var FALLBACK_DOMAINS = [
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.ws',
  'https://hdfilmcehennemi.mobi'
];

// Test'te 200 döndüren EXACT header seti
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
  'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'Sec-Fetch-Dest':   'iframe',
  'Sec-Fetch-Mode':   'navigate',
  'Sec-Fetch-Site':   'cross-site',
  'Upgrade-Insecure-Requests': '1'
};

// ── SSL bypass (playmix.uno CDN trick için) ───────────────────

function makeFetchOptions(opts) {
  // Node.js ortamında https.Agent ile SSL bypass
  // Tarayıcı ortamında (Nuvio) bu parametreler yok sayılır
  if (typeof require !== 'undefined') {
    try {
      var https = require('https');
      opts.agent = new https.Agent({ rejectUnauthorized: false });
    } catch(e) {}
  }
  return opts;
}

// ── Domain tespiti ────────────────────────────────────────────

var _activeDomain = null;

function getActiveDomain() {
  if (_activeDomain) return Promise.resolve(_activeDomain);

  // Önce PRIMARY dene
  return fetch(PRIMARY_DOMAIN + '/', { headers: PAGE_HEADERS })
    .then(function(r) {
      if (r.ok) {
        return r.text().then(function(html) {
          if (html.indexOf('Just a moment') === -1) {
            _activeDomain = PRIMARY_DOMAIN;
            console.log('[HDFC] Domain: ' + PRIMARY_DOMAIN);
            return PRIMARY_DOMAIN;
          }
          return tryFallbacks();
        });
      }
      return tryFallbacks();
    })
    .catch(function() { return tryFallbacks(); });
}

function tryFallbacks() {
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
                console.log('[HDFC] Fallback domain: ' + d);
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
        titleTr: d.title || d.name || '',
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
  var url = domain + '/search/?q=' + encodeURIComponent(query);
  // KRİTİK: Referer domain + '/' — test'te bunu kullanınca 200 dönüyor
  var hdrs = Object.assign({}, SEARCH_HEADERS, { 'Referer': domain + '/' });

  console.log('[HDFC] Arama: ' + query);

  return fetch(url, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var results = data.results || [];
      var parsed = [];
      results.forEach(function(html) {
        var hrefM  = html.match(/href="([^"]+)"/);
        if (!hrefM) return;
        var titleM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i)
                  || html.match(/alt="([^"]+)"/);
        var yearM  = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
        var typeM  = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
        parsed.push({
          href:  hrefM[1],
          title: titleM ? titleM[1].trim() : '',
          year:  yearM  ? yearM[1] : '',
          type:  typeM  ? typeM[1].trim().toLowerCase() : ''
        });
      });
      console.log('[HDFC] "' + query + '": ' + parsed.length + ' sonuç');
      return parsed;
    })
    .catch(function(e) {
      console.log('[HDFC] Arama hata "' + query + '": ' + e.message);
      return [];
    });
}

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);

  var filtered = results.filter(function(r) {
    if (!r.type) return true;
    if (mediaType === 'movie') return r.type === 'film' || r.type === 'movie';
    if (mediaType === 'tv')    return r.type === 'dizi' || r.type === 'series';
    return true;
  });
  if (!filtered.length) filtered = results;

  if (year) {
    for (var i = 0; i < filtered.length; i++) {
      var nt = norm(filtered[i].title);
      if ((nt === nTr || nt === nEn) && filtered[i].year === year) return filtered[i].href;
    }
  }
  for (var j = 0; j < filtered.length; j++) {
    var nt2 = norm(filtered[j].title);
    if (nt2 === nTr || nt2 === nEn) return filtered[j].href;
  }
  for (var k = 0; k < filtered.length; k++) {
    var nt3 = norm(filtered[k].title);
    if (nt3.indexOf(nTr) !== -1 || nt3.indexOf(nEn) !== -1) return filtered[k].href;
  }
  for (var l = 0; l < filtered.length; l++) {
    var nh = norm(filtered[l].href);
    if (nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1) return filtered[l].href;
  }
  return filtered[0].href;
}

function buildEpisodeUrl(showUrl, season, episode) {
  return showUrl.replace(/\/$/, '') + '/' + season + '-sezon-' + episode + '-bolum/';
}

// ── Embed sayfasından stream çıkar ───────────────────────────

function fetchStreamsFromEmbed(embedUrl, referer) {
  console.log('[HDFC] Embed: ' + embedUrl);

  var hdrs = Object.assign({}, EMBED_HEADERS, {
    'Referer': referer,
    'Origin':  referer.split('/').slice(0, 3).join('/')
  });

  return fetch(embedUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var cookie = '';
      var sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return r.text().then(function(html) { return { html: html, cookie: cookie }; });
    })
    .then(function(res) {
      var html   = res.html;
      var cookie = res.cookie;

      // Altyazılar
      var subtitles = [];
      var tRe = /<track[^>]+src="([^"]+)"[^>]+kind="captions"[^>]+srclang="([^"]+)"[^>]+label="([^"]+)"/gi;
      var tm;
      while ((tm = tRe.exec(html)) !== null) {
        var tUrl = tm[1].startsWith('http') ? tm[1] : 'https://hdfilmcehennemi.mobi' + tm[1];
        subtitles.push({ url: tUrl, language: tm[3], label: tm[3] });
      }

      // Yöntem 1: JSON-LD contentUrl
      var ldM = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      if (ldM) {
        try {
          var ld = JSON.parse(ldM[1]);
          if (ld.contentUrl && ld.contentUrl.startsWith('http')) {
            console.log('[HDFC] JSON-LD contentUrl: ' + ld.contentUrl);
            return buildStreams(ld.contentUrl, embedUrl, subtitles);
          }
        } catch(e) {}
      }

      // Yöntem 2: Direkt HLS URL
      var hlsM = html.match(/["'](https?:\/\/hls\d+\.playmix\.uno\/[^"']+(?:master\.txt|\.m3u8)[^"']*)["']/i);
      if (hlsM) {
        console.log('[HDFC] Direkt HLS: ' + hlsM[1]);
        return buildStreams(hlsM[1], embedUrl, subtitles);
      }

      // Yöntem 3: POST /ah/
      var idM = embedUrl.match(/\/video\/embed\/([^\/\?]+)/);
      if (idM) {
        var ahUrl = 'https://hdfilmcehennemi.mobi/video/embed/' + idM[1] + '/ah/';
        console.log('[HDFC] POST /ah/: ' + ahUrl);
        var ahHdrs = {
          'User-Agent':       EMBED_HEADERS['User-Agent'],
          'Accept':           '*/*',
          'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin':           'https://hdfilmcehennemi.mobi',
          'Referer':          embedUrl,
          'Sec-Fetch-Dest':   'empty',
          'Sec-Fetch-Mode':   'cors',
          'Sec-Fetch-Site':   'same-origin'
        };
        if (cookie) ahHdrs['Cookie'] = cookie;

        return fetch(ahUrl, { method: 'POST', headers: ahHdrs, body: '' })
          .then(function(r) { return r.text(); })
          .then(function(text) {
            var urlM = text.match(/(https?:\/\/[^\s"'<>]+(?:\.txt|\.m3u8)[^\s"'<>]*)/i);
            if (urlM) return buildStreams(urlM[1], embedUrl, subtitles);
            console.log('[HDFC] /ah/ yanıtsız');
            return [];
          });
      }

      return [];
    })
    .catch(function(e) { console.log('[HDFC] Embed hata: ' + e.message); return []; });
}

function buildStreams(masterUrl, referer, subtitles) {
  var baseUrl = masterUrl.split('/').slice(0, -1).join('/') + '/';

  var hlsHeaders = {
    'User-Agent':      EMBED_HEADERS['User-Agent'],
    'Accept':          '*/*',
    'Accept-Language': 'tr-TR,tr;q=0.9',
    'Origin':          'https://hdfilmcehennemi.mobi',
    'Referer':         'https://hdfilmcehennemi.mobi/'
  };

  // SSL bypass
  var fetchOpts = makeFetchOptions({ headers: hlsHeaders });

  return fetch(masterUrl, fetchOpts)
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function(m3u8) {
      console.log('[HDFC] master.txt OK, ' + m3u8.split('\n').length + ' satır');

      var streams = [];
      var lines   = m3u8.split('\n').map(function(l) { return l.trim(); });

      // Ses grupları
      var hasAudio = {};
      lines.forEach(function(line) {
        var am = line.match(/#EXT-X-MEDIA:.*?NAME="([^"]+)"/i);
        if (am) hasAudio[am[1]] = true;
      });

      // Video stream'leri
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
        var next = lines[i + 1] || '';
        if (!next || next.startsWith('#')) continue;

        var streamUrl = next.startsWith('http') ? next : baseUrl + next;
        var resM      = line.match(/RESOLUTION=(\d+x\d+)/i);
        var w         = resM ? parseInt(resM[1].split('x')[0]) : 0;
        var quality   = w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';

        var base = {
          name:    'HDFilmCehennemi',
          quality: quality,
          type:    'hls',
          headers: hlsHeaders
        };
        if (subtitles.length) base.subtitles = subtitles;

        if (hasAudio['Turkish'] || hasAudio['Türkçe']) {
          streams.push(Object.assign({}, base, { title: 'HDFC • TR Dublaj • ' + quality, url: streamUrl }));
        }
        if (hasAudio['Original Audio'] || hasAudio['Original']) {
          streams.push(Object.assign({}, base, { title: 'HDFC • Orijinal • ' + quality, url: streamUrl }));
        }
        if (!Object.keys(hasAudio).length) {
          streams.push(Object.assign({}, base, { title: 'HDFC • ' + quality, url: streamUrl }));
        }
      }

      if (!streams.length) {
        streams.push({
          name: 'HDFilmCehennemi', title: 'HDFC • Auto',
          url: masterUrl, quality: 'Auto', type: 'hls',
          headers: hlsHeaders,
          subtitles: subtitles.length ? subtitles : undefined
        });
      }

      return streams;
    })
    .catch(function(e) {
      // SSL veya ağ hatası → master URL'yi direkt döndür, oynatıcı halleder
      console.log('[HDFC] master.txt hata: ' + e.message + ' — URL direkt kullanılıyor');
      return [{
        name: 'HDFilmCehennemi', title: 'HDFC • Auto',
        url: masterUrl, quality: 'Auto', type: 'hls',
        headers: hlsHeaders,
        subtitles: subtitles.length ? subtitles : undefined
      }];
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[HDFilmCehennemi] TMDB:' + tmdbId + ' ' + mediaType
    + (season ? ' S' + season + 'E' + episode : ''));

  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0];
      var info   = init[1];
      console.log('[HDFC] ' + info.titleEn + ' / ' + info.titleTr + ' (' + info.year + ')');

      // TR ve EN araması paralel
      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr)
        searches.push(searchSite(domain, info.titleEn));

      return Promise.all(searches).then(function(allResults) {
        var seen = {}, combined = [];
        (allResults[0] || []).concat(allResults[1] || []).forEach(function(r) {
          if (!seen[r.href]) { seen[r.href] = true; combined.push(r); }
        });

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (!pageUrl) { console.log('[HDFC] Bulunamadı'); return null; }

        if (mediaType === 'tv' && season && episode)
          pageUrl = buildEpisodeUrl(pageUrl, season, episode);

        console.log('[HDFC] Sayfa: ' + pageUrl);
        return fetch(pageUrl, {
          headers: Object.assign({}, PAGE_HEADERS, { 'Referer': domain + '/' })
        }).then(function(r) {
          return r.text().then(function(h) { return { html: h, url: pageUrl }; });
        });
      });
    })
    .then(function(result) {
      if (!result) return [];

      var embedM = result.html.match(/data-src="(https?:\/\/hdfilmcehennemi\.mobi\/video\/embed\/[^"]+)"/i);
      if (!embedM) { console.log('[HDFC] Embed URL bulunamadı'); return []; }

      return fetchStreamsFromEmbed(embedM[1], result.url);
    })
    .then(function(streams) {
      var seen = {}, out = [];
      (streams || []).forEach(function(s) {
        if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); }
      });
      console.log('[HDFilmCehennemi] Toplam stream: ' + out.length);
      return out;
    })
    .catch(function(e) { console.error('[HDFilmCehennemi] Hata: ' + e.message); return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
