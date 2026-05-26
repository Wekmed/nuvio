// ============================================================
//  CizgiMax — Nuvio Provider (watchbuddy.tv API üzerinden)
// ============================================================

var BASE_URL     = 'https://stream.watchbuddy.tv';
var PLUGIN_NAME  = 'CizgiMax';
var PROXY_URL    = 'https://goproxy.watchbuddy.tv';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         BASE_URL + '/'
};

// ── Yardımcı ─────────────────────────────────────────────────

function regexFirst(html, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(html);
  return m ? m[1] : null;
}

function regexAll(html, pattern, flags) {
  var re = new RegExp(pattern, (flags || 's') + 'g');
  var results = [], m;
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

function normalizeStr(s) {
  return (s || '').toLowerCase()
    .replace(/[g]/g,'g').replace(/[u]/g,'u').replace(/[s]/g,'s')
    .replace(/[i]/g,'i').replace(/[o]/g,'o').replace(/[c]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = (mediaType === 'movie') ? 'movie' : 'tv';
  var baseUrl = 'https://api.themoviedb.org/3/' + ep + '/' + tmdbId;

  // TR bilgisi + EN bilgisi + alternatif isimler paralel cek
  return Promise.all([
    fetch(baseUrl + '?api_key=' + TMDB_API_KEY + '&language=tr-TR').then(function(r) { return r.json(); }),
    fetch(baseUrl + '?api_key=' + TMDB_API_KEY + '&language=en-US').then(function(r) { return r.json(); }),
    fetch(baseUrl + '/alternative_titles?api_key=' + TMDB_API_KEY).then(function(r) { return r.json(); }).catch(function() { return {}; })
  ]).then(function(res) {
    var tr = res[0], en = res[1], alt = res[2];

    var titleTr = tr.title || tr.name || '';
    var titleEn = en.title || en.name || '';

    // Alternatif isimler icinden sadece TR ve EN olanlari al
    var altTitles = [];
    var items = alt.titles || alt.results || [];
    items.forEach(function(a) {
      var iso = (a.iso_3166_1 || '').toUpperCase();
      if ((iso === 'TR' || iso === 'US' || iso === 'GB') && a.title) {
        altTitles.push(a.title);
      }
    });

    // titleTr ve titleEn zaten listede varsa tekrar ekleme
    [titleTr, titleEn].forEach(function(t) {
      if (t && altTitles.indexOf(t) === -1) altTitles.unshift(t);
    });

    console.log('[CizgiMax] Basliklar: ' + altTitles.join(' / '));
    return { titleTr: titleTr, titleEn: titleEn, altTitles: altTitles };
  });
}

// ── Arama: watchbuddy /ara/CizgiMax ──────────────────────────

function searchSite(query) {
  var url = BASE_URL + '/ara/' + PLUGIN_NAME
    + '?lang=tr&sorgu=' + encodeURIComponent(query);

  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // watchbuddy aria-label kullanıyor (title degil)
      var matches = regexAll(html, 'href="([^"]+icerik[^"]+)"[^>]*aria-label="([^"]+)"');
      // Fallback: title attribute
      if (!matches.length) {
        matches = regexAll(html, 'class="poster-card[^"]*"[^>]+href="([^"]+)"[^>]+title="([^"]+)"');
      }
      return matches.map(function(m) {
        return {
          url:  decodeHtmlEntities(m[1]),
          name: decodeHtmlEntities(m[2])
        };
      });
    })
    .catch(function() { return []; });
}

function findBestMatch(results, titleEn, titleTr) {
  var nEn = normalizeStr(titleEn), nTr = normalizeStr(titleTr);
  var best = null, bestScore = 0;
  results.forEach(function(r) {
    var ni = normalizeStr(r.name), sc = 0;
    if (ni === nEn || ni === nTr)                                        sc = 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) sc = 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) sc = 60;
    if (sc > bestScore) { bestScore = sc; best = r; }
  });
  return bestScore >= 55 ? best : null;
}

// ── İçerik sayfasından bölüm linkleri ────────────────────────

function fetchContentPage(contentUrl) {
  var encoded = encodeURIComponent(encodeURIComponent(contentUrl));
  var pageUrl = BASE_URL + '/icerik/' + PLUGIN_NAME + '?url=' + encoded;

  return fetch(pageUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var episodeLinks = regexAll(
        html,
        'href="(' + BASE_URL.replace(/\//g,'[/]') + '/izle/' + PLUGIN_NAME + '\\?[^"]*season=(\\d+)[^"]*episode=(\\d+)[^"]*)"'
      );
      return episodeLinks.map(function(m) {
        return {
          watchUrl: decodeHtmlEntities(m[1]),
          season:   parseInt(m[2]),
          episode:  parseInt(m[3])
        };
      });
    })
    .catch(function() { return []; });
}

// ── Stream URL'lerini çek ─────────────────────────────────────

function fetchStreams(watchUrl) {
  return fetch(watchUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];

      // 1. data-url attribute (ham HTML'de stream URL burada)
      // <... data-url="https://cizgimax.online/api/stream/sibnet/?t=TOKEN" data-referer="...">
      var dataUrl = regexFirst(html, 'data-url="(https://cizgimax\\.online/api/stream/[^"]+)"');
      if (dataUrl) {
        var dataRef = regexFirst(html, 'data-referer="([^"]+)"') || 'https://cizgimax.online/';
        var proxyStream = PROXY_URL + '/proxy/video?url='
          + encodeURIComponent(dataUrl)
          + '&referer=' + encodeURIComponent(dataRef);
        results.push({
          name:    'CizgiMax',
          title:   'CizgiMax | Turkce Dublaj',
          url:     proxyStream,
          quality: 'Auto',
          headers: { 'Referer': dataRef, 'User-Agent': HEADERS['User-Agent'] }
        });
      }

      // 2. <video src="https://goproxy..."> (JS render sonrasi)
      if (!results.length) {
        var videoSrc = regexFirst(html, '<video[^>]+src="(https://goproxy\\.watchbuddy\\.tv/proxy/video[^"]+)"');
        if (videoSrc) {
          var cleanSrc = videoSrc.replace(/&amp;/g, '&');
          var refM = /[?&]referer=([^&]+)/.exec(cleanSrc);
          var ref  = refM ? decodeURIComponent(refM[1]) : 'https://cizgimax.online/';
          results.push({
            name:    'CizgiMax',
            title:   'CizgiMax | Turkce Dublaj',
            url:     cleanSrc,
            quality: 'Auto',
            headers: { 'Referer': ref, 'User-Agent': HEADERS['User-Agent'] }
          });
        }
      }

      console.log('[CizgiMax] ' + results.length + ' stream: ' + watchUrl.slice(0, 80));
      return results;
    })
    .catch(function(e) {
      console.log('[CizgiMax] Stream hata: ' + (e.message || String(e)));
      return [];
    });
}

// ── Bolum izle URL olustur ────────────────────────────────────
// contentUrl: https://cizgimax.online/diziler/boyster-izle/
// bolumUrl:   https://cizgimax.online/boyster-1-sezon-1-bolum-izle/

function buildWatchUrl(contentUrl, season, episode, title) {
  var slugMatch = contentUrl.match(/\/diziler\/(.+?)-izle\//);
  if (!slugMatch) return null;
  var slug     = slugMatch[1];
  var bolumUrl = 'https://cizgimax.online/' + slug
    + '-' + season + '-sezon-' + episode + '-bolum-izle/';

  return BASE_URL + '/izle/' + PLUGIN_NAME
    + '?url=' + encodeURIComponent(encodeURIComponent(bolumUrl))
    + '&baslik=' + encodeURIComponent(title || slug)
    + '&season=' + season
    + '&episode=' + episode;
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var sNum = parseInt(seasonNum)  || 1;
  var eNum = parseInt(episodeNum) || 1;

  console.log('[CizgiMax] Baslatiliyor: tmdb=' + tmdbId
    + ' tip=' + mediaType + ' S' + sNum + 'E' + eNum);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var titleEn = info.titleEn, titleTr = info.titleTr;
      console.log('[CizgiMax] TMDB: ' + titleEn + ' / ' + titleTr);

      if (!titleEn && !titleTr) {
        console.log('[CizgiMax] TMDB baslik bos');
        return [];
      }

      // altTitles listesindeki her isimle sırayla ara, ilk eslesende dur
      var altTitles = info.altTitles || [titleEn, titleTr].filter(Boolean);
      var seen = {};
      var uniqueTitles = altTitles.filter(function(t) {
        if (!t || seen[t]) return false;
        seen[t] = true;
        return true;
      });

      return uniqueTitles.reduce(function(chain, query) {
        return chain.then(function(best) {
          if (best) return best;
          return searchSite(query).then(function(results) {
            console.log('[CizgiMax] Arama (' + query + '): ' + results.length + ' sonuc');
            return findBestMatch(results, titleEn, titleTr);
          });
        });
      }, Promise.resolve(null))
        .then(function(best) {
          if (!best) {
            console.log('[CizgiMax] Eslesme bulunamadi: ' + (titleEn || titleTr));
            return [];
          }
          console.log('[CizgiMax] Eslesti: ' + best.name + ' -> ' + best.url);

          // Icerik URL decode
          var contentUrl;
          var urlParam = /[?&]url=([^&]+)/.exec(best.url);
          if (urlParam) {
            try { contentUrl = decodeURIComponent(decodeURIComponent(urlParam[1])); }
            catch(e) {
              try { contentUrl = decodeURIComponent(urlParam[1]); }
              catch(e2) { contentUrl = urlParam[1]; }
            }
          }

          if (!contentUrl) {
            console.log('[CizgiMax] Icerik URL parse hatasi');
            return [];
          }

          console.log('[CizgiMax] Icerik URL: ' + contentUrl);

          if (mediaType === 'movie') {
            var movieWatchUrl = BASE_URL + '/izle/' + PLUGIN_NAME
              + '?url=' + encodeURIComponent(encodeURIComponent(contentUrl))
              + '&baslik=' + encodeURIComponent(best.name);
            return fetchStreams(movieWatchUrl);
          }

          // Dizi: once buildWatchUrl dene, olmassa icerik sayfasindan bul
          var watchUrl = buildWatchUrl(contentUrl, sNum, eNum, best.name);
          if (watchUrl) {
            console.log('[CizgiMax] Bolum URL: ' + watchUrl.slice(0, 100));
            return fetchStreams(watchUrl);
          }

          // Fallback: icerik sayfasindan bolum linkini bul
          return fetchContentPage(contentUrl)
            .then(function(episodes) {
              console.log('[CizgiMax] Icerik sayfasi: ' + episodes.length + ' bolum');
              var ep = null;
              episodes.forEach(function(e) {
                if (e.season === sNum && e.episode === eNum) ep = e;
              });
              if (!ep) {
                console.log('[CizgiMax] S' + sNum + 'E' + eNum + ' bulunamadi');
                return [];
              }
              return fetchStreams(ep.watchUrl);
            });
        });
    })
    .catch(function(err) {
      console.log('[CizgiMax] Hata: ' + (err.message || String(err)));
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
