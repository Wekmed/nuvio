// ============================================================
//  HDFilmCehennemi — Nuvio Provider (v3)
// ============================================================

var BASE_URL     = 'https://www.hdfilmcehennemi.nl';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var DOMAINS = [
  'https://www.hdfilmcehennemi.nl',
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.ws',
  'https://hdfilmcehennemi.mobi'
];

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

var PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9'
};

// ── Domain tespiti ────────────────────────────────────────────

var _activeDomain = null;

function getActiveDomain() {
  if (_activeDomain) return Promise.resolve(_activeDomain);

  return new Promise(function(resolve) {
    var done = 0, settled = false;
    DOMAINS.forEach(function(domain) {
      fetch(domain + '/', { headers: PAGE_HEADERS })
        .then(function(r) {
          done++;
          if (settled) return;
          if (r.ok) {
            return r.text().then(function(html) {
              var isCF = html.indexOf('Just a moment') !== -1;
              if (!isCF) {
                settled = true;
                _activeDomain = domain;
                console.log('[HDFC] Aktif domain: ' + domain);
                resolve(domain);
              } else if (done >= DOMAINS.length && !settled) {
                resolve(DOMAINS[0]);
              }
            });
          } else if (done >= DOMAINS.length && !settled) {
            resolve(DOMAINS[0]);
          }
        })
        .catch(function() {
          done++;
          if (!settled && done >= DOMAINS.length) resolve(DOMAINS[0]);
        });
    });
  });
}

// ── TMDB ──────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = (mediaType === 'tv') ? 'tv' : 'movie';
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
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u').replace(/&[a-z]+;/g,'')
    .replace(/[^a-z0-9]/g,'');
}

// ── Arama — JSON API ─────────────────────────────────────────

/**
 * Site /search/?q= endpoint'i JSON döndürüyor.
 * Yanıt: { results: ["<a href='...' ...>...</a>", ...] }
 * Her eleman href ve h4.title içeriyor.
 */
function searchSite(domain, query) {
  var url = domain + '/search/?q=' + encodeURIComponent(query);
  console.log('[HDFC] Arama: ' + url);

  return fetch(url, {
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      'Referer': domain + '/'
    })
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function(data) {
    var results = data.results || [];
    var parsed = [];

    results.forEach(function(html) {
      // href çıkar
      var hrefM = html.match(/href="([^"]+)"/);
      if (!hrefM) return;

      // h4.title veya alt attribute çıkar
      var titleM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i)
                || html.match(/alt="([^"]+)"/);
      var title = titleM ? titleM[1]
        .replace(/&ccedil;/g,'ç').replace(/&ouml;/g,'ö').replace(/&uuml;/g,'ü')
        .replace(/&scaron;/g,'ş').replace(/&yacute;/g,'ı').replace(/&amp;/g,'&')
        .trim() : '';

      // Yıl
      var yearM = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
      var year = yearM ? yearM[1] : '';

      // Tür (Film/Dizi)
      var typeM = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
      var type = typeM ? typeM[1].trim().toLowerCase() : '';

      parsed.push({
        href:  hrefM[1],
        title: title,
        year:  year,
        type:  type
      });
    });

    console.log('[HDFC] Arama sonucu: ' + parsed.length + ' öğe');
    return parsed;
  })
  .catch(function(e) {
    console.log('[HDFC] Arama hata: ' + e.message);
    return [];
  });
}

// ── En iyi eşleşmeyi bul ──────────────────────────────────────

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;

  var nTr = norm(titleTr);
  var nEn = norm(titleEn);

  // Türe göre filtrele (film/dizi)
  var filtered = results.filter(function(r) {
    if (!r.type) return true;
    if (mediaType === 'movie') return r.type === 'film' || r.type === 'movie';
    if (mediaType === 'tv')    return r.type === 'dizi' || r.type === 'tv' || r.type === 'series';
    return true;
  });
  if (!filtered.length) filtered = results;

  // 1. Başlık exact + yıl eşleşmesi
  if (year) {
    for (var i = 0; i < filtered.length; i++) {
      var nt = norm(filtered[i].title);
      if ((nt === nTr || nt === nEn) && filtered[i].year === year) return filtered[i].href;
    }
  }

  // 2. Başlık exact
  for (var j = 0; j < filtered.length; j++) {
    var nt2 = norm(filtered[j].title);
    if (nt2 === nTr || nt2 === nEn) return filtered[j].href;
  }

  // 3. URL'de başlık + yıl
  if (year) {
    for (var k = 0; k < filtered.length; k++) {
      var nh = norm(filtered[k].href);
      if ((nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1)
          && filtered[k].href.indexOf(year) !== -1) return filtered[k].href;
    }
  }

  // 4. URL'de başlık
  for (var l = 0; l < filtered.length; l++) {
    var nh2 = norm(filtered[l].href);
    if (nh2.indexOf(nTr) !== -1 || nh2.indexOf(nEn) !== -1) return filtered[l].href;
  }

  // 5. Başlık contains
  for (var m = 0; m < filtered.length; m++) {
    var nt3 = norm(filtered[m].title);
    if (nt3.indexOf(nTr) !== -1 || nt3.indexOf(nEn) !== -1) return filtered[m].href;
  }

  return filtered[0].href;
}

// ── Dizi bölüm URL'i ─────────────────────────────────────────

function buildEpisodeUrl(showUrl, season, episode) {
  // https://domain/dizi/slug-izle-N/ → bölüm sayfasına git
  // Site genellikle /dizi/slug/sezon-X-bolum-Y/ formatını kullanıyor
  var base = showUrl.replace(/\/$/, '');
  return base + '/' + season + '-sezon-' + episode + '-bolum/';
}

// ── Film sayfasından video URL'lerini çıkar ──────────────────

function extractVideoUrls(html) {
  var urls = [];
  var seen = {};

  function add(u) {
    u = (u || '').trim();
    if (u && u.startsWith('http') && !seen[u]) { seen[u] = true; urls.push(u); }
  }

  // 1. iframe src — kendi domain dışı
  var re1 = /<iframe[^>]+src="(https?:\/\/(?!(?:www\.)?hdfilmcehenn)[^"]+)"/gi;
  var m;
  while ((m = re1.exec(html)) !== null) add(m[1]);

  // 2. data-video attribute
  var re2 = /data-video="(https?:\/\/[^"]+)"/gi;
  while ((m = re2.exec(html)) !== null) add(m[1]);

  // 3. data-src (embed linkleri)
  var re3 = /data-src="(https?:\/\/(?!(?:www\.)?hdfilmcehenn)[^"]+)"/gi;
  while ((m = re3.exec(html)) !== null) {
    if (m[1].indexOf('wp-content') === -1) add(m[1]);
  }

  // 4. JS içinde player URL'leri
  var re4 = /["'](https?:\/\/(?:yabancidizim|rapidrame|hls\d+\.playmix|player\.|embed\.|video\.)[^"']+)["']/gi;
  while ((m = re4.exec(html)) !== null) add(m[1]);

  // 5. Direkt m3u8
  var re5 = /["'](https?:\/\/[^"']+\.m3u8(?:[^"']*))["']/gi;
  while ((m = re5.exec(html)) !== null) add(m[1]);

  return urls;
}

// ── jwplayer config parse ─────────────────────────────────────

function parseJwConfig(html) {
  var patterns = [
    /window\.configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /var\s+configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /jwplayer\s*\(\s*["']player["']\s*\)\s*\.setup\s*\(\s*(\{[\s\S]+?\})\s*\)/,
    /setup\s*\(\s*(\{[\s\S]*?"sources"[\s\S]+?\})\s*\)/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch(e) {}
  }

  // sources array direkt
  var sm = html.match(/["']sources["']\s*:\s*(\[[\s\S]+?\])/);
  if (sm) { try { return { sources: JSON.parse(sm[1]), tracks: [] }; } catch(e) {} }

  // Tek m3u8
  var fm = html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (fm) return { sources: [{ file: fm[1], label: 'Auto' }], tracks: [] };

  return null;
}

function configToStreams(config, referer) {
  if (!config || !config.sources) return [];

  var subs = (config.tracks || [])
    .filter(function(t) { return t.file; })
    .map(function(t) {
      var l = (t.label || '').toLowerCase();
      var lang = l.indexOf('turk') !== -1 || l.indexOf('tr') !== -1 ? 'Türkçe'
               : l.indexOf('eng') !== -1 ? 'İngilizce' : t.label || 'Bilinmeyen';
      return { url: t.file, language: lang, label: lang };
    });

  return config.sources
    .filter(function(s) { return s.file && s.file.startsWith('http'); })
    .map(function(s) {
      var q   = s.label || 'Auto';
      var obj = {
        name:    'HDFilmCehennemi',
        title:   'HDFC • ' + q,
        url:     s.file,
        quality: q,
        type:    s.file.indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
        headers: {
          'Referer':    referer,
          'User-Agent': PAGE_HEADERS['User-Agent'],
          'Origin':     referer.split('/').slice(0, 3).join('/')
        }
      };
      if (subs.length) obj.subtitles = subs;
      return obj;
    });
}

// ── iframe'den stream çıkar ───────────────────────────────────

function fetchFromIframe(iframeUrl, pageUrl) {
  var hdrs = Object.assign({}, PAGE_HEADERS, {
    'Referer': pageUrl,
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site'
  });

  return fetch(iframeUrl, { headers: hdrs })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // İç iframe var mı?
      var innerM = html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i);
      if (innerM && innerM[1] !== iframeUrl) {
        return fetch(innerM[1], { headers: Object.assign({}, hdrs, { 'Referer': iframeUrl }) })
          .then(function(r2) { return r2.text(); })
          .then(function(html2) { return parseJwConfig(html2); })
          .then(function(cfg) { return configToStreams(cfg, innerM[1]); });
      }
      var cfg = parseJwConfig(html);
      return configToStreams(cfg, iframeUrl);
    })
    .catch(function(e) { console.log('[HDFC] iframe hata: ' + e.message); return []; });
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

      // OPT: TR ve EN araması paralel
      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr)
        searches.push(searchSite(domain, info.titleEn));

      return Promise.all(searches).then(function(allResults) {
        var combined = (allResults[0] || []).concat(allResults[1] || []);

        // Duplicate temizle
        var seen = {}, unique = [];
        combined.forEach(function(r) {
          if (!seen[r.href]) { seen[r.href] = true; unique.push(r); }
        });

        var pageUrl = pickBest(unique, info.titleTr, info.titleEn, info.year, mediaType);
        if (!pageUrl) { console.log('[HDFC] Bulunamadı'); return null; }

        // Dizi ise bölüm URL'i oluştur
        if (mediaType === 'tv' && season && episode) {
          pageUrl = buildEpisodeUrl(pageUrl, season, episode);
        }

        console.log('[HDFC] Sayfa: ' + pageUrl);
        return fetch(pageUrl, {
          headers: Object.assign({}, PAGE_HEADERS, { 'Referer': domain + '/' })
        })
        .then(function(r) { return r.text().then(function(h) { return { html: h, url: pageUrl }; }); });
      });
    })
    .then(function(result) {
      if (!result) return [];

      var videoUrls = extractVideoUrls(result.html);
      console.log('[HDFC] Video URL sayısı: ' + videoUrls.length);

      if (!videoUrls.length) {
        console.log('[HDFC] Video URL yok');
        return [];
      }

      // Direkt m3u8 URL'leri
      var directStreams = [];
      var iframeUrls   = [];

      videoUrls.forEach(function(u) {
        if (u.indexOf('.m3u8') !== -1) {
          directStreams.push({
            name:    'HDFilmCehennemi',
            title:   'HDFC • Auto',
            url:     u,
            quality: 'Auto',
            type:    'hls',
            headers: { 'Referer': result.url, 'User-Agent': PAGE_HEADERS['User-Agent'] }
          });
        } else {
          iframeUrls.push(u);
        }
      });

      return Promise.all(
        iframeUrls.map(function(u) {
          return fetchFromIframe(u, result.url).catch(function() { return []; });
        })
      ).then(function(iframeResults) {
        var all  = directStreams.concat([].concat.apply([], iframeResults));
        var seen = {}, out = [];
        all.forEach(function(s) { if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); } });
        console.log('[HDFilmCehennemi] Toplam stream: ' + out.length);
        return out;
      });
    })
    .catch(function(e) { console.error('[HDFilmCehennemi] Hata: ' + e.message); return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
