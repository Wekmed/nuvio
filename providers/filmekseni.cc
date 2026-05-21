// ============================================================
//  FilmEkseni — Nuvio Provider
// ============================================================

var MAIN_URL     = 'https://filmekseni.cc';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023'; // Plugin'den alınan key (TR metadata)
var PROVIDER     = 'FilmEkseni';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ─── Türkçe karakter → ASCII slug ────────────────────────────

var TR_MAP = {
  'ğ':'g','ü':'u','ş':'s','ı':'i','İ':'i','ö':'o','ç':'c',
  'Ğ':'g','Ü':'u','Ş':'s','Ö':'o','Ç':'c','â':'a','û':'u','î':'i'
};

function trSlug(s) {
  return (s || '').replace(/[ğüşıİöçĞÜŞÖÇâûî]/g, function(c) { return TR_MAP[c] || c; })
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function norm(s) {
  return (s || '').replace(/[ğüşıİöçĞÜŞÖÇâûî]/g, function(c) { return TR_MAP[c] || c; })
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── HTTP yardımcıları ────────────────────────────────────────

function get(url, extraHeaders) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, extraHeaders || {})
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
    return r.text();
  });
}

function getJson(url, extraHeaders) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Accept': 'application/json, */*' }, extraHeaders || {})
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ─── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch(
    'https://api.themoviedb.org/3/' + ep + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=tr-TR'
  )
  .then(function(r) { return r.json(); })
  .then(function(d) {
    return {
      titleTr: (d.title  || d.name  || '').trim(),
      titleEn: (d.original_title || d.original_name || '').trim(),
      year:    (d.release_date || d.first_air_date || '').slice(0, 4)
    };
  });
}

// ─── Arama ───────────────────────────────────────────────────
//
// filmekseni.cc/search/?q= → JSON yanıt
// DEX'ten: SearchApiResponse { result: SearchResultItem[] }
// SearchResultItem: { postid, title, slug, slug_prefix, type,
//                     year, posterUrl, akatitle, original_title }

function searchSite(query) {
  return getJson(MAIN_URL + '/search/?q=' + encodeURIComponent(query))
    .then(function(data) {
      var items = data.result || data.results || (Array.isArray(data) ? data : []);
      console.log('[FilmEkseni] Arama "' + query + '" → ' + items.length + ' sonuç');
      return items;
    })
    .catch(function(e) {
      console.log('[FilmEkseni] Arama hata: ' + e.message);
      return [];
    });
}

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);

  var scored = results.map(function(r) {
    var score = 0;
    var nt  = norm(r.title || '');
    var nat = norm(r.akatitle || '');
    var not = norm(r.original_title || '');
    var typ = (r.type || '').toLowerCase();

    // Tür eşleşmesi
    if (mediaType === 'movie' && (typ === 'film' || typ === 'movie')) score += 80;
    if (mediaType === 'tv'    && (typ === 'dizi' || typ === 'series' || typ === 'tv')) score += 80;

    // Başlık eşleşmesi
    if (nt === nTr || nt === nEn)            score += 60;
    else if (nat === nTr || nat === nEn)     score += 55;
    else if (not === nTr || not === nEn)     score += 55;
    else if (nt.indexOf(nTr) !== -1 || nt.indexOf(nEn) !== -1) score += 30;

    // Yıl eşleşmesi
    if (year && r.year && String(r.year) === String(year)) score += 40;

    return { r: r, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });
  if (scored[0].score < 30) return null;
  return scored[0].r;
}

function buildPageUrl(item, mediaType) {
  if (item.href)  return item.href.startsWith('http') ? item.href : MAIN_URL + item.href;
  if (item.link)  return item.link.startsWith('http') ? item.link : MAIN_URL + item.link;
  if (item.slug) {
    var prefix = item.slug_prefix || (mediaType === 'tv' ? 'dizi' : 'film');
    return MAIN_URL + '/' + prefix + '/' + item.slug;
  }
  return null;
}

// ─── EksenLoad Video Extractor ───────────────────────────────
//
// DEX'ten öğrenilen: player URL'i eksenload.site / eksenload.top
// Oynatıcı: jwplayer veya video.js
// CDN: d2.vidload.top

function extractQuality(s) {
  s = (s || '').toLowerCase();
  if (s.indexOf('2160') !== -1 || s.indexOf('4k') !== -1) return '4K';
  if (s.indexOf('1080') !== -1) return '1080p';
  if (s.indexOf('720')  !== -1) return '720p';
  if (s.indexOf('480')  !== -1) return '480p';
  if (s.indexOf('360')  !== -1) return '360p';
  return 'Auto';
}

function extractFromEksenLoad(playerUrl, label, subtitleCallback) {
  var fullUrl = playerUrl.startsWith('//') ? 'https:' + playerUrl : playerUrl;
  var playerHeaders = {
    'User-Agent': HEADERS['User-Agent'],
    'Referer':    MAIN_URL + '/',
    'Accept':     'text/html,application/xhtml+xml,*/*;q=0.8'
  };

  return get(fullUrl, playerHeaders)
    .then(function(html) {
      var streams = [];

      // 1. jwplayer sources dizisi
      var sourcesMatch = html.match(/sources\s*:\s*\[([^\]]+)\]/i);
      if (sourcesMatch) {
        var block = sourcesMatch[1];
        var fileRe = /file\s*:\s*["']([^"']+)["']/g;
        var labelRe = /label\s*:\s*["']([^"']+)["']/g;
        var fileM, labelM;
        var files = [], labels = [];
        while ((fileM = fileRe.exec(block)) !== null)   files.push(fileM[1]);
        while ((labelM = labelRe.exec(block)) !== null) labels.push(labelM[1]);
        files.forEach(function(url, i) {
          if (!url || url.indexOf('http') === -1) return;
          var q = labels[i] ? extractQuality(labels[i]) : extractQuality(url);
          streams.push({
            name:    PROVIDER,
            title:   '⌜ FİLMEKSENİ ⌟ | ' + (label || 'Eksen') + ' | ' + q,
            url:     url,
            quality: q,
            type:    url.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
            headers: { 'Referer': fullUrl, 'User-Agent': HEADERS['User-Agent'] }
          });
        });
        if (streams.length) return streams;
      }

      // 2. Tek file: "..." pattern
      var singleFile = html.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
      if (singleFile) {
        var url = singleFile[1];
        var q   = extractQuality(url);
        streams.push({
          name:    PROVIDER,
          title:   '⌜ FİLMEKSENİ ⌟ | ' + (label || 'Eksen') + ' | ' + q,
          url:     url,
          quality: q,
          type:    url.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
          headers: { 'Referer': fullUrl, 'User-Agent': HEADERS['User-Agent'] }
        });
        return streams;
      }

      // 3. vidload.top / eksenload CDN direkt URL
      var cdnRe = /https?:\/\/(?:d2\.vidload\.top|eksenload\.(?:site|top))\/[^\s"'<>]+/gi;
      var cdnM, seen = {};
      while ((cdnM = cdnRe.exec(html)) !== null) {
        var cdnUrl = cdnM[0];
        if (!seen[cdnUrl] && (cdnUrl.indexOf('.m3u8') !== -1 || cdnUrl.indexOf('.mp4') !== -1)) {
          seen[cdnUrl] = true;
          var q2 = extractQuality(cdnUrl);
          streams.push({
            name:    PROVIDER,
            title:   '⌜ FİLMEKSENİ ⌟ | CDN | ' + q2,
            url:     cdnUrl,
            quality: q2,
            type:    cdnUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
            headers: { 'Referer': fullUrl, 'User-Agent': HEADERS['User-Agent'] }
          });
        }
      }

      // 4. Subtitle / altyazı
      if (streams.length && subtitleCallback) {
        var subRe = /file\s*:\s*["']([^"']+\.(?:srt|vtt))["']/gi;
        var subM;
        while ((subM = subRe.exec(html)) !== null) {
          subtitleCallback({ url: subM[1], lang: 'tur', label: 'Türkçe' });
        }
      }

      return streams;
    })
    .catch(function(e) {
      console.log('[FilmEkseni] EksenLoad hata: ' + e.message);
      return [];
    });
}

// ─── Sayfa parser ─────────────────────────────────────────────
//
// DEX'ten: div.card-video iframe seçici
// Sezon/bölüm: #seasonsTabs-tabContent .tab-pane

function parseIframesFromHtml(html) {
  var iframes = [];
  var re = /<iframe[^>]+(?:data-src|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var src = m[1];
    if (src.indexOf('youtube') !== -1) continue; // fragman atla
    iframes.push(src);
  }
  return iframes;
}

function getIframesFromPage(pageUrl) {
  return get(pageUrl).then(function(html) {
    // Önce div.card-video içinde ara
    var playerBlock = html.match(/<div[^>]+class="[^"]*card-video[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (playerBlock) {
      var iframes = parseIframesFromHtml(playerBlock[1]);
      if (iframes.length) return iframes;
    }
    // Fallback: tüm sayfada ara
    return parseIframesFromHtml(html);
  });
}

// ─── Dizi bölüm URL'i ────────────────────────────────────────
//
// filmekseni.cc dizi URL yapısı (DEX'ten: /season/ paterni):
// Dene: /dizi-adi/sezon-N/bolum-M
// Dene: /dizi-adi/sezon-N-bolum-M
// Dene: sayfadan tab parse

function buildEpisodeUrl(pageUrl, season, episode) {
  var base = pageUrl.replace(/\/$/, '');
  return [
    base + '/sezon-' + season + '/bolum-' + episode,
    base + '/sezon-' + season + '-bolum-' + episode,
    base + '/' + season + '-sezon-' + episode + '-bolum'
  ];
}

function tryEpisodeUrls(urls, index) {
  if (index >= urls.length) return Promise.resolve([]);
  return getIframesFromPage(urls[index])
    .then(function(iframes) {
      if (iframes.length) return iframes;
      return tryEpisodeUrls(urls, index + 1);
    })
    .catch(function() { return tryEpisodeUrls(urls, index + 1); });
}

// ─── Ana akış ─────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      console.log('[FilmEkseni] ' + info.titleTr + ' / ' + info.titleEn + ' (' + info.year + ')');

      var searches = [searchSite(info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) {
        searches.push(searchSite(info.titleEn));
      }

      return Promise.all(searches).then(function(all) {
        var seen = {}, combined = [];
        (all[0] || []).concat(all[1] || []).forEach(function(r) {
          var key = r.postid || r.slug || r.title;
          if (!seen[key]) { seen[key] = true; combined.push(r); }
        });

        var best = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (!best) { console.log('[FilmEkseni] Eşleşme bulunamadı'); return []; }

        var pageUrl = buildPageUrl(best, mediaType);
        if (!pageUrl) return [];
        console.log('[FilmEkseni] Sayfa: ' + pageUrl);

        // Dizi ise bölüm URL'i oluştur
        var iframePromise;
        if (mediaType === 'tv' && season && episode) {
          var epUrls = buildEpisodeUrl(pageUrl, parseInt(season), parseInt(episode));
          iframePromise = tryEpisodeUrls(epUrls, 0);
        } else {
          iframePromise = getIframesFromPage(pageUrl);
        }

        return iframePromise.then(function(iframes) {
          if (!iframes.length) { console.log('[FilmEkseni] iframe bulunamadı'); return []; }
          console.log('[FilmEkseni] ' + iframes.length + ' iframe bulundu');

          var streamPromises = iframes.map(function(src, i) {
            return extractFromEksenLoad(src, 'Kaynak ' + (i + 1), null);
          });

          return Promise.all(streamPromises).then(function(results) {
            var all2 = [], seenUrl = {};
            results.forEach(function(arr) {
              (arr || []).forEach(function(s) {
                if (s && s.url && !seenUrl[s.url]) {
                  seenUrl[s.url] = true;
                  all2.push(s);
                }
              });
            });
            console.log('[FilmEkseni] ' + all2.length + ' stream döndürüldü');
            return all2;
          });
        });
      });
    })
    .catch(function(e) {
      console.error('[FilmEkseni] Hata: ' + (e.message || e));
      return [];
    });
}

// ─── Export ───────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
