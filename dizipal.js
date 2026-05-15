/**
 * DiziPal Provider for Nuvio
 *
 * Kaynak: dizipal.im (dinamik domain — domainListesi'nden alınır)
 * Desteklenen: TV dizileri, filmler, animeler
 * Embed: iframe[src*='embed'] / .series-player-container iframe
 */

// ─── Sabitler ─────────────────────────────────────────────────────────────────

var DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt';
var BASE_URL        = 'https://dizipal.im';
var CACHE_MS        = 60 * 60 * 1000; // 1 saat

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

var HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
};

// ─── Domain cache ─────────────────────────────────────────────────────────────

var _domain    = null;
var _domainTs  = 0;

function getBaseUrl() {
  var now = Date.now();
  if (_domain && (now - _domainTs) < CACHE_MS) return Promise.resolve(_domain);

  return fetch(DOMAIN_LIST_URL, { headers: { 'User-Agent': UA } })
    .then(function(r) { return r.ok ? r.text() : ''; })
    .then(function(text) {
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l.toLowerCase().indexOf('dizipal=') === 0) {
          var d = l.substring(8).trim().replace(/\/$/, '');
          if (d) { _domain = d; _domainTs = Date.now(); return d; }
        }
      }
      _domain = BASE_URL; _domainTs = Date.now(); return BASE_URL;
    })
    .catch(function() { return _domain || BASE_URL; });
}

// ─── HTTP yardımcıları ────────────────────────────────────────────────────────

function get(url, referer) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer || BASE_URL + '/' })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' → ' + url);
    return r.text();
  });
}

function postAjax(url, body, referer) {
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': BASE_URL,
      'Referer': referer || BASE_URL + '/'
    }),
    body: body
  }).then(function(r) { return r.text(); });
}

// ─── TR slug dönüştürücü ──────────────────────────────────────────────────────

var TR_MAP = { 'ğ':'g','ü':'u','ş':'s','ı':'i','ö':'o','ç':'c','Ğ':'g','Ü':'u','Ş':'s','İ':'i','Ö':'o','Ç':'c' };
function trSlug(s) {
  if (!s) return '';
  return s.replace(/[ğüşıöçĞÜŞİÖÇ]/g, function(c) { return TR_MAP[c] || c; })
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── TMDB ──────────────────────────────────────────────────────────────────────

var TMDB_KEY = 'c4ffcab48dfaa7b41625ac13d61aec31';

function getTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'movie' ? 'movie' : 'tv';
  return fetch(
    'https://api.themoviedb.org/3/' + ep + '/' + tmdbId +
    '?api_key=' + TMDB_KEY + '&language=tr-TR'
  ).then(function(r) { return r.json(); })
   .then(function(d) {
     return {
       title:     (d.name      || d.title          || '').trim(),
       origTitle: (d.original_name || d.original_title || '').trim(),
       year:      ((d.first_air_date || d.release_date || '')).slice(0, 4)
     };
   });
}

// ─── Arama: /?s=sorgu ────────────────────────────────────────────────────────

function searchSite(baseUrl, query) {
  var url = baseUrl + '/?s=' + encodeURIComponent(query);
  return get(url, baseUrl + '/').then(function(html) {
    var results = [];
    // div.post-item veya div.swiper-slide içindeki h1 a / h4 a
    var re = /<(?:div|article)[^>]+class="[^"]*(?:post-item|swiper-slide)[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>[\s\S]*?<\/(?:div|article)>/gi;
    var block;
    while ((block = re.exec(html)) !== null) {
      var href    = block[1];
      var titleM  = block[0].match(/<(?:h1|h4)[^>]*>([^<]+)<\/(?:h1|h4)>/i);
      var title   = titleM ? titleM[1].trim() : '';
      if (href && title) results.push({ href: href, title: title });
    }
    // Fallback: h1 a içinde
    if (!results.length) {
      var re2 = /<h[14][^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      var m2;
      while ((m2 = re2.exec(html)) !== null) {
        results.push({ href: m2[1], title: m2[2].trim() });
      }
    }
    return results;
  });
}

// ─── Dizi bölüm URL'si ───────────────────────────────────────────────────────

function findShowPage(baseUrl, tmdbInfo) {
  var queries = [tmdbInfo.title, tmdbInfo.origTitle].filter(function(t, i, arr) {
    return t && arr.indexOf(t) === i;
  });

  function tryQuery(i) {
    if (i >= queries.length) return Promise.resolve(null);
    return searchSite(baseUrl, queries[i]).then(function(results) {
      if (results.length) return results[0].href;
      return tryQuery(i + 1);
    });
  }
  return tryQuery(0);
}

// ─── Sezon listesi ───────────────────────────────────────────────────────────

function getSeasonLinks(baseUrl, showUrl) {
  return get(showUrl, baseUrl + '/').then(function(html) {
    // div#season-options-list li a:not(.font-bold)
    var seasons = {};
    var re = /<a\s+href="([^"]+)"[^>]*>[\s\S]*?(\d+)\s*\.\s*Sezon[\s\S]*?<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var num = parseInt(m[2], 10);
      if (!seasons[num]) seasons[num] = m[1];
    }
    // Alternatif: section h1 + span + ul a
    if (!Object.keys(seasons).length) {
      var re2 = /<li[^>]*>\s*<a\s+href="([^"]+)"[^>]*>[\s\S]*?(\d+)\s*[\.\-]\s*Sezon[\s\S]*?<\/a>\s*<\/li>/gi;
      while ((m = re2.exec(html)) !== null) {
        var num2 = parseInt(m[2], 10);
        if (!seasons[num2]) seasons[num2] = m[1];
      }
    }
    // Sayfanın kendisi de 1. sezon olabilir
    if (!Object.keys(seasons).length) seasons[1] = showUrl;
    return seasons;
  });
}

// ─── Bölüm listesi ───────────────────────────────────────────────────────────

function getEpisodeLinks(baseUrl, seasonUrl, targetEp) {
  return get(seasonUrl, baseUrl + '/').then(function(html) {
    // div.episode veya div.episode-item içindeki linkler
    var eps = {};
    var re = /<div[^>]+class="[^"]*episode[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[\s\S]*?<\/div>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var epNumM = m[1].match(/(\d+)[.-]bolum/i) || m[0].match(/(\d+)[.\s]*B[oö]l[üu]m/i);
      if (epNumM) {
        var num = parseInt(epNumM[1], 10);
        if (!eps[num]) eps[num] = m[1];
      }
    }
    return eps[targetEp] || null;
  });
}

// ─── iframe / embed çıkarma ──────────────────────────────────────────────────

function extractIframe(baseUrl, episodeUrl) {
  return get(episodeUrl, baseUrl + '/').then(function(html) {
    // Öncelik sırası: .series-player-container iframe, .responsive-player iframe,
    // iframe[src*='embed'], div#vast_new iframe
    var patterns = [
      /series-player-container[\s\S]{0,200}?<iframe[^>]+src="([^"]+)"/i,
      /responsive-player[\s\S]{0,200}?<iframe[^>]+src="([^"]+)"/i,
      /<iframe[^>]+src="([^"]*embed[^"]*)"/i,
      /div#vast_new[\s\S]{0,200}?<iframe[^>]+src="([^"]+)"/i,
      /<iframe[^>]+src="(https?:[^"]+)"/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1]) return m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    }
    return null;
  });
}

// ─── m3u8 çıkarma (embed sayfasından) ───────────────────────────────────────

function extractM3u8(embedUrl, referer) {
  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer })
  }).then(function(r) { return r.text(); })
  .then(function(html) {
    // sources: [{ file: '...' }] veya source src="..."
    var patterns = [
      /file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
      /source\s+src=['"]([^'"]+\.m3u8[^'"]*)['"]/i,
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  }).catch(function() { return null; });
}

// ─── Ana getStreams fonksiyonu ────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([getBaseUrl(), getTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var baseUrl  = init[0];
      var tmdbInfo = init[1];

      console.log('[DiziPal] Domain: ' + baseUrl);
      console.log('[DiziPal] İçerik: "' + tmdbInfo.title + '" / "' + tmdbInfo.origTitle + '"');

      if (mediaType === 'movie') {
        // Film: doğrudan arama + ilk sonuç
        return searchSite(baseUrl, tmdbInfo.title).then(function(results) {
          if (!results.length && tmdbInfo.origTitle !== tmdbInfo.title) {
            return searchSite(baseUrl, tmdbInfo.origTitle);
          }
          return results;
        }).then(function(results) {
          if (!results.length) throw new Error('Film bulunamadı');
          return extractIframe(baseUrl, results[0].href);
        });
      }

      // Dizi: arama → show sayfası → sezon → bölüm → iframe
      return findShowPage(baseUrl, tmdbInfo).then(function(showUrl) {
        if (!showUrl) throw new Error('Dizi bulunamadı');
        return getSeasonLinks(baseUrl, showUrl);
      }).then(function(seasons) {
        var seasonUrl = seasons[season];
        if (!seasonUrl) throw new Error(season + '. sezon bulunamadı');
        return getEpisodeLinks(baseUrl, seasonUrl, episode);
      }).then(function(epUrl) {
        if (!epUrl) throw new Error(season + 'x' + episode + ' bölümü bulunamadı');
        return extractIframe(baseUrl, epUrl);
      });
    })
    .then(function(iframeUrl) {
      if (!iframeUrl) {
        console.warn('[DiziPal] iframe bulunamadı');
        return [];
      }
      console.log('[DiziPal] iframe: ' + iframeUrl);
      return extractM3u8(iframeUrl, BASE_URL + '/').then(function(m3u8) {
        if (!m3u8) {
          // iframe'i doğrudan stream olarak dön (WebView ile açılır)
          return [{
            name: 'DiziPal',
            title: '⌜ DiziPAL ⌟ | Embed | 🇹🇷',
            url: iframeUrl,
            quality: '1080p',
            type: 'iframe',
            headers: { 'Referer': BASE_URL + '/' }
          }];
        }
        return [{
          name: 'DiziPal',
          title: '⌜ DiziPAL ⌟ | HLS | 🇹🇷',
          url: m3u8,
          quality: '1080p',
          type: 'hls',
          headers: { 'Referer': iframeUrl }
        }];
      });
    })
    .catch(function(err) {
      console.error('[DiziPal] Hata: ' + (err.message || err));
      return [];
    });
}

module.exports = { getStreams: getStreams };
