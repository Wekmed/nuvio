// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var BASE_URL     = 'https://hdfilmcehennemini.org';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

// Bilinen aktif domain'ler - öncelik sırasıyla
var DOMAINS = [
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.nl',
  'https://www.hdfilmcehennemi.ws',
  'https://hdfilmcehennemi.mobi'
];

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache'
};

// ── Domain tespiti ────────────────────────────────────────────

var _activeDomain = null;

function getActiveDomain() {
  if (_activeDomain) return Promise.resolve(_activeDomain);

  return new Promise(function(resolve) {
    var done = 0;
    var settled = false;
    DOMAINS.forEach(function(domain) {
      fetch(domain + '/', { headers: HEADERS })
        .then(function(r) {
          done++;
          if (settled) return;
          if (r.ok) {
            return r.text().then(function(html) {
              // Cloudflare challenge değilse kullan
              if (html.indexOf('Just a moment') === -1 && html.indexOf('cf-browser-verification') === -1) {
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

// ── Slug ──────────────────────────────────────────────────────

function titleToSlug(title) {
  return (title || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u').replace(/î/g,'i')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function norm(s) {
  return (s||'').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,'');
}

// ── Arama ─────────────────────────────────────────────────────

function searchSite(domain, query) {
  // WordPress arama: ?s= parametresi
  var url = domain + '/?s=' + encodeURIComponent(query);
  console.log('[HDFC] Arama: ' + url);

  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': domain + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      var seen = {};

      // Film linkleri: href içinde domain/{slug}/ formatı
      // h4 veya h3 başlığı yanında
      var re = /href="(https?:\/\/[^"]+\/[^"\/]+\/)"[^>]*>[\s\S]{0,200}?<(?:h[34]|div[^>]*title)[^>]*>([^<]+)</gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href  = m[1];
        var title = m[2].trim();
        // Ana sayfa veya kategori linkleri değil, film linkleri
        if (href.indexOf(domain) !== -1 
            && href.indexOf('/category/') === -1
            && href.indexOf('/yil/') === -1
            && href.indexOf('/oyuncu/') === -1
            && href.indexOf('/ulke/') === -1
            && !seen[href]) {
          seen[href] = true;
          results.push({ href: href, title: title });
        }
      }

      // Alternatif: direkt <a href="domain/slug/"> pattern
      if (results.length === 0) {
        var re2 = /href="(https?:\/\/[^"]+\/[a-z0-9\-]+\/)"/gi;
        while ((m = re2.exec(html)) !== null) {
          var h = m[1];
          if (h.indexOf(domain) !== -1
              && h !== domain + '/'
              && h.indexOf('/category/') === -1
              && h.indexOf('/page/') === -1
              && !seen[h]) {
            seen[h] = true;
            results.push({ href: h, title: '' });
          }
        }
      }

      console.log('[HDFC] Sonuç sayısı: ' + results.length);
      return results;
    })
    .catch(function(e) { console.log('[HDFC] Arama hata: ' + e.message); return []; });
}

function pickBestResult(results, titleTr, titleEn, year) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);

  // 1. URL + yıl
  if (year) {
    for (var i=0; i<results.length; i++) {
      var nh = norm(results[i].href);
      if ((nh.indexOf(nTr)!==-1||nh.indexOf(nEn)!==-1) && results[i].href.indexOf(year)!==-1)
        return results[i].href;
    }
  }
  // 2. URL başlık
  for (var j=0; j<results.length; j++) {
    var nh2 = norm(results[j].href);
    if (nh2.indexOf(nTr)!==-1 || nh2.indexOf(nEn)!==-1) return results[j].href;
  }
  // 3. Başlık metni
  for (var k=0; k<results.length; k++) {
    if (norm(results[k].title)===nTr || norm(results[k].title)===nEn) return results[k].href;
  }
  return results[0].href;
}

// ── Direkt slug denemesi ──────────────────────────────────────

function tryDirectUrl(domain, titleTr, titleEn, year) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var candidates = [];

  if (slugTr) candidates.push(domain + '/' + slugTr + '/');
  if (slugEn && slugEn !== slugTr) candidates.push(domain + '/' + slugEn + '/');
  // Yıllı varyantlar
  if (slugTr && year) candidates.push(domain + '/' + slugTr + '-' + year + '/');
  if (slugEn && year && slugEn !== slugTr) candidates.push(domain + '/' + slugEn + '-' + year + '/');

  // Hepsini paralel dene, ilk 200 OK kazanır
  return new Promise(function(resolve) {
    if (!candidates.length) { resolve(null); return; }
    var done = 0, settled = false;
    candidates.forEach(function(url) {
      fetch(url, { headers: HEADERS })
        .then(function(r) {
          done++;
          if (settled) return;
          if (r.ok) {
            return r.text().then(function(html) {
              // Gerçek film sayfası mı? (oyuncu listesi veya imdb skoru var)
              if (html.indexOf('post-info-imdb') !== -1 || html.indexOf('IMDb') !== -1) {
                settled = true;
                resolve({ url: url, html: html });
              } else if (done >= candidates.length && !settled) {
                resolve(null);
              }
            });
          } else if (done >= candidates.length && !settled) {
            resolve(null);
          }
        })
        .catch(function() {
          done++;
          if (!settled && done >= candidates.length) resolve(null);
        });
    });
  });
}

// ── Video URL çıkarma ─────────────────────────────────────────

/**
 * Sayfa HTML'sinden tüm potansiyel video URL'lerini topla.
 * Bu site WordPress tabanlı — video genelde AJAX ile veya
 * sayfa içi script bloğunda bulunuyor.
 */
function extractVideoUrls(html, pageUrl, domain) {
  var urls = [];
  var seen = {};

  function add(u) {
    if (u && !seen[u] && u.startsWith('http')) { seen[u] = true; urls.push(u); }
  }

  // 1. data-video
  var m;
  var re1 = /data-video="(https?:\/\/[^"]+)"/gi;
  while ((m = re1.exec(html)) !== null) add(m[1]);

  // 2. data-src embed linkleri
  var re2 = /data-src="(https?:\/\/(?!hdfilmcehennemi)[^"]+)"/gi;
  while ((m = re2.exec(html)) !== null) {
    if (m[1].indexOf('wp-content') === -1) add(m[1]);
  }

  // 3. iframe src (başka domainlerde)
  var re3 = /<iframe[^>]+src="(https?:\/\/(?!hdfilmcehennemi)[^"]+)"/gi;
  while ((m = re3.exec(html)) !== null) add(m[1]);

  // 4. JavaScript içinde URL'ler
  var re4 = /["'](https?:\/\/(?:rapidrame|hls\d+\.playmix|player|embed|video)[^"']+)["']/gi;
  while ((m = re4.exec(html)) !== null) add(m[1]);

  // 5. file: "..." direkt m3u8
  var re5 = /["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
  while ((m = re5.exec(html)) !== null) add(m[1]);

  console.log('[HDFC] Video URL sayısı: ' + urls.length);
  return urls;
}

// ── jwplayer config parse ─────────────────────────────────────

function parseJwConfig(html) {
  // 1. window.configs = {...}
  var patterns = [
    /window\.configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /var\s+configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /jwplayer\s*\(\s*["']player["']\s*\)\s*\.setup\s*\(\s*(\{[\s\S]+?\})\s*\)/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) {
      try { return JSON.parse(m[1]); } catch(e) {}
    }
  }

  // 2. sources array
  var sm = html.match(/["']sources["']\s*:\s*(\[[\s\S]+?\])/);
  if (sm) { try { return { sources: JSON.parse(sm[1]), tracks: [] }; } catch(e) {} }

  // 3. Tek file URL
  var fm = html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (fm) return { sources: [{ file: fm[1], label: 'Auto' }], tracks: [] };

  return null;
}

function configToStreams(config, referer, label) {
  if (!config || !config.sources) return [];
  var subs = (config.tracks || [])
    .filter(function(t) { return t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'); })
    .map(function(t) {
      var l = (t.label||'').toLowerCase();
      var lang = l.indexOf('turk')!==-1||l.indexOf('tr')!==-1 ? 'Türkçe'
               : l.indexOf('eng')!==-1||l.indexOf('ing')!==-1 ? 'İngilizce'
               : t.label||'Bilinmeyen';
      return { url: t.file, language: lang, label: lang };
    });

  return config.sources
    .filter(function(s) { return s.file && s.file.startsWith('http'); })
    .map(function(s) {
      var q = s.label || 'Auto';
      var stream = {
        name:    'HDFilmCehennemi',
        title:   (label||'HDFC') + ' • ' + q,
        url:     s.file,
        quality: q,
        type:    s.file.indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
        headers: {
          'Referer':    referer,
          'User-Agent': HEADERS['User-Agent'],
          'Origin':     referer.split('/').slice(0,3).join('/')
        }
      };
      if (subs.length) stream.subtitles = subs;
      return stream;
    });
}

// ── iframe fetch ──────────────────────────────────────────────

function fetchFromIframe(iframeUrl, pageUrl) {
  var isRapid = /rapidrame|rapid/i.test(iframeUrl);
  var hdrs = Object.assign({}, HEADERS, {
    'Referer': pageUrl,
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site'
  });
  if (isRapid) {
    hdrs['Origin'] = pageUrl.split('/').slice(0,3).join('/');
  }

  return fetch(iframeUrl, { headers: hdrs })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var config = parseJwConfig(html);
      if (!config) { console.log('[HDFC] Config yok: ' + iframeUrl); return []; }
      console.log('[HDFC] Sources: ' + (config.sources||[]).length);
      return configToStreams(config, iframeUrl, isRapid ? 'RapidRame' : 'HDFilmCehennemi');
    })
    .catch(function(e) { console.log('[HDFC] iframe hata: ' + e.message); return []; });
}

// ── Sayfa yükle ───────────────────────────────────────────────

function loadPage(url, domain) {
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': domain + '/' }) })
    .then(function(r) { return r.text().then(function(h) { return { html: h, url: r.url || url }; }); });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[HDFilmCehennemi] TMDB:' + tmdbId + ' ' + mediaType
    + (season ? ' S'+season+'E'+episode : ''));

  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0];
      var info   = init[1];
      console.log('[HDFC] ' + info.titleEn + ' / ' + info.titleTr + ' (' + info.year + ')');

      // OPT: Slug denemesi + TR arama + EN arama üçü paralel
      var tries = [
        tryDirectUrl(domain, info.titleTr, info.titleEn, info.year),
        searchSite(domain, info.titleTr),
        info.titleEn !== info.titleTr ? searchSite(domain, info.titleEn) : Promise.resolve([])
      ];

      return Promise.all(tries).then(function(results) {
        // Direkt URL bulunduysa kullan
        if (results[0]) {
          console.log('[HDFC] Direkt bulundu: ' + results[0].url);
          return results[0];
        }

        // Arama sonuçlarından en iyiyi seç
        var allResults = (results[1]||[]).concat(results[2]||[]);
        var pageUrl = pickBestResult(allResults, info.titleTr, info.titleEn, info.year);
        if (!pageUrl) { console.log('[HDFC] Bulunamadı'); return null; }

        console.log('[HDFC] Arama seçildi: ' + pageUrl);
        return loadPage(pageUrl, domain);
      });
    })
    .then(function(result) {
      if (!result) return [];

      var videoUrls = extractVideoUrls(result.html, result.url, _activeDomain || DOMAINS[0]);

      // Direkt m3u8 URL varsa ekle
      var directStreams = [];
      videoUrls.forEach(function(u) {
        if (u.indexOf('.m3u8') !== -1) {
          directStreams.push({
            name:    'HDFilmCehennemi',
            title:   'HDFC • Auto',
            url:     u,
            quality: 'Auto',
            type:    'hls',
            headers: { 'Referer': result.url, 'User-Agent': HEADERS['User-Agent'] }
          });
        }
      });

      // iframe URL'leri işle
      var iframeUrls = videoUrls.filter(function(u) { return u.indexOf('.m3u8') === -1; });

      if (!iframeUrls.length && !directStreams.length) {
        console.log('[HDFC] Video URL yok — site üye girişi gerektirebilir');
        return [];
      }

      return Promise.all(
        iframeUrls.map(function(u) { return fetchFromIframe(u, result.url).catch(function() { return []; }); })
      ).then(function(iframeResults) {
        var all = directStreams.concat([].concat.apply([], iframeResults));
        // Deduplicate
        var seen = {}, out = [];
        all.forEach(function(s) { if (!seen[s.url]) { seen[s.url]=true; out.push(s); } });
        console.log('[HDFilmCehennemi] Toplam stream: ' + out.length);
        return out;
      });
    })
    .catch(function(e) { console.error('[HDFilmCehennemi] Hata: ' + e.message); return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
               
