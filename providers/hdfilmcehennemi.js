// ============================================================
//  HDFilmCehennemi — Nuvio Provider
//  KekikStream HDFilmCehennemi.py'den dönüştürüldü
//  Film + Dizi destekler
//  Hermes uyumlu: regex + fetch, cheerio yok
// ============================================================

var BASE_URL     = 'https://www.hdfilmcehennemi.nl';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':    BASE_URL + '/'
};

// ── Yardımcı: HTML entity decode ────────────────────────────
function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ── Yardımcı: URL düzelt ─────────────────────────────────────
function fixUrl(url) {
  if (!url) return '';
  url = url.replace(/\\/g, '');
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  return BASE_URL + (url.startsWith('/') ? '' : '/') + url;
}

// ── Yardımcı: Regex ilk eşleşme ─────────────────────────────
function regexFirst(html, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(html);
  return m ? m[1] : null;
}

// ── Yardımcı: Regex tüm eşleşmeler ──────────────────────────
function regexAll(html, pattern, flags) {
  var re = new RegExp(pattern, (flags || '') + 'g');
  var results = [], m;
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

// ── Yardımcı: Random cookie (cehennempass için) ──────────────
// RecTV.py generate_random_cookie() karşılığı
function randomCookie() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var result = '';
  for (var i = 0; i < 16; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// ── Yardımcı: TMDB bilgisi al ───────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'movie') ? 'movie' : 'tv';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Arama ────────────────────────────────────────────────────
// HDFilmCehennemi.py search() — JSON endpoint döndürür
function searchHDFC(query) {
  return fetch(BASE_URL + '/search/?q=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, {
      'X-Requested-With': 'fetch',
      'authority': 'www.hdfilmcehennemi.nl'
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var results = [];
    (data.results || []).forEach(function(htmlStr) {
      // Her sonuç HTML string — h4.title ve a[href] ve img[data-src]
      var title  = regexFirst(htmlStr, /<h4[^>]*class="title"[^>]*>([^<]+)<\/h4>/);
      var href   = regexFirst(htmlStr, /href="([^"]+)"/);
      var poster = regexFirst(htmlStr, /data-src="([^"]+)"/) ||
                   regexFirst(htmlStr, /<img[^>]+src="([^"]+)"/);

      if (title && href) {
        // /thumb/ → /list/ dönüşümü (py kodundan)
        if (poster) poster = poster.replace('/thumb/', '/list/');
        results.push({
          title:  decodeHtml(title),
          href:   fixUrl(href),
          poster: poster ? fixUrl(poster) : null
        });
      }
    });
    return results;
  })
  .catch(function() { return []; });
}

// ── En iyi eşleşmeyi bul ─────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ıi]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBestMatch(results, titleEn, titleTr, year) {
  var nEn = normalize(titleEn);
  var nTr = normalize(titleTr);
  var scored = results.map(function(item) {
    var nItem = normalize(item.title);
    var score = 0;
    if (nItem === nEn || nItem === nTr) score += 100;
    else if (nItem.indexOf(nEn) !== -1 || nEn.indexOf(nItem) !== -1) score += 60;
    else if (nItem.indexOf(nTr) !== -1 || nTr.indexOf(nItem) !== -1) score += 55;
    if (year && item.href && item.href.indexOf(year) !== -1) score += 10;
    return { item: item, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  if (scored.length && scored[0].score >= 55) return scored[0].item;
  return null;
}

// ── İçerik sayfasını parse et ────────────────────────────────
// HDFilmCehennemi.py load_item() karşılığı
function loadItemPage(url) {
  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var isSeries = html.indexOf('seasons-tab-content') !== -1 &&
                     html.indexOf('seasons-tab-content a') !== -1;

      // Film ise → video kaynaklarını bul
      // Dizi ise → bölüm linklerini bul
      return { html: html, isSeries: isSeries, url: url };
    });
}

// ── Sezon/Bölüm numarası çıkar ──────────────────────────────
// HTMLHelper.extract_season_episode() karşılığı
function extractSeasonEpisode(text) {
  var s = 1, e = 1;
  var sMatch = text.match(/(\d+)\s*\.\s*sezon/i);
  var eMatch = text.match(/(\d+)\s*\.\s*b[oö]l[üu]m/i);
  if (sMatch) s = parseInt(sMatch[1]);
  if (eMatch) e = parseInt(eMatch[1]);
  return { season: s, episode: e };
}

// ── Dizi bölümlerini parse et ────────────────────────────────
function parseEpisodes(html) {
  var episodes = [];
  // div.seasons-tab-content içindeki a linklerini bul
  var tabMatch = html.match(/<div[^>]+class="[^"]*seasons-tab-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!tabMatch) return episodes;

  var block = tabMatch[1];
  var linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = linkRegex.exec(block)) !== null) {
    var href  = fixUrl(m[1]);
    var inner = m[2];
    // h4 içindeki isim
    var nameMatch = inner.match(/<h4[^>]*>([^<]+)<\/h4>/);
    var name  = nameMatch ? decodeHtml(nameMatch[1]).trim() : '';
    if (!name || !href) continue;
    var se = extractSeasonEpisode(name);
    episodes.push({ season: se.season, episode: se.episode, title: name, url: href });
  }
  return episodes;
}

// ── Alternatif video linkleri parse et ──────────────────────
// HDFilmCehennemi.py load_links() → div.alternative-links parse
function parseAlternativeLinks(html) {
  var sources = [];

  // div.alternative-links bloklarını bul
  var altRegex = /<div[^>]+class="[^"]*alternative-links[^"]*"[^>]*data-lang="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
  var altMatch;
  while ((altMatch = altRegex.exec(html)) !== null) {
    var langCode = (altMatch[1] || '').toUpperCase();
    var block    = altMatch[2];

    // button.alternative-link içindeki data-video ID'leri
    var btnRegex = /<button[^>]+class="[^"]*alternative-link[^"]*"[^>]+data-video="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
    var btnMatch;
    while ((btnMatch = btnRegex.exec(block)) !== null) {
      var videoId    = btnMatch[1];
      var btnText    = btnMatch[2].replace(/<[^>]+>/g, '').replace(/\(HDrip Xbet\)/g, '').trim();
      var sourceName = (langCode ? langCode + ' | ' : '') + btnText;
      if (videoId) sources.push({ videoId: videoId, name: sourceName });
    }
  }
  return sources;
}

// ── Altyazıları çıkar ────────────────────────────────────────
// HDFilmCehennemi.py _extract_subtitles() karşılığı
function extractSubtitles(html) {
  var subtitles = [];

  // 1. tracks: [...] formatı (JWPlayer / Plyr)
  var tracksMatch = html.match(/tracks\s*:\s*(\[[^\]]+\])/);
  if (tracksMatch) {
    try {
      var trackData = JSON.parse(tracksMatch[1]);
      trackData.forEach(function(t) {
        var fileUrl = t.file;
        var kind    = t.kind || 'captions';
        if (fileUrl && (kind === 'captions' || kind === 'subtitles')) {
          var label = t.label || t.language || 'TR';
          subtitles.push({ url: fixUrl(fileUrl), name: label.toUpperCase() });
        }
      });
      if (subtitles.length) return subtitles;
    } catch (e) {
      // Regex fallback
      var fileMatches = regexAll(tracksMatch[1], /file\s*:\s*["']([^"']+)["'].*?(?:label|language)\s*:\s*["']([^"']+)["']/);
      fileMatches.forEach(function(m) {
        subtitles.push({ url: fixUrl(m[1].replace(/\\/g, '')), name: m[2].toUpperCase() });
      });
    }
  }

  // 2. PlayerJS (subtitle: "url,name;url,name")
  if (!subtitles.length) {
    var subStr = regexFirst(html, /subtitle\s*:\s*["']([^"']+)["']/);
    if (subStr) {
      subStr.split(';').forEach(function(item) {
        if (item.indexOf(',') !== -1) {
          var parts = item.split(',');
          var u, n;
          if (parts[0].indexOf('http') !== -1) { u = parts[0]; n = parts[1]; }
          else                                  { u = parts[1]; n = parts[0]; }
          if (u && n) subtitles.push({ url: fixUrl(u.trim()), name: n.trim() });
        } else if (item.indexOf('http') !== -1) {
          subtitles.push({ url: fixUrl(item.trim()), name: 'TR' });
        }
      });
    }
  }

  // 3. HTML5 track tag
  if (!subtitles.length) {
    var trackTagRegex = /<track[^>]+kind=["'](captions|subtitles)["'][^>]*>/g;
    var m;
    while ((m = trackTagRegex.exec(html)) !== null) {
      var src   = regexFirst(m[0], /src=["']([^"']+)["']/);
      var label = regexFirst(m[0], /label=["']([^"']+)["']/) ||
                  regexFirst(m[0], /srclang=["']([^"']+)["']/) || 'TR';
      if (src) subtitles.push({ url: fixUrl(src), name: label.toUpperCase() });
    }
  }

  return subtitles;
}

// ── Video URL çıkar ──────────────────────────────────────────
// HDFilmCehennemi.py _extract_video_url() karşılığı
// Not: Packer/StreamDecoder Python kütüphanesi yok,
//      burada eval(function... deobfuscation regex ile yapılıyor
function extractVideoUrl(html) {
  // 1. JSON-LD contentUrl
  var jsonLd = regexFirst(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/);
  if (jsonLd) {
    try {
      var data = JSON.parse(jsonLd.trim());
      if (data.contentUrl && data.contentUrl.startsWith('http')) return data.contentUrl;
    } catch (e) {}
  }

  // 2. Regex contentUrl
  var cu = regexFirst(html, /"contentUrl"\s*:\s*"([^"]+)"/);
  if (cu && cu.startsWith('http')) return cu;

  // 3. file: "..." (JWPlayer / Plyr)
  var fileUrl = regexFirst(html, /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
  if (fileUrl) return fixUrl(fileUrl);

  fileUrl = regexFirst(html, /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/);
  if (fileUrl) return fixUrl(fileUrl);

  // 4. source src
  var srcUrl = regexFirst(html, /<source[^>]+src=["']([^"']+)["']/);
  if (srcUrl && (srcUrl.indexOf('m3u8') !== -1 || srcUrl.indexOf('mp4') !== -1)) {
    return fixUrl(srcUrl);
  }

  // 5. eval(function... packed JS — basit p,a,c,k,e,d unpack
  var evalMatch = html.match(/eval\(function\(p,a,c,k,e,[dr]\)([\s\S]+?)\)\s*;/);
  if (evalMatch) {
    try {
      // Basit unpack: sadece string array ve format string çıkar
      var packed   = evalMatch[0];
      var strArr   = regexFirst(packed, /\|([a-zA-Z0-9+/=|]+)\|/);
      var urlMatch = packed.match(/(https?:[^"'\\]+\.m3u8[^"'\\]*)/);
      if (urlMatch) return urlMatch[1];
    } catch (e) {}
  }

  return null;
}

// ── CehennemPass fallback ────────────────────────────────────
// HDFilmCehennemi.py cehennempass() karşılığı
function fetchCehennemPass(videoId, sourceName, subtitles) {
  var qualities = [
    { key: 'low',  label: 'Düşük Kalite' },
    { key: 'high', label: 'Yüksek Kalite' }
  ];

  var promises = qualities.map(function(q) {
    return fetch('https://cehennempass.pw/process_quality_selection.php', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/x-www-form-urlencoded',
        'Referer':         'https://cehennempass.pw/download/' + videoId,
        'X-Requested-With': 'fetch',
        'authority':       'cehennempass.pw',
        'Cookie':          'PHPSESSID=' + randomCookie()
      },
      body: 'video_id=' + encodeURIComponent(videoId) + '&selected_quality=' + q.key
    })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var dlLink = json.download_link;
      if (!dlLink) return null;
      var label = sourceName ? sourceName + ' | ' + q.label : q.label;
      return {
        name:      'HDFilmCehennemi',
        title:     '⌜ HDFC ⌟ | ' + label,
        url:       fixUrl(dlLink),
        quality:   q.key === 'high' ? '1080p' : '480p',
        headers:   { 'Referer': 'https://cehennempass.pw/download/' + videoId },
        subtitles: subtitles || []
      };
    })
    .catch(function() { return null; });
  });

  return Promise.all(promises).then(function(results) {
    return results.filter(Boolean);
  });
}

// ── Yerel kaynak işle ────────────────────────────────────────
// HDFilmCehennemi.py invoke_local_source() karşılığı
function invokeLocalSource(iframeUrl, sourceName, referer, subtitlesHint) {
  return fetch(iframeUrl, {
    headers: {
      'User-Agent':       HEADERS['User-Agent'],
      'X-Requested-With': 'XMLHttpRequest',
      'Referer':          BASE_URL + '/'
    }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var videoId = iframeUrl.replace(/\/$/, '').split('/').pop();

    if (!html || html.length < 50) {
      return fetchCehennemPass(videoId, sourceName, subtitlesHint || []);
    }

    var subtitles = extractSubtitles(html);
    var videoUrl  = extractVideoUrl(html);

    if (!videoUrl) {
      return fetchCehennemPass(videoId, sourceName, subtitles);
    }

    var isM3u8 = videoUrl.indexOf('m3u8') !== -1;
    return [{
      name:      'HDFilmCehennemi',
      title:     '⌜ HDFC ⌟ | ' + sourceName,
      url:       videoUrl,
      quality:   isM3u8 ? 'Auto' : '1080p',
      headers:   { 'Referer': referer || BASE_URL + '/' },
      subtitles: subtitles
    }];
  })
  .catch(function() { return []; });
}

// ── Video kaynağı al ─────────────────────────────────────────
// HDFilmCehennemi.py _get_video_source() karşılığı
// GET /video/{id}/ → iframe data-src al → invokeLocalSource
function getVideoSource(videoId, sourceName, referer) {
  return fetch(BASE_URL + '/video/' + videoId + '/', {
    headers: {
      'Content-Type':     'application/json',
      'X-Requested-With': 'fetch',
      'Referer':          referer
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    // Response: {"success": true, "data": {"html": "<iframe ... data-src=\"...\" ...>"}}
    var htmlContent = (json.data || {}).html || '';
    var iframeUrl   = regexFirst(htmlContent, /data-src=["']([^"']+)["']/);

    // JSON parse başarısız ise regex fallback (py kodundan)
    if (!iframeUrl) {
      iframeUrl = regexFirst(htmlContent, /data-src=\\\"([^"]+)/);
      if (iframeUrl) iframeUrl = iframeUrl.replace(/\\/g, '');
    }

    if (!iframeUrl) return [];

    // mobi URL kontrolü (py kodundan)
    if (iframeUrl.indexOf('mobi') !== -1) {
      iframeUrl = iframeUrl.split('?')[0];
    }
    // rapidrame query → /rplayer/ID/ formatına çevir (py kodundan)
    else if (iframeUrl.indexOf('rapidrame') !== -1 && iframeUrl.indexOf('?rapidrame_id=') !== -1) {
      var rapId = iframeUrl.split('?rapidrame_id=')[1];
      iframeUrl = BASE_URL + '/rplayer/' + rapId;
    }

    return invokeLocalSource(iframeUrl, sourceName, referer, []);
  })
  .catch(function() { return []; });
}

// ── Film stream'leri ─────────────────────────────────────────
function fetchMovieStreams(pageUrl) {
  return fetch(pageUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var sources = parseAlternativeLinks(html);
      if (!sources.length) return [];

      // Paralel — max 5 eş zamanlı (gather_with_limit karşılığı)
      var limit   = 5;
      var results = [];
      var index   = 0;

      function runNext() {
        if (index >= sources.length) return Promise.resolve();
        var src = sources[index++];
        return getVideoSource(src.videoId, src.name, pageUrl)
          .then(function(streams) {
            streams.forEach(function(s) { results.push(s); });
            return runNext();
          });
      }

      // limit kadar paralel başlat
      var workers = [];
      for (var i = 0; i < Math.min(limit, sources.length); i++) {
        workers.push(runNext());
      }
      return Promise.all(workers).then(function() { return results; });
    })
    .catch(function() { return []; });
}

// ── Dizi bölümü stream'leri ──────────────────────────────────
function fetchEpisodeStreams(epUrl) {
  return fetchMovieStreams(epUrl);  // Aynı mantık — alternatif linkler
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isMovie = (mediaType === 'movie');

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      // Arama: önce İngilizce, bulamazsa Türkçe
      return searchHDFC(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr, info.year);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchHDFC(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr, info.year);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[HDFilmCehennemi] İçerik bulunamadı: ' + info.titleEn);
            return [];
          }
          console.log('[HDFilmCehennemi] Bulundu: ' + best.title + ' → ' + best.href);

          if (isMovie) {
            return fetchMovieStreams(best.href);
          } else {
            // Dizi: load_item → episodes → eşleşen bölümü bul → stream
            return fetch(best.href, { headers: HEADERS })
              .then(function(r) { return r.text(); })
              .then(function(html) {
                var episodes = parseEpisodes(html);
                var sNum     = parseInt(seasonNum)  || 1;
                var eNum     = parseInt(episodeNum) || 1;

                var matched = episodes.filter(function(ep) {
                  return ep.season === sNum && ep.episode === eNum;
                });
                if (!matched.length) {
                  console.log('[HDFilmCehennemi] S' + sNum + 'E' + eNum + ' bulunamadı');
                  return [];
                }
                // İlk eşleşen bölümün stream'lerini al
                return fetchEpisodeStreams(matched[0].url);
              });
          }
        });
    })
    .catch(function(err) {
      console.error('[HDFilmCehennemi] Hata:', err.message || err);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
                    }
