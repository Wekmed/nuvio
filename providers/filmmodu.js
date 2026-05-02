// ============================================================
//  FilmModu — Nuvio Provider
//  - console.log yok
//  - 1080p altı kaliteler gösterilmez (720p, 480p vb.)
//  - UI formatı: name=film adı, title=⌜FILMMODU⌟|kaynak|dil
// ============================================================

var BASE_URL     = 'https://www.filmmodu.one';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':       BASE_URL + '/'
};

function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/movie/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || '',
        titleEn: d.original_title || '',
        year:    (d.release_date || '').slice(0, 4)
      };
    });
}

function normalizeForUrl(str) {
  return (str || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,'');
}

function findBestMatch(results, searchTitle, year) {
  var ns = normalizeForUrl(searchTitle);
  if (year) {
    for (var i = 0; i < results.length; i++) {
      if (normalizeForUrl(results[i].href).indexOf(ns) !== -1 && results[i].href.indexOf(year) !== -1)
        return results[i].href;
    }
  }
  for (var j = 0; j < results.length; j++) {
    if (normalizeForUrl(results[j].href).indexOf(ns) !== -1) return results[j].href;
  }
  if (year) {
    for (var k = 0; k < results.length; k++) {
      if (results[k].href.indexOf(year) !== -1) return results[k].href;
    }
  }
  return null;
}

function searchFilmModu(title, year) {
  var searchUrl = BASE_URL + '/film-ara?term=' + encodeURIComponent(title);
  return fetch(searchUrl, { headers: HEADERS, redirect: 'follow' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
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
        return $('link[rel="canonical"]').attr('href') || searchUrl;
      }
      var results = [];
      $('div.movie').each(function() {
        var href = $(this).find('a').first().attr('href') || '';
        if (href) results.push({ href: href });
      });
      if (!results.length) return null;
      return findBestMatch(results, title, year);
    })
    .catch(function() { return null; });
}

function fetchAlternateLinks(filmUrl) {
  return fetch(filmUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(html);
      var links = [];
      $('div.alternates a').each(function() {
        var href = $(this).attr('href') || '';
        var name = $(this).text().trim();
        if (name && name !== 'Fragman' && name !== 'Türkçe Altyazılı' && href) {
          links.push({ href: href, name: name });
        }
      });
      return links;
    })
    .catch(function() { return []; });
}

// Kalite string'inden pixel genişliği tahmin et
function qualityToPx(label) {
  if (!label) return 0;
  var l = label.toLowerCase();
  if (l.indexOf('4k') !== -1 || l.indexOf('2160') !== -1) return 2160;
  if (l.indexOf('1440') !== -1) return 1440;
  if (l.indexOf('1080') !== -1) return 1080;
  if (l.indexOf('720') !== -1)  return 720;
  if (l.indexOf('480') !== -1)  return 480;
  if (l.indexOf('360') !== -1)  return 360;
  return 0;
}

function fetchStreamsFromAlt(altLink, filmUrl, movieName) {
  return fetch(altLink.href, { headers: Object.assign({}, HEADERS, { 'Referer': filmUrl }) })
    .then(function(r) { return r.ok ? r.text() : ''; })
    .then(function(html) {
      var videoIdM   = html.match(/var videoId\s*=\s*'([^']+)'/);
      var videoTypeM = html.match(/var videoType\s*=\s*'([^']+)'/);
      if (!videoIdM || !videoTypeM) return [];

      var sourceUrl = BASE_URL + '/get-source?movie_id=' + videoIdM[1] + '&type=' + videoTypeM[1];
      return fetch(sourceUrl, {
        headers: Object.assign({}, HEADERS, {
          'Referer':          altLink.href,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept':           'application/json, text/javascript, */*'
        })
      })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data || !data.sources || !data.sources.length) return [];

          var subtitleUrl = null;
          if (data.subtitle) {
            subtitleUrl = data.subtitle.startsWith('http') ? data.subtitle : BASE_URL + data.subtitle;
          }

          var streams = [];
          data.sources.forEach(function(source) {
            if (!source.src) return;

            var qualityLabel = source.label || (source.res ? source.res + 'p' : 'HD');

            // 1080p altını atla
            var px = qualityToPx(qualityLabel);
            if (px > 0 && px < 1080) return;

            var srcUrl = source.src;
            if (srcUrl.indexOf('.m3u8') === -1) srcUrl += '.m3u8';

            var flag = altLink.name.toLowerCase().indexOf('dublaj') !== -1 ? '🇹🇷 ' : '🌐 ';
            var streamObj = {
              name:    movieName,
              title:   '⌜ FILMMODU ⌟ | ' + altLink.name + ' | ' + flag + qualityLabel,
              url:     srcUrl,
              quality: qualityLabel,
              type:    'hls',
              headers: { 'Referer': BASE_URL + '/', 'User-Agent': HEADERS['User-Agent'] }
            };
            if (subtitleUrl) {
              streamObj.subtitles = [{ url: subtitleUrl, language: 'Türkçe', label: 'Türkçe' }];
            }
            streams.push(streamObj);
          });
          return streams;
        })
        .catch(function() { return []; });
    })
    .catch(function() { return []; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'movie') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
      var movieName = info.titleTr || info.titleEn;

      // EN ve TR aramaları paralel
      var searches = [searchFilmModu(info.titleEn, info.year)];
      if (info.titleTr && info.titleTr !== info.titleEn)
        searches.push(searchFilmModu(info.titleTr, info.year));

      return Promise.all(searches)
        .then(function(urls) { return urls[0] || urls[1] || null; })
        .then(function(filmUrl) {
          if (!filmUrl) return [];
          return fetchAlternateLinks(filmUrl)
            .then(function(altLinks) {
              if (!altLinks.length) return [];
              return Promise.all(altLinks.map(function(alt) {
                return fetchStreamsFromAlt(alt, filmUrl, movieName);
              })).then(function(results) {
                var all = [];
                results.forEach(function(arr) { if (arr) arr.forEach(function(s) { all.push(s); }); });
                return all;
              });
            });
        });
    })
    .catch(function() { return []; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
