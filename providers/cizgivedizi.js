/**
 * CizgiVeDizi — Nuvio Provider
 */

var BASE_URL    = 'https://www.cizgivedizi.com';
var TMDB_KEY    = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST = 'https://video.sibnet.ru';
var LOG_TAG     = '[CizgiVeDizi]';
var STREAM_TIMEOUT = 10000;

var SEARCH_DIZI = BASE_URL + '/dizi/gmb/gumball';
var SEARCH_FILM = BASE_URL + '/film/_/_';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         BASE_URL + '/'
};

var STOP = ['the','a','an','of','in','on','at','to','and','or','for',
            've','bir','ile','bu','mi','mu','mı','mü','da','de'];

// ── Log ──────────────────────────────────────────────────────

function log(msg) {
  console.log(LOG_TAG + ' ' + msg);
}

// ── Normalize ────────────────────────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9]/g,'');
}

// ── Base64 Decode (Simple & Robust) ──────────────────────────

function b64decode(b64) {
  if (!b64 || typeof b64 !== 'string') return null;

  // Try 1: Node.js Buffer
  if (typeof Buffer !== 'undefined') {
    try {
      var decoded = Buffer.from(b64, 'base64').toString('utf8');
      var parsed = JSON.parse(decoded);
      log('b64decode: Buffer method OK (' + (Array.isArray(parsed) ? parsed.length : 0) + ' items)');
      return parsed;
    } catch(e) {
      log('b64decode: Buffer failed - ' + e.message);
    }
  }

  // Try 2: Browser atob
  if (typeof atob !== 'undefined') {
    try {
      var decoded = atob(b64);
      var parsed = JSON.parse(decoded);
      log('b64decode: atob method OK (' + (Array.isArray(parsed) ? parsed.length : 0) + ' items)');
      return parsed;
    } catch(e) {
      log('b64decode: atob failed - ' + e.message);
    }
  }

  // Fallback: Return null, other parseEmbeds methods will handle it
  log('b64decode: No compatible decoder found, using fallback');
  return null;
}

// ── Fetch ────────────────────────────────────────────────────

function getHtml(url, extra) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extra || {}) })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

// ── Slug encode ──────────────────────────────────────────────

function encPath(s) {
  var out = '';
  for (var i = 0; i < (s || '').length; i++) {
    var code = s.charCodeAt(i);
    if (code > 127) out += encodeURIComponent(s[i]);
    else out += s[i];
  }
  return out;
}

// ── 1. TMDB ──────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep  = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + ep + '/' + tmdbId
          + '?api_key=' + TMDB_KEY + '&language=tr-TR';
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title:   d.title   || d.name                 || '',
        titleTr: d.title   || d.name                 || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date  || '').slice(0, 4)
      };
    });
}

// ── 2. Arama ─────────────────────────────────────────────────

function buildQueries(titleTr, titleEn) {
  var seen = {}, out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && !seen[q]) { seen[q] = true; out.push(q); }
  }
  var enW = (titleEn||'').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  var trW = (titleTr||'').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });

  add(titleTr);
  add(titleEn);
  if (enW.length > 0) add(enW[enW.length - 1]);
  if (enW.length > 1) add(enW[0]);
  if (enW.length > 2) add(enW[0] + ' ' + enW[1]);
  if (trW.length > 0) add(trW[trW.length - 1]);
  if (trW.length > 1) add(trW[0]);
  for (var i = 0; i < trW.length - 1; i++) add(trW[i] + ' ' + trW[i+1]);
  for (var j = 1; j < enW.length - 1; j++) add(enW[j] + ' ' + enW[j+1]);
  return out;
}

function searchSite(query, mediaType) {
  var anchor = mediaType === 'movie' ? SEARCH_FILM : SEARCH_DIZI;
  var url    = anchor + '?ajax=search&q=' + encodeURIComponent(query);
  return fetch(url, {
    headers: Object.assign({}, HEADERS, {
      'Accept':           'application/json, */*',
      'X-Requested-With': 'XMLHttpRequest'
    })
  })
    .then(function(r) { return r.ok ? r.json() : []; })
    .catch(function() { return []; });
}

function scoreItem(item, titleEn, titleTr, year) {
  var raw = item.name || '';
  var n   = norm(raw);
  var ne  = norm(titleEn);
  var nt  = norm(titleTr);

  var nyM = raw.match(/\b(19[89]\d|20[0-3]\d)\b/);
  var ny  = nyM ? nyM[1] : null;

  var nc  = n.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var nec = ne.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var ntc = nt.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');

  var s = 0;
  if (nc === nec || nc === ntc)                         s = 80;
  else if (nec.length > 2 && nec.indexOf(nc) !== -1)   s = 80;
  else if (ntc.length > 2 && ntc.indexOf(nc) !== -1)   s = 75;
  else if (nc.length > 4  && nc.indexOf(nec) !== -1)   s = 70;
  else if (nc.length > 4  && nc.indexOf(ntc) !== -1)   s = 70;
  else {
    var enWords = nec.match(/[a-z]{4,}/g) || [];
    var trWords = ntc.match(/[a-z]{4,}/g) || [];
    var siteWords = nc.match(/[a-z]{4,}/g) || [];
    var hits = 0;
    for (var wi = 0; wi < siteWords.length; wi++) {
      if (enWords.indexOf(siteWords[wi]) !== -1 || trWords.indexOf(siteWords[wi]) !== -1) hits++;
    }
    if (hits > 0 && siteWords.length > 0) s = Math.round(60 * hits / siteWords.length);
  }

  if (s === 0) return 0;
  if (ny && year) return ny === year ? s + 20 : Math.max(0, s - 50);
  return s;
}

function fetchYearFromPage(item, mediaType) {
  var type = mediaType === 'movie' ? 'film' : 'dizi';
  var url  = BASE_URL + '/' + type + '/' + encPath(item.id) + '/' + encPath(item.slug);
  return getHtml(url, { 'Range': 'bytes=0-61440' })
    .then(function(html) {
      var m = html.match(/badge-date-text[^>]*>[^<]*((?:19[89]|20[0-3])\d)/i);
      return m ? m[1] : null;
    })
    .catch(function() { return null; });
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);

  return queries.reduce(function(chain, query) {
    return chain.then(function(found) {
      if (found) return found;
      return searchSite(query, mediaType).then(function(results) {
        if (!results.length) return null;

        var allScored = results
          .map(function(item) {
            return { item: item, score: scoreItem(item, info.titleEn, info.titleTr, info.year) };
          })
          .sort(function(a, b) { return b.score - a.score; });

        var candidates = allScored.filter(function(c) { return c.score >= 70; });
        if (candidates.length === 0) return null;

        var best = candidates[0];
        var tied = candidates.filter(function(c) { return c.score === best.score; });

        if (tied.length === 1) return best.item;

        return Promise.all(tied.map(function(c) {
          return fetchYearFromPage(c.item, mediaType)
            .then(function(year) {
              return { item: c.item, year: year, score: c.score };
            });
        })).then(function(withYears) {
          var byYear = withYears.filter(function(w) { return w.year === info.year; });
          return (byYear.length > 0 ? byYear[0] : withYears[0]).item;
        });
      });
    });
  }, Promise.resolve(null));
}

// ── 3. Global Episode Number ──────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    (function(sn) {
      promises.push(
        fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sn +
              '?api_key=' + TMDB_KEY)
          .then(function(r) { return r.json(); })
          .then(function(d) { return (d.episodes && d.episodes.length) || 0; })
          .catch(function() { return 0; })
      );
    })(s);
  }
  return Promise.all(promises).then(function(counts) {
    return counts.reduce(function(a, b) { return a + b; }, 0) + episodeNum;
  });
}

// ── 4. HTML → embed URL'leri ─────────────────────────────────

function parseEmbeds(html) {
  // Method A: window.__embeds_b64
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    var arr = b64decode(b64m[1]);
    if (Array.isArray(arr) && arr.length) {
      return arr.filter(Boolean);
    }
  }

  // Method B: window.__embeds = [...]
  var dm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dm) {
    try {
      var arr2 = JSON.parse(dm[1]);
      if (Array.isArray(arr2) && arr2.length) {
        return arr2.filter(Boolean);
      }
    } catch(e) {}
  }

  // Method C: Script URL parsing (fallback)
  var urls = [], seen = {};
  var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    var urlRe = /["'`]((?:https?:)?\/\/(?:video\.sibnet\.ru\/shell\.php[^"'`\s<>]+|my\.mail\.ru\/video\/embed\/[^"'`\s<>]+|www\.mp4upload\.com\/embed-[^"'`\s<>]+|vidmoly\.to\/e\/[^"'`\s<>]+|ok\.ru\/videoembed\/[^"'`\s<>]+|vk\.com\/video_ext[^"'`\s<>]+))/gi;
    var um;
    while ((um = urlRe.exec(sm[1])) !== null) {
      var u = um[1];
      if (!seen[u]) { seen[u] = true; urls.push(u); }
    }
  }
  
  if (urls.length) {
    log('parseEmbeds fallback: ' + urls.length + ' URL found in scripts');
    return urls;
  }

  log('parseEmbeds: No embeds found');
  return [];
}

function parseSourceNames(html) {
  var names = [];
  // Improved: handle newlines and whitespace
  var re = /data-kaynak="(\d+)"[^>]*>\s*([^\n<]+?)\s*</gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1]);
    var name = (m[2] || '').trim();
    if (name && name.length > 0) {
      names[idx] = name;
    }
  }
  log('parseSourceNames: ' + Object.keys(names).length + ' names found');
  return names;
}

// ── 5. Embed → Stream ─────────────────────────────────────────

function toAbs(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

function isVideoUrl(url) {
  var p = (url || '').toLowerCase().split('?')[0];
  var bad = ['.css','.js','.woff','.woff2','.ttf','.eot','.png','.jpg','.gif','.svg','.ico','.map','.json'];
  for (var i = 0; i < bad.length; i++) if (p.slice(-bad[i].length) === bad[i]) return false;
  return p.indexOf('.m3u8') !== -1 || p.indexOf('.mp4') !== -1;
}

function extractSibnet(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': 'https://video.sibnet.ru/' })
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)["']/i)
           || html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4)["']/i);
      if (!m) return null;
      var mp4 = m[1].indexOf('http') === 0 ? m[1] : SIBNET_HOST + m[1];
      return { url: mp4, type: 'direct', headers: { 'Referer': full } };
    }).catch(function() { return null; });
}

function extractVidmoly(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractMp4upload(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
           || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i);
      if (m && isVideoUrl(m[1]))
        return { url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
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
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractStream(url) {
  var full = toAbs(url);
  if (!full) return Promise.resolve(null);
  var lo   = full.toLowerCase();
  if (lo.indexOf('sibnet')    !== -1) return extractSibnet(url);
  if (lo.indexOf('vidmoly')   !== -1) return extractVidmoly(url);
  if (lo.indexOf('mp4upload') !== -1) return extractMp4upload(url);
  if (lo.indexOf('mail.ru')   !== -1) return extractMailRu(url);
  return Promise.resolve(null);
}

// ── Sequential Stream Processing ────────────────────────────

function getStreamsSequential(embeds, srcNames, info) {
  var results = [];
  var completed = 0;

  function processStream(idx) {
    if (idx >= embeds.length) {
      return Promise.resolve(results);
    }

    var srcName = srcNames[idx] || ('Kaynak ' + idx);

    return extractStream(embeds[idx])
      .then(function(stream) {
        if (stream) {
          completed++;
          results.push({
            name:    info.title,
            title:   '⌜ ÇİZGİVEDİZİ ⌟ | ' + srcName + ' | Auto',
            url:     stream.url,
            quality: 'Auto',
            type:    stream.type,
            headers: stream.headers || {}
          });
        }
      })
      .catch(function() {})
      .then(function() {
        return processStream(idx + 1);
      });
  }

  return processStream(0);
}

// ── Main ─────────────────────────────────────────────────────

function buildEpUrl(item, mediaType, epGlobalNo) {
  if (mediaType === 'movie')
    return BASE_URL + '/film/' + encPath(item.id) + '/' + encPath(item.slug);
  return BASE_URL + '/dizi/' + encPath(item.id) + '/' + encPath(item.slug)
       + '/' + epGlobalNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  log('START ' + mediaType + ' tmdbId=' + tmdbId);

  var infoP = fetchTmdbInfo(tmdbId, mediaType);
  var epNoP = mediaType === 'tv'
    ? fetchGlobalEpNo(tmdbId, season, episode)
    : Promise.resolve(null);

  return Promise.all([infoP, epNoP])
    .then(function(res) {
      var info     = res[0];
      var epGlobal = res[1];

      return findContent(info, mediaType).then(function(item) {
        if (!item) {
          log('Content not found');
          return [];
        }

        var epUrl = buildEpUrl(item, mediaType, epGlobal);
        return getHtml(epUrl).then(function(html) {
          var embeds   = parseEmbeds(html);
          var srcNames = parseSourceNames(html);

          if (!embeds || embeds.length === 0) {
            log('No embeds found');
            return [];
          }

          log('Found ' + embeds.length + ' embed(s), extracting...');
          return getStreamsSequential(embeds, srcNames, info);
        });
      });
    })
    .catch(function(e) {
      log('ERROR: ' + e.message);
      return [];
    });
}

// ── Export ───────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
