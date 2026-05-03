// ============================================================
//  HDFilmCehennemi — Nuvio Provider
//  Film + Dizi destekler | Hermes uyumlu (cheerio yok)
// ============================================================

var TMDB_API_KEY   = '500330721680edb6d5f7f12ba7cd9023';
var AH_HASH        = 'hash=408307737dacb42e3bbac1f77b4a4dab';
var PRIMARY_DOMAIN = 'https://www.hdfilmcehennemi.nl';

var CDN_HOSTS = [
  'https://srv12.cdnimages96.shop',
  'https://srv12.cdnimages1128.shop',
  'https://srv1.cdnimages391.shop',
  'https://srv2.cdnimages391.shop',
  'https://srv3.cdnimages391.shop',
  'https://cdn1.cdnimages1128.shop',
  'https://srv10.cdnimages1128.shop',
  'https://srv11.cdnimages1128.shop'
];

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
  'User-Agent':                'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':           'tr-TR,tr;q=0.9',
  'Upgrade-Insecure-Requests': '1'
};

var EMBED_HEADERS = {
  'User-Agent':                'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':           'tr-TR,tr;q=0.9',
  'Sec-Ch-Ua':                 '"Chromium";v="146", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile':          '?1',
  'Sec-Ch-Ua-Platform':        '"Android"',
  'Sec-Fetch-Dest':            'iframe',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'cross-site',
  'Upgrade-Insecure-Requests': '1'
};

var AH_HEADERS_EXTRA = {
  'User-Agent':       'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Accept':           '*/*',
  'Accept-Language':  'tr-TR,tr;q=0.9',
  'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Dest':   'empty',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin'
};

// ── Domain yönetimi ──────────────────────────────────────────

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

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB HTTP ' + r.status);
      return r.text();
    })
    .then(function(text) {
      var d;
      try { d = JSON.parse(text); } catch(e) { throw new Error('TMDB JSON parse hatası: ' + text.slice(0, 60)); }
      if (!d || d.success === false) throw new Error('TMDB bulunamadı: ' + tmdbId);
      return {
        titleTr: d.title  || d.name  || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Normalize ────────────────────────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/û/g,'u')
    .replace(/&[a-z]+;/g,'').replace(/[^a-z0-9]/g,'');
}

// ── Arama ────────────────────────────────────────────────────

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
        // Python: h4.title → select_text
        var tM = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h4>/i) || html.match(/alt="([^"]+)"/);
        var yM = html.match(/<span[^>]*class="year"[^>]*>(\d{4})<\/span>/);
        var pM = html.match(/<span[^>]*class="type"[^>]*>([^<]+)<\/span>/);
        return {
          href:  hM[1],
          title: tM ? tM[1].trim() : '',
          year:  yM ? yM[1] : '',
          type:  pM ? pM[1].trim().toLowerCase() : ''
        };
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
    if (nt === nTr || nt === nEn)                                  score += 50;
    else if (nt.indexOf(nTr) !== -1 || nt.indexOf(nEn) !== -1)    score += 20;
    else if (nh.indexOf(nTr) !== -1 || nh.indexOf(nEn) !== -1)    score += 10;
    if (year && r.year === year)                                   score += 30;
    else if (year && r.year && Math.abs(parseInt(r.year||0) - parseInt(year)) <= 1) score += 10;
    return { r: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored[0].r.href;
}

// ── Dizi bölüm URL'si ────────────────────────────────────────
// Python: extract_season_episode + sezon/bölüm URL'si inşa et

function buildEpisodeUrl(baseUrl, season, episode) {
  return baseUrl.replace(/\/$/, '') + '/' + season + '-sezon-' + episode + '-bolum/';
}

// ── Base64 decode (saf JS — Hermes uyumlu) ───────────────────

function _base64Decode(str) {
  if (typeof atob === 'function') { try { return atob(str); } catch(e) {} }
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var out = '', p = -8, b = 0, c, d;
  for (var i = 0; i < str.length; i++) {
    c = chars.indexOf(str[i]);
    if (c === -1) continue;
    b = (b << 6) + c; p += 6;
    if (p >= 0) { d = (b >> p) & 0xFF; out += String.fromCharCode(d); p -= 8; }
  }
  return out;
}

// ── Packer (eval obfuscation) çözüm ─────────────────────────
// Python: Packer.unpack + StreamDecoder.extract_stream_url

function unpackEval(packed) {
  try {
    var pM = packed.match(/}\s*\(\s*'([\s\S]+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\s*\.split/);
    if (!pM) return null;
    var p = pM[1], a = parseInt(pM[2]), c = parseInt(pM[3]);
    var k = pM[4].split('|');
    function e(n) {
      var d = '';
      do { d = 'abcdefghijklmnopqrstuvwxyz'[n % 36] + d; n = Math.floor(n / 36); } while (n > 0);
      return d || String(c);
    }
    while (c--) { if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]); }
    return p;
  } catch(e) { return null; }
}

function extractStreamFromUnpacked(unpacked) {
  if (!unpacked) return null;
  // m3u8 veya mp4 URL'si yakala
  var m = unpacked.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)['"]/);
  return m ? m[1] : null;
}

// ── Obfuscated URL decode (JS'teki mevcut yöntem korundu) ────

function decodeObfuscatedUrl(html) {
  var varMatch = html.match(/var\s+s_[a-zA-Z0-9_]+\s*=\s*dc_[a-zA-Z0-9_]+\s*\(\s*(\[[^\]]+\])\s*\)/);
  if (!varMatch) return null;
  try {
    var parts = JSON.parse(varMatch[1]);
    var v = parts.join('');
    v = v.replace(/[a-zA-Z]/g, function(c) {
      return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
    v = v.split('').reverse().join('');
    v = _base64Decode(v);
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

// ── Altyazı çıkarma ──────────────────────────────────────────
// Python: _extract_subtitles — 3 farklı yöntem

function extractSubtitles(html) {
  var subtitles = [];

  // 1. JWPlayer / Plyr tracks: [...]
  var tracksM = html.match(/tracks\s*:\s*(\[[^\]]+\])/);
  if (tracksM) {
    try {
      var tracks = JSON.parse(tracksM[1]);
      tracks.forEach(function(t) {
        var kind = t.kind || 'captions';
        if ((kind === 'captions' || kind === 'subtitles') && t.file) {
          var label = t.label || t.language || 'TR';
          subtitles.push({ url: t.file, language: label, label: label });
        }
      });
      if (subtitles.length) return subtitles;
    } catch(e) {
      // Regex fallback
      var trackRe = /file\s*:\s*["']([^"']+)["'].*?(?:label|language)\s*:\s*["']([^"']+)["']/g;
      var tm;
      while ((tm = trackRe.exec(tracksM[1])) !== null) {
        subtitles.push({ url: tm[1].replace(/\\\\/g,""), language: tm[2], label: tm[2] });
      }
    }
  }

  // 2. PlayerJS subtitle: "url,name;url,name"
  if (!subtitles.length) {
    var subStrM = html.match(/subtitle\s*:\s*["']([^"']+)['"]/);
    if (subStrM) {
      subStrM[1].split(';').forEach(function(item) {
        if (item.indexOf(',') !== -1) {
          var parts = item.split(',');
          var u, n;
          if (parts[0].indexOf('http') !== -1) { u = parts[0]; n = parts[1]; }
          else { u = parts[1]; n = parts[0]; }
          var lbl = (n || 'TR').trim();
          if (u) subtitles.push({ url: u.trim(), language: lbl, label: lbl });
        } else if (item.indexOf('http') !== -1) {
          subtitles.push({ url: item.trim(), language: 'TR', label: 'TR' });
        }
      });
    }
  }

  // 3. HTML5 <track> tagları
  if (!subtitles.length) {
    var trackTagRe = /<track[^>]+kind=["'](?:captions|subtitles)["'][^>]*>/gi;
    var tagM;
    while ((tagM = trackTagRe.exec(html)) !== null) {
      var srcM   = tagM[0].match(/src=["']([^"']+)["']/);
      var lblM   = tagM[0].match(/label=["']([^"']+)["']/) || tagM[0].match(/srclang=["']([^"']+)["']/);
      if (srcM) {
        var lbl2 = lblM ? lblM[1] : 'TR';
        subtitles.push({ url: srcM[1], language: lbl2, label: lbl2 });
      }
    }
  }

  // 4. VTT URL fallback (mevcut JS'teki yöntem)
  if (!subtitles.length) {
    var vttRe = /(https?:\/\/[^\s"']+\.vtt)/gi;
    var vttM;
    while ((vttM = vttRe.exec(html)) !== null) {
      var vttLang = vttM[1].indexOf('-tr-') !== -1 ? 'Turkish'
                  : vttM[1].indexOf('-en-') !== -1 ? 'English' : 'TR';
      if (!subtitles.some(function(s) { return s.url === vttM[1]; })) {
        subtitles.push({ url: vttM[1], language: vttLang, label: vttLang });
      }
    }
  }

  return subtitles;
}

// ── Video URL çıkarma ────────────────────────────────────────
// Python: _extract_video_url — JSON-LD, regex, Packer

function extractVideoUrl(html) {
  // 1. JSON-LD contentUrl
  var jsonLdM = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdM) {
    try {
      var data = JSON.parse(jsonLdM[1].trim());
      if (data.contentUrl && data.contentUrl.indexOf('http') === 0) return data.contentUrl;
    } catch(e) {}
  }

  // 2. Regex contentUrl
  var cuM = html.match(/"contentUrl"\s*:\s*"([^"]+)"/);
  if (cuM && cuM[1].indexOf('http') === 0) return cuM[1];

  // 3. Obfuscated JS decode (mevcut JS yöntemi)
  var decoded = decodeObfuscatedUrl(html);
  if (decoded) return decoded;

  // 4. eval(function...) — Packer
  var evalM = html.match(/(eval\(function[\s\S]+)/);
  if (evalM) {
    var unpacked = unpackEval(evalM[1]);
    var streamUrl = extractStreamFromUnpacked(unpacked);
    if (streamUrl) return streamUrl;
  }

  // 5. Direkt m3u8/mp4 URL
  var directM = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)['"]/);
  if (directM) return directM[1];

  return null;
}

// ── M3U8 → stream objeleri ───────────────────────────────────

function buildStreamsFromM3u8(m3u8Text, masterUrl, subtitles) {
  var hlsHdrs = {
    'User-Agent': EMBED_HEADERS['User-Agent'],
    'Accept':     '*/*',
    'Origin':     'https://hdfilmcehennemi.mobi',
    'Referer':    'https://hdfilmcehennemi.mobi/'
  };

  var lines    = m3u8Text.split('\n').map(function(l) { return l.trim(); });
  var hasAudio = {};
  lines.forEach(function(line) {
    var am = line.match(/#EXT-X-MEDIA:.*?NAME="([^"]+)"/i);
    if (am) hasAudio[am[1]] = true;
  });

  var quality = 'Auto';
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    var resM = lines[i].match(/RESOLUTION=(\d+x\d+)/i);
    var w    = resM ? parseInt(resM[1].split('x')[0]) : 0;
    quality  = w >= 3840 ? '4K' : w >= 2560 ? '1440p' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'Auto';
    break;
  }

  var hasTr   = hasAudio['Turkish']        || hasAudio['Türkçe'];
  var hasOrig = hasAudio['Original Audio'] || hasAudio['Original'];
  var isDual  = hasTr && hasOrig;

  var trSubs = subtitles.filter(function(s) { return /TR|Turkish|Türkçe/i.test(s.language); });
  var enSubs = subtitles.filter(function(s) { return /EN|English/i.test(s.language); });

  function makeStream(titleStr, subList) {
    var s = {
      name:    'HDFilmCehennemi',
      title:   titleStr,
      url:     masterUrl,
      quality: quality,
      headers: hlsHdrs
    };
    if (subList && subList.length) s.subtitles = subList;
    return s;
  }

  var streams = [];
  if (isDual) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | DUAL | ' + quality, trSubs.length ? trSubs : subtitles));
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Orijinal | ' + quality, enSubs.length ? enSubs : subtitles));
  } else if (hasTr) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🇹🇷 TR Dublaj | ' + quality, trSubs.length ? trSubs : subtitles));
  } else if (hasOrig) {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Orijinal | ' + quality, enSubs.length ? enSubs : subtitles));
  } else {
    streams.push(makeStream('⌜ HDFILMCEHENNEMI ⌟ | 🌐 Video | ' + quality, subtitles));
  }
  return streams;
}

function fetchMasterAndBuild(masterUrl, subtitles) {
  return fetch(masterUrl, {
    headers: {
      'User-Agent': EMBED_HEADERS['User-Agent'],
      'Accept':     '*/*',
      'Origin':     'https://hdfilmcehennemi.mobi',
      'Referer':    'https://hdfilmcehennemi.mobi/'
    }
  })
  .then(function(r) { return r.ok ? r.text() : null; })
  .then(function(m3u8) {
    if (!m3u8 || m3u8.indexOf('#EXTM3U') === -1) {
      return [{ name: 'HDFilmCehennemi', title: '⌜ HDFILMCEHENNEMI ⌟ | Auto', url: masterUrl, quality: 'Auto', headers: {}, subtitles: subtitles.length ? subtitles : undefined }];
    }
    return buildStreamsFromM3u8(m3u8, masterUrl, subtitles);
  })
  .catch(function() { return []; });
}

// ── CehennemPass fallback ────────────────────────────────────
// Python: cehennempass() — video_id ile kalite seçimi POST

function tryCehennemPass(videoId, sourceName, subtitles) {
  var results = [];
  var qualities = [
    { q: 'low',  label: 'Düşük Kalite' },
    { q: 'high', label: 'Yüksek Kalite' }
  ];

  var promises = qualities.map(function(item) {
    var randomCookie = Math.random().toString(36).substring(2, 18);
    return fetch('https://cehennempass.pw/process_quality_selection.php', {
      method: 'POST',
      headers: {
        'Referer':          'https://cehennempass.pw/download/' + videoId,
        'X-Requested-With': 'fetch',
        'Cookie':           'PHPSESSID=' + randomCookie,
        'Content-Type':     'application/x-www-form-urlencoded'
      },
      body: 'video_id=' + videoId + '&selected_quality=' + item.q
    })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (json && json.download_link) {
        return {
          name:    sourceName ? (sourceName + ' | ' + item.label) : item.label,
          title:   '⌜ HDFILMCEHENNEMI ⌟ | ' + (sourceName || '') + ' | ' + item.label,
          url:     json.download_link,
          quality: item.q === 'high' ? '1080p' : '720p',
          headers: { 'Referer': 'https://cehennempass.pw/download/' + videoId },
          subtitles: subtitles && subtitles.length ? subtitles : undefined
        };
      }
      return null;
    })
    .catch(function() { return null; });
  });

  return Promise.all(promises).then(function(res) {
    return res.filter(Boolean);
  });
}

// ── YOL 2a: POST /ah/ ────────────────────────────────────────

function tryAhEndpoint(videoId, cookie, embedUrl, subtitles, filename) {
  if (!videoId) return Promise.resolve([]);
  var ahUrl  = 'https://hdfilmcehennemi.mobi/video/embed/' + videoId + '/ah/';
  var ahHdrs = Object.assign({}, AH_HEADERS_EXTRA, {
    'Origin':  'https://hdfilmcehennemi.mobi',
    'Referer': embedUrl
  });
  if (cookie) ahHdrs['Cookie'] = cookie;

  return fetch(ahUrl, { method: 'POST', headers: ahHdrs, body: AH_HASH })
    .then(function(r) { return r.text(); })
    .then(function(body) {
      if (!body || body.length < 5) return [];
      if (body.indexOf('#EXTM3U') !== -1) return buildStreamsFromM3u8(body, ahUrl, subtitles);
      var urlM = body.match(/(https?:\/\/[^\s"'<>\n]+(?:master\.txt|\.m3u8)[^\s"'<>\n]*)/i);
      if (urlM) return fetchMasterAndBuild(urlM[1], subtitles);
      var trimmed = body.trim();
      if (trimmed.indexOf('http') === 0 && trimmed.indexOf(' ') === -1) return fetchMasterAndBuild(trimmed, subtitles);
      return [];
    })
    .catch(function() { return []; });
}

// ── YOL 2b: CDN host denemesi ────────────────────────────────

function tryCdnHosts(filename, subtitles) {
  return new Promise(function(resolve) {
    var done = 0, settled = false;
    CDN_HOSTS.forEach(function(host) {
      var masterUrl = host + '/hls/' + filename + '.mp4/txt/master.txt';
      fetch(masterUrl, {
        headers: {
          'User-Agent': EMBED_HEADERS['User-Agent'],
          'Accept':     '*/*',
          'Origin':     'https://hdfilmcehennemi.mobi',
          'Referer':    'https://hdfilmcehennemi.mobi/'
        }
      })
      .then(function(r) {
        done++;
        if (settled) return;
        if (r.ok) {
          return r.text().then(function(m3u8) {
            if (m3u8.indexOf('#EXTM3U') !== -1) {
              settled = true;
              resolve(buildStreamsFromM3u8(m3u8, masterUrl, subtitles));
            } else if (done >= CDN_HOSTS.length) resolve([]);
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

// ── Embed sayfası → stream ───────────────────────────────────
// Python: invoke_local_source

function fetchStreamsFromEmbed(embedUrl, pageReferer, sourceName) {
  var hdrs = Object.assign({}, EMBED_HEADERS, {
    'Referer': pageReferer,
    'Cookie':  'guide_tooltip_closeloadxx=1',
    'Origin':  pageReferer.split('/').slice(0, 3).join('/')
  });

  return fetch(embedUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      var cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      return r.text().then(function(html) { return { html: html, cookie: cookie }; });
    })
    .then(function(res) {
      var html   = res.html;
      var cookie = res.cookie;

      // Boş yanıt → CehennemPass fallback
      if (!html || html.length < 50) {
        var videoId = (embedUrl.match(/\/(?:video\/embed|rplayer)\/([^\/\?]+)/) || [])[1];
        return videoId ? tryCehennemPass(videoId, sourceName, []) : [];
      }

      var subtitles = extractSubtitles(html);

      // YOL 1: Video URL doğrudan çıkarılabiliyorsa
      var videoUrl = extractVideoUrl(html);
      if (videoUrl) {
        if (videoUrl.indexOf('master.txt') !== -1 || videoUrl.indexOf('.m3u8') !== -1) {
          return fetchMasterAndBuild(videoUrl, subtitles);
        }
        return [{
          name:     'HDFilmCehennemi',
          title:    '⌜ HDFILMCEHENNEMI ⌟ | ' + (sourceName || '') + ' | Auto',
          url:      videoUrl,
          quality:  'Auto',
          headers:  { 'Referer': pageReferer },
          subtitles: subtitles.length ? subtitles : undefined
        }];
      }

      // YOL 2: videoId + POST /ah/ + CDN paralel
      var thumbM   = html.match(/hdfilmcehennemi\.mobi\/img\/([^"'\s]+)\.(?:jpg|webp)/i);
      var filename = thumbM ? thumbM[1] : null;
      var videoId  = (embedUrl.match(/\/(?:video\/embed|rplayer)\/([^\/\?]+)/) || [])[1];

      return Promise.all([
        tryAhEndpoint(videoId, cookie, embedUrl, subtitles, filename),
        filename ? tryCdnHosts(filename, subtitles) : Promise.resolve([])
      ]).then(function(results) {
        var all  = (results[0] || []).concat(results[1] || []);
        // Hiçbir şey bulunamadıysa CehennemPass son çare
        if (!all.length && videoId) return tryCehennemPass(videoId, sourceName, subtitles);
        return all;
      });
    })
    .catch(function() { return []; });
}

// ── Video source API çağrısı ─────────────────────────────────
// Python: _get_video_source — /video/{id}/ → iframe → embed

function fetchVideoSource(domain, videoId, sourceName, referer) {
  var apiUrl = domain + '/video/' + videoId + '/';
  var hdrs = {
    'Content-Type':     'application/json',
    'X-Requested-With': 'fetch',
    'Referer':          referer
  };

  return fetch(apiUrl, { headers: hdrs })
    .then(function(r) {
      if (!r.ok) return null;
      return r.json();
    })
    .then(function(json) {
      if (!json) return null;
      var htmlContent = (json.data || {}).html || '';

      // iframe data-src bul
      var iframeM = htmlContent.match(/data-src=["']([^"']+)["']/) ||
                    htmlContent.match(/src=["'](https?:\/\/[^"']+)["']/);
      if (!iframeM) {
        // Regex fallback: kaçış karakterli JSON içi
        var escaped = htmlContent.match(/data-src=\\"([^"]+)\\"/);
        if (escaped) return escaped[1].replace(/\\/g, '');
        return null;
      }
      return iframeM[1].replace(/\\/g, '');
    })
    .then(function(iframe) {
      if (!iframe) return [];

      // mobi URL'si → direkt kullan
      if (iframe.indexOf('mobi') !== -1) {
        iframe = iframe.split('?')[0];
      }
      // rapidrame URL → /rplayer/{id}/ formatına çevir
      else if (iframe.indexOf('rapidrame') !== -1 && iframe.indexOf('?rapidrame_id=') !== -1) {
        var rapId = iframe.split('?rapidrame_id=')[1];
        iframe = domain + '/rplayer/' + rapId + '/';
      }

      return fetchStreamsFromEmbed(iframe, referer, sourceName);
    })
    .catch(function() { return []; });
}

// ── Film sayfasından tüm kaynakları çek ─────────────────────
// Python: load_links — div.alternative-links → video_id'ler

function fetchAllSources(domain, pageUrl, pageHtml) {
  // div.alternative-links bloklarını parse et
  var sources = [];
  var altBlockRe = /<div[^>]+class="[^"]*alternative-links[^"]*"[^>]*data-lang="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi;
  var blockM;

  while ((blockM = altBlockRe.exec(pageHtml)) !== null) {
    var langCode  = (blockM[1] || '').toUpperCase();
    var blockHtml = blockM[2];

    // Dil butonundan daha güzel isim al
    var langBtnM = pageHtml.match(
      new RegExp('<button[^>]+class="[^"]*language-link[^"]*"[^>]+data-lang="' + langCode.toLowerCase() + '"[^>]*>([^<]+)<\/button>', 'i')
    );
    if (langBtnM) {
      var langText = langBtnM[1].trim();
      langCode = langText.indexOf('DUAL') !== -1 ? 'DUAL' : langText;
    }

    // button.alternative-link içindeki video ID'leri
    var btnRe = /<button[^>]+class="[^"]*alternative-link[^"]*"[^>]+data-video="([^"]+)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/button>/gi;
    var btnM;
    while ((btnM = btnRe.exec(blockHtml)) !== null) {
      var videoId = btnM[1];
      // Kaynak adını temizle
      var sourceText = btnM[0]
        .replace(/<[^>]+>/g, '')
        .replace(/\(HDrip Xbet\)/gi, '')
        .trim();
      var sourceName = (langCode + ' | ' + sourceText).trim().replace(/\|\s*$/, '');
      if (videoId) sources.push({ videoId: videoId, sourceName: sourceName });
    }
  }

  if (!sources.length) return Promise.resolve([]);

  var promises = sources.map(function(s) {
    return fetchVideoSource(domain, s.videoId, s.sourceName, pageUrl);
  });

  return Promise.all(promises).then(function(results) {
    var all = [];
    results.forEach(function(arr) {
      (arr || []).forEach(function(s) { if (s) all.push(s); });
    });
    return all;
  });
}

// ── Ana fonksiyon ────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([getActiveDomain(), fetchTmdbInfo(tmdbId, mediaType)])
    .then(function(init) {
      var domain = init[0];
      var info   = init[1];

      // Hem TR hem EN başlıkla ara, sonuçları birleştir
      var searches = [searchSite(domain, info.titleTr)];
      if (info.titleEn && info.titleEn !== info.titleTr) {
        searches.push(searchSite(domain, info.titleEn));
      }

      return Promise.all(searches).then(function(all) {
        var seen = {}, combined = [];
        (all[0] || []).concat(all[1] || []).forEach(function(r) {
          if (!seen[r.href]) { seen[r.href] = true; combined.push(r); }
        });
        if (!combined.length) return null;

        var pageUrl = pickBest(combined, info.titleTr, info.titleEn, info.year, mediaType);
        if (!pageUrl) return null;

        // Dizi ise bölüm URL'si inşa et
        if (mediaType === 'tv' && season && episode) {
          pageUrl = buildEpisodeUrl(pageUrl, season, episode);
        }

        return fetch(pageUrl, {
          headers: Object.assign({}, PAGE_HEADERS, { 'Referer': domain + '/' })
        })
        .then(function(r) {
          return r.text().then(function(html) {
            return { domain: domain, html: html, url: pageUrl };
          });
        });
      });
    })
    .then(function(result) {
      if (!result) return [];
      return fetchAllSources(result.domain, result.url, result.html);
    })
    .then(function(streams) {
      // Tekrar eden URL'leri temizle
      var seen = {}, out = [];
      (streams || []).forEach(function(s) {
        if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); }
      });
      return out;
    })
    .catch(function(err) {
      console.error('[HDFilmCehennemi] Hata:', err && err.message ? err.message : err);
      return [];
    });
}

// ── Export ───────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
