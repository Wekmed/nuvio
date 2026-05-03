// ============================================================
//  HDFilmCehennemi — Nuvio Provider
// ============================================================

var TMDB_API_KEY   = '500330721680edb6d5f7f12ba7cd9023';
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';

var FALLBACK_DOMAINS = [
  'https://hdfilmcehennemini.org',
  'https://www.hdfilmcehennemi.ws',
  'https://hdfilmcehennemi.mobi'
];

var SEARCH_HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':           '*/*',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'Content-Type':     'application/json',
  'X-Requested-With': 'fetch',
  'Sec-Fetch-Dest':   'empty',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin'
};

var PAGE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Upgrade-Insecure-Requests': '1'
};

var EMBED_HEADERS = {
  'User-Agent':               'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':          'tr-TR,tr;q=0.9',
  'Sec-Ch-Ua':                '"Chromium";v="146", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile':         '?1',
  'Sec-Ch-Ua-Platform':       '"Android"',
  'Sec-Fetch-Dest':           'iframe',
  'Sec-Fetch-Mode':           'navigate',
  'Sec-Fetch-Site':           'cross-site',
  'Sec-Fetch-Storage-Access': 'none',
  'Sec-Gpc':                  '1',
  'Upgrade-Insecure-Requests': '1'
};

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
                settled = true; _activeDomain = d;
                resolve(d);
              } else if (done >= FALLBACK_DOMAINS.length) resolve(PRIMARY_DOMAIN);
            });
          } else if (done >= FALLBACK_DOMAINS.length) resolve(PRIMARY_DOMAIN);
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

// ── Normalize ─────────────────────────────────────────────────

function norm(s) {
  return (s||'').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u')
    .replace(/&[a-z]+;/g,'').replace(/[^a-z0-9]/g,'');
}

// ── Arama ─────────────────────────────────────────────────────

function searchSite(domain, query) {
  var hdrs = Object.assign({}, SEARCH_HEADERS, { 'Referer': domain + '/' });
  return fetch(domain + '/search/?q=' + encodeURIComponent(query), { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var results = (data.results || []).map(function(html) {
        var hM = html.match(/href="([^"]+)"/);
        if (!hM) return null;
        var tM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i) || html.match(/alt="([^"]+)"/);
        var yM = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
        var pM = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
        return { href: hM[1], title: tM ? tM[1].trim() : '', year: yM ? yM[1] : '', type: pM ? pM[1].trim().toLowerCase() : '' };
      }).filter(Boolean);
      return results;
    })
    .catch(function() { return []; });
}

function pickBest(results, titleTr, titleEn, year, mediaType) {
  if (!results.length) return null;
  var nTr = norm(titleTr), nEn = norm(titleEn);
  var scored = results.map(function(r) {
    var score = 0, nt = norm(r.title), nh = norm(r.href);
    if (mediaType === 'movie' && (r.type === 'film' || r.type === 'movie')) score += 100;
    if (mediaType === 'tv'    && (r.type === 'dizi' || r.type === 'series')) score += 100;
    if (nt === nTr || nt === nEn)                                 score += 50;
    else if (nt.indexOf(nTr) !== -1 || nt.indexOf(nEn) !== -1)   score += 20;
    else if (nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1)   score += 10;
    if (year && r.year === year)                                  score += 30;
    else if (year && r.year && Math.abs(parseInt(r.year||0)-parseInt(year))<=1) score += 10;
    return { r: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored[0].r.href;
}

function buildEpisodeUrl(url, s, e) {
  return url.replace(/\/$/, '') + '/' + s + '-sezon-' + e + '-bolum/';
}

// ── Embed sayfası → CDN URL ───────────────────────────────────
// Strateji:
//   1. Embed HTML'inden obfuscated dc_ fonksiyonunu çöz → CDN URL direkt
//   2. contentUrl JSON-LD'den al (fallback)
//   3. Thumbnail filename → CDN host denemesi (son fallback)

// Pure-JS base64 decode — atob veya Buffer gerektirmez
// React Native, Node.js, tarayıcı ortamlarında çalışır
function _base64Decode(str) {
  // Önce native yöntemleri dene
  if (typeof atob === 'function') {
    try { return atob(str); } catch(e) {}
  }
  if (typeof Buffer !== 'undefined') {
    try { return Buffer.from(str, 'base64').toString('binary'); } catch(e) {}
  }
  // Pure-JS fallback (tüm ortamlarda çalışır)
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var out = '', p = -8, b = 0, c, d;
  for (var i = 0; i < str.length; i++) {
    c = chars.indexOf(str[i]);
    if (c === -1) continue;
    b = (b << 6) + c;
    p += 6;
    if (p >= 0) {
      d = (b >> p) & 0xFF;
      out += String.fromCharCode(d);
      p -= 8;
    }
  }
  return out;
}

function decodeObfuscatedUrl(html) {
  // Değişken tanımını bul: var s_XXXX = dc_XXXX([...])
  var varMatch = html.match(/var\s+s_[a-zA-Z0-9_]+\s*=\s*dc_[a-zA-Z0-9_]+\s*\(\s*(\[[^\]]+\])\s*\)/);
  if (!varMatch) return null;

  try {
    var parts = JSON.parse(varMatch[1]);
    var v = parts.join('');
    // ROT13
    v = v.replace(/[a-zA-Z]/g, function(c) {
      return String.fromCharCode(
        (c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26
      );
    });
    // Reverse
    v = v.split('').reverse().join('');
    // Base64 decode
    v = _base64Decode(v);
    // Unmix
    var unmix = '';
    for (var i = 0; i < v.length; i++) {
      var cc = v.charCodeAt(i);
      cc = (cc - (399756995 % (i + 5)) + 256) % 256;
      unmix += String.fromCharCode(cc);
    }
    if (unmix && unmix.indexOf('http') === 0) return unmix;
  } catch(e) {}
  return null;
}

function fetchStreamsFromEmbed(embedUrl, pageReferer) {
  var hdrs = Object.assign({}, EMBED_HEADERS, {
    'Referer': pageReferer,
    'Cookie':  'guide_tooltip_closeloadxx=1',
    'Origin':  pageReferer.split('/').slice(0, 3).join('/')
  });

  return fetch(embedUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      return r.text();
    })
    .then(function(html) {
      // ── Altyazılar: jwplayer tracks dizisinden çek ──
      // Format: {"file": "https://...vtt", "kind": "captions", "label": "Turkish"}
      var subtitles = [];
      var trackRe = /\{\s*["']?file["']?\s*:\s*["'](https?:\/\/hdfilmcehennemi\.mobi\/vtt\/[^"']+)["'][^}]*["']?kind["']?\s*:\s*["']captions["'][^}]*["']?label["']?\s*:\s*["']([^"']+)["']/gi;
      var tm;
      while ((tm = trackRe.exec(html)) !== null) {
        subtitles.push({ url: tm[1], language: tm[2], label: tm[2] });
      }
      // Alternatif sıralama (file önce değil)
      if (!subtitles.length) {
        var trackRe2 = /["']?label["']?\s*:\s*["']([^"']+)["'][^}]*["']?file["']?\s*:\s*["'](https?:\/\/hdfilmcehennemi\.mobi\/vtt\/[^"']+)["'][^}]*["']?kind["']?\s*:\s*["']captions["']/gi;
        while ((tm = trackRe2.exec(html)) !== null) {
          subtitles.push({ url: tm[2], language: tm[1], label: tm[1] });
        }
      }
      // Basit fallback: tüm VTT URL'lerini yakala
      if (!subtitles.length) {
        var vttRe = /(https?:\/\/hdfilmcehennemi\.mobi\/vtt\/[^"'\s]+\.vtt)/gi;
        var vttM;
        var vttIdx = 0;
        while ((vttM = vttRe.exec(html)) !== null) {
          var lang = vttM[1].indexOf('-tr-') !== -1 ? 'Turkish' : vttM[1].indexOf('-en-') !== -1 ? 'English' : 'Sub ' + (++vttIdx);
          subtitles.push({ url: vttM[1], language: lang, label: lang });
        }
      }

      // ── YOL 1: Obfuscated JS değişkenini decode et ──
      var decodedUrl = decodeObfuscatedUrl(html);
      if (decodedUrl) {
        // master.txt URL'ini normalize et
        var masterUrl = decodedUrl.indexOf('master.txt') !== -1
          ? decodedUrl
          : decodedUrl.replace(/\.mp4.*$/, '.mp4/txt/master.txt');
        return fetchMasterAndBuild(masterUrl, subtitles);
      }

      // ── YOL 2: JSON-LD contentUrl ──
      var contentUrlM = html.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
      if (contentUrlM && contentUrlM[1].indexOf('.txt') !== -1) {
        return fetchMasterAndBuild(contentUrlM[1], subtitles);
      }

      // ── YOL 3: Decode ve contentUrl başarısız → boş döndür ──
      return [];
    })
    .catch(function() { return []; });
}

// Direkt master.txt URL'i ile stream oluştur (YOL 1 için)
function fetchMasterAndBuild(masterUrl, subtitles) {
  return fetch(masterUrl, {
    headers: {
      'User-Agent': EMBED_HEADERS['User-Agent'],
      'Accept':     '*/*',
      'Origin':     'https://hdfilmcehennemi.mobi',
      'Referer':    'https://hdfilmcehennemi.mobi/'
    }
  })
  .then(function(r) {
    if (!r.ok) throw new Error('master.txt HTTP ' + r.status);
    return r.text();
  })
  .then(function(m3u8) {
    if (m3u8.indexOf('#EXTM3U') === -1) throw new Error('Geçersiz m3u8');
    return buildStreamsFromM3u8(m3u8, masterUrl, subtitles);
  })
  .catch(function() { return []; });
}

// M3U8 → stream'lere çevir (Nuvio/Stremio formatı)
function buildStreamsFromM3u8(m3u8Text, masterUrl, subtitles) {
  var hlsHeaders = {
    'User-Agent': EMBED_HEADERS['User-Agent'],
    'Origin':     'https://hdfilmcehennemi.mobi',
    'Referer':    'https://hdfilmcehennemi.mobi/'
  };

  var lines      = m3u8Text.split('\n').map(function(l) { return l.trim(); });
  var audioNames = [];
  var streams    = [];

  lines.forEach(function(line) {
    var am = line.match(/#EXT-X-MEDIA:.*?NAME="([^"]+)"/i);
    if (am) audioNames.push(am[1]);
  });

  var quality = 'Auto';
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    var resM = lines[i].match(/RESOLUTION=(\d+x\d+)/i);
    var w    = resM ? parseInt(resM[1].split('x')[0]) : 0;
    quality  = w >= 3840 ? '4K' : w >= 2560 ? '1440p' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';
    break;
  }

  var hasTr   = audioNames.some(function(n) { return /turkish|türkçe/i.test(n); });
  var hasOrig = audioNames.some(function(n) { return /original/i.test(n); });
  var isDual  = hasTr && hasOrig;

  // Altyazıları Stremio formatına çevir: {id, url, lang}
  function toStremioSubs(subList) {
    return subList.map(function(s, idx) {
      var langCode = /turkish|türkçe/i.test(s.language) ? 'tur'
                   : /english/i.test(s.language)        ? 'eng'
                   : s.language.slice(0, 3).toLowerCase();
      return { id: 'sub_' + idx, url: s.url, lang: langCode };
    });
  }

  var trSubs   = subtitles.filter(function(s) { return /turkish|türkçe/i.test(s.language); });
  var enSubs   = subtitles.filter(function(s) { return /english/i.test(s.language); });
  var allSubs  = subtitles;

  // behaviorHints — ExoPlayer için header gerekli
  var bh = {
    notWebReady:  true,
    proxyHeaders: { request: hlsHeaders }
  };

  function makeStream(titleStr, subList) {
    var s = {
      name:          'HDFC ' + quality,
      title:         titleStr,
      url:           masterUrl,
      behaviorHints: bh
    };
    var converted = toStremioSubs(subList);
    if (converted.length) s.subtitles = converted;
    return s;
  }

  if (isDual) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | DUAL | ' + quality, trSubs.length ? trSubs : allSubs));
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Orijinal | ' + quality, enSubs.length ? enSubs : allSubs));
  } else if (hasTr) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🇹🇷 TR Dublaj | ' + quality, trSubs.length ? trSubs : allSubs));
  } else if (hasOrig) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Orijinal | ' + quality, allSubs));
  } else {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Video | ' + quality, allSubs));
  }

  return streams;
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0], info = init[1];

      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) searches.push(searchSite(domain, info.titleEn));

      return Promise.all(searches).then(function(all) {
        var seen = {}, combined = [];
        (all[0]||[]).concat(all[1]||[]).forEach(function(r) { if (!seen[r.href]) { seen[r.href]=true; combined.push(r); } });
        if (!combined.length) return null;

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (mediaType === 'tv' && season && episode) pageUrl = buildEpisodeUrl(pageUrl, season, episode);

        return fetch(pageUrl, { headers: Object.assign({}, PAGE_HEADERS, {'Referer': domain+'/'}) })
          .then(function(r) { return r.text().then(function(h) { return { html: h, url: pageUrl }; }); });
      });
    })
    .then(function(result) {
      if (!result) return [];
      var embedM = result.html.match(/data-src="(https?:\/\/hdfilmcehennemi\.mobi\/video\/embed\/[^"]+)"/i);
      if (!embedM) return [];
      return fetchStreamsFromEmbed(embedM[1], result.url);
    })
    .then(function(streams) {
      var seen = {}, out = [];
      (streams||[]).forEach(function(s) { if (s && !seen[s.url]) { seen[s.url]=true; out.push(s); } });
      return out;
    })
    .catch(function() { return []; });
}

if (typeof module !== 'undefined') module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
