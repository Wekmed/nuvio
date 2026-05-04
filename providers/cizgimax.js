// ============================================================
//  CizgiMax — Nuvio Provider (v3)
//  Gerçek akış (Network loglarından doğrulandı):
//  1. /ajaxservice/index.php?qr= → dizi slug'ı bul
//  2. Dizi sayfasından bölüm URL'leri çek (statik HTML'de mevcut)
//  3. Bölüm sayfasından cizgipass embed URL'ini bul (AJAX değil, sayfada var)
//  4. cizgipass100.online/embed/ID → bePlayer("PASS","{"ct","iv","s"}") → AES decrypt → video_location (/list/BASE64)
//  5. /list/BASE64 → master m3u8 → oynat
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
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
  return fetch(url, {
    headers: Object.assign({}, HEADERS, extraHeaders || {})
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
    return r.text();
  });
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
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), {
    headers: HEADERS
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var items = (data.data || {}).result || [];
      // Sadece ana dizi sayfalarını al, bölüm/sezon satırlarını filtrele
      return items.filter(function(item) {
        return !/(\.Bölüm|\.Sezon|-Sezon|-izle\s*\d)/i.test(item.s_name || '');
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
    if (n === nEn || n === nTr)                                    s = 100;
    else if (n.indexOf(nEn) !== -1 || nEn.indexOf(n) !== -1)      s = 70;
    else if (n.indexOf(nTr) !== -1 || nTr.indexOf(n) !== -1)      s = 70;
    return { item: item, score: s };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 60) ? scored[0].item : null;
}

// ── Bölüm URL'i oluştur ───────────────────────────────────────
// CizgiMax bölüm URL yapısı iki formatta olabiliyor:
//   /dizi-slug-X-sezon-Y-bolum-izle/   (eski)
//   /dizi-adi-X-sezon-Y-bolum/          (yeni, Türkçe başlıkla)
// Dizi sayfasından parse etmek en güvenilir yol.

function extractSeasonEpisode(text) {
  var s = 1, e = 1;
  var sm = text.match(/(\d+)\s*\.?\s*[Ss]ezon/i);
  var em = text.match(/(\d+)\s*\.?\s*[Bb]ölüm/i)
        || text.match(/[Bb]ölüm\s*(\d+)/i);
  if (sm) s = parseInt(sm[1]);
  if (em) e = parseInt(em[1]);
  return { season: s, episode: e };
}

// Dizi sayfasından tüm bölüm linklerini çek
// Gerçek HTML'de: <a href="/big-city-greens-1-sezon-1-bolum-izle/"> gibi linkler var
function fetchShowEpisodes(showUrl) {
  return getHtml(showUrl).then(function(html) {
    var episodes = [];

    // Bölüm linkleri: <a href="..."> içinde sezon/bölüm bilgisi geçenler
    // Gerçek CizgiMax HTML'inde bölümler şöyle listeleniyor:
    // <a href="/slug-X-sezon-Y-bolum-izle/">  veya /slug-X-sezon-Y-bolum/
    var re = /href="(https?:\/\/cizgimax\.online\/[^"]*(?:sezon|bolum)[^"]*|\/[^"]*(?:sezon|bolum)[^"]*)"/gi;
    var seen = {};
    var m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1].indexOf('http') === 0 ? m[1] : fixUrl(m[1]);
      if (seen[href]) continue;
      seen[href] = true;

      // URL'den sezon/bölüm çıkar
      var se = extractSeasonEpisode(href);
      if (se.episode > 0) {
        episodes.push({ season: se.season, episode: se.episode, url: href });
      }
    }

    return episodes;
  });
}

// ── Bölüm sayfasından cizgipass embed URL'ini al ──────────────
// Gerçek bölüm sayfasında player direkt HTML'de var ama
// "CIZGIMAX+" üyelik duvarı arkasında olabilir.
// data-frame veya iframe src olarak cizgipass URL'i bulunur.
function fetchCizgipassUrl(epUrl) {
  return getHtml(epUrl, { 'Referer': MAIN_URL + '/' }).then(function(html) {
    // 1. data-frame attribute'u ile
    var m = html.match(/data-frame="(https?:\/\/cizgipass[^"]+)"/i);
    if (m) return m[1];

    // 2. iframe src ile
    m = html.match(/<iframe[^>]+src="(https?:\/\/cizgipass[^"]+)"/i);
    if (m) return m[1];

    // 3. Herhangi bir cizgipass URL'i
    m = html.match(/(https?:\/\/cizgipass\d*\.online\/embed\/[a-zA-Z0-9]+)/i);
    if (m) return m[1];

    // 4. data-src ile (lazy load)
    m = html.match(/data-src="(https?:\/\/cizgipass[^"]+)"/i);
    if (m) return m[1];

    return null;
  });
}

// ── MD5 implementasyonu (crypto.subtle MD5 desteklemez) ───────
function md5(data) {
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

  var bytes = data;
  var len   = bytes.length;
  var words = new Array(len >> 2);
  for (var i = 0; i < words.length; i++) words[i] = 0;
  for (var i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (i % 4 * 8);
  words[len >> 2] |= 0x80 << (len % 4 * 8);
  words[((len + 72 >> 6) << 4) + 14] = len * 8;

  var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  for (var i = 0; i < words.length; i += 16) {
    var A=a, B=b, C=c, D=d;
    a=ff(a,b,c,d,words[i+0],7,-680876936);    b=ff(d,a,b,c,words[i+1],12,-389564586);
    c=ff(c,d,a,b,words[i+2],17,606105819);    d=ff(b,c,d,a,words[i+3],22,-1044525330);
    a=ff(a,b,c,d,words[i+4],7,-176418897);    b=ff(d,a,b,c,words[i+5],12,1200080426);
    c=ff(c,d,a,b,words[i+6],17,-1473231341);  d=ff(b,c,d,a,words[i+7],22,-45705983);
    a=ff(a,b,c,d,words[i+8],7,1770035416);    b=ff(d,a,b,c,words[i+9],12,-1958414417);
    c=ff(c,d,a,b,words[i+10],17,-42063);      d=ff(b,c,d,a,words[i+11],22,-1990404162);
    a=ff(a,b,c,d,words[i+12],7,1804603682);   b=ff(d,a,b,c,words[i+13],12,-40341101);
    c=ff(c,d,a,b,words[i+14],17,-1502002290); d=ff(b,c,d,a,words[i+15],22,1236535329);
    a=gg(a,b,c,d,words[i+1],5,-165796510);    b=gg(d,a,b,c,words[i+6],9,-1069501632);
    c=gg(c,d,a,b,words[i+11],14,643717713);   d=gg(b,c,d,a,words[i+0],20,-373897302);
    a=gg(a,b,c,d,words[i+5],5,-701558691);    b=gg(d,a,b,c,words[i+10],9,38016083);
    c=gg(c,d,a,b,words[i+15],14,-660478335);  d=gg(b,c,d,a,words[i+4],20,-405537848);
    a=gg(a,b,c,d,words[i+9],5,568446438);     b=gg(d,a,b,c,words[i+14],9,-1019803690);
    c=gg(c,d,a,b,words[i+3],14,-187363961);   d=gg(b,c,d,a,words[i+8],20,1163531501);
    a=gg(a,b,c,d,words[i+13],5,-1444681467);  b=gg(d,a,b,c,words[i+2],9,-51403784);
    c=gg(c,d,a,b,words[i+7],14,1735328473);   d=gg(b,c,d,a,words[i+12],20,-1926607734);
    a=hh(a,b,c,d,words[i+5],4,-378558);       b=hh(d,a,b,c,words[i+8],11,-2022574463);
    c=hh(c,d,a,b,words[i+11],16,1839030562);  d=hh(b,c,d,a,words[i+14],23,-35309556);
    a=hh(a,b,c,d,words[i+1],4,-1530992060);   b=hh(d,a,b,c,words[i+4],11,1272893353);
    c=hh(c,d,a,b,words[i+7],16,-155497632);   d=hh(b,c,d,a,words[i+10],23,-1094730640);
    a=hh(a,b,c,d,words[i+13],4,681279174);    b=hh(d,a,b,c,words[i+0],11,-358537222);
    c=hh(c,d,a,b,words[i+3],16,-722521979);   d=hh(b,c,d,a,words[i+6],23,76029189);
    a=hh(a,b,c,d,words[i+9],4,-640364487);    b=hh(d,a,b,c,words[i+12],11,-421815835);
    c=hh(c,d,a,b,words[i+15],16,530742520);   d=hh(b,c,d,a,words[i+2],23,-995338651);
    a=ii(a,b,c,d,words[i+0],6,-198630844);    b=ii(d,a,b,c,words[i+7],10,1126891415);
    c=ii(c,d,a,b,words[i+14],15,-1416354905); d=ii(b,c,d,a,words[i+5],21,-57434055);
    a=ii(a,b,c,d,words[i+12],6,1700485571);   b=ii(d,a,b,c,words[i+3],10,-1894986606);
    c=ii(c,d,a,b,words[i+10],15,-1051523);    d=ii(b,c,d,a,words[i+1],21,-2054922799);
    a=ii(a,b,c,d,words[i+8],6,1873313359);    b=ii(d,a,b,c,words[i+15],10,-30611744);
    c=ii(c,d,a,b,words[i+6],15,-1560198380);  d=ii(b,c,d,a,words[i+13],21,1309151649);
    a=ii(a,b,c,d,words[i+4],6,-145523070);    b=ii(d,a,b,c,words[i+11],10,-1120210379);
    c=ii(c,d,a,b,words[i+2],15,718787259);    d=ii(b,c,d,a,words[i+9],21,-343485551);
    a=safeAdd(a,A); b=safeAdd(b,B); c=safeAdd(c,C); d=safeAdd(d,D);
  }
  var out = new Uint8Array(16);
  for (var i = 0; i < 4; i++) {
    out[i]    = (a >> i*8) & 0xFF;
    out[i+4]  = (b >> i*8) & 0xFF;
    out[i+8]  = (c >> i*8) & 0xFF;
    out[i+12] = (d >> i*8) & 0xFF;
  }
  return out;
}

// ── OpenSSL EVP_BytesToKey ────────────────────────────────────
// CryptoJS.AES şifrelemenin kullandığı key türetme algoritması
function evpBytesToKey(password, salt) {
  var p = new TextEncoder().encode(password);
  var s = salt || new Uint8Array(0);

  function cat() {
    var args = Array.prototype.slice.call(arguments);
    var len  = 0; args.forEach(function(a){ len += a.length; });
    var out  = new Uint8Array(len), off = 0;
    args.forEach(function(a){ out.set(a, off); off += a.length; });
    return out;
  }

  var d0 = md5(cat(p, s));
  var d1 = md5(cat(d0, p, s));
  var d2 = md5(cat(d1, p, s));

  return {
    key: cat(d0, d1),   // 32 byte
    iv:  d2.slice(0,16) // 16 byte
  };
}

// ── BePlayer AES-256-CBC Decrypt ─────────────────────────────
// Network'te görülen format: {"ct":"BASE64","iv":"HEX","s":"HEX"}
// s  = salt (hex, 8 byte)
// iv = initialization vector (hex, 16 byte)
// ct = ciphertext (base64)
function bePlayerDecrypt(password, encryptedJson) {
  var parsed;
  try { parsed = JSON.parse(encryptedJson); }
  catch(e) { return Promise.reject(new Error('JSON parse hatası')); }

  // ct: base64 → bytes
  var ctRaw = atob(parsed.ct);
  var ct    = new Uint8Array(ctRaw.length);
  for (var i = 0; i < ctRaw.length; i++) ct[i] = ctRaw.charCodeAt(i);

  // iv: hex → bytes
  var iv = new Uint8Array(16);
  for (var i = 0; i < 16; i++) iv[i] = parseInt(parsed.iv.slice(i*2, i*2+2), 16);

  // s (salt): hex → bytes  — EVP ile key türet
  var salt = new Uint8Array(8);
  if (parsed.s) {
    for (var i = 0; i < 8; i++) salt[i] = parseInt(parsed.s.slice(i*2, i*2+2), 16);
  }

  var derived = evpBytesToKey(password, salt);

  return crypto.subtle.importKey('raw', derived.key, { name: 'AES-CBC' }, false, ['decrypt'])
    .then(function(key) {
      return crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, key, ct);
    })
    .then(function(buf) {
      var bytes = new Uint8Array(buf);
      // PKCS7 padding kaldır
      var pad = bytes[bytes.length - 1];
      if (pad > 0 && pad <= 16) bytes = bytes.slice(0, bytes.length - pad);
      return new TextDecoder().decode(bytes);
    });
}

// ── CizgiPass embed'den video URL'i çek ───────────────────────
// Network logu doğruladı:
//   1. GET cizgipass100.online/embed/ID → HTML içinde bePlayer("pass","{"ct","iv","s"}")
//   2. Decrypt → JSON → video_location = "https://cizgipass100.online/list/BASE64"
//   3. GET /list/BASE64 → master m3u8 (zaten orada, ekstra istek gerekmez)
function extractFromCizgipass(embedUrl) {
  var label = '⌜ CİZGİMAX ⌟';

  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer':          MAIN_URL + '/',
      'sec-fetch-dest':   'iframe',
      'sec-fetch-mode':   'navigate',
      'sec-fetch-site':   'cross-site'
    })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // bePlayer("PASS", '{"ct":"...","iv":"...","s":"..."}')
      // BEPLAYER_REGEX = r"bePlayer\(['\"](.*?)['\"],\s*['\"](.*?)['\"]\);"
      var m = html.match(/bePlayer\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"](\{[^'"\\]*(?:\\.[^'"\\]*)*\})['"]\s*\)/);
      if (!m) {
        // Alternatif: tırnak kaçış karakterleri farklı olabilir
        m = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{.+?\})'\s*\)/s)
         || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{.+?\})"\s*\)/s);
      }

      if (!m) {
        console.log('[CizgiMax] bePlayer bulunamadı: ' + embedUrl);
        // Fallback: direkt file: ara
        var fm = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i);
        if (fm) return { url: fm[1], name: label, title: label,
                         quality: 'Auto', type: 'hls',
                         headers: { 'Referer': embedUrl } };
        return null;
      }

      var pass = m[1];
      var enc  = m[2];
      console.log('[CizgiMax] bePlayer bulundu, çözülüyor...');

      return bePlayerDecrypt(pass, enc)
        .then(function(decrypted) {
          console.log('[CizgiMax] Decrypt sonucu:', decrypted.slice(0, 100));

          var videoUrl = null;
          var subs     = [];

          try {
            var data = JSON.parse(decrypted);
            // video_location: "/list/BASE64" veya tam URL
            videoUrl = data.video_location
              || (data.schedule && data.schedule.client &&
                  reFind(String(data.schedule.client), /"video_location":"([^"]+)"/))
              || data.file
              || data.src;

            // Altyazılar
            (data.strSubtitles || []).forEach(function(sub) {
              if (sub.file && sub.label && sub.label.indexOf('Forced') === -1)
                subs.push({ label: sub.label.toUpperCase(), url: sub.file });
            });

          } catch(e) {
            // JSON değilse direkt URL dene
            var um = decrypted.match(/"video_location"\s*:\s*"([^"]+)"/);
            if (um) videoUrl = um[1];
          }

          if (!videoUrl) {
            console.log('[CizgiMax] video_location bulunamadı');
            return null;
          }

          // /list/BASE64 → tam URL yap
          if (videoUrl.startsWith('/')) {
            videoUrl = 'https://cizgipass100.online' + videoUrl;
          }

          console.log('[CizgiMax] Video URL: ' + videoUrl.slice(0, 80));

          return {
            url:       videoUrl,
            name:      label,
            title:     label + (subs.length ? ' | ' + subs.map(function(s){ return s.label; }).join('/') : ''),
            quality:   'Auto',
            type:      'hls',
            headers:   { 'Referer': embedUrl },
            subtitles: subs
          };
        })
        .catch(function(e) {
          console.error('[CizgiMax] Decrypt hata:', e.message);
          return null;
        });
    })
    .catch(function(e) {
      console.error('[CizgiMax] CizgiPass fetch hata:', e.message);
      return null;
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  var sNum = parseInt(seasonNum) || 1;
  var eNum = parseInt(episodeNum) || 1;
  console.log('[CizgiMax] TMDB:' + tmdbId + ' S' + sNum + 'E' + eNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
      console.log('[CizgiMax] Aranan: "' + info.titleEn + '" / "' + info.titleTr + '"');

      // 1. Dizi sayfasını bul
      return searchCizgiMax(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchCizgiMax(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[CizgiMax] Dizi bulunamadı');
            return [];
          }

          var showUrl = best.s_link
            ? (best.s_link.startsWith('http') ? best.s_link : fixUrl(best.s_link))
            : null;

          if (!showUrl) return [];
          console.log('[CizgiMax] Dizi: ' + best.s_name + ' → ' + showUrl);

          // 2. Bölüm listesi
          return fetchShowEpisodes(showUrl)
            .then(function(episodes) {
              console.log('[CizgiMax] ' + episodes.length + ' bölüm bulundu');

              // Sezon+bölüm eşleşmesi
              var matched = episodes.filter(function(ep) {
                return ep.season === sNum && ep.episode === eNum;
              });
              // Bulunamazsa sadece bölüm numarasıyla dene
              if (!matched.length && sNum === 1) {
                matched = episodes.filter(function(ep) { return ep.episode === eNum; });
              }
              if (!matched.length) {
                console.log('[CizgiMax] S' + sNum + 'E' + eNum + ' bulunamadı');
                return [];
              }

              var epUrl = matched[0].url;
              console.log('[CizgiMax] Bölüm: ' + epUrl);

              // 3. Bölüm sayfasından cizgipass embed URL'ini al
              return fetchCizgipassUrl(epUrl)
                .then(function(embedUrl) {
                  if (!embedUrl) {
                    console.log('[CizgiMax] CizgiPass embed URL bulunamadı: ' + epUrl);
                    return [];
                  }
                  console.log('[CizgiMax] Embed: ' + embedUrl);

                  // 4. bePlayer decrypt → video URL
                  return extractFromCizgipass(embedUrl)
                    .then(function(stream) {
                      return stream ? [stream] : [];
                    });
                });
            });
        });
    })
    .then(function(streams) {
      console.log('[CizgiMax] Sonuç: ' + streams.length + ' stream');
      return streams;
    })
    .catch(function(err) {
      console.error('[CizgiMax] Hata:', err.message || err);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
                                                                  }
