// ============================================================
//  FilmModu — Nuvio Provider
//  Sadece Film (movie) destekler
// ============================================================

var BASE_URL = 'https://www.filmmodu.one';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── Kalite filtresi: sadece 1080p ve üzeri ───────────────────
function isHighQuality(label) {
  if (!label) return false;
  var l = String(label).toLowerCase().replace(/\s/g, '');
  // 4K, 2160p, 1440p, 1080p geçenler kabul
  if (l.indexOf('4k') !== -1 || l.indexOf('2160') !== -1) return true;
  if (l.indexOf('1440') !== -1) return true;
  if (l.indexOf('1080') !== -1) return true;
  // Sayısal px değeri varsa karşılaştır
  var num = parseInt(l);
  if (!isNaN(num) && num >= 1080) return true;
  return false;
}

// ── TMDB Verisi ──────────────────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  var url = 'https://api.themoviedb.org/3/movie/' + tmdbId
    + '?api_key=' + TMDB_API_KEY
    + '&language=tr-TR';

  return fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB yanıt vermedi: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr:  data.title || '',
        titleEn:  data.original_title || '',
        year:     data.release_date ? data.release_date.slice(0, 4) : ''
      };
    });
}

// ── Normalize ────────────────────────────────────────────────
function normalizeForUrl(str) {
  return str
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

// ── En iyi eşleşme — skor bazlı ──────────────────────────────
function normalizeStr(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBestMatch(results, titleEn, titleTr, year) {
  var nEn = normalizeStr(titleEn);
  var nTr = normalizeStr(titleTr);

  var scored = results.map(function(r) {
    var score = 0;
    var nHref = normalizeStr(r.href);
    var nText = normalizeStr(r.text);

    // Başlık tam eşleşmesi (href içinde)
    if (nEn && nHref.indexOf(nEn) !== -1) score += 100;
    else if (nTr && nHref.indexOf(nTr) !== -1) score += 100;
    // Başlık kelime bazlı eşleşme
    else if (nEn) {
      var words = nEn.split(' ').filter(function(w) { return w.length > 2; });
      var matched = words.filter(function(w) { return nHref.indexOf(w) !== -1; }).length;
      score += Math.floor(matched / words.length * 60);
    }

    // Text eşleşmesi
    if (nEn && nText === nEn) score += 50;
    else if (nTr && nText === nTr) score += 50;

    // Yıl eşleşmesi — kritik
    if (year && r.href.indexOf(year) !== -1) score += 80;
    else if (year) score -= 50; // Yanlış yıl büyük ceza

    return { r: r, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });

  // En az 50 puan olan ilk sonucu döndür
  if (scored.length && scored[0].score >= 50) return scored[0].r.href;
  return null;
}

// ── FilmModu'nda arama ───────────────────────────────────────
function searchFilmModu(info) {
  var title    = info.titleEn || info.titleTr;
  var year     = info.year;
  var searchUrl = BASE_URL + '/film-ara?term=' + encodeURIComponent(title);

  return fetch(searchUrl, { headers: HEADERS, redirect: 'follow' })
    .then(function(r) {
      if (!r.ok) throw new Error('Arama başarısız: ' + r.status);
      var finalUrl = r.url;
      if (finalUrl && finalUrl !== searchUrl && finalUrl.indexOf('/film-ara') === -1) {
        return { redirectUrl: finalUrl, html: null };
      }
      return r.text().then(function(html) { return { redirectUrl: null, html: html }; });
    })
    .then(function(result) {
      if (result.redirectUrl) return result.redirectUrl;

      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(result.html);

      if ($('div.alternates').length > 0) {
        var canonical = $('link[rel="canonical"]').attr('href') || '';
        if (canonical) return canonical;
        return searchUrl;
      }

      var results = [];
      $('div.movie').each(function() {
        var a    = $(this).find('a').first();
        var href = a.attr('href') || '';
        var text = a.text().trim();
        if (href) results.push({ href: href, text: text });
      });

      if (results.length === 0) return null;
      return findBestMatch(results, info.titleEn, info.titleTr, year);
    });
}

// ── Film sayfasından kaynak linklerini çek ───────────────────
function fetchAlternateLinks(filmUrl) {
  return fetch(filmUrl, { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('Film sayfası yüklenemedi: ' + r.status);
      return r.text();
    })
    .then(function(html) {
      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(html);
      var links = [];

      $('div.alternates a').each(function() {
        var href = $(this).attr('href') || '';
        var name = $(this).text().trim();
        // Fragman hariç hepsini al (Türkçe Altyazılı dahil)
        if (name && name !== 'Fragman' && href) {
          links.push({ href: href, name: name });
        }
      });

      return links;
    });
}

// ── Tek bir kaynak linkinden stream çek ──────────────────────
function fetchStreamsFromAlt(altLink, filmUrl, movieTitle) {
  var altHeaders = Object.assign({}, HEADERS, { 'Referer': filmUrl });

  return fetch(altLink.href, { headers: altHeaders })
    .then(function(r) {
      if (!r.ok) return [];
      return r.text();
    })
    .then(function(altHtml) {
      var videoIdMatch   = altHtml.match(/var videoId\s*=\s*'([^']+)'/);
      var videoTypeMatch = altHtml.match(/var videoType\s*=\s*'([^']+)'/);

      if (!videoIdMatch || !videoTypeMatch) return [];

      var videoId   = videoIdMatch[1];
      var videoType = videoTypeMatch[1];
      var sourceUrl = BASE_URL + '/get-source?movie_id=' + videoId + '&type=' + videoType;

      var sourceHeaders = Object.assign({}, HEADERS, {
        'Referer':          altLink.href,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*'
      });

      return fetch(sourceUrl, { headers: sourceHeaders })
        .then(function(r) {
          if (!r.ok) return [];
          return r.json();
        })
        .then(function(data) {
          var streams = [];

          if (!data || !data.sources || data.sources.length === 0) return streams;

          var subtitleUrl = null;
          if (data.subtitle) {
            subtitleUrl = data.subtitle.startsWith('http')
              ? data.subtitle
              : BASE_URL + data.subtitle;
          }

          data.sources.forEach(function(source) {
            if (!source.src) return;

            // Kalite etiketi
            var qualityLabel = source.label || (source.res ? (source.res + 'p') : 'HD');

            // 1080p altını filtrele
            if (!isHighQuality(qualityLabel)) return;

            var srcUrl = source.src;
            if (srcUrl.indexOf('.m3u8') === -1) srcUrl = srcUrl + '.m3u8';

            var streamObj = {
              name:  movieTitle,
              title: '⌜ FILMMODU ⌟ | ' + altLink.name + ' | ' + qualityLabel,
              url:   srcUrl,
              behaviorHints: {
                notWebReady:  true,
                proxyHeaders: {
                  request: {
                    'Referer':    BASE_URL + '/',
                    'User-Agent': HEADERS['User-Agent']
                  }
                }
              }
            };
            if (subtitleUrl) {
              streamObj.subtitles = [{
                id:   'sub_tr_0',
                url:  subtitleUrl,
                lang: 'tur'
              }];
            }
            streams.push(streamObj);
          });
          return streams;
        })
        .catch(function() { return []; });
    })
    .catch(function() { return []; });
}

// ── Ana fonksiyon ────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'movie') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      var movieTitle = info.titleTr || info.titleEn;

      // Önce İngilizce başlıkla ara, bulamazsa Türkçe ile
      return searchFilmModu(info)
        .then(function(filmUrl) {
          if (!filmUrl && info.titleTr && info.titleTr !== info.titleEn) {
            return searchFilmModu({ titleEn: info.titleTr, titleTr: info.titleEn, year: info.year });
          }
          return filmUrl;
        })
        .then(function(filmUrl) {
          if (!filmUrl) return [];

          return fetchAlternateLinks(filmUrl)
            .then(function(altLinks) {
              if (altLinks.length === 0) return [];

              var promises = altLinks.map(function(alt) {
                return fetchStreamsFromAlt(alt, filmUrl, movieTitle);
              });

              return Promise.all(promises).then(function(results) {
                var allStreams = [];
                results.forEach(function(arr) {
                  if (arr && arr.length > 0) {
                    arr.forEach(function(s) { allStreams.push(s); });
                  }
                });
                return allStreams;
              });
            });
        });
    })
    .catch(function() { return []; });
}

// ── Export ───────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
