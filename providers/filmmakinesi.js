// ============================================================
//  FilmMakinesi — Nuvio Provider v2
//  Gerçek HTML analizine göre yeniden yazıldı:
//
//  Buton yapısı:
//    <a data-video_url="https://closeload.filmmakinesi.to/...">Tek Close</a>
//    <a data-video_url="https://rapid.filmmakinesi.to/embed-ID/">Dual Rapid</a>
//
//  Extractor tespiti URL'den yapılıyor (buton adından değil):
//    closeload.filmmakinesi.to → SKIP
//    rapid.filmmakinesi.to     → RapidVid extractor (KekikStream RapidVid.py)
//    kentfilmizle.xyz          → KentFilm extractor
//    filmizle.in / filmdefilm  → PlayerFilmIzle extractor
// ============================================================

var BASE_URL     = 'https://filmmakinesi.to';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';
var UA           = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

var HEADERS = {
  'User-Agent':     UA,
  'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'tr-TR,tr;q=0.9,en-US;q=0.8',
  'Referer':        BASE_URL + '/'
};

// ── Yardımcı ─────────────────────────────────────────────────

function decodeHtml(s) {
  if (!s) return '';
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').trim();
}

function fixUrl(u) {
  if (!u) return '';
  u = String(u).replace(/\\\\/g,'').replace(/\\/g,'');
  if (u.startsWith('http')) return u;
  if (u.startsWith('//'))   return 'https:' + u;
  return BASE_URL + (u.startsWith('/') ? '' : '/') + u;
}

function rx(text, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(text);
  return m ? m[1] : null;
}

function rxAll(text, pattern, flags) {
  var re = new RegExp(pattern, (flags || '') + 'g'), out = [], m;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

function getOrigin(url) {
  try { var u = new URL(url); return u.protocol + '//' + u.host; }
  catch(e) { return BASE_URL; }
}

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/movie/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title          || '',
        titleEn: d.original_title || '',
        year:   (d.release_date   || '').slice(0,4)
      };
    });
}

// ── Arama ────────────────────────────────────────────────────

function normalize(s) {
  return (s||'').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ıi]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function searchFilmMakinesi(query) {
  return fetch(BASE_URL + '/arama/?s=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      var re = /<div[^>]+class="[^"]*item-relative[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*item-relative|<\/section|$)/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        var block  = m[1];
        var title  = rx(block, /<div[^>]+class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        var href   = rx(block, /href="([^"]+)"/);
        var poster = rx(block, /data-src="([^"]+)"/) || rx(block, /src="([^"]+\.(?:jpg|png|webp)[^"]*)"/);
        if (title && href) results.push({ title: decodeHtml(title), href: fixUrl(href), poster: poster ? fixUrl(poster) : null });
      }
      return results;
    })
    .catch(function() { return []; });
}

function findBest(results, en, tr, year) {
  var nEn = normalize(en), nTr = normalize(tr);
  var scored = results.map(function(r) {
    var ni = normalize(r.title), score = 0;
    if (ni === nEn || ni === nTr)                                     score += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) score += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) score += 60;
    if (year && r.href && r.href.indexOf(year) !== -1)                score += 10;
    return { r:r, score:score };
  });
  scored.sort(function(a,b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 55) ? scored[0].r : null;
}

// ── URL bazlı kaynak tipi tespiti ────────────────────────────
// Buton adına BAKMIYORUZ — URL'den tespit ediyoruz
// Gerçek HTML: "Tek Close" → closeload.filmmakinesi.to
//              "Dual Rapid" → rapid.filmmakinesi.to

var SKIP_URL_DOMAINS = [
  'closeload',    // CloseLoad — hls8.playmix.uno master.txt şifreli format
  'dosyaload',
  'mixdrop',
  'dood',
  'streamtape',
  'uqload',
  'mp4upload',
  'yourupload',
  'filemoon',
];

function getSourceType(videoUrl) {
  if (SKIP_URL_DOMAINS.some(function(d) { return videoUrl.indexOf(d) !== -1; }))
    return 'SKIP';
  if (videoUrl.indexOf('rapid.filmmakinesi.to') !== -1 || videoUrl.indexOf('rapidvid.net') !== -1)
    return 'RAPIDVID';
  if (videoUrl.indexOf('kentfilmizle') !== -1)
    return 'KENTFILM';
  if (['filmizle.in','filmdefilm','filmpablo'].some(function(d) { return videoUrl.indexOf(d) !== -1; }))
    return 'PLAYERFILMIZLE';
  return 'UNKNOWN';
}

// ── RapidVid extractor ────────────────────────────────────────
// KekikStream RapidVid.py portu
// supported_domains: rapidvid.net, rapid.filmmakinesi.to
// 3 yöntem: HexCodec → av('...') decode → Packer unpack

function decodeRapidSecret(encoded) {
  try {
    var rev  = encoded.split('').reverse().join('');
    var dec1 = atob(rev);
    var key  = 'K9L', out = '';
    for (var i = 0; i < dec1.length; i++)
      out += String.fromCharCode(dec1.charCodeAt(i) - ((key[i % key.length].charCodeAt(0) % 5) + 1));
    var result = atob(out);
    return result.startsWith('http') ? result : null;
  } catch(e) { return null; }
}

function decodeHex(hex) {
  try {
    var c = hex.replace(/[^0-9a-fA-F]/g,''), out = '';
    for (var i = 0; i < c.length; i += 2)
      out += String.fromCharCode(parseInt(c.substr(i,2),16));
    return out.startsWith('http') ? out : null;
  } catch(e) { return null; }
}

function extractRapidVid(url, label) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // Altyazılar: captions","file":"URL","label":"LANG"
    var subs = [];
    rxAll(html, 'captions","file":"([^"]+)","label":"([^"]+)"').forEach(function(m) {
      subs.push({ url: m[1].replace(/\\/g,''), name: m[2] });
    });

    var videoUrl = null;

    // Yöntem 1: HexCodec — file": "HEXDATA",
    var hexData = rx(html, /file"\s*:\s*"([0-9a-fA-F]{20,})"\s*,/);
    if (hexData) videoUrl = decodeHex(hexData);

    // Yöntem 2: av('...') — base64 + K9L key shift
    if (!videoUrl) {
      var avData = rx(html, /av\('([^']+)'\)/);
      if (avData) videoUrl = decodeRapidSecret(avData);
    }

    // Yöntem 3: Packed JS → m3u8 direkt
    if (!videoUrl) {
      var ev = html.match(/eval\(function\(p,a,c,k,e,[dr]\)([\s\S]+?)\)\s*;/);
      if (ev) {
        var um = ev[0].match(/(https?:[^\s"'\\]+\.m3u8[^\s"'\\]*)/);
        if (um) videoUrl = um[1];
      }
    }

    // Yöntem 4: direkt m3u8
    if (!videoUrl) {
      videoUrl = rx(html, /file\s*:\s*["'](https?[^"']+\.m3u8[^"']*)["']/);
    }

    if (!videoUrl) {
      console.log('[FilmMakinesi] RapidVid decode başarısız: ' + url);
      return null;
    }

    console.log('[FilmMakinesi] RapidVid OK: ' + label);
    return {
      name:      'FilmMakinesi',
      title:     '⌜ FİLMMAKİNESİ ⌟ | ' + label,
      url:       videoUrl,
      quality:   'Auto',
      headers:   {
        'User-Agent': UA,
        'Referer':    getOrigin(url) + '/'
      },
      subtitles: subs
    };
  })
  .catch(function(e) {
    console.log('[FilmMakinesi] RapidVid hata: ' + e);
    return null;
  });
}

// ── KentFilm extractor ────────────────────────────────────────
// FirePlayer(id, {videoUrl, videoServer, videoDisk}, false)

function extractKentFilm(url, label) {
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var jsonStr = rx(html, /FirePlayer\s*\(\s*[^,]+\s*,\s*(\{.*?\})\s*,\s*false\s*\)/)
               || rx(html, /FirePlayer\s*\(\s*[^,]+\s*,\s*(\{.*?\})\s*,/);
    if (!jsonStr) return null;

    var videoUrl    = rx(jsonStr, /"videoUrl"\s*:\s*"([^"]+)"/);
    var videoServer = rx(jsonStr, /"videoServer"\s*:\s*"([^"]+)"/);
    var videoDisk   = rx(jsonStr, /"videoDisk"\s*:\s*"([^"]+)"/);
    if (!videoUrl) return null;

    videoUrl = videoUrl.replace(/\\\//g,'/');
    if (videoUrl.startsWith('/')) videoUrl = 'https://kentfilmizle.xyz' + videoUrl;
    if (videoServer) videoUrl += '?s=' + videoServer + '&d=' + (videoDisk || '');

    return {
      name:    'FilmMakinesi',
      title:   '⌜ FİLMMAKİNESİ ⌟ | ' + label,
      url:     videoUrl,
      quality: 'Auto',
      headers: { 'Referer': url, 'User-Agent': UA }
    };
  })
  .catch(function() { return null; });
}

// ── PlayerFilmIzle extractor ──────────────────────────────────
// FirePlayer("HASH") → POST /player/index.php?data=HASH&do=getVideo → securedLink

function extractPlayerFilmIzle(url, label) {
  var origin = getOrigin(url);
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // Altyazı
    var subs = [];
    var rawSubs = rx(html, /playerjsSubtitle\s*=\s*"([^"]*)"/);
    if (rawSubs) {
      rxAll(rawSubs, /\[(.*?)\](https?:\/\/[^\s",]+)/).forEach(function(m) {
        subs.push({ name: m[1].trim(), url: m[2].trim() });
      });
    }

    // Hash bul (packed veya düz)
    var dataVal = rx(html, /FirePlayer\s*\(\s*["']([a-f0-9A-F]+)["']/);
    if (!dataVal) {
      var ev = html.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)([\s\S]+?)\)\s*;/);
      if (ev) {
        try {
          var packed = ev[0];
          var arr    = packed.match(/'([^']+)'\s*\.split\('\|'\)/);
          if (arr) {
            var tokens  = arr[1].split('|');
            var content = packed;
            tokens.forEach(function(t, i) { if (t) content = content.replace(new RegExp('\\b' + i + '\\b', 'g'), t); });
            dataVal = rx(content, /FirePlayer\s*\(\s*["']([a-f0-9A-F]+)["']/);
          }
        } catch(e) {}
      }
    }
    if (!dataVal) return null;

    return fetch(origin + '/player/index.php?data=' + dataVal + '&do=getVideo', {
      method:  'POST',
      headers: {
        'Content-Type':     'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer':           url,
        'User-Agent':        UA
      },
      body: 'hash=' + encodeURIComponent(dataVal) + '&r=' + encodeURIComponent(BASE_URL + '/')
    })
    .then(function(r) { return r.text(); })
    .then(function(resp) {
      var m3u8 = rx(resp, /"securedLink"\s*:\s*"([^"]+)"/)
              || rx(resp, /["']file["']\s*:\s*["'](https?[^"']+\.m3u8[^"']*)["']/);
      if (!m3u8) return null;
      return {
        name:      'FilmMakinesi',
        title:     '⌜ FİLMMAKİNESİ ⌟ | ' + label,
        url:       m3u8.replace(/\\\//g,'/').replace(/\\/g,''),
        quality:   'Auto',
        headers:   { 'Referer': url, 'User-Agent': UA },
        subtitles: subs
      };
    });
  })
  .catch(function() { return null; });
}

// ── Film sayfasından stream'leri topla ───────────────────────

function fetchPageStreams(pageUrl) {
  return fetch(pageUrl, { headers: HEADERS })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // data-video_url butonlarını topla
    var tasks = [];
    var btnRe = /<a[^>]+data-video_url="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = btnRe.exec(html)) !== null) {
      var videoUrl = m[1];
      var rawLabel = m[2].replace(/<[^>]+>/g,'').trim();
      var type     = getSourceType(videoUrl);

      if (type === 'SKIP') {
        console.log('[FilmMakinesi] Skip: ' + videoUrl.slice(0,50));
        continue;
      }
      tasks.push({ url: fixUrl(videoUrl), label: rawLabel, type: type });
    }

    // video-parts yoksa iframe data-src dene
    if (!tasks.length) {
      var iframeSrc = rx(html, /<iframe[^>]+data-src="([^"]+)"/);
      if (iframeSrc) {
        var type = getSourceType(iframeSrc);
        if (type !== 'SKIP') tasks.push({ url: fixUrl(iframeSrc), label: 'Video', type: type });
      }
    }

    if (!tasks.length) return [];

    // Paralel işle
    var results = [], idx = 0;
    function next() {
      if (idx >= tasks.length) return Promise.resolve();
      var t = tasks[idx++];
      var promise;

      switch(t.type) {
        case 'RAPIDVID':       promise = extractRapidVid(t.url, t.label);        break;
        case 'KENTFILM':       promise = extractKentFilm(t.url, t.label);        break;
        case 'PLAYERFILMIZLE': promise = extractPlayerFilmIzle(t.url, t.label); break;
        default:
          // Bilinmeyen — RapidVid dene, olmaz KentFilm
          promise = extractRapidVid(t.url, t.label).then(function(r) {
            return r || extractKentFilm(t.url, t.label);
          });
      }

      return promise.then(function(r) {
        if (r) results.push(r);
        return next();
      });
    }

    var workers = [];
    for (var i = 0; i < Math.min(4, tasks.length); i++) workers.push(next());
    return Promise.all(workers).then(function() { return results; });
  })
  .catch(function() { return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'movie') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      return searchFilmMakinesi(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBest(results, info.titleEn, info.titleTr, info.year);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchFilmMakinesi(info.titleTr).then(function(r2) {
              return findBest(r2, info.titleEn, info.titleTr, info.year);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) { console.log('[FilmMakinesi] Bulunamadı: ' + info.titleEn); return []; }
          console.log('[FilmMakinesi] Eşleşti: ' + best.title);
          return fetchPageStreams(best.href);
        });
    })
    .catch(function(e) {
      console.error('[FilmMakinesi] Hata: ' + e);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
