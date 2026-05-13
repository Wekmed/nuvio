// ============================================================
//  HDFilmCehennemi — Nuvio Provider
//
//  Kaynaklar:
//   - Close  : /video/{id}/ → embed → dc_ decode → CDN master.txt
//   - Rapidrame: /video/{id}/ → /rplayer/{rapId}/ → _extract_video_url
//
//  Düzeltmeler (V5 → bu versiyon):
//   ✓ authority: www.hdfilmcehennemi.pro header → search JSON döner
//   ✓ dc_ decode sırası: ROT13 → base64 → reverse → unmix (V5'te reverse/base64 ters)
//   ✓ subtitles: [] (undefined değil) → VTT Nuvio'da görünür
//   ✓ Rapidrame: /rplayer/{id}/ invoke_local_source entegre edildi
//   ✓ master.txt headers: Referer + Origin → source error düzeltildi
//   ✓ CDN fallback: 1-2500 arası sayı ile tek istek (dc_ başarısızsa)
// ============================================================

var TMDB_API_KEY   = '500330721680edb6d5f7f12ba7cd9023';
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';
var EMBED_DOMAIN   = 'https://hdfilmcehennemi.mobi';

var FALLBACK_DOMAINS = [
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.ws'
];

// CDN fallback için kullanılır (dc_ başarısız olursa)
// cdnimages[1-2500].shop → hepsi çalışıyor, 12 hosttan oluşan temsili liste
var CDN_HOSTS = [
  'https://srv12.cdnimages1132.shop',
  'https://srv12.cdnimages1397.shop',
  'https://srv12.cdnimages1128.shop',
  'https://srv12.cdnimages784.shop',
  'https://srv12.cdnimages965.shop',
  'https://srv12.cdnimages96.shop',
  'https://srv12.cdnimages403.shop',
  'https://srv1.cdnimages391.shop',
  'https://srv2.cdnimages391.shop',
  'https://srv3.cdnimages391.shop',
  'https://cdn1.cdnimages1128.shop',
  'https://srv10.cdnimages1128.shop'
];

var ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36';

// ── Header setleri ────────────────────────────────────────────

var PAGE_HEADERS = {
  'User-Agent':      ANDROID_UA,
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Upgrade-Insecure-Requests': '1'
};

// "authority: www.hdfilmcehennemi.pro" → CF bypass, search JSON döner
var SEARCH_HEADERS = {
  'User-Agent':       ANDROID_UA,
  'Accept':           '*/*',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'Content-Type':     'application/json',
  'X-Requested-With': 'fetch',
  'authority':        'www.hdfilmcehennemi.pro',
  'Sec-Fetch-Dest':   'empty',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin'
};

var VIDEO_API_HEADERS = {
  'User-Agent':       ANDROID_UA,
  'Accept':           '*/*',
  'Content-Type':     'application/json',
  'X-Requested-With': 'fetch'
};

var EMBED_HEADERS = {
  'User-Agent':               ANDROID_UA,
  'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':          'tr-TR,tr;q=0.9',
  'Sec-Ch-Ua':                '"Chromium";v="134", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile':         '?1',
  'Sec-Ch-Ua-Platform':       '"Android"',
  'Sec-Fetch-Dest':           'iframe',
  'Sec-Fetch-Mode':           'navigate',
  'Sec-Fetch-Site':           'cross-site',
  'Sec-Fetch-Storage-Access': 'none',
  'Upgrade-Insecure-Requests': '1'
};

var RPLAYER_HEADERS = {
  'User-Agent':       ANDROID_UA,
  'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'X-Requested-With': 'XMLHttpRequest'
};

var CDN_HEADERS = {
  'User-Agent': ANDROID_UA,
  'Accept':     '*/*',
  'Origin':     EMBED_DOMAIN,
  'Referer':    EMBED_DOMAIN + '/'
};

// ── Yardımcılar ───────────────────────────────────────────────

function fixUrl(url) {
  if (!url) return '';
  url = (url + '').replace(/\\\//g, '/').replace(/\\/g, '').trim();
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  return PRIMARY_DOMAIN + (url.startsWith('/') ? '' : '/') + url;
}

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u')
    .replace(/&[a-z]+;/g,'').replace(/[^a-z0-9]/g,'');
}

// ── Domain ────────────────────────────────────────────────────

var _activeDomain = null;

function getActiveDomain() {
  if (_activeDomain) return Promise.resolve(_activeDomain);
  return fetch(PRIMARY_DOMAIN + '/', { headers: PAGE_HEADERS })
    .then(function(r) {
      if (!r.ok) return _tryFallbacks();
      return r.text().then(function(html) {
        if (html.indexOf('Just a moment') === -1) {
          _activeDomain = PRIMARY_DOMAIN;
          return PRIMARY_DOMAIN;
        }
        return _tryFallbacks();
      });
    })
    .catch(function() { return _tryFallbacks(); });
}

function _tryFallbacks() {
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
                settled = true; _activeDomain = d; resolve(d);
              } else if (done >= FALLBACK_DOMAINS.length && !settled) resolve(PRIMARY_DOMAIN);
            });
          } else if (done >= FALLBACK_DOMAINS.length && !settled) resolve(PRIMARY_DOMAIN);
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
        titleTr: d.title  || d.name  || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Arama: JSON parse (authority header ile CF bypass) ────────

function searchSite(domain, query) {
  var hdrs = Object.assign({}, SEARCH_HEADERS, { 'Referer': domain + '/' });
  return fetch(domain + '/search/?q=' + encodeURIComponent(query), { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('search HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var results = (data.results || []).map(function(html) {
        var hM = html.match(/href="([^"]+)"/);
        if (!hM) return null;
        var tM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i)
               || html.match(/alt="([^"]+)"/);
        var yM = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
        var pM = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
        return {
          href:  hM[1],
          title: tM ? tM[1].trim() : '',
          year:  yM ? yM[1] : '',
          type:  pM ? pM[1].trim().toLowerCase() : ''
        };
      }).filter(Boolean);
      console.log('[HDFC] Arama "' + query + '" → ' + results.length + ' sonuç');
      return results;
    })
    .catch(function(e) {
      console.log('[HDFC] Arama hata: ' + e.message);
      return [];
    });
}

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);
  var scored = results.map(function(r) {
    var score = 0, nt = norm(r.title), nh = norm(r.href);
    if (mediaType === 'movie' && (r.type === 'film' || r.type === 'movie')) score += 100;
    if (mediaType === 'tv'    && (r.type === 'dizi' || r.type === 'series')) score += 100;
    if (nt === nTr || nt === nEn)                               score += 50;
    else if (nt.indexOf(nTr) !== -1 || nt.indexOf(nEn) !== -1) score += 20;
    else if (nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1) score += 10;
    if (year && r.year === year)                                score += 30;
    else if (year && r.year && Math.abs(parseInt(r.year||0) - parseInt(year)) <= 1) score += 10;
    return { r: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored[0].r.href;
}

// ── dc_ decoder: ROT13 → base64 → reverse → unmix ────────────
// NOT: V5'te sıra hatalıydı (reverse/base64 ters), burada düzeltildi

function dcDecode(html) {
  var m = html.match(/var\s+s_\w+\s*=\s*dc_\w+\(\[([^\]]+)\]\)/);
  if (!m) return null;
  try {
    var parts = m[1].split(',').map(function(p) { return p.trim().replace(/^["']|["']$/g, ''); });
    var val   = parts.join('');

    // 1. ROT13
    val = val.replace(/[a-zA-Z]/g, function(c) {
      return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });

    // 2. base64 decode (latin1)
    var dec = (typeof Buffer !== 'undefined')
      ? Buffer.from(val, 'base64').toString('latin1')
      : atob(val);

    // 3. reverse
    var rev = dec.split('').reverse().join('');

    // 4. unmix
    var out = '';
    for (var i = 0; i < rev.length; i++) {
      out += String.fromCharCode((rev.charCodeAt(i) - (399756995 % (i + 5)) + 256) % 256);
    }

    if (out.startsWith('http')) {
      console.log('[HDFC] dc_: ' + out);
      return out;
    }
  } catch (e) {
    console.log('[HDFC] dc_ hata: ' + e.message);
  }
  return null;
}

// ── _extract_video_url: JSON-LD → regex → Packer ─────────────
// Python'daki _extract_video_url'nin JS karşılığı

function extractVideoUrl(html) {
  // 1. JSON-LD contentUrl
  var ldM = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ldM) {
    try {
      var d = JSON.parse(ldM[1].trim());
      if (d.contentUrl && d.contentUrl.startsWith('http')) return d.contentUrl;
    } catch (e) {}
  }
  var cuM = html.match(/"contentUrl"\s*:\s*"([^"]+)"/);
  if (cuM && cuM[1].startsWith('http')) return cuM[1].replace(/\\\//g, '/');

  // 2. dc_ decode (Close player için)
  var dcUrl = dcDecode(html);
  if (dcUrl) return dcUrl;

  // 3. file: "...m3u8..." veya "...mp4..."
  var fM = html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)['"]/);
  if (fM) return fixUrl(fM[1]);

  // 4. <source src>
  var sM = html.match(/<source[^>]+src=["']([^"']+)['"]/);
  if (sM && (sM[1].indexOf('m3u8') !== -1 || sM[1].indexOf('mp4') !== -1)) return fixUrl(sM[1]);

  return null;
}

// ── Altyazı: tracks[] + fallback ─────────────────────────────
// NOT: her zaman array döner (undefined değil) → Nuvio'da VTT görünür

function extractSubtitles(html) {
  var subs = [];

  // 1. tracks: [{file, kind, label}, ...]
  var trkM = html.match(/tracks\s*:\s*\[([\s\S]*?)\]/);
  if (trkM) {
    try {
      var arr = JSON.parse('[' + trkM[1] + ']');
      arr.forEach(function(t) {
        if (t.file && (t.kind === 'captions' || t.kind === 'subtitles')) {
          subs.push({
            url:      t.file.replace(/\\\//g, '/'),
            language: (t.label || t.language || 'TR'),
            label:    (t.label || t.language || 'TR')
          });
        }
      });
      if (subs.length) return subs;
    } catch (e) {}
    // JSON parse başarısız → regex fallback
    var fRe = /"file"\s*:\s*"([^"]+)"/g;
    var lRe = /"label"\s*:\s*"([^"]+)"/g;
    var kRe = /"kind"\s*:\s*"([^"]+)"/g;
    var files = [], labels = [], kinds = [];
    var m;
    while ((m = fRe.exec(trkM[1])) !== null) files.push(m[1].replace(/\\\//g, '/'));
    while ((m = lRe.exec(trkM[1])) !== null) labels.push(m[1]);
    while ((m = kRe.exec(trkM[1])) !== null) kinds.push(m[1]);
    for (var i = 0; i < files.length; i++) {
      if (kinds[i] === 'captions' || kinds[i] === 'subtitles') {
        subs.push({ url: files[i], language: labels[i] || 'TR', label: labels[i] || 'TR' });
      }
    }
    if (subs.length) return subs;
  }

  // 2. PlayerJS subtitle: "url,label;..."
  var subStr = (html.match(/subtitle\s*:\s*["']([^"']+)["']/) || [])[1];
  if (subStr) {
    subStr.split(';').forEach(function(item) {
      item = item.trim();
      if (!item) return;
      if (item.indexOf(',') !== -1) {
        var parts = item.split(',');
        var u = parts[0].indexOf('http') !== -1 ? parts[0] : parts[1];
        var n = parts[0].indexOf('http') !== -1 ? parts[1] : parts[0];
        if (u) subs.push({ url: fixUrl(u.trim()), language: (n || 'TR').trim(), label: (n || 'TR').trim() });
      } else if (item.indexOf('http') !== -1) {
        subs.push({ url: fixUrl(item), language: 'TR', label: 'TR' });
      }
    });
    if (subs.length) return subs;
  }

  // 3. <track> tags
  var tagRe = /<track[^>]+>/gi;
  var tm;
  while ((tm = tagRe.exec(html)) !== null) {
    var tag = tm[0];
    if (tag.indexOf('captions') === -1 && tag.indexOf('subtitles') === -1) continue;
    var srcM = tag.match(/\bsrc=["']([^"']+)['"]/i);
    var labM = tag.match(/\blabel=["']([^"']+)['"]/i);
    if (!srcM) continue;
    var tUrl = srcM[1].startsWith('http') ? srcM[1] : EMBED_DOMAIN + srcM[1];
    var lang = labM ? labM[1] : 'TR';
    subs.push({ url: tUrl, language: lang, label: lang });
  }

  return subs; // boş array döner, undefined değil
}

// ── M3U8 → stream nesneleri ───────────────────────────────────

function buildStreams(m3u8, masterUrl, subtitles, sourceName) {
  var lines    = m3u8.split('\n').map(function(l) { return l.trim(); });
  var hasAudio = {};
  lines.forEach(function(l) {
    var a = l.match(/#EXT-X-MEDIA:.*?NAME="([^"]+)"/i);
    if (a) hasAudio[a[1]] = true;
  });

  var quality = 'Auto';
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    var r = lines[i].match(/RESOLUTION=(\d+x\d+)/i);
    if (r) {
      var w = parseInt(r[1].split('x')[0]);
      quality = w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';
    }
    break;
  }

  var hasTr   = !!(hasAudio['Turkish']        || hasAudio['Türkçe']);
  var hasOrig = !!(hasAudio['Original Audio'] || hasAudio['Original'] || hasAudio['English']);
  var isDual  = hasTr && hasOrig;

  var prefix  = sourceName ? '⌜ HDFILMCEHENNEMI ⌟ | ' + sourceName : '⌜ HDFILMCEHENNEMI ⌟';
  var hlsHdrs = CDN_HEADERS;
  var subs    = subtitles || [];

  var trSubs = subs.filter(function(s) { return /turkish|türkçe/i.test(s.language); });
  var enSubs = subs.filter(function(s) { return /english/i.test(s.language); });

  var streams = [];
  if (isDual) {
    streams.push({ name: 'HDFilmCehennemi', title: prefix + ' | DUAL | ' + quality, url: masterUrl, quality: quality, type: 'hls', headers: hlsHdrs, subtitles: trSubs.length ? trSubs : subs });
    streams.push({ name: 'HDFilmCehennemi', title: prefix + ' | 🌐 Orijinal | ' + quality, url: masterUrl, quality: quality, type: 'hls', headers: hlsHdrs, subtitles: enSubs.length ? enSubs : subs });
  } else if (hasTr) {
    streams.push({ name: 'HDFilmCehennemi', title: prefix + ' | 🇹🇷 TR Dublaj | ' + quality, url: masterUrl, quality: quality, type: 'hls', headers: hlsHdrs, subtitles: trSubs.length ? trSubs : subs });
  } else if (hasOrig) {
    streams.push({ name: 'HDFilmCehennemi', title: prefix + ' | 🌐 Orijinal | ' + quality, url: masterUrl, quality: quality, type: 'hls', headers: hlsHdrs, subtitles: enSubs.length ? enSubs : subs });
  } else {
    streams.push({ name: 'HDFilmCehennemi', title: prefix + ' | 🎬 Video | ' + quality, url: masterUrl, quality: quality, type: 'hls', headers: hlsHdrs, subtitles: subs });
  }
  return streams;
}

function fetchMasterAndBuild(masterUrl, subtitles, sourceName) {
  return fetch(masterUrl, { headers: CDN_HEADERS })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(m3u8) {
      if (!m3u8 || m3u8.indexOf('#EXTM3U') === -1) {
        // master.txt alınamadı ama URL geçerli — direkt dön
        return [{
          name:      'HDFilmCehennemi',
          title:     '⌜ HDFILMCEHENNEMI ⌟' + (sourceName ? ' | ' + sourceName : '') + ' | Auto',
          url:       masterUrl,
          quality:   'Auto',
          type:      'hls',
          headers:   CDN_HEADERS,
          subtitles: subtitles || []
        }];
      }
      return buildStreams(m3u8, masterUrl, subtitles, sourceName);
    })
    .catch(function() { return []; });
}

// ── CDN fallback: thumbnail → CDN host listesi ────────────────

function tryCdnHosts(filename, subtitles, sourceName) {
  return new Promise(function(resolve) {
    var done = 0, settled = false;
    CDN_HOSTS.forEach(function(host) {
      var masterUrl = host + '/hls/' + filename + '.mp4/txt/master.txt';
      fetch(masterUrl, { headers: CDN_HEADERS })
        .then(function(r) {
          done++;
          if (settled) return;
          if (r.ok) {
            return r.text().then(function(m3u8) {
              if (m3u8.indexOf('#EXTM3U') !== -1) {
                settled = true;
                console.log('[HDFC] CDN hit: ' + host);
                resolve(buildStreams(m3u8, masterUrl, subtitles, sourceName));
              } else if (done >= CDN_HOSTS.length && !settled) resolve([]);
            });
          } else if (done >= CDN_HOSTS.length && !settled) resolve([]);
        })
        .catch(function() {
          done++;
          if (!settled && done >= CDN_HOSTS.length) resolve([]);
        });
    });
  });
}

// ── invoke_local_source: iframe → video URL → stream ─────────
// Python'daki invoke_local_source'un JS karşılığı
// Hem Close embed hem Rapidrame /rplayer/ için kullanılır

function invokeLocalSource(iframeUrl, sourceName, pageReferer, isRplayer) {
  var hdrs = isRplayer
    ? Object.assign({}, RPLAYER_HEADERS, { 'Referer': pageReferer })
    : Object.assign({}, EMBED_HEADERS,   { 'Referer': pageReferer });

  return fetch(iframeUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('iframe HTTP ' + r.status);
      return r.text();
    })
    .then(function(html) {
      var subtitles = extractSubtitles(html);
      var videoUrl  = extractVideoUrl(html);

      console.log('[HDFC] invokeLocalSource: url=' + (videoUrl ? videoUrl.slice(0,80) : 'YOK') + ' subs=' + subtitles.length);

      if (!videoUrl) {
        // Video URL bulunamadı → CDN thumbnail fallback
        var thumbM = html.match(/hdfilmcehennemi\.mobi\/img\/([^"'\s]+)\.(?:jpg|webp)/i);
        if (thumbM) {
          console.log('[HDFC] CDN fallback: ' + thumbM[1]);
          return tryCdnHosts(thumbM[1], subtitles, sourceName);
        }
        return [];
      }

      // .mp4/txt/master.txt veya .m3u8 → fetchMasterAndBuild
      var isMaster = videoUrl.indexOf('master.txt') !== -1 || videoUrl.indexOf('m3u8') !== -1;
      if (isMaster) return fetchMasterAndBuild(videoUrl, subtitles, sourceName);

      // Diğer URL'ler → direkt stream
      return [{
        name:      'HDFilmCehennemi',
        title:     '⌜ HDFILMCEHENNEMI ⌟ | ' + sourceName + ' | Auto',
        url:       videoUrl,
        quality:   'Auto',
        type:      'hls',
        headers:   CDN_HEADERS,
        subtitles: subtitles
      }];
    })
    .catch(function(e) {
      console.log('[HDFC] invokeLocalSource hata: ' + e.message);
      return [];
    });
}

// ── /video/{id}/ → Close veya Rapidrame yönlendirmesi ─────────
// Python'daki _get_video_source'un JS karşılığı

function getVideoSource(domain, videoId, sourceName, pageReferer) {
  return fetch(domain + '/video/' + videoId + '/', {
    headers: Object.assign({}, VIDEO_API_HEADERS, { 'Referer': pageReferer })
  })
  .then(function(r) {
    if (!r.ok) throw new Error('video/ HTTP ' + r.status);
    return r.json();
  })
  .then(function(json) {
    var htmlContent = (json.data || {}).html || '';

    // data-src attribute'ını bul
    var iframeUrl = null;
    var m1 = htmlContent.match(/data-src=["']([^"']+)["']/i);
    if (m1) iframeUrl = m1[1].replace(/\\/g, '');
    if (!iframeUrl) {
      var m2 = htmlContent.match(/data-src=\\"([^"]+)/);
      if (m2) iframeUrl = m2[1].replace(/\\/g, '');
    }
    if (!iframeUrl) return [];

    console.log('[HDFC] ' + sourceName + ': ' + iframeUrl);

    // Close: .mobi/video/embed/ → query strip → invokeLocalSource
    if (iframeUrl.indexOf('hdfilmcehennemi.mobi') !== -1) {
      var embedUrl = iframeUrl.split('?')[0];
      return invokeLocalSource(embedUrl, sourceName, pageReferer, false);
    }

    // Rapidrame: ?rapidrame_id= → /rplayer/{id}/ → invokeLocalSource
    if (iframeUrl.indexOf('rapidrame_id=') !== -1) {
      var rapId     = iframeUrl.split('rapidrame_id=')[1].split('&')[0];
      var rplayerUrl = domain + '/rplayer/' + rapId + '/';
      return invokeLocalSource(rplayerUrl, sourceName, pageReferer, true);
    }

    // Diğer iframe'ler (eski player vb.)
    return invokeLocalSource(fixUrl(iframeUrl), sourceName, pageReferer, true);
  })
  .catch(function(e) {
    console.log('[HDFC] getVideoSource hata: ' + e.message);
    return [];
  });
}

// ── Film/bölüm sayfası: alternative-links parse ───────────────

function fetchStreamsFromPage(domain, pageUrl) {
  return fetch(pageUrl, {
    headers: Object.assign({}, PAGE_HEADERS, { 'Referer': domain + '/' })
  })
  .then(function(r) {
    if (!r.ok) throw new Error('sayfa HTTP ' + r.status);
    return r.text();
  })
  .then(function(html) {
    console.log('[HDFC] Sayfa: ' + pageUrl + ' (' + html.length + ' kar)');

    // alternative-links → tüm video ID'leri topla
    var sources = [];
    var altRe   = /<div[^>]+class="[^"]*alternative-links[^"]*"[^>]*data-lang="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
    var altM;
    while ((altM = altRe.exec(html)) !== null) {
      var lang  = (altM[1] || '').toUpperCase();
      var block = altM[2];
      var btnRe = /<button[^>]+data-video="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
      var btnM;
      while ((btnM = btnRe.exec(block)) !== null) {
        var text = btnM[2].replace(/<[^>]+>/g, '').replace(/\(HDrip Xbet\)/g, '').trim();
        var name = (lang ? lang + ' | ' : '') + text;
        if (btnM[1]) sources.push({ videoId: btnM[1], name: name });
      }
    }

    console.log('[HDFC] ' + sources.length + ' kaynak bulundu');

    if (!sources.length) return [];

    // Tüm kaynakları paralel işle (max 4)
    var idx = 0, results = [];
    function next() {
      if (idx >= sources.length) return Promise.resolve();
      var src = sources[idx++];
      return getVideoSource(domain, src.videoId, src.name, pageUrl)
        .then(function(ss) {
          ss.forEach(function(s) { results.push(s); });
          return next();
        });
    }
    var workers = [];
    for (var i = 0; i < Math.min(4, sources.length); i++) workers.push(next());
    return Promise.all(workers).then(function() { return results; });
  })
  .catch(function(e) {
    console.log('[HDFC] fetchStreamsFromPage hata: ' + e.message);
    return [];
  });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0], info = init[1];
      console.log('[HDFC] ' + info.titleTr + ' (' + info.titleEn + ') ' + info.year);

      var queries = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) {
        queries.push(searchSite(domain, info.titleEn));
      }

      return Promise.all(queries).then(function(all) {
        var seen = {}, combined = [];
        (all[0] || []).concat(all[1] || []).forEach(function(r) {
          if (!seen[r.href]) { seen[r.href] = true; combined.push(r); }
        });

        if (!combined.length) { console.log('[HDFC] Arama sonuç yok'); return []; }

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (!pageUrl) return [];

        // Dizi: bölüm URL'i oluştur
        if (mediaType === 'tv' && season && episode) {
          var sNum = parseInt(season), eNum = parseInt(episode);
          pageUrl = pageUrl.replace(/\/$/, '') + '/' + sNum + '-sezon-' + eNum + '-bolum/';
        }

        console.log('[HDFC] URL: ' + pageUrl);
        return fetchStreamsFromPage(domain, pageUrl);
      });
    })
    .then(function(streams) {
      var seen = {}, out = [];
      (streams || []).forEach(function(s) {
        if (s && s.url && !seen[s.url]) { seen[s.url] = true; out.push(s); }
      });
      return out;
    })
    .catch(function(e) {
      console.error('[HDFC] Hata: ' + (e.message || e));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
