// ============================================================
//  HDFilmCehennemi — Nuvio Provider v2
//  CS3 DEX (v68) + KekikStream HDFilmCehennemi.py analizi
//  Film + Dizi | Cloudflare bypass | WebView extractor
// ============================================================

var BASE_URL     = 'https://www.hdfilmcehennemi.nl';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var UA_FF     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';

var HEADERS = {
  'User-Agent':     UA_CHROME,
  'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer':        BASE_URL + '/'
};

// ── Yardımcı ─────────────────────────────────────────────────

function decodeHtml(s) {
  if (!s) return '';
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').trim();
}

function fixUrl(url) {
  if (!url) return '';
  url = String(url).replace(/\\/g,'');
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  return BASE_URL + (url.startsWith('/') ? '' : '/') + url;
}

function regexFirst(text, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(text);
  return m ? m[1] : null;
}

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === 'movie' ? 'movie' : 'tv';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || '',
        year:   (d.release_date || d.first_air_date || '').slice(0,4)
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

function searchHDFC(query) {
  return fetch(BASE_URL + '/search?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'X-Requested-With': 'fetch' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var results = [];
    // div.section-slider-container div.slider-slide
    var slideRe = /<div[^>]+class="[^"]*slider-slide[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*slider-slide|$)/g;
    var m;
    while ((m = slideRe.exec(html)) !== null) {
      var block  = m[1];
      var title  = regexFirst(block, /<h4[^>]*>([\s\S]*?)<\/h4>/)
                || regexFirst(block, /<h3[^>]*>([\s\S]*?)<\/h3>/);
      var href   = regexFirst(block, /href="([^"]+)"/);
      var poster = regexFirst(block, /data-src="([^"]+)"/)
                || regexFirst(block, /src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/);
      if (!title || !href) continue;
      if (poster) poster = poster.replace('/thumb/', '/list/');
      results.push({
        title:  decodeHtml(title),
        href:   fixUrl(href),
        poster: poster ? fixUrl(poster) : null
      });
    }
    return results;
  })
  .catch(function() { return []; });
}

function findBest(results, en, tr, year) {
  var nEn = normalize(en), nTr = normalize(tr);
  var scored = results.map(function(r) {
    var ni = normalize(r.title), score = 0;
    if (ni === nEn || ni === nTr) score += 100;
    else if (nEn && (ni.indexOf(nEn) !== -1 || nEn.indexOf(ni) !== -1)) score += 65;
    else if (nTr && (ni.indexOf(nTr) !== -1 || nTr.indexOf(ni) !== -1)) score += 60;
    if (year && r.href && r.href.indexOf(year) !== -1) score += 10;
    return { r: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 55) ? scored[0].r : null;
}

// ── Kalite ───────────────────────────────────────────────────

function isHD(label) {
  if (!label) return false;
  var l = String(label).toLowerCase().replace(/\s/g,'');
  return l.indexOf('1080') !== -1 || l.indexOf('1440') !== -1 ||
         l.indexOf('2160') !== -1 || l.indexOf('4k')   !== -1 ||
         (!isNaN(parseInt(l)) && parseInt(l) >= 1080);
}

// ── Skip listeleri ────────────────────────────────────────────
// CS3 DEX'ten gözlemlenen 'Close' string'i ile uyumlu

var SKIP_BTN = [
  /^close$/i,       // CS3'te gözlemlendi — CloseLoad butonu "Close" olarak geliyor
  /closeload/i,
  /close\s*load/i,
  /dosyaload/i,
  /dosya\s*load/i,
  /mixdrop/i,
  /^dood$/i,
  /doodstream/i,
  /streamtape/i,
  /uqload/i,
  /mp4upload/i,
  /yourupload/i,
  /upstream/i,
  /filemoon/i,
];

var SKIP_IFRAME = [
  'closeload','close-load','dosyaload','mixdrop','dood',
  'streamtape','uqload','mp4upload','yourupload','upstream','filemoon'
];

// ── Buton parse ───────────────────────────────────────────────
// CS3: div.alternative-links[data-lang] > button.alternative-link[data-video]
// CS3 lang logic: button.language-link[data-lang=X].text() → DUAL varsa "DUAL"

function parseButtons(html) {
  var sources = [];

  var blockRe = /<div[^>]+class="[^"]*alternative-links[^"]*"[^>]+data-lang="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
  var bm;
  while ((bm = blockRe.exec(html)) !== null) {
    var rawLang = (bm[1] || '').toUpperCase();
    var block   = bm[2];

    // Gerçek dil etiketini al
    var langLabel = rawLang;
    var lbRe = new RegExp(
      'button[^>]+class="[^"]*language-link[^"]*"[^>]+data-lang="' +
      rawLang.toLowerCase() + '"[^>]*>([\\s\\S]*?)<\\/button>'
    );
    var lbm = lbRe.exec(html);
    if (lbm) {
      var lt = lbm[1].replace(/<[^>]+>/g,'').trim();
      langLabel = lt.indexOf('DUAL') !== -1 ? 'DUAL' : lt;
    }

    var btnRe = /<button[^>]+class="[^"]*alternative-link[^"]*"[^>]+data-video="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
    var btn;
    while ((btn = btnRe.exec(block)) !== null) {
      var videoId  = btn[1];
      // CS3: link.text().strip().replace('(HDrip Xbet)','').strip()
      var rawText  = btn[2].replace(/<[^>]+>/g,'').replace(/\(HDrip Xbet\)/gi,'').trim();

      if (!rawText || !videoId) continue;

      if (SKIP_BTN.some(function(p) { return p.test(rawText); })) {
        console.log('[HDFC] Skip (btn): ' + rawText);
        continue;
      }

      var name = langLabel ? langLabel + ' | ' + rawText : rawText;
      sources.push({ videoId: videoId, name: name });
    }
  }
  return sources;
}

// ── Dizi bölümleri ────────────────────────────────────────────
// CS3: div.seasons-tab-content a > h4

function parseEpisodes(html) {
  var eps = [];
  var block = regexFirst(html, /<div[^>]+class="[^"]*seasons-tab-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!block) return eps;

  var linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = linkRe.exec(block)) !== null) {
    var href  = fixUrl(m[1]);
    var name  = regexFirst(m[2], /<h4[^>]*>([\s\S]*?)<\/h4>/);
    if (!name) name = m[2].replace(/<[^>]+>/g,'').trim();
    name = decodeHtml(name);
    if (!name || !href) continue;

    var sNum = 1, eNum = 1;
    var sm = name.match(/(\d+)\s*\.\s*sezon/i);
    var em = name.match(/(\d+)\s*\.\s*b[oö]l[üu]m/i);
    if (sm) sNum = parseInt(sm[1]);
    if (em) eNum = parseInt(em[1]);

    eps.push({ season: sNum, episode: eNum, title: name, url: href });
  }
  return eps;
}

// ── Altyazı ──────────────────────────────────────────────────

function extractSubtitles(html) {
  var subs = [];
  var tm = html.match(/tracks\s*:\s*(\[[\s\S]*?\])/);
  if (tm) {
    try {
      JSON.parse(tm[1]).forEach(function(t) {
        if (!t.file) return;
        var kind = t.kind || '';
        if (kind && kind !== 'captions' && kind !== 'subtitles') return;
        var label = t.label || t.language || 'TR';
        if (label === 'Turkish') label = 'Türkçe';
        if (label === 'English') label = 'İngilizce';
        subs.push({ url: fixUrl(t.file), name: label });
      });
    } catch(e) {}
  }
  return subs;
}

// ── Video kaynakları (JWPlayer) ───────────────────────────────

function extractSources(html) {
  var found = [];
  var sm = html.match(/sources\s*:\s*(\[[\s\S]*?\])/);
  if (sm) {
    try {
      JSON.parse(sm[1]).forEach(function(s) {
        var url   = s.file || s.src || s.url;
        var label = s.label || s.res || s.quality || '';
        if (!url) return;
        if (isHD(label)) {
          found.push({ url: fixUrl(url), label: String(label) });
        } else if (!label && url.indexOf('m3u8') !== -1) {
          found.push({ url: fixUrl(url), label: 'Auto' });
        }
      });
      if (found.length) return found;
    } catch(e) {}

    // regex fallback
    var pr = /file\s*:\s*["']([^"']+)["'][\s\S]*?label\s*:\s*["']([^"']+)["']/g;
    var pm;
    while ((pm = pr.exec(sm[1])) !== null) {
      if (isHD(pm[2])) found.push({ url: fixUrl(pm[1]), label: pm[2] });
    }
    if (found.length) return found;
  }

  // tekil m3u8
  var s = regexFirst(html, /file\s*:\s*["'](https?[^"']+\.m3u8[^"']*)["']/);
  if (s) return [{ url: fixUrl(s), label: 'Auto' }];

  return [];
}

// ── Rapidrame decode (RapidVid.py portu) ─────────────────────

function decodeRapidSecret(enc) {
  try {
    var rev  = enc.split('').reverse().join('');
    var dec1 = atob(rev);
    var key  = 'K9L', out = '';
    for (var i = 0; i < dec1.length; i++) {
      out += String.fromCharCode(dec1.charCodeAt(i) - ((key[i%key.length].charCodeAt(0)%5)+1));
    }
    var r = atob(out);
    return r.startsWith('http') ? r : null;
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

function extractRapidrameUrl(html) {
  // 1. HexCodec
  var hex = regexFirst(html, /file"\s*:\s*"([0-9a-fA-F]{20,})"/);
  if (hex) { var u = decodeHex(hex); if (u) return u; }
  // 2. av('...')
  var av = regexFirst(html, /av\('([^']+)'\)/);
  if (av) { var u = decodeRapidSecret(av); if (u) return u; }
  // 3. packed eval
  var ev = html.match(/eval\(function\(p,a,c,k,e,[dr]\)([\s\S]+?)\)\s*;/);
  if (ev) {
    var um = ev[0].match(/(https?:[^\s"'\\]+\.m3u8[^\s"'\\]*)/);
    if (um) return um[1];
  }
  // 4. direkt file
  var dm = regexFirst(html, /file\s*:\s*["'](https?[^"']+\.m3u8[^"']*)["']/);
  if (dm) return dm;
  return null;
}

// ── /video/{id}/ → iframe → stream ───────────────────────────

function getVideoSource(videoId, sourceName, pageUrl) {
  return fetch(BASE_URL + '/video/' + videoId + '/', {
    headers: {
      'Content-Type':     'application/json',
      'X-Requested-With': 'fetch',
      'Referer':          pageUrl,
      'User-Agent':       UA_CHROME
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    var snippet = (json.data || {}).html || '';

    // iframe data-src — 3 farklı escape formatı (CS3 DEX'te hepsi var)
    var iframeUrl = regexFirst(snippet, /data-src=["']([^"']+)["']/)
                 || regexFirst(snippet, /data-src=\\"([^"\\]+)/)
                 || regexFirst(snippet, /data-src=\\\\\\"([^"\\]+)/);

    if (!iframeUrl) {
      console.log('[HDFC] iframe yok, id=' + videoId);
      return [];
    }

    iframeUrl = iframeUrl.replace(/\\\\/g,'').replace(/\\/g,'');

    // iframe skip
    if (SKIP_IFRAME.some(function(d) { return iframeUrl.indexOf(d) !== -1; })) {
      console.log('[HDFC] iframe skip: ' + iframeUrl);
      return [];
    }

    // URL dönüşümleri
    if (iframeUrl.indexOf('mobi') !== -1) {
      iframeUrl = iframeUrl.split('?')[0];
    } else if (iframeUrl.indexOf('rapidrame') !== -1 &&
               iframeUrl.indexOf('?rapidrame_id=') !== -1) {
      var rapId = iframeUrl.split('?rapidrame_id=')[1].split('&')[0];
      iframeUrl = BASE_URL + '/rplayer/' + rapId;
    }

    var isRapid = iframeUrl.indexOf('/rplayer/') !== -1 ||
                  iframeUrl.indexOf('rapidrame') !== -1;

    // CS3 HdFilmCehennemiRapid: referer = iframe'in kendi origin'i
    var rapidRef = BASE_URL + '/';
    if (isRapid) {
      try {
        var pu = new URL(iframeUrl);
        rapidRef = pu.protocol + '//' + pu.host + '/';
      } catch(e) {}
    }

    return fetch(iframeUrl, {
      headers: {
        'User-Agent':    isRapid ? UA_FF : UA_CHROME,
        'Referer':       isRapid ? rapidRef : BASE_URL + '/',
        'Origin':        isRapid ? rapidRef.replace(/\/$/,'') : BASE_URL,
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': isRapid ? 'video' : 'iframe',
        'Sec-Fetch-Mode': isRapid ? 'cors'  : 'navigate',
        'Sec-Fetch-Site': 'cross-site'
      }
    })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      if (!html || html.length < 50) return [];

      if (isRapid) {
        var ru = extractRapidrameUrl(html);
        if (!ru) {
          console.log('[HDFC] Rapid decode fail: ' + sourceName);
          return [];
        }
        return [{
          name:      'HDFilmCehennemi',
          title:     '⌜ HDFC ⌟ | ' + sourceName,
          url:       ru,
          quality:   'Auto',
          headers:   {
            'User-Agent':    UA_FF,
            'Referer':       rapidRef,
            'Origin':        rapidRef.replace(/\/$/,''),
            'Sec-Fetch-Dest':'video',
            'Sec-Fetch-Mode':'cors',
            'Sec-Fetch-Site':'cross-site'
          },
          subtitles: extractSubtitles(html)
        }];
      }

      var subs    = extractSubtitles(html);
      var sources = extractSources(html);
      if (!sources.length) return [];

      return sources.map(function(src) {
        var qt = (src.label && src.label !== 'Auto') ? ' | ' + src.label : '';
        return {
          name:      'HDFilmCehennemi',
          title:     '⌜ HDFC ⌟ | ' + sourceName + qt,
          url:       src.url,
          quality:   src.label,
          headers:   { 'Referer': BASE_URL + '/', 'User-Agent': UA_CHROME },
          subtitles: subs
        };
      });
    });
  })
  .catch(function(e) {
    console.error('[HDFC] getVideoSource err: ' + e);
    return [];
  });
}

// ── Sayfa stream'leri ─────────────────────────────────────────

function fetchPageStreams(pageUrl) {
  return fetch(pageUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var btns = parseButtons(html);
      if (!btns.length) return [];

      var all = [], idx = 0;
      function next() {
        if (idx >= btns.length) return Promise.resolve();
        var b = btns[idx++];
        return getVideoSource(b.videoId, b.name, pageUrl)
          .then(function(s) { s.forEach(function(x){ all.push(x); }); return next(); });
      }

      var workers = [];
      for (var i = 0; i < Math.min(4, btns.length); i++) workers.push(next());
      return Promise.all(workers).then(function() { return all; });
    })
    .catch(function() { return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      return searchHDFC(info.titleEn || info.titleTr)
        .then(function(res) {
          var best = findBest(res, info.titleEn, info.titleTr, info.year);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchHDFC(info.titleTr).then(function(r2) {
              return findBest(r2, info.titleEn, info.titleTr, info.year);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) return [];
          console.log('[HDFC] Eşleşti: ' + best.title);

          if (mediaType === 'movie') {
            return fetchPageStreams(best.href);
          }

          return fetch(best.href, { headers: HEADERS })
            .then(function(r) { return r.text(); })
            .then(function(html) {
              var eps  = parseEpisodes(html);
              var sNum = parseInt(seasonNum)  || 1;
              var eNum = parseInt(episodeNum) || 1;
              var hit  = eps.filter(function(e) {
                return e.season === sNum && e.episode === eNum;
              });
              if (!hit.length) return [];
              return fetchPageStreams(hit[0].url);
            });
        });
    })
    .catch(function(e) {
      console.error('[HDFC] err: ' + e);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
    }
