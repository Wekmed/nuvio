// ============================================================
//  CizgiMax — Nuvio Provider (v2)
//  KekikStream CizgiMax.py + BePlayerExtractor'dan dönüştürüldü
//  Sadece Dizi/Animasyon destekler (TV only)
//  CizgiPass player: bePlayer("pass", "{encrypted}") → AES decrypt → video_location
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ── Yardımcılar ───────────────────────────────────────────────
function fixUrl(url) {
  if (!url) return '';
  url = url.trim();
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  if (url.startsWith('/'))    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

function getHtml(url, extraHeaders) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extraHeaders || {}) })
    .then(function(r) { return r.text(); });
}

function reFind(html, pattern) {
  var m = html.match(pattern);
  return m ? m[1] : null;
}

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/tv/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.name || '',
        titleEn: d.original_name || '',
        year:    (d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Arama ────────────────────────────────────────────────────
function searchCizgiMax(query) {
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var items = (data.data || {}).result || [];
      return items.filter(function(item) {
        return !/(\.Bölüm|\.Sezon|-Sezon|-izle)/i.test(item.s_name || '');
      });
    })
    .catch(function() { return []; });
}

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBestMatch(items, titleEn, titleTr) {
  var nEn = normalize(titleEn), nTr = normalize(titleTr);
  var scored = items.map(function(item) {
    var n = normalize(item.s_name || '');
    var s = 0;
    if (n === nEn || n === nTr) s = 100;
    else if (n.indexOf(nEn) !== -1 || nEn.indexOf(n) !== -1) s = 60;
    else if (n.indexOf(nTr) !== -1 || nTr.indexOf(n) !== -1) s = 60;
    return { item: item, score: s };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 60) ? scored[0].item : null;
}

// ── Sezon/Bölüm parse ─────────────────────────────────────────
function extractSeasonEpisode(text) {
  var s = 1, e = 1;
  var sm = text.match(/(\d+)\s*\.?\s*[Ss]ezon/i);
  var em = text.match(/(\d+)\s*\.?\s*[Bb]ölüm/i)
        || text.match(/[Bb]ölüm\s*(\d+)/i)
        || text.match(/Ep\.?\s*(\d+)/i);
  if (sm) s = parseInt(sm[1]);
  if (em) e = parseInt(em[1]);
  return { season: s, episode: e };
}

// ── Bölüm listesi ─────────────────────────────────────────────
function fetchShowEpisodes(showUrl) {
  return getHtml(showUrl).then(function(html) {
    var episodes = [];
    var linkRe = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*season-name[^"]*"[^>]*>([^<]*)<\/span>[\s\S]*?<span[^>]*class="[^"]*episode-names[^"]*"[^>]*>([^<]*)<\/span>/gi;
    var m;
    while ((m = linkRe.exec(html)) !== null) {
      var se = extractSeasonEpisode(m[2] + ' ' + m[3]);
      episodes.push({ season: se.season, episode: se.episode, title: m[3].trim(), url: fixUrl(m[1]) });
    }
    return episodes;
  });
}

// ── data-frame iframe'leri ────────────────────────────────────
function fetchEpisodeIframes(epUrl) {
  return getHtml(epUrl, { 'Referer': MAIN_URL + '/' }).then(function(html) {
    var iframes = [], re = /data-frame="([^"]+)"/gi, m;
    while ((m = re.exec(html)) !== null) {
      var src = fixUrl(m[1].trim());
      if (src && iframes.indexOf(src) === -1) iframes.push(src);
    }
    return iframes;
  });
}

// ── BePlayer AES Decrypt (OpenSSL EVP_BytesToKey + AES-256-CBC) ───
// KekikStream BePlayerExtractor.decrypt_beplayer() tam JS karşılığı
// CryptoJS.AES şifreleme: bePlayer("PASSWORD", '{"ct":"...","iv":"...","s":"..."}')

function md5(data) {
  // Lightweight MD5 — SubtleCrypto MD5 desteklemediği için
  function safeAdd(x, y) {
    var l = (x & 0xFFFF) + (y & 0xFFFF);
    return ((x >> 16) + (y >> 16) + (l >> 16)) << 16 | (l & 0xFFFF);
  }
  function rol(n, s) { return n << s | n >>> (32 - s); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t) { return cmn((b&c)|(~b&d),a,b,x,s,t); }
  function gg(a,b,c,d,x,s,t) { return cmn((b&d)|(c&~d),a,b,x,s,t); }
  function hh(a,b,c,d,x,s,t) { return cmn(b^c^d,a,b,x,s,t); }
  function ii(a,b,c,d,x,s,t) { return cmn(c^(b|~d),a,b,x,s,t); }

  var len = data.length;
  var words = [];
  for (var i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | data[i] << (i % 4 * 8);
  words[len >> 2] |= 0x80 << (len % 4 * 8);
  words[((len + 72 >> 6) << 4) + 14] = len * 8;

  var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  for (var i = 0; i < words.length; i += 16) {
    var A=a, B=b, C=c, D=d;
    a=ff(a,b,c,d,words[i+0],7,-680876936);   b=ff(d,a,b,c,words[i+1],12,-389564586);
    c=ff(c,d,a,b,words[i+2],17,606105819);   d=ff(b,c,d,a,words[i+3],22,-1044525330);
    a=ff(a,b,c,d,words[i+4],7,-176418897);   b=ff(d,a,b,c,words[i+5],12,1200080426);
    c=ff(c,d,a,b,words[i+6],17,-1473231341); d=ff(b,c,d,a,words[i+7],22,-45705983);
    a=ff(a,b,c,d,words[i+8],7,1770035416);   b=ff(d,a,b,c,words[i+9],12,-1958414417);
    c=ff(c,d,a,b,words[i+10],17,-42063);     d=ff(b,c,d,a,words[i+11],22,-1990404162);
    a=ff(a,b,c,d,words[i+12],7,1804603682);  b=ff(d,a,b,c,words[i+13],12,-40341101);
    c=ff(c,d,a,b,words[i+14],17,-1502002290);d=ff(b,c,d,a,words[i+15],22,1236535329);
    a=gg(a,b,c,d,words[i+1],5,-165796510);   b=gg(d,a,b,c,words[i+6],9,-1069501632);
    c=gg(c,d,a,b,words[i+11],14,643717713);  d=gg(b,c,d,a,words[i+0],20,-373897302);
    a=gg(a,b,c,d,words[i+5],5,-701558691);   b=gg(d,a,b,c,words[i+10],9,38016083);
    c=gg(c,d,a,b,words[i+15],14,-660478335); d=gg(b,c,d,a,words[i+4],20,-405537848);
    a=gg(a,b,c,d,words[i+9],5,568446438);    b=gg(d,a,b,c,words[i+14],9,-1019803690);
    c=gg(c,d,a,b,words[i+3],14,-187363961);  d=gg(b,c,d,a,words[i+8],20,1163531501);
    a=gg(a,b,c,d,words[i+13],5,-1444681467); b=gg(d,a,b,c,words[i+2],9,-51403784);
    c=gg(c,d,a,b,words[i+7],14,1735328473);  d=gg(b,c,d,a,words[i+12],20,-1926607734);
    a=hh(a,b,c,d,words[i+5],4,-378558);      b=hh(d,a,b,c,words[i+8],11,-2022574463);
    c=hh(c,d,a,b,words[i+11],16,1839030562); d=hh(b,c,d,a,words[i+14],23,-35309556);
    a=hh(a,b,c,d,words[i+1],4,-1530992060);  b=hh(d,a,b,c,words[i+4],11,1272893353);
    c=hh(c,d,a,b,words[i+7],16,-155497632);  d=hh(b,c,d,a,words[i+10],23,-1094730640);
    a=hh(a,b,c,d,words[i+13],4,681279174);   b=hh(d,a,b,c,words[i+0],11,-358537222);
    c=hh(c,d,a,b,words[i+3],16,-722521979);  d=hh(b,c,d,a,words[i+6],23,76029189);
    a=hh(a,b,c,d,words[i+9],4,-640364487);   b=hh(d,a,b,c,words[i+12],11,-421815835);
    c=hh(c,d,a,b,words[i+15],16,530742520);  d=hh(b,c,d,a,words[i+2],23,-995338651);
    a=ii(a,b,c,d,words[i+0],6,-198630844);   b=ii(d,a,b,c,words[i+7],10,1126891415);
    c=ii(c,d,a,b,words[i+14],15,-1416354905);d=ii(b,c,d,a,words[i+5],21,-57434055);
    a=ii(a,b,c,d,words[i+12],6,1700485571);  b=ii(d,a,b,c,words[i+3],10,-1894986606);
    c=ii(c,d,a,b,words[i+10],15,-1051523);   d=ii(b,c,d,a,words[i+1],21,-2054922799);
    a=ii(a,b,c,d,words[i+8],6,1873313359);   b=ii(d,a,b,c,words[i+15],10,-30611744);
    c=ii(c,d,a,b,words[i+6],15,-1560198380); d=ii(b,c,d,a,words[i+13],21,1309151649);
    a=ii(a,b,c,d,words[i+4],6,-145523070);   b=ii(d,a,b,c,words[i+11],10,-1120210379);
    c=ii(c,d,a,b,words[i+2],15,718787259);   d=ii(b,c,d,a,words[i+9],21,-343485551);
    a=safeAdd(a,A); b=safeAdd(b,B); c=safeAdd(c,C); d=safeAdd(d,D);
  }
  var out = new Uint8Array(16);
  for (var i = 0; i < 4; i++) {
    out[i]    = (a >> i*8) & 0xFF; out[i+4]  = (b >> i*8) & 0xFF;
    out[i+8]  = (c >> i*8) & 0xFF; out[i+12] = (d >> i*8) & 0xFF;
  }
  return out;
}

function evpBytesToKey(password, salt) {
  // OpenSSL EVP_BytesToKey: key(32) + iv(16) türet
  var p = new TextEncoder().encode(password);
  var s = salt || new Uint8Array(0);

  function concat() {
    var args = Array.prototype.slice.call(arguments);
    var len = args.reduce(function(acc, a) { return acc + a.length; }, 0);
    var out = new Uint8Array(len), off = 0;
    args.forEach(function(a) { out.set(a, off); off += a.length; });
    return out;
  }

  var d0 = md5(concat(p, s));
  var d1 = md5(concat(d0, p, s));
  var d2 = md5(concat(d1, p, s));

  return { key: concat(d0, d1), iv: d2.slice(0, 16) };
}

function bePlayerDecrypt(password, encryptedData) {
  // CryptoJS JSON formatı: {"ct":"...","iv":"HEX","s":"HEX"}
  var parsed = null;
  try { parsed = JSON.parse(encryptedData); } catch(e) {}

  var cipherBytes, ivBytes, saltBytes;

  if (parsed && parsed.ct) {
    // Base64 → bytes
    var raw = atob(parsed.ct);
    cipherBytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) cipherBytes[i] = raw.charCodeAt(i);

    // Salt (hex)
    if (parsed.s) {
      saltBytes = new Uint8Array(8);
      for (var i = 0; i < 8; i++) saltBytes[i] = parseInt(parsed.s.slice(i*2, i*2+2), 16);
    } else {
      saltBytes = new Uint8Array(0);
    }

    // IV (hex) varsa EVP'siz direkt kullan
    if (parsed.iv) {
      ivBytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) ivBytes[i] = parseInt(parsed.iv.slice(i*2, i*2+2), 16);
      var derived = evpBytesToKey(password, saltBytes);

      return crypto.subtle.importKey('raw', derived.key, { name: 'AES-CBC' }, false, ['decrypt'])
        .then(function(k) { return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, k, cipherBytes); })
        .then(unpad);
    }
  }

  // OpenSSL Salted__ formatı: Base64("Salted__" + 8b_salt + cipher)
  var raw2 = atob((encryptedData || '').trim());
  var rawBytes = new Uint8Array(raw2.length);
  for (var i = 0; i < raw2.length; i++) rawBytes[i] = raw2.charCodeAt(i);

  var hasSalt = raw2.slice(0, 8) === 'Salted__';
  if (hasSalt) {
    saltBytes   = rawBytes.slice(8, 16);
    cipherBytes = rawBytes.slice(16);
  } else {
    saltBytes   = new Uint8Array(0);
    cipherBytes = rawBytes;
  }

  var derived = evpBytesToKey(password, saltBytes);
  return crypto.subtle.importKey('raw', derived.key, { name: 'AES-CBC' }, false, ['decrypt'])
    .then(function(k) { return crypto.subtle.decrypt({ name: 'AES-CBC', iv: derived.iv }, k, cipherBytes); })
    .then(unpad);
}

function unpad(buf) {
  var bytes = new Uint8Array(buf);
  var pad   = bytes[bytes.length - 1];
  if (pad > 0 && pad <= 16) bytes = bytes.slice(0, bytes.length - pad);
  return new TextDecoder().decode(bytes);
}

// ── CizgiPass / BePlayer extractor ───────────────────────────
function extractCizgiPass(iframeSrc) {
  var label = '⌜ CİZGİMAX ⌟';

  return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // bePlayer("PASS", '{"ct":"...","iv":"...","s":"..."}')  — çeşitli tırnak kombinasyonları
      var m = html.match(/bePlayer\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"](\{[\s\S]+?\})['"]\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]+\})"\s*\)/)
           || html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']+\})'\s*\)/);

      if (!m) {
        // Fallback: düz file:
        var fm = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i)
              || html.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)['"]/i);
        if (fm) return {
          url: fm[1], name: label, title: label,
          quality: 'Auto', type: fm[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
          headers: { 'Referer': iframeSrc }
        };
        console.log('[CizgiMax] bePlayer bulunamadı: ' + iframeSrc);
        return null;
      }

      var pass      = m[1];
      var encrypted = m[2];
      console.log('[CizgiMax] bePlayer bulundu, çözülüyor...');

      return bePlayerDecrypt(pass, encrypted)
        .then(function(decrypted) {
          var data;
          try { data = JSON.parse(decrypted); }
          catch(e) {
            var u = decrypted.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i)
                 || decrypted.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
            return u ? { url: u[1], name: label, title: label, quality: 'Auto',
                         type: 'direct', headers: { 'Referer': iframeSrc } } : null;
          }

          // video_location — BePlayerExtractor'ın beklediği alan
          var videoUrl = data.video_location
            || (data.schedule && data.schedule.client &&
                reFind(String(data.schedule.client), /"video_location":"([^"]+)"/))
            || data.file || data.src || data.url;

          if (!videoUrl) return null;

          // Altyazılar
          var subs = [];
          (data.strSubtitles || []).forEach(function(sub) {
            if (sub.file && sub.label && sub.label.indexOf('Forced') === -1)
              subs.push({ label: sub.label.toUpperCase(), url: sub.file });
          });

          return {
            url:       videoUrl,
            name:      label,
            title:     label + (subs.length ? ' | ' + subs.map(function(s){ return s.label; }).join('/') : ''),
            quality:   'Auto',
            type:      videoUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
            headers:   { 'Referer': iframeSrc },
            subtitles: subs
          };
        })
        .catch(function(e) { console.error('[CizgiMax] Decrypt hata:', e.message); return null; });
    })
    .catch(function(e) { console.error('[CizgiMax] Fetch hata:', e.message); return null; });
}

// ── Genel extractor ───────────────────────────────────────────
function extractStream(iframeSrc) {
  // CizgiPass player (cizgimax'ın kendi player'ı)
  if (iframeSrc.indexOf('cizgipass') !== -1) return extractCizgiPass(iframeSrc);

  var label = '⌜ CİZGİMAX ⌟';

  if (iframeSrc.indexOf('vidmoly') !== -1) {
    return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        return m ? { url: m[1], name: label, title: label + ' | VidMoly',
                     quality: 'Auto', type: 'hls', headers: { 'Referer': iframeSrc } } : null;
      }).catch(function() { return null; });
  }

  if (iframeSrc.indexOf('sibnet.ru') !== -1) {
    var idM = iframeSrc.match(/videoid=(\d+)/) || iframeSrc.match(/video(\d+)/);
    if (!idM) return Promise.resolve(null);
    var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + idM[1];
    return fetch(shellUrl, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' }) })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
        return m ? { url: 'https://video.sibnet.ru' + m[1], name: label, title: label + ' | Sibnet',
                     quality: 'Auto', type: 'direct', headers: { 'Referer': shellUrl } } : null;
      }).catch(function() { return null; });
  }

  if (iframeSrc.indexOf('youtube.com/embed') !== -1 || iframeSrc.indexOf('youtu.be') !== -1) {
    var ytId = reFind(iframeSrc, /(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return Promise.resolve(ytId ? { url: 'https://www.youtube.com/watch?v=' + ytId,
      name: label, title: label + ' | YouTube', quality: 'Auto', type: 'direct', headers: {} } : null);
  }

  // Generic fallback
  return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m3u8 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m3u8) return { url: m3u8[1], name: label, title: label,
                          quality: 'Auto', type: 'hls', headers: { 'Referer': iframeSrc } };
      var mp4 = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
      if (mp4)  return { url: mp4[1],  name: label, title: label,
                          quality: 'Auto', type: 'direct', headers: { 'Referer': iframeSrc } };
      return null;
    }).catch(function() { return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);
  console.log('[CizgiMax] TMDB:' + tmdbId + ' S' + seasonNum + 'E' + episodeNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
      return searchCizgiMax(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn)
            return searchCizgiMax(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          return best;
        })
        .then(function(best) {
          if (!best) { console.log('[CizgiMax] Bulunamadı: ' + info.titleEn); return []; }
          var showUrl = fixUrl(best.s_link);
          console.log('[CizgiMax] Bulundu: ' + best.s_name + ' → ' + showUrl);

          var sNum = parseInt(seasonNum) || 1;
          var eNum = parseInt(episodeNum) || 1;

          return fetchShowEpisodes(showUrl).then(function(episodes) {
            var matched = episodes.filter(function(ep) {
              return ep.season === sNum && ep.episode === eNum;
            });
            if (!matched.length)
              matched = episodes.filter(function(ep) { return ep.episode === eNum; });
            if (!matched.length) {
              console.log('[CizgiMax] Bölüm bulunamadı S' + sNum + 'E' + eNum);
              return [];
            }

            console.log('[CizgiMax] Bölüm: ' + matched[0].url);
            return fetchEpisodeIframes(matched[0].url).then(function(iframes) {
              if (!iframes.length) return [];
              return Promise.all(iframes.map(extractStream))
                .then(function(s) { return s.filter(Boolean); });
            });
          });
        });
    })
    .then(function(streams) {
      var seen = {}, unique = streams.filter(function(s) {
        if (seen[s.url]) return false;
        seen[s.url] = true; return true;
      });
      console.log('[CizgiMax] Toplam stream: ' + unique.length);
      return unique;
    })
    .catch(function(err) { console.error('[CizgiMax] Hata:', err.message || err); return []; });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
                                                  
