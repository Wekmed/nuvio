// ============================================================
//  CizgiMax — Nuvio Provider
// ============================================================

const nodeCrypto = require('crypto');

const MAIN_URL     = 'https://cizgimax.online';
const TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
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

// Cookie birleştir — response'dan yeni cookie'leri alıp mevcutlarla merge et
function mergeCookies(response, existing) {
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const map = {};
  if (existing) {
    existing.split('; ').forEach(function(c) {
      const idx = c.indexOf('=');
      if (idx > 0) map[c.slice(0, idx).trim()] = c.slice(idx + 1);
    });
  }
  setCookies.forEach(function(c) {
    const kv  = c.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) map[kv.slice(0, idx).trim()] = kv.slice(idx + 1);
  });
  return Object.entries(map).map(function(e) { return e[0] + '=' + e[1]; }).join('; ');
}

function getHtml(url, extraHeaders) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, extraHeaders || {})
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
    return r.text();
  });
}

function getHtmlWithResponse(url, extraHeaders) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, extraHeaders || {})
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
    return r.text().then(function(html) { return { html: html, response: r }; });
  });
}

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/tv/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.name || '',
        titleEn: d.original_name || ''
      };
    });
}

// ── Arama ────────────────────────────────────────────────────
function searchCizgiMax(query) {
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return ((data.data || {}).result || []).filter(function(item) {
        return !/(\.Bölüm|\.Sezon|-Sezon)/i.test(item.s_name || '');
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
    if (n === nEn || n === nTr)                               s = 100;
    else if (n.indexOf(nEn) !== -1 || nEn.indexOf(n) !== -1) s = 70;
    else if (n.indexOf(nTr) !== -1 || nTr.indexOf(n) !== -1) s = 70;
    return { item: item, score: s };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 60) ? scored[0].item : null;
}

// ── Sezon/Bölüm URL'den çıkar ─────────────────────────────────
// Debug'da doğrulandı: /slug-X-sezon-Y-bolum[-izle]/
// Karma slug: big-city-greens-1-sezon-1-bolum-izle (İngilizce)
//             greenlerin-buyuksehir-maceralari-4-sezon-30-bolum (Türkçe)
function extractSE(url) {
  var sm = url.match(/-(\d+)-sezon-/i);
  var em = url.match(/-sezon-(\d+)-bolum/i);
  return {
    season:  sm ? parseInt(sm[1]) : 1,
    episode: em ? parseInt(em[1]) : 0
  };
}

// ── Dizi sayfasından bölüm listesi ────────────────────────────
function fetchShowEpisodes(showUrl) {
  return getHtml(showUrl, { 'Referer': MAIN_URL + '/' }).then(function(html) {
    var episodes = [];
    var seen     = {};
    var re       = /href="([^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1].startsWith('http') ? m[1] : MAIN_URL + m[1];
      if (seen[href]) continue;
      if (href.indexOf('sezon') === -1 || href.indexOf('bolum') === -1) continue;
      seen[href] = true;
      var se = extractSE(href);
      if (se.episode > 0) episodes.push({ season: se.season, episode: se.episode, url: href });
    }
    console.log('[CizgiMax] ' + episodes.length + ' bölüm bulundu');
    return episodes;
  });
}

// ── Bölüm sayfasından embed URL + ilk cookie ─────────────────
function fetchEpisodeEmbed(epUrl) {
  return fetch(epUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + epUrl);
    var cookies = mergeCookies(r, '');
    return r.text().then(function(html) {
      var m = html.match(/data-frame="(https?:\/\/cizgipass[^"]+)"/i)
           || html.match(/class="linkler"[\s\S]{0,600}?data-frame="([^"]+)"/i)
           || html.match(/(https?:\/\/cizgipass\d*\.online\/embed\/[a-zA-Z0-9]+)/i);
      if (!m) throw new Error('Embed URL bulunamadı');
      return { embedUrl: m[1], cookies: cookies };
    });
  });
}

// ── EVP_BytesToKey (node:crypto MD5) ─────────────────────────
// Debug ile doğrulandı: EVP IV == JSON IV → key doğru
function evpBytesToKey(password, saltHex) {
  var p  = Buffer.from(password);
  var s  = Buffer.from(saltHex || '', 'hex');
  var d0 = nodeCrypto.createHash('md5').update(Buffer.concat([p, s])).digest();
  var d1 = nodeCrypto.createHash('md5').update(Buffer.concat([d0, p, s])).digest();
  var d2 = nodeCrypto.createHash('md5').update(Buffer.concat([d1, p, s])).digest();
  return { key: Buffer.concat([d0, d1]), iv: d2.slice(0, 16) };
}

// ── BePlayer AES-256-CBC Decrypt ─────────────────────────────
// Debug ile doğrulandı: node:crypto çalışıyor, crypto.subtle çalışmıyor
function bePlayerDecrypt(password, encryptedJson) {
  try {
    var parsed   = JSON.parse(encryptedJson);
    var ct       = Buffer.from(parsed.ct, 'base64');
    var iv       = Buffer.from(parsed.iv, 'hex');
    var derived  = evpBytesToKey(password, parsed.s || '');
    var decipher = nodeCrypto.createDecipheriv('aes-256-cbc', derived.key, iv);
    decipher.setAutoPadding(true);
    var dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return { ok: true, data: JSON.parse(dec.toString('utf8')) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Embed'den stream çek ──────────────────────────────────────
// Debug'da doğrulandı:
//   1. Embed fetch → PHPSESSID cookie al
//   2. bePlayer decrypt → video_location = /list/BASE64
//   3. /list/ fetch → cookie + embed Referer → 200 + m3u8
function extractFromEmbed(embedUrl, cookies) {
  var label = '⌜ CİZGİMAX ⌟';

  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer':        MAIN_URL + '/',
      'Cookie':         cookies,
      'sec-fetch-dest': 'iframe',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'cross-site'
    })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      // Cookie'leri birleştir — PHPSESSID burada geliyor
      var newCookies = mergeCookies(r, cookies);
      return r.text().then(function(html) {
        return { html: html, cookies: newCookies };
      });
    })
    .then(function(res) {
      var html       = res.html;
      var newCookies = res.cookies;

      // bePlayer parse
      var m = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']*"ct"[^']*\})'\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]*"ct"[^"]*\})"\s*\)/);

      if (!m) {
        console.log('[CizgiMax] bePlayer bulunamadı');
        return null;
      }

      var result = bePlayerDecrypt(m[1], m[2]);
      if (!result.ok) {
        console.error('[CizgiMax] Decrypt hata:', result.error);
        return null;
      }

      var data     = result.data;
      var videoUrl = data.video_location || data.file || data.src;
      var subs     = [];

      (data.strSubtitles || []).forEach(function(sub) {
        if (sub.file && sub.label && sub.label.indexOf('Forced') === -1)
          subs.push({ label: sub.label.toUpperCase(), url: sub.file });
      });

      if (!videoUrl) {
        console.log('[CizgiMax] video_location yok');
        return null;
      }

      if (videoUrl.startsWith('/')) videoUrl = 'https://cizgipass100.online' + videoUrl;
      console.log('[CizgiMax] ✓ Stream: ' + videoUrl.slice(0, 80));

      // /list/ URL'ini döndür — headers ile birlikte
      // Nuvio bu URL'i kendi HTTP client'ı ile açacak
      return {
        url:       videoUrl,
        name:      label,
        title:     label + (subs.length ? ' | ' + subs.map(function(s) { return s.label; }).join('/') : ''),
        quality:   'Auto',
        type:      'hls',
        // Debug'da doğrulandı: embed URL Referer + PHPSESSID cookie şart
        headers:   {
          'Referer': embedUrl,
          'Cookie':  newCookies,
          'Origin':  'https://cizgipass100.online'
        },
        subtitles: subs
      };
    })
    .catch(function(e) {
      console.error('[CizgiMax] extractFromEmbed hata:', e.message);
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
      console.log('[CizgiMax] "' + info.titleEn + '" / "' + info.titleTr + '"');

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
          if (!best) { console.log('[CizgiMax] Dizi bulunamadı'); return []; }

          var showUrl = best.s_link
            ? (best.s_link.startsWith('http') ? best.s_link : fixUrl(best.s_link))
            : null;
          if (!showUrl) return [];
          console.log('[CizgiMax] Dizi: ' + best.s_name + ' → ' + showUrl);

          return fetchShowEpisodes(showUrl)
            .then(function(episodes) {
              // S+E birebir eşleştir
              var matched = episodes.filter(function(ep) {
                return ep.season === sNum && ep.episode === eNum;
              });
              // Bulunamazsa sadece E ile eşleştir
              if (!matched.length) {
                matched = episodes.filter(function(ep) { return ep.episode === eNum; });
              }
              if (!matched.length) {
                console.log('[CizgiMax] S' + sNum + 'E' + eNum + ' bulunamadı');
                return [];
              }

              var epUrl = matched[0].url;
              console.log('[CizgiMax] Bölüm: ' + epUrl);

              // Bölüm sayfasından embed URL + cookie al
              return fetchEpisodeEmbed(epUrl)
                .then(function(res) {
                  console.log('[CizgiMax] Embed: ' + res.embedUrl);
                  return extractFromEmbed(res.embedUrl, res.cookies);
                })
                .then(function(stream) { return stream ? [stream] : []; });
            });
        });
    })
    .then(function(streams) {
      console.log('[CizgiMax] Toplam stream: ' + streams.length);
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
