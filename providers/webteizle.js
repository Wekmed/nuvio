// ============================================================
//  WebteIzle — Nuvio Provider
//  KekikStream WebteIzle.py'den tam port
//  Desteklenen extractor'lar (KekikStream kaynaklı):
//    VidMoly, Filemoon/ByseSX, Sibnet, DzenRu,
//    Odnoklassniki/OkRu, RubyVid, PixelDrain, MailRu
// ============================================================

var BASE_URL     = 'https://webteizle3.xyz';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Accept':        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':        BASE_URL + '/'
};

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = (mediaType === 'tv') ? 'tv' : 'movie';
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

// ── Slug ─────────────────────────────────────────────────────
function titleToSlug(title) {
  return (title || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// ── Sayfa bul ─────────────────────────────────────────────────
// WebteIzle.py: /izle/dublaj/{slug} ve /izle/altyazi/{slug}
function findFilmPage(titleTr, titleEn) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);

  var candidates = [];
  if (slugTr) {
    candidates.push(BASE_URL + '/izle/dublaj/'  + slugTr);
    candidates.push(BASE_URL + '/izle/altyazi/' + slugTr);
  }
  if (slugEn && slugEn !== slugTr) {
    candidates.push(BASE_URL + '/izle/dublaj/'  + slugEn);
    candidates.push(BASE_URL + '/izle/altyazi/' + slugEn);
  }

  if (candidates.length === 0) return searchFallback(titleTr, titleEn);

  return new Promise(function(resolve) {
    var done = 0, resolved = false;
    candidates.forEach(function(url) {
      fetch(url, { headers: HEADERS })
        .then(function(r) {
          if (!r.ok) throw new Error(r.status + '');
          return r.text().then(function(html) {
            if (html.indexOf('data-id') === -1) throw new Error('gecersiz');
            return { url: url, html: html };
          });
        })
        .then(function(result) {
          done++;
          if (!resolved) { resolved = true; resolve(result); }
        })
        .catch(function() {
          done++;
          if (done === candidates.length && !resolved) {
            resolved = true;
            resolve(searchFallback(titleTr, titleEn));
          }
        });
    });
  });
}

function searchFallback(titleTr, titleEn) {
  // WebteIzle.py: /filtre?a={query}
  var query = titleTr || titleEn;
  return fetch(BASE_URL + '/filtre?a=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var re = /href="([^"]+\/hakkinda\/[^"]+)"/gi, m, links = [];
      while ((m = re.exec(html)) !== null) links.push(m[1]);
      if (!links.length) throw new Error('Bulunamadi');
      var target = links[0].startsWith('http') ? links[0] : BASE_URL + links[0];
      return fetch(target, { headers: HEADERS })
        .then(function(r) { return r.text().then(function(html) { return { url: target, html: html }; }); });
    });
}

// ── Film ID ve dil listesi ────────────────────────────────────
function parseFilmId(html) {
  var m = html.match(/data-id="(\d+)"[^>]*id="wip"/)
       || html.match(/id="wip"[^>]*data-id="(\d+)"/)
       || html.match(/data-id="(\d+)"/);
  return m ? m[1] : null;
}

function parseDilList(html, pageUrl) {
  var diller = [];
  if (html.indexOf('/izle/dublaj/')  !== -1 || pageUrl.indexOf('/izle/dublaj/')  !== -1) diller.push({ dil: '0', ad: 'TR Dublaj' });
  if (html.indexOf('/izle/altyazi/') !== -1 || pageUrl.indexOf('/izle/altyazi/') !== -1) diller.push({ dil: '1', ad: 'TR Altyazı' });
  if (!diller.length) { diller.push({ dil: '0', ad: 'TR Dublaj' }); diller.push({ dil: '1', ad: 'TR Altyazı' }); }
  return diller;
}

// ── Alternatifleri getir ──────────────────────────────────────
// WebteIzle.py: /ajax/dataAlternatif3.asp
function fetchAlternatifler(filmId, dil, season, episode) {
  var body = 'filmid=' + filmId + '&dil=' + dil
           + '&s=' + (season || '') + '&b=' + (episode || '') + '&bot=0';
  return fetch(BASE_URL + '/ajax/dataAlternatif3.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type':     'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin':            BASE_URL
    }),
    body: body
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return (data.status === 'success' && Array.isArray(data.data)) ? data.data : [];
    })
    .catch(function() { return []; });
}

// ── Embed iframe çek ──────────────────────────────────────────
// WebteIzle.py: /ajax/dataEmbed.asp → _parse_embed()
function fetchEmbedIframe(embedId) {
  return fetch(BASE_URL + '/ajax/dataEmbed.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type':     'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin':            BASE_URL
    }),
    body: 'id=' + embedId
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // WebteIzle.py _parse_embed() mantığı — birebir port
      var urls = [];

      // 1. <iframe src="..."> — doğrudan URL
      var iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi, m;
      while ((m = iframeRe.exec(html)) !== null) {
        var src = m[1];
        if (src.startsWith('//')) src = 'https:' + src;
        if (src.startsWith('/') || !src.startsWith('http')) continue;
        // WebteIzle.py domain düzeltmeleri
        src = src.replace('bysezoxexe.com', 'filemoon.sx')
                 .replace('vidmoly.me', 'vidmoly.net')
                 .replace('hqq.to', 'hqq.tv');
        urls.push(src);
      }

      // 2. JS fonksiyon çağrıları — WebteIzle.py pts tablosu
      var pts = {
        'vidmoly\\([\'"]([^\'"]+)[\'"]':           'https://vidmoly.net/embed-{}.html',
        '(?:filemoon|bysezoxexe)\\([\'"]([^\'"]+)[\'"]': 'https://filemoon.sx/e/{}',
        'sruby\\([\'"]([^\'"]+)[\'"]':             'https://rubyvidhub.com/embed-{}.html',
        'okru\\([\'"]([^\'"]+)[\'"]':              'https://ok.ru/videoembed/{}',
        'pixel\\([\'"]([^\'"]+)[\'"]':             'https://pixeldrain.com/api/file/{}',
        'mailru\\([\'"]([^\'"]+)[\'"]':            'https://my.mail.ru/video/embed/{}'
      };
      Object.keys(pts).forEach(function(pat) {
        var rm = new RegExp(pat, 'i').exec(html);
        if (rm) {
          var id  = rm[1].split('|')[0];
          var url = pts[pat].replace('{}', id);
          if (urls.indexOf(url) === -1) urls.push(url);
        }
      });

      // 3. Dzen — dzenUrl(...) veya href içinde dzen.ru
      var dzenM = html.match(/dzen\\(['"](https?:\/\/[^'"]+)['"]\)/i)
               || html.match(/(https:\/\/dzen\.ru\/(?:video\/watch|embed)\/[^\s"'<>]+)/i);
      if (dzenM) { var du = dzenM[1]; if (urls.indexOf(du) === -1) urls.push(du); }

      return urls.length ? urls[0] : null;
    })
    .catch(function() { return null; });
}

// ══════════════════════════════════════════════════════════════
//  EXTRACTORlar — KekikStream Python kaynaklı JS port
// ══════════════════════════════════════════════════════════════

// ── VidMoly ──────────────────────────────────────────────────
// KekikStream: VidMoly.py — packed JS unpack + sources regex
function fetchVidMolyStream(iframeUrl) {
  var fullUrl = iframeUrl.startsWith('//') ? 'https:' + iframeUrl : iframeUrl;
  // Tüm domain varyantlarını .net'e normalize et
  fullUrl = fullUrl.replace(/vidmoly\.(to|me|biz|net)/, 'vidmoly.net');

  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer':        BASE_URL + '/',
      'Sec-Fetch-Dest': 'iframe'
    })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // Packed JS unpack
      var unpacked = tryUnpack(html) || html;

      // sources: [{file:"..."}] — en güvenilir yol
      var srcM = unpacked.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i)
              || unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!srcM) return null;

      var subtitles = extractSubtitles(unpacked, fullUrl);
      return { url: srcM[1], type: 'hls', referer: fullUrl, subtitles: subtitles };
    })
    .catch(function() { return null; });
}

// ── Filemoon / ByseSX ─────────────────────────────────────────
// KekikStream: Filemoon.py — packed JS + AES-GCM decrypt (opsiyonel)
function fetchFilemoonStream(iframeUrl) {
  var fullUrl = iframeUrl.startsWith('//') ? 'https:' + iframeUrl : iframeUrl;
  fullUrl = fullUrl.replace('bysezoxexe.com', 'filemoon.sx')
                   .replace('bysedikamoum.com', 'filemoon.sx');
  var origin = fullUrl.split('/').slice(0, 3).join('/');

  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer':        BASE_URL + '/',
      'Sec-Fetch-Dest': 'iframe'
    })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var unpacked = tryUnpack(html) || html;
      var m = unpacked.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i)
           || unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (!m) return null;

      var subtitles = extractSubtitles(unpacked, fullUrl);
      return { url: m[1], type: 'hls', referer: origin + '/', subtitles: subtitles };
    })
    .catch(function() { return null; });
}

// ── Sibnet ────────────────────────────────────────────────────
// KekikStream kaynaklı + CS3 DEX analizi
function fetchSibnetStream(src) {
  var id = (src.match(/videoid=(\d+)/) || src.match(/video(\d+)/) || [])[1];
  if (!id) return Promise.resolve(null);
  var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + id;
  return fetch(shellUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i)
           || html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
      if (!m) return null;
      return { url: 'https://video.sibnet.ru' + m[1], type: 'direct', referer: shellUrl };
    })
    .catch(function() { return null; });
}

// ── DzenRu ────────────────────────────────────────────────────
// KekikStream: DzenRu.py — embed/{key} → okcdn.ru linkleri
function fetchDzenStream(dzenUrl) {
  var videoKey = dzenUrl.split('/').pop().split('?')[0];
  var embedUrl = 'https://dzen.ru/embed/' + videoKey;

  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer': 'https://dzen.ru/',
      'Origin':  'https://dzen.ru'
    })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // KekikStream DzenRu.py: r'https://vd\d+\.okcdn\.ru/\?[^"\'\\s]+'
      var re = /https:\/\/vd\d+\.okcdn\.ru\/\?[^\s"'\\<>]+/g;
      var m, links = [], seen = {};
      while ((m = re.exec(html)) !== null) {
        if (!seen[m[0]]) { seen[m[0]] = true; links.push(m[0]); }
      }
      if (links.length) {
        // En yüksek kalite genelde sonuncu — KekikStream: list(set(links))[-1]
        var best = links[links.length - 1];
        return { url: best, type: 'direct', referer: 'https://dzen.ru/' };
      }
      // Fallback: doğrudan m3u8
      var fm = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (fm) return { url: fm[1], type: 'hls', referer: 'https://dzen.ru/' };
      return null;
    })
    .catch(function() { return null; });
}

// ── Odnoklassniki / OkRu ─────────────────────────────────────
// KekikStream: Odnoklassniki.py — videoembed URL → metadata → en iyi kalite
function fetchOkRuStream(src) {
  var url = src;
  if (url.indexOf('/video/') !== -1) url = url.replace('/video/', '/videoembed/');
  if (!url.startsWith('http')) url = 'https://ok.ru' + url;

  return fetch(url, {
    headers: Object.assign({}, HEADERS, {
      'Origin':  'https://ok.ru',
      'Referer': 'https://ok.ru/'
    })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // KekikStream: data-options → flashvars → metadata → ondemandHls / videos[]
      var dataOptsM = html.match(/data-options="([^"]+)"/i);
      if (dataOptsM) {
        try {
          var opts      = JSON.parse(dataOptsM[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"'));
          var flashvars = opts.flashvars || {};
          var metadata  = flashvars.metadata ? JSON.parse(flashvars.metadata) : null;
          if (metadata) {
            var best = metadata.ondemandHls || metadata.ondemandDash;
            if (!best) {
              var order  = ['ULTRA','QUAD','FULL','HD','SD','LOW','MOBILE'];
              var videos = metadata.videos || [];
              for (var qi = 0; qi < order.length; qi++) {
                for (var vi = 0; vi < videos.length; vi++) {
                  if ((videos[vi].name || '').toUpperCase() === order[qi]) { best = videos[vi].url; break; }
                }
                if (best) break;
              }
            }
            if (best) {
              best = best.replace(/u0026/g,'&').replace(/\\u0026/g,'&');
              return { url: best, type: best.includes('.m3u8') ? 'hls' : 'direct', referer: url };
            }
          }
        } catch(e) {}
      }

      // Fallback: videos: [...] regex
      var vDataM = html.match(/"videos"\s*:\s*(\[[\s\S]+?\])/);
      if (vDataM) {
        try {
          var videos = JSON.parse(vDataM[1].replace(/&quot;/g,'"').replace(/u0026/g,'&'));
          var order  = ['ULTRA','QUAD','FULL','HD','SD','LOW','MOBILE'];
          var bestUrl = null;
          for (var q = 0; q < order.length && !bestUrl; q++)
            for (var v = 0; v < videos.length && !bestUrl; v++)
              if ((videos[v].name || '').toUpperCase() === order[q]) bestUrl = videos[v].url;
          if (!bestUrl && videos.length) bestUrl = videos[0].url;
          if (bestUrl) return { url: bestUrl.replace(/u0026/g,'&'), type: 'direct', referer: url };
        } catch(e) {}
      }
      return null;
    })
    .catch(function() { return null; });
}

// ── RubyVid ───────────────────────────────────────────────────
// KekikStream: RapidVid.py — packed JS → decode_secret → m3u8
function fetchRubyVidStream(src) {
  var fullUrl = src.startsWith('//') ? 'https:' + src : src;
  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var unpacked = tryUnpack(html) || html;
      var m = unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i)
           || unpacked.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: fullUrl } : null;
    })
    .catch(function() { return null; });
}

// ── PixelDrain ────────────────────────────────────────────────
function fetchPixelDrainStream(src) {
  var fileId = src.split('/u/').pop().split('?')[0];
  var dlUrl  = 'https://pixeldrain.com/api/file/' + fileId + '?download';
  return Promise.resolve({ url: dlUrl, type: 'direct', referer: 'https://pixeldrain.com/' });
}

// ── MailRu ────────────────────────────────────────────────────
function fetchMailRuStream(src) {
  var fullUrl = src.startsWith('//') ? 'https:' + src : src;
  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/"url"\s*:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i);
      return m ? { url: m[1], type: m[1].includes('.m3u8') ? 'hls' : 'direct', referer: fullUrl } : null;
    })
    .catch(function() { return null; });
}

// ══════════════════════════════════════════════════════════════
//  YARDIMCI FONKSİYONLAR
// ══════════════════════════════════════════════════════════════

// packed JS (eval/p,a,c,k,e,r) çözücü
function tryUnpack(html) {
  var m = html.match(/eval\(function\(p,a,c,k,e,[^)]*\)[\s\S]+?\)\)/);
  if (!m) return null;
  try {
    var packed = m[0];
    var parts  = packed.match(/\('([\s\S]+?)',(\d+),(\d+),'([^']*)'/);
    if (!parts) return null;
    var p = parts[1], a = parseInt(parts[2]), c = parseInt(parts[3]);
    var k = parts[4].split('|');
    function e(n) { return (n < a ? '' : e(Math.floor(n/a))) + ((n = n%a) > 35 ? String.fromCharCode(n+29) : n.toString(36)); }
    while (c--) { if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]); }
    return p;
  } catch(ex) { return null; }
}

// Altyazı çıkar
function extractSubtitles(html, referer) {
  var subtitles = [], re = /['"](https?:\/\/[^\s"'<>]+\.(?:vtt|srt)[^\s"'<>]*)['"]/gi, m;
  while ((m = re.exec(html)) !== null) {
    subtitles.push({ url: m[1], language: 'Türkçe', label: 'Türkçe' });
  }
  return subtitles;
}

// URL tipini tespit et
function detectProvider(src) {
  if (!src) return 'unknown';
  if (src.indexOf('vidmoly') !== -1)                                        return 'vidmoly';
  if (src.indexOf('filemoon') !== -1 || src.indexOf('bysezoxexe') !== -1
   || src.indexOf('bysedikamoum') !== -1)                                   return 'filemoon';
  if (src.indexOf('sibnet.ru') !== -1)                                      return 'sibnet';
  if (src.indexOf('dzen.ru') !== -1)                                        return 'dzen';
  if (src.indexOf('ok.ru') !== -1 || src.indexOf('odnoklassniki') !== -1)  return 'okru';
  if (src.indexOf('rubyvidhub') !== -1 || src.indexOf('rapidvid') !== -1)  return 'rubyvid';
  if (src.indexOf('pixeldrain') !== -1)                                     return 'pixeldrain';
  if (src.indexOf('mail.ru') !== -1)                                        return 'mailru';
  return 'unknown';
}

// Tek bir embed'i işle → stream nesnesi döndür
function processEmbed(embedId, dilAd, movieName) {
  return fetchEmbedIframe(embedId)
    .then(function(src) {
      if (!src) return null;
      var provider = detectProvider(src);
      var flag     = dilAd.indexOf('Dublaj') !== -1 ? '🇹🇷 ' : '🌐 ';
      var label    = '⌜ WEBTEIZLE ⌟ | ' + provider.charAt(0).toUpperCase() + provider.slice(1) + ' | ' + flag + dilAd;

      function make(s) {
        if (!s) return null;
        var obj = {
          name:    movieName,
          title:   label,
          url:     s.url,
          quality: s.quality || 'Auto',
          type:    s.type    || 'hls',
          headers: { 'Referer': s.referer || src, 'User-Agent': HEADERS['User-Agent'] }
        };
        if (s.subtitles && s.subtitles.length) obj.subtitles = s.subtitles;
        return obj;
      }

      switch (provider) {
        case 'vidmoly':    return fetchVidMolyStream(src).then(make);
        case 'filemoon':   return fetchFilemoonStream(src).then(make);
        case 'sibnet':     return fetchSibnetStream(src).then(make);
        case 'dzen':       return fetchDzenStream(src).then(make);
        case 'okru':       return fetchOkRuStream(src).then(make);
        case 'rubyvid':    return fetchRubyVidStream(src).then(make);
        case 'pixeldrain': return fetchPixelDrainStream(src).then(make);
        case 'mailru':     return fetchMailRuStream(src).then(make);
        default:
          // Genel fallback: m3u8 regex
          return fetch(src, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
            .then(function(r) { return r.text(); })
            .then(function(html) {
              var unpacked = tryUnpack(html) || html;
              var m = unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
              return m ? make({ url: m[1], type: 'hls', referer: src }) : null;
            })
            .catch(function() { return null; });
      }
    })
    .catch(function() { return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var movieName = info.titleTr || info.titleEn;
      return findFilmPage(info.titleTr, info.titleEn)
        .then(function(result) {
          var filmId = parseFilmId(result.html);
          if (!filmId) throw new Error('Film ID bulunamadi');

          var diller  = parseDilList(result.html, result.url);
          var streams = [];

          return Promise.all(diller.map(function(d) {
            return fetchAlternatifler(filmId, d.dil, season, episode)
              .then(function(embedList) {
                return Promise.all(embedList.map(function(e) {
                  return processEmbed(e.id, d.ad, movieName);
                }));
              })
              .then(function(results) {
                results.forEach(function(s) { if (s) streams.push(s); });
              });
          })).then(function() { return streams; });
        });
    })
    .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
