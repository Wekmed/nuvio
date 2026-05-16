/**
 * CizgiVeDizi Provider — v12
 * ═══════════════════════════════════════════════════════════════
 */

var BASE_URL    = 'https://www.cizgivedizi.com';
var TMDB_KEY    = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST = 'https://video.sibnet.ru';
var LOG_TAG     = '[CizgiVeDizi]';

// CHUNK_OFFSET: 256KB limitinin biraz altı
// 1. fetch: 0–262143 → 2. fetch: 245760– → birleşimde 444KB görünür
var CHUNK_OFFSET = 245760;

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         BASE_URL + '/'
};

var STOP_WORDS = [
  'the','a','an','of','in','on','at','to','and','or','for',
  've','bir','ile','bu','mi','mu','mı','mü','da','de','den','nin','nun'
];

function log(msg) { console.log(LOG_TAG + ' ' + msg); }

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9]/g,'');
}

function mergeHeaders(extra) {
  var h = {}, k;
  for (k in HEADERS) h[k] = HEADERS[k];
  if (extra) for (k in extra) h[k] = extra[k];
  return h;
}

function getHtml(url, extra) {
  return fetch(url, { headers: mergeHeaders(extra) }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' → ' + url);
    return r.text();
  });
}

/**
 * 2 aşamalı fetch — NuvioTV 256KB truncation sorununu aşar.
 *
 * Aşama 1: Normal GET → ilk ~256KB gelir.
 * Aşama 2: __embeds_b64 bulunamazsa Range: bytes=245760- ile
 *          geri kalan kısım alınır, chunk1 ile birleştirilir.
 */
function getHtmlChunked(url) {
  return fetch(url, { headers: mergeHeaders() }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' → ' + url);
    return r.text().then(function(chunk1) {
      if (chunk1.indexOf('__embeds_b64') !== -1) {
        log('chunk1 yeterli (' + chunk1.length + ' kar)');
        return chunk1;
      }
      if (chunk1.length < 240000) {
        log('Sayfa kısa (' + chunk1.length + ' kar), embed yok');
        return chunk1;
      }
      log('chunk1 ' + chunk1.length + ' kar — Range fetch bytes=' + CHUNK_OFFSET + '-');
      return fetch(url, { headers: mergeHeaders({ 'Range': 'bytes=' + CHUNK_OFFSET + '-' }) })
        .then(function(r2) {
          return r2.text().then(function(chunk2) {
            log('chunk2 ' + chunk2.length + ' kar');
            return chunk1 + chunk2;
          });
        }).catch(function(e) {
          log('Range fetch hata: ' + e.message);
          return chunk1;
        });
    });
  });
}

/**
 * Base64 → UTF-8 → JSON.parse
 * Site kodu: JSON.parse(decodeURIComponent(escape(atob(b64))))
 * escape() QuickJS polyfill'inde eksik olabileceği için manuel UTF-8 decode.
 */
function b64ToJson(b64) {
  try {
    var raw = atob(b64);
    var bytes = new Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
    var out = '';
    for (var j = 0; j < bytes.length; ) {
      var b = bytes[j];
      if (b < 0x80) { out += String.fromCharCode(b); j++; }
      else if ((b & 0xe0) === 0xc0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j+1] & 0x3f)); j += 2; }
      else if ((b & 0xf0) === 0xe0) { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j+1] & 0x3f) << 6) | (bytes[j+2] & 0x3f)); j += 3; }
      else { j++; }
    }
    return JSON.parse(out);
  } catch(e) {
    try { return JSON.parse(atob(b64)); } catch(e2) { return null; }
  }
}

function encPath(s) {
  var out = '', code;
  for (var i = 0; i < (s || '').length; i++) {
    code = s.charCodeAt(i);
    out += code > 127 ? encodeURIComponent(s[i]) : s[i];
  }
  return out;
}

// ─── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var info = {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
      log('TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ')');
      return info;
    });
}

// ─── Arama ────────────────────────────────────────────────────

function buildQueries(titleTr, titleEn) {
  var seen = {}, out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && q.length > 1 && !seen[q]) { seen[q] = true; out.push(q); }
  }
  function words(s) {
    return (s || '').split(/[\s\-:,().!?]+/).filter(function(w) {
      return w.length > 1 && STOP_WORDS.indexOf(w.toLowerCase()) === -1;
    });
  }
  var trW = words(titleTr), enW = words(titleEn), i;
  // TR önce (Regular Show → "Sürekli Dizi" gibi durumlar)
  add(titleTr);
  if (trW.length > 0) add(trW[trW.length - 1]);
  if (trW.length > 1) add(trW[0]);
  if (trW.length > 2) add(trW[0] + ' ' + trW[1]);
  // EN sonra
  add(titleEn);
  if (enW.length > 0) add(enW[enW.length - 1]);
  if (enW.length > 1) add(enW[0]);
  for (i = 0; i < trW.length - 1; i++) add(trW[i] + ' ' + trW[i+1]);
  for (i = 0; i < enW.length - 1; i++) add(enW[i] + ' ' + enW[i+1]);
  return out;
}

function searchSite(query, mediaType) {
  var base = mediaType === 'movie' ? BASE_URL + '/film/_/_' : BASE_URL + '/dizi/_/_';
  return fetch(base + '?ajax=search&q=' + encodeURIComponent(query), {
    headers: {
      'User-Agent':       HEADERS['User-Agent'],
      'Accept':           'application/json, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer':          BASE_URL + '/'
    }
  }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; });
}

// ─── Skorlama ─────────────────────────────────────────────────
//
//  Site yanıtı örneği:
//    { id:"duckt17", slug:"ducktales_(2017)", name:"ducktales (2017)", hay_en:"ducktales" }
//  "name" içindeki (yıl) TMDB yılıyla karşılaştırılır.

function scoreItem(item, titleEn, titleTr, year) {
  var rawName  = item.name   || '';
  var hayEn    = item.hay_en || '';
  var yearMatch = rawName.match(/\((\d{4})\)/);
  var itemYear  = yearMatch ? yearMatch[1] : null;

  // Yıl çelişkisi → eleme
  if (itemYear && year && itemYear !== year) return 0;

  var nItem  = norm(rawName.replace(/\(\d{4}\)/g, ''));
  var nHayEn = norm(hayEn);
  var nEn    = norm(titleEn);
  var nTr    = norm(titleTr);
  var score  = 0;

  if      (nItem === nEn || nItem === nTr)                       score = 90;
  else if (nHayEn && (nHayEn === nEn || nHayEn === nTr))         score = 88;
  else if (nEn.length > 2  && nEn.indexOf(nItem)   !== -1)       score = 80;
  else if (nTr.length > 2  && nTr.indexOf(nItem)   !== -1)       score = 78;
  else if (nItem.length > 3 && nItem.indexOf(nEn)  !== -1)       score = 75;
  else if (nItem.length > 3 && nItem.indexOf(nTr)  !== -1)       score = 73;
  else if (nHayEn.length > 3 && nEn.indexOf(nHayEn) !== -1)      score = 70;
  else return 0;

  if (itemYear && year && itemYear === year) score += 10;
  return score;
}

function fetchYearFromPage(item, mediaType) {
  var type = mediaType === 'movie' ? 'film' : 'dizi';
  var url  = BASE_URL + '/' + type + '/' + encPath(item.id) + '/' + encPath(item.slug);
  return fetch(url, { headers: mergeHeaders({ 'Range': 'bytes=0-10240' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/badge[^>]*>[^<]*((?:19[89]|20[0-3])\d)/i);
      return m ? m[1] : null;
    }).catch(function() { return null; });
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);
  log('Sorgular (' + queries.length + '): ' + queries.slice(0, 5).join(' | '));

  return queries.reduce(function(chain, query) {
    return chain.then(function(found) {
      if (found) return found;
      return searchSite(query, mediaType).then(function(results) {
        if (!results || !results.length) { log('"' + query + '" → 0'); return null; }
        log('"' + query + '" → ' + results.length + ' sonuç');

        var candidates = [], i, s;
        for (i = 0; i < results.length; i++) {
          s = scoreItem(results[i], info.titleEn, info.titleTr, info.year);
          if (s > 0) candidates.push({ item: results[i], score: s });
        }
        candidates.sort(function(a, b) { return b.score - a.score; });
        if (!candidates.length) return null;

        log('Adaylar: ' + candidates.slice(0,4).map(function(c) {
          return c.item.id + '(' + c.score + ')';
        }).join(', '));

        if (candidates.length === 1 || candidates[0].score - candidates[1].score >= 15) {
          log('Seçildi: ' + candidates[0].item.id);
          return candidates[0].item;
        }

        log('Tie-break → yıl fetch');
        return Promise.all(candidates.slice(0, 3).map(function(c) {
          return fetchYearFromPage(c.item, mediaType).then(function(yr) {
            return { item: c.item, year: yr };
          });
        })).then(function(withYears) {
          for (var j = 0; j < withYears.length; j++) {
            if (withYears[j].year === info.year) { log('Yıl eşleşti: ' + withYears[j].item.id); return withYears[j].item; }
          }
          return withYears[0].item;
        });
      });
    });
  }, Promise.resolve(null));
}

// ─── Global bölüm no ──────────────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  if (seasonNum <= 1) return Promise.resolve(episodeNum);
  var promises = [], s;
  for (s = 1; s < seasonNum; s++) {
    promises.push((function(sn) {
      return fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sn + '?api_key=' + TMDB_KEY)
        .then(function(r) { return r.json(); })
        .then(function(d) { return (d.episodes && d.episodes.length) || 0; })
        .catch(function() { return 0; });
    })(s));
  }
  return Promise.all(promises).then(function(counts) {
    var total = 0;
    for (var i = 0; i < counts.length; i++) total += counts[i];
    log('Global ep: S' + seasonNum + 'E' + episodeNum + ' → #' + (total + episodeNum));
    return total + episodeNum;
  });
}

// ─── Embed parse ──────────────────────────────────────────────

function parseEmbeds(html) {
  // A: window.__embeds_b64 (ana yöntem — sayfanın altında inline JS)
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    var arr = b64ToJson(b64m[1]);
    if (Array.isArray(arr) && arr.length) {
      log('__embeds_b64: ' + arr.length + ' embed');
      return arr.filter(Boolean);
    }
    log('__embeds_b64 decode başarısız');
  }

  // B: window.__embeds düz JSON
  var dm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dm) {
    try {
      var arr2 = JSON.parse(dm[1]);
      if (Array.isArray(arr2) && arr2.length) { log('__embeds: ' + arr2.length); return arr2.filter(Boolean); }
    } catch(e) {}
  }

  // C: Script içi URL regex
  var urls = [], seen = {}, scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi, sm, um;
  var urlRe = /["'`]((?:https?:)?\/\/(?:video\.sibnet\.ru\/shell\.php[^"'`\s<>]+|my\.mail\.ru\/video\/embed\/[^"'`\s<>]+|www\.mp4upload\.com\/embed-[^"'`\s<>]+|vidmoly\.to\/e\/[^"'`\s<>]+|ok\.ru\/videoembed\/[^"'`\s<>]+|vk\.com\/video_ext[^"'`\s<>]+))/gi;
  while ((sm = scriptRe.exec(html)) !== null) {
    urlRe.lastIndex = 0;
    while ((um = urlRe.exec(sm[1])) !== null) {
      if (!seen[um[1]]) { seen[um[1]] = true; urls.push(um[1]); }
    }
  }
  if (urls.length) { log('Script regex: ' + urls.length + ' embed'); return urls; }

  // D: <iframe id="playerFrame" src="..."> fallback
  var ifrm = html.match(/id=["']playerFrame["'][^>]*\bsrc=["']([^"']+)["']/i)
          || html.match(/\bsrc=["']([^"']+)["'][^>]*id=["']playerFrame["']/i);
  if (ifrm && ifrm[1] && ifrm[1].indexOf('cid:') !== 0 && ifrm[1].trim() !== '') {
    var src = ifrm[1].indexOf('//') === 0 ? 'https:' + ifrm[1] : ifrm[1];
    log('playerFrame fallback: ' + src.slice(0, 80));
    return [src];
  }

  log('Embed bulunamadı');
  return [];
}

function parseSourceNames(html) {
  var names = {}, re = /data-kaynak=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    names[parseInt(m[1])] = m[2].replace(/<[^>]+>/g, '').trim();
  }
  return names;
}

// ─── Embed → Stream ───────────────────────────────────────────

function toAbs(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

function isVideoUrl(url) {
  var p = (url || '').toLowerCase().split('?')[0];
  var bad = ['.css','.js','.woff','.woff2','.ttf','.png','.jpg','.gif','.svg','.ico'];
  for (var i = 0; i < bad.length; i++) if (p.slice(-bad[i].length) === bad[i]) return false;
  return p.indexOf('.m3u8') !== -1 || p.indexOf('.mp4') !== -1;
}

function extractSibnet(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': SIBNET_HOST + '/' }).then(function(html) {
    // <video src="...mp4"> — server-side HTML'de mevcut
    var m = html.match(/<video[^>]*\bsrc=["']([^"']+\.mp4[^"']*)["']/i);
    if (m) return { url: m[1], type: 'direct', headers: { 'Referer': full } };
    var m2 = html.match(/<source[^>]*\bsrc=["']([^"']+\.mp4[^"']*)["']/i);
    if (m2) return { url: m2[1], type: 'direct', headers: { 'Referer': full } };
    // player.src — script tagları geldiyse
    var m3 = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)/i);
    if (m3) { var p3 = m3[1].indexOf('http') === 0 ? m3[1] : SIBNET_HOST + m3[1]; return { url: p3, type: 'direct', headers: { 'Referer': full } }; }
    // /v/HASH/ID.mp4 pattern
    var m4 = html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4[^"']*)["']/i);
    if (m4) { var p4 = m4[1].indexOf('http') === 0 ? m4[1] : SIBNET_HOST + m4[1]; return { url: p4, type: 'direct', headers: { 'Referer': full } }; }
    log('Sibnet MP4 bulunamadı');
    return null;
  }).catch(function(e) { log('Sibnet hata: ' + e.message); return null; });
}

function extractVidmoly(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' }).then(function(html) {
    var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
  }).catch(function() { return null; });
}

function extractMp4upload(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' }).then(function(html) {
    var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
         || html.match(/[,{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i);
    if (m && isVideoUrl(m[1])) return { url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
    var all = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    for (var i = 0; i < all.length; i++) {
      if (isVideoUrl(all[i]) && all[i].indexOf('mp4upload') !== -1)
        return { url: all[i], type: all[i].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
    }
    return null;
  }).catch(function() { return null; });
}

function extractMailRu(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' }).then(function(html) {
    var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
  }).catch(function() { return null; });
}

function extractOkRu(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' }).then(function(html) {
    var m = html.match(/"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)"/i)
         || html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    return m ? { url: m[1].replace(/\\u0026/g,'&'), type: 'hls', headers: { 'Referer': full } } : null;
  }).catch(function() { return null; });
}

function extractStream(url) {
  var full = toAbs(url);
  if (!full) return Promise.resolve(null);
  var lo = full.toLowerCase();
  if (lo.indexOf('sibnet')    !== -1) return extractSibnet(url);
  if (lo.indexOf('vidmoly')   !== -1) return extractVidmoly(url);
  if (lo.indexOf('mp4upload') !== -1) return extractMp4upload(url);
  if (lo.indexOf('mail.ru')   !== -1) return extractMailRu(url);
  if (lo.indexOf('ok.ru')     !== -1) return extractOkRu(url);
  log('Desteklenmeyen embed: ' + full.slice(0, 60));
  return Promise.resolve(null);
}

// ─── Ana akış ─────────────────────────────────────────────────

function buildEpUrl(item, mediaType, epNo) {
  if (mediaType === 'movie')
    return BASE_URL + '/film/' + encPath(item.id) + '/' + encPath(item.slug);
  return BASE_URL + '/dizi/' + encPath(item.id) + '/' + encPath(item.slug) + '/' + epNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  log('START tmdbId=' + tmdbId + ' type=' + mediaType +
      (mediaType === 'tv' ? ' S' + season + 'E' + episode : ''));

  return Promise.all([
    fetchTmdbInfo(tmdbId, mediaType),
    mediaType === 'tv' ? fetchGlobalEpNo(tmdbId, season, episode) : Promise.resolve(null)
  ]).then(function(res) {
    var info = res[0], epGlobal = res[1];

    return findContent(info, mediaType).then(function(item) {
      if (!item) { log('İçerik bulunamadı'); return []; }
      log('Eşleşti: "' + item.name + '" id=' + item.id);

      var epUrl = buildEpUrl(item, mediaType, epGlobal);
      log('Bölüm URL: ' + epUrl);

      return getHtmlChunked(epUrl).then(function(html) {
        var srcNames = parseSourceNames(html);
        var embeds   = parseEmbeds(html);

        if (!embeds.length) { log('Embed bulunamadı'); return []; }
        log(embeds.length + ' embed: ' + embeds.slice(0,3).join(' | '));

        return Promise.all(embeds.map(function(embedUrl, idx) {
          return extractStream(embedUrl).then(function(stream) {
            if (!stream) return null;
            var srcName = srcNames[idx] !== undefined ? srcNames[idx] : ('Kaynak ' + idx);
            return {
              name:    item.name || info.titleTr,
              title:   '⌜ ÇİZGİVEDİZİ ⌟ | ' + srcName + ' | Auto',
              url:     stream.url,
              quality: 'Auto',
              type:    stream.type,
              headers: stream.headers || {}
            };
          });
        })).then(function(all) {
          var filtered = all.filter(Boolean);
          log('Toplam stream: ' + filtered.length);
          return filtered;
        });
      });
    });
  }).catch(function(e) {
    log('HATA: ' + e.message);
    return [];
  });
}

// ─── Export ───────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}
