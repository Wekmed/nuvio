/**
 * CizgiVeDizi — Nuvio Provider (QuickJS & Android TV Uyumlu Optimize Sürüm)
 */

var BASE_URL    = 'https://www.cizgivedizi.com';
var TMDB_KEY    = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST = 'https://video.sibnet.ru';
var LOG_TAG     = '[CizgiVeDizi]';

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

function log(msg) {
  console.log(LOG_TAG + ' ' + msg);
}

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9]/g,'');
}

// 🔥 CRITICAL FIX: QuickJS içinde %100 sorunsuz çalışan Saf JS Çözücü
function b64decode(b64) {
  if (!b64 || typeof b64 !== 'string') return null;

  try {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var str = String(b64).replace(/[=]+$/, '');
    var output = '';
    if (str.length % 4 === 1) return null;
    
    for (var bc = 0, bs, buffer, idx = 0; char = str.charAt(idx++); ~char && (bs = bc % 4 ? bs * 64 + char : char, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
      char = chars.indexOf(char);
    }
    
    var parsed = JSON.parse(output);
    log('b64decode: Pure JS Decode SUCCESS (' + (Array.isArray(parsed) ? parsed.length : 0) + ' items)');
    return parsed;
  } catch(e) {
    log('b64decode: Pure JS Decode FAILED - ' + e.message);
    return null;
  }
}

function getHtml(url, extra) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extra || {}) })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

function encPath(s) {
  var out = '';
  for (var i = 0; i < (s || '').length; i++) {
    var code = s.charCodeAt(i);
    if (code > 127) out += encodeURIComponent(s[i]);
    else out += s[i];
  }
  return out;
}

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
    }).catch(function() { return { title:'', titleTr:'', titleEn:'', year:'' }; });
}

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
  var s = 0;
  if (n.indexOf(ne) !== -1 || n.indexOf(nt) !== -1) s = 80;
  else if (ne.indexOf(n) !== -1 || nt.indexOf(n) !== -1) s = 70;
  return s;
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);
  return queries.reduce(function(chain, query) {
    return chain.then(function(found) {
      if (found) return found;
      return searchSite(query, mediaType).then(function(results) {
        if (!results || !results.length) return null;
        var scored = results.map(function(item) {
          return { item: item, score: scoreItem(item, info.titleEn, info.titleTr, info.year) };
        }).sort(function(a, b) { return b.score - a.score; });
        return scored.length && scored[0].score >= 70 ? scored[0].item : null;
      });
    });
  }, Promise.resolve(null));
}

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    (function(sn) {
      promises.push(
        fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sn + '?api_key=' + TMDB_KEY)
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

function parseEmbeds(html) {
  // Method A: window.__embeds_b64 (QuickJS Uyumlu)
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    var arr = b64decode(b64m[1]);
    if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
  }

  // Method B: window.__embeds = [...]
  var dm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dm) {
    try {
      var arr2 = JSON.parse(dm[1]);
      if (Array.isArray(arr2) && arr2.length) return arr2.filter(Boolean);
    } catch(e) {}
  }
  return [];
}

function parseSourceNames(html) {
  var names = [];
  var re = /data-kaynak="(\d+)"[^>]*>\s*([^\n<]+?)\s*</gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1]);
    var name = (m[2] || '').trim();
    if (name) names[idx] = name;
  }
  return names;
}

function toAbs(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
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

function extractStream(url) {
  var full = toAbs(url);
  if (!full) return Promise.resolve(null);
  var lo = full.toLowerCase();
  if (lo.indexOf('sibnet')  !== -1) return extractSibnet(url);
  if (lo.indexOf('vidmoly') !== -1) return extractVidmoly(url);
  return Promise.resolve(null);
}

// 🔥 NUVIO TV İÇİN SIRALI VE KORUMALI ÇÖZÜMLEME
function getStreamsSequential(embeds, srcNames, info) {
  var results = [];

  function processStream(idx) {
    if (idx >= embeds.length) {
      return Promise.resolve(results);
    }

    var srcName = srcNames[idx] || ('Kaynak ' + idx);

    return extractStream(embeds[idx])
      .then(function(stream) {
        if (stream) {
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

function buildEpUrl(item, mediaType, epGlobalNo) {
  if (mediaType === 'movie') return BASE_URL + '/film/' + encPath(item.id) + '/' + encPath(item.slug);
  return BASE_URL + '/dizi/' + encPath(item.id) + '/' + encPath(item.slug) + '/' + epGlobalNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  log('START ' + mediaType + ' tmdbId=' + tmdbId);

  var infoP = fetchTmdbInfo(tmdbId, mediaType);
  var epNoP = mediaType === 'tv' ? fetchGlobalEpNo(tmdbId, season, episode) : Promise.resolve(null);

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

// ── Export (Nuvio Global Entegrasyon) ──────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
