// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

// Bilinen domain'ler (plugin dinamik çeker, biz statik + fallback kullanıyoruz)
var DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt';
var FALLBACK_DOMAINS = [
  'https://www.hdfilmcehennemi.ws',
  'https://www.hdfilmcehennemi.nl',
  'https://hdfilmcehennemi.mobi',
  'https://www.hdfilmcehennemi2.com',
  'https://www.hdfilmcehennemi.info'
];

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin'
};

// ── Domain yönetimi ───────────────────────────────────────────

var _cachedDomain = null;
var _domainFetchedAt = 0;
var DOMAIN_CACHE_MS = 30 * 60 * 1000; // 30 dakika

function getActiveDomain() {
  // Cache geçerliyse direkt döndür
  if (_cachedDomain && (Date.now() - _domainFetchedAt) < DOMAIN_CACHE_MS) {
    return Promise.resolve(_cachedDomain);
  }

  // Önce GitHub'dan domain listesini çek
  return fetch(DOMAIN_LIST_URL, { headers: HEADERS })
    .then(function(r) { return r.ok ? r.text() : ''; })
    .then(function(text) {
      // "HDFilmCehennemi=https://www.hdfilmcehennemi.ws" formatı
      var m = text.match(/HDFilmCehennemi[=:]\s*(https?:\/\/[^\s\n]+)/i);
      if (m) return [m[1]].concat(FALLBACK_DOMAINS);
      return FALLBACK_DOMAINS;
    })
    .catch(function() { return FALLBACK_DOMAINS; })
    .then(function(domains) {
      // Aktif domain'i bul — race ile hepsi paralel
      return new Promise(function(resolve) {
        var settled = false;
        var done = 0;
        domains.forEach(function(domain) {
          fetch(domain + '/', { headers: HEADERS })
            .then(function(r) {
              done++;
              if (settled) return;
              if (r.ok || r.status === 301 || r.status === 302) {
                // Cloudflare challenge değilse kabul et
                return r.text().then(function(html) {
                  if (html.indexOf('Just a moment') !== -1) {
                    if (done >= domains.length) resolve(FALLBACK_DOMAINS[0]);
                    return;
                  }
                  settled = true;
                  _cachedDomain = domain;
                  _domainFetchedAt = Date.now();
                  resolve(domain);
                });
              } else if (done >= domains.length && !settled) {
                resolve(FALLBACK_DOMAINS[0]);
              }
            })
            .catch(function() {
              done++;
              if (!settled && done >= domains.length) resolve(FALLBACK_DOMAINS[0]);
            });
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

// ── Arama ─────────────────────────────────────────────────────

function searchSite(domain, query) {
  var url = domain + '/search?q=' + encodeURIComponent(query);
  console.log('[HDFC] Arama: ' + url);

  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': domain + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      // a.poster veya a[data-token] seçici — href + title çek
      var re = /href="(https?:\/\/[^"]*\/(?:film|dizi)\/[^"]+)"[^>]*>[\s\S]*?(?:class="poster-title"[^>]*>([^<]+)|title="([^"]+)")/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href  = m[1];
        var title = (m[2] || m[3] || '').trim();
        if (!title) {
          // h4.title veya h3'ten al
          var nearby = html.slice(m.index, m.index + 500);
          var tm = nearby.match(/<h[34][^>]*>([^<]+)<\/h[34]>/i);
          title = tm ? tm[1].trim() : '';
        }
        if (href) results.push({ href: href, title: title });
      }

      // Ayrıca data-token pattern
      if (!results.length) {
        var re2 = /href="([^"]+\/(?:film|dizi)\/[^"]+)"[^>]*data-token/gi;
        while ((m = re2.exec(html)) !== null) {
          results.push({ href: m[1], title: '' });
        }
      }

      console.log('[HDFC] Arama sonucu: ' + results.length);
      return results;
    })
    .catch(function(e) { console.log('[HDFC] Arama hata: ' + e.message); return []; });
}

function findBestResult(results, titleTr, titleEn, year) {
  if (!results.length) return null;

  function norm(s) {
    return (s||'').toLowerCase()
      .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
      .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
      .replace(/[^a-z0-9]/g,'');
  }

  var nTr = norm(titleTr), nEn = norm(titleEn);

  // 1. URL + yıl eşleşmesi
  if (year) {
    for (var i = 0; i < results.length; i++) {
      var nh = norm(results[i].href);
      if ((nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1)
          && results[i].href.indexOf(year) !== -1) return results[i].href;
    }
  }
  // 2. URL başlık eşleşmesi
  for (var j = 0; j < results.length; j++) {
    var nh2 = norm(results[j].href);
    if (nh2.indexOf(nTr) !== -1 || nh2.indexOf(nEn) !== -1) return results[j].href;
  }
  // 3. Başlık text eşleşmesi
  for (var k = 0; k < results.length; k++) {
    var nt = norm(results[k].title);
    if (nt === nTr || nt === nEn) return results[k].href;
  }

  return results[0].href;
}

// ── İçerik sayfası parse ──────────────────────────────────────

function loadContentPage(pageUrl, domain, season, episode) {
  var hdrs = Object.assign({}, HEADERS, { 'Referer': domain + '/' });
  var targetUrl = pageUrl;

  // TV dizisi için bölüm URL'i oluştur
  if (season && episode) {
    // /dizi/slug/ → /dizi/slug/sezon-X-bolum-Y/
    if (pageUrl.indexOf('-sezon-') === -1) {
      targetUrl = pageUrl.replace(/\/$/, '') + '/' + season + '-sezon-' + episode + '-bolum/';
    }
  }

  console.log('[HDFC] Sayfa: ' + targetUrl);

  return fetch(targetUrl, { headers: hdrs })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      return { html: html, url: targetUrl };
    });
}

// ── Video URL çıkarma ─────────────────────────────────────────

/**
 * Sayfadan video iframe URL'ini bul.
 * DEX'ten: data-video, data-src, data-modal, button.alternative-link
 */
function extractIframeUrl(html, pageUrl, domain) {
  // 1. data-video attribute
  var m = html.match(/data-video="(https?:\/\/[^"]+)"/i);
  if (m) { console.log('[HDFC] data-video: ' + m[1]); return m[1]; }

  // 2. data-src pattern (DEX: 'data-src=\\\"([^"]+)')
  m = html.match(/data-src="(https?:\/\/[^"]+(?:embed|video|player)[^"]+)"/i);
  if (m) { console.log('[HDFC] data-src: ' + m[1]); return m[1]; }

  // 3. data-modal
  m = html.match(/data-modal="(https?:\/\/[^"]+)"/i);
  if (m) { console.log('[HDFC] data-modal: ' + m[1]); return m[1]; }

  // 4. button.alternative-link ilk kaynağı al
  m = html.match(/button[^>]+class="[^"]*alternative-link[^"]*"[^>]+data-(?:video|src|url)="(https?:\/\/[^"]+)"/i);
  if (m) { console.log('[HDFC] alternative-link: ' + m[1]); return m[1]; }

  // 5. iframe src (fallback)
  m = html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i);
  if (m && m[1].indexOf(domain) === -1) { console.log('[HDFC] iframe: ' + m[1]); return m[1]; }

  console.log('[HDFC] iframe URL bulunamadı');
  return null;
}

/**
 * Tüm alternatif linkleri çek (div.alternative-links içindeki butonlar)
 */
function extractAllIframeUrls(html, domain) {
  var urls = [];
  var seen = {};

  // button.alternative-link data-* attribute'ları
  var re = /button[^>]+(?:data-video|data-src|data-url)="(https?:\/\/[^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = true; urls.push(m[1]); }
  }

  // data-video genel
  var re2 = /data-video="(https?:\/\/[^"]+)"/gi;
  while ((m = re2.exec(html)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = true; urls.push(m[1]); }
  }

  // Eğer hiç bulunamadıysa fallback
  if (!urls.length) {
    var single = extractIframeUrl(html, null, domain);
    if (single) urls.push(single);
  }

  console.log('[HDFC] Toplam iframe URL: ' + urls.length);
  return urls;
}

// ── jwplayer config çözümleyici ───────────────────────────────

/**
 * iframe sayfasından jwplayer configs'i parse et.
 * DEX'ten: jwplayer("player").setup(configs) ve window.configs = configs
 *
 * Yapı:
 *   var configs = { sources: [{file:"...", label:"..."}, ...], tracks: [{file:"...", label:"...", kind:"captions"}] }
 */
function extractJwplayerConfig(html) {
  var configJson = null;

  // 1. window.configs = {...} veya var configs = {...}
  var patterns = [
    /window\.configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /var\s+configs\s*=\s*(\{[\s\S]+?\})\s*;/,
    /jwplayer\s*\(\s*["']player["']\s*\)\s*\.setup\s*\(\s*(\{[\s\S]+?\})\s*\)/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) {
      try {
        configJson = JSON.parse(m[1]);
        console.log('[HDFC] jwplayer config bulundu (pattern ' + i + ')');
        break;
      } catch(e) {
        // JSON parse hatası - devam et
      }
    }
  }

  if (!configJson) {
    // 2. Direkt sources array ara
    var srcM = html.match(/["']sources["']\s*:\s*(\[[\s\S]+?\])/);
    if (srcM) {
      try {
        var sources = JSON.parse(srcM[1]);
        configJson = { sources: sources, tracks: [] };
        console.log('[HDFC] Sources array bulundu');
      } catch(e) {}
    }
  }

  if (!configJson) {
    // 3. file: "..." pattern ile tek tek çek
    var fileM = html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i);
    if (fileM) {
      console.log('[HDFC] Direkt m3u8 URL: ' + fileM[1]);
      configJson = { sources: [{ file: fileM[1], label: 'Auto' }], tracks: [] };
    }
  }

  return configJson;
}

/**
 * RapidRame için özel işlem.
 * DEX: 'rapidrameReferer' + 'Dinamik rapidrameReferer'
 * RapidRame kendi sayfasını açıp referer elde etmek gerekiyor.
 */
function fetchRapidRameStream(rapidUrl, referer) {
  console.log('[HDFC] RapidRame: ' + rapidUrl);
  var hdrs = Object.assign({}, HEADERS, {
    'Referer': referer || 'https://www.hdfilmcehennemi.ws/',
    'Origin':  referer ? referer.split('/').slice(0,3).join('/') : 'https://www.hdfilmcehennemi.ws'
  });

  return fetch(rapidUrl, { headers: hdrs })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var config = extractJwplayerConfig(html);
      if (!config || !config.sources || !config.sources.length) {
        console.log('[HDFC] RapidRame config bulunamadı');
        return [];
      }
      return configToStreams(config, rapidUrl, 'RapidRame');
    })
    .catch(function(e) { console.log('[HDFC] RapidRame hata: ' + e.message); return []; });
}

function configToStreams(config, refererUrl, sourceName) {
  if (!config || !config.sources) return [];

  // Altyazılar
  var subtitles = [];
  var tracks = config.tracks || [];
  tracks.forEach(function(t) {
    if (!t.file || (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles')) return;
    var lang = (t.label || '').toLowerCase();
    var langCode = lang.indexOf('turk') !== -1 || lang.indexOf('tr') !== -1 ? 'Türkçe'
                 : lang.indexOf('eng') !== -1 || lang.indexOf('ing') !== -1 ? 'İngilizce'
                 : t.label || 'Bilinmeyen';
    subtitles.push({ url: t.file, language: langCode, label: langCode });
  });

  var streams = [];
  config.sources.forEach(function(src) {
    if (!src.file) return;
    if (!src.file.startsWith('http')) { console.log('[HDFC] URL http değil, atlandı: ' + src.file); return; }

    var quality = src.label || 'Auto';
    // M3U8 URL — hls13.playmix.uno gibi CDN'ler
    var stream = {
      name:    'HDFilmCehennemi',
      title:   (sourceName || 'HDFilmCehennemi') + ' • ' + quality,
      url:     src.file,
      quality: quality,
      type:    src.file.indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
      headers: {
        'Referer':    refererUrl,
        'User-Agent': HEADERS['User-Agent'],
        'Origin':     refererUrl ? refererUrl.split('/').slice(0,3).join('/') : ''
      }
    };
    if (subtitles.length) stream.subtitles = subtitles;
    streams.push(stream);
  });

  return streams;
}

// ── iframe'den stream çıkar ───────────────────────────────────

function fetchStreamsFromIframe(iframeUrl, pageUrl, domain) {
  var isRapidRame = iframeUrl.toLowerCase().indexOf('rapidrame') !== -1
                 || iframeUrl.toLowerCase().indexOf('rapid') !== -1;

  if (isRapidRame) {
    return fetchRapidRameStream(iframeUrl, pageUrl);
  }

  var hdrs = Object.assign({}, HEADERS, {
    'Referer': pageUrl || (domain + '/'),
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site'
  });

  return fetch(iframeUrl, { headers: hdrs })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var config = extractJwplayerConfig(html);
      if (!config || !config.sources || !config.sources.length) {
        console.log('[HDFC] Config yok: ' + iframeUrl);
        return [];
      }
      console.log('[HDFC] Sources: ' + config.sources.length + ' | Tracks: ' + (config.tracks||[]).length);
      return configToStreams(config, iframeUrl, 'HDFilmCehennemi');
    })
    .catch(function(e) { console.log('[HDFC] iframe hata: ' + e.message); return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[HDFilmCehennemi] TMDB:' + tmdbId + ' ' + mediaType
    + (season ? ' S'+season+'E'+episode : ''));

  // OPT: Domain + TMDB bilgisi paralel
  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0];
      var info   = init[1];
      console.log('[HDFC] Domain: ' + domain + ' | ' + info.titleEn + ' / ' + info.titleTr);

      // OPT: TR ve EN araması paralel
      var searches = [searchSite(domain, info.titleEn)];
      if (info.titleTr && info.titleTr !== info.titleEn)
        searches.push(searchSite(domain, info.titleTr));

      return Promise.all(searches).then(function(allResults) {
        var results = allResults[0].concat(allResults[1] || []);
        var pageUrl = findBestResult(results, info.titleTr, info.titleEn, info.year);

        if (!pageUrl) {
          console.log('[HDFC] Film/dizi bulunamadı');
          return [];
        }

        console.log('[HDFC] Seçildi: ' + pageUrl);
        return loadContentPage(pageUrl, domain, season, episode);
      })
      .then(function(result) {
        if (!result) return [];

        // Tüm video URL'lerini çek
        var iframeUrls = extractAllIframeUrls(result.html, domain);
        if (!iframeUrls.length) {
          console.log('[HDFC] Video URL bulunamadı');
          return [];
        }

        // OPT: Tüm iframe'ler paralel işleniyor
        return Promise.all(
          iframeUrls.map(function(iurl) {
            return fetchStreamsFromIframe(iurl, result.url, domain)
              .catch(function() { return []; });
          })
        ).then(function(results) {
          var all = [].concat.apply([], results);
          // Deduplicate
          var seen = {}, out = [];
          all.forEach(function(s) {
            if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); }
          });
          console.log('[HDFilmCehennemi] Toplam stream: ' + out.length);
          return out;
        });
      });
    })
    .catch(function(e) { console.error('[HDFilmCehennemi] Hata: ' + e.message); return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
                        
