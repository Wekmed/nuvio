// ============================================================
//  CizgiMax — Nuvio Provider
//  KekikStream CizgiMax.py'den dönüştürüldü
//  Sadece Dizi/Animasyon destekler (TV only)
//  HTML parse tabanlı — şifreleme yok
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ── Yardımcı: URL düzelt ─────────────────────────────────────
function fixUrl(url) {
  if (!url) return '';
  url = url.trim();
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  if (url.startsWith('/'))    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

// ── Yardımcı: HTML fetch ──────────────────────────────────────
function getHtml(url, extraHeaders) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extraHeaders || {}) })
    .then(function(r) { return r.text(); });
}

// ── Yardımcı: Regex ile ilk eşleşmeyi al ─────────────────────
function reFind(html, pattern) {
  var m = html.match(pattern);
  return m ? m[1] : null;
}

function reFindAll(html, pattern) {
  var results = [];
  var re = new RegExp(pattern.source || pattern, (pattern.flags || '') + (pattern.flags && pattern.flags.indexOf('g') !== -1 ? '' : 'g'));
  var m;
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

// ── TMDB bilgisi al ──────────────────────────────────────────
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

// ── CizgiMax JSON arama (ajaxservice) ───────────────────────
// CizgiMax.py search() → GET /ajaxservice/index.php?qr=...
function searchCizgiMax(query) {
  var url = MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query);
  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var items = (data.data || {}).result || [];
      // Bölüm/Sezon satırlarını filtrele (CizgiMax.py'den)
      return items.filter(function(item) {
        var name = item.s_name || '';
        return !/(\.Bölüm|\.Sezon|-Sezon|-izle)/i.test(name);
      });
    })
    .catch(function() { return []; });
}

// ── Eşleştirme yardımcıları ──────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBestMatch(items, titleEn, titleTr) {
  var nEn = normalize(titleEn);
  var nTr = normalize(titleTr);

  var scored = items.map(function(item) {
    var nItem = normalize(item.s_name || '');
    var score = 0;
    if (nItem === nEn || nItem === nTr)                           score += 100;
    else if (nItem.indexOf(nEn) !== -1 || nEn.indexOf(nItem) !== -1) score += 60;
    else if (nItem.indexOf(nTr) !== -1 || nTr.indexOf(nItem) !== -1) score += 60;
    return { item: item, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });
  if (scored.length && scored[0].score >= 60) return scored[0].item;
  return null;
}

// ── Sezon/Bölüm numarasını metinden çıkar ────────────────────
// CizgiMax.py extract_season_episode() mantığı
// Örn: "2. Sezon 5. Bölüm" → { season: 2, episode: 5 }
//      "Bölüm 3" → { season: 1, episode: 3 }
function extractSeasonEpisode(text) {
  var s = 1, e = 1;
  var sMatch = text.match(/(\d+)\s*\.?\s*[Ss]ezon/i);
  var eMatch = text.match(/(\d+)\s*\.?\s*[Bb]ölüm/i)
            || text.match(/[Bb]ölüm\s*(\d+)/i)
            || text.match(/[Ee]pisode\s*(\d+)/i)
            || text.match(/[Ee]p\.?\s*(\d+)/i);
  if (sMatch) s = parseInt(sMatch[1]);
  if (eMatch) e = parseInt(eMatch[1]);
  return { season: s, episode: e };
}

// ── Dizi detay sayfasından bölüm listesi çek ─────────────────
// CizgiMax.py load_item() → div.asisotope div.ajax_post
function fetchShowEpisodes(showUrl) {
  return getHtml(showUrl)
    .then(function(html) {
      var episodes = [];

      // div.asisotope içindeki her ajax_post bloğunu bul
      // Her blok: season-name span + episode-names span + href
      var blockRe = /<div[^>]*class="[^"]*ajax_post[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/gi;
      var blocks  = reFindAll(html, blockRe);

      // Blok yoksa daha geniş pattern dene
      if (!blocks.length) {
        // Alternatif: tüm bölüm linklerini <a href> + span.episode-names ile al
        var linkRe = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*season-name[^"]*"[^>]*>([^<]*)<\/span>[\s\S]*?<span[^>]*class="[^"]*episode-names[^"]*"[^>]*>([^<]*)<\/span>/gi;
        var lm;
        while ((lm = linkRe.exec(html)) !== null) {
          var href    = fixUrl(lm[1]);
          var sznName = (lm[2] || '').trim();
          var epName  = (lm[3] || '').trim();
          if (!href || !epName) continue;
          var se = extractSeasonEpisode(sznName + ' ' + epName);
          episodes.push({ season: se.season, episode: se.episode, title: epName, url: href });
        }
        return episodes;
      }

      blocks.forEach(function(bm) {
        var block   = bm[0] || bm[1] || '';
        var href    = reFind(block, /href="([^"]+)"/);
        var sznName = reFind(block, /class="[^"]*season-name[^"]*"[^>]*>([^<]+)<\/span>/) || '';
        var epName  = reFind(block, /class="[^"]*episode-names[^"]*"[^>]*>([^<]+)<\/span>/) || '';

        if (!href || !epName) return;
        var se = extractSeasonEpisode(sznName + ' ' + epName);
        episodes.push({
          season:  se.season,
          episode: se.episode,
          title:   epName.trim(),
          url:     fixUrl(href)
        });
      });

      return episodes;
    });
}

// ── Bölüm sayfasından iframe'leri çek ────────────────────────
// CizgiMax.py load_links() → ul.linkler li a[data-frame]
function fetchEpisodeIframes(epUrl) {
  return getHtml(epUrl, { 'Referer': MAIN_URL + '/' })
    .then(function(html) {
      var iframes = [];
      // <li ...><a ... data-frame="URL" ...>
      var re = /data-frame="([^"]+)"/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var src = fixUrl(m[1].trim());
        if (src && iframes.indexOf(src) === -1) iframes.push(src);
      }
      return iframes;
    });
}

// ── Evrensel stream extractor ────────────────────────────────
function extractStream(iframeSrc) {
  var label = '⌜ CİZGİMAX ⌟';

  // Vidmoly
  if (iframeSrc.indexOf('vidmoly') !== -1) {
    return fetchWithReferer(iframeSrc, MAIN_URL + '/')
      .then(function(html) {
        var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        if (!m) return null;
        return { url: m[1], name: label, title: label + ' | VidMoly',
                 quality: 'Auto', type: 'hls', headers: { 'Referer': iframeSrc } };
      }).catch(function() { return null; });
  }

  // Sibnet
  if (iframeSrc.indexOf('sibnet.ru') !== -1) {
    var idM = iframeSrc.match(/videoid=(\d+)/) || iframeSrc.match(/video(\d+)/);
    if (!idM) return Promise.resolve(null);
    var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + idM[1];
    return fetchWithReferer(shellUrl, 'https://video.sibnet.ru/')
      .then(function(html) {
        var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
        if (!m) return null;
        return { url: 'https://video.sibnet.ru' + m[1], name: label, title: label + ' | Sibnet',
                 quality: 'Auto', type: 'direct', headers: { 'Referer': shellUrl } };
      }).catch(function() { return null; });
  }

  // Dailymotion
  if (iframeSrc.indexOf('dailymotion.com') !== -1) {
    var dmId = reFind(iframeSrc, /\/video\/([a-zA-Z0-9]+)/);
    if (!dmId) return Promise.resolve(null);
    return fetch('https://www.dailymotion.com/player/metadata/video/' + dmId)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var quals = d.qualities || {};
        var best  = quals['1080'] || quals['720'] || quals['480'] || quals['auto'] || [];
        var entry = Array.isArray(best) ? best[0] : best;
        if (!entry || !entry.url) return null;
        return { url: entry.url, name: label, title: label + ' | Dailymotion',
                 quality: 'Auto', type: 'hls', headers: {} };
      }).catch(function() { return null; });
  }

  // YouTube embed
  if (iframeSrc.indexOf('youtube.com/embed') !== -1 || iframeSrc.indexOf('youtu.be') !== -1) {
    var ytId = reFind(iframeSrc, /(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!ytId) return Promise.resolve(null);
    return Promise.resolve({
      url:     'https://www.youtube.com/watch?v=' + ytId,
      name:    label,
      title:   label + ' | YouTube',
      quality: 'Auto',
      type:    'direct',
      headers: {}
    });
  }

  // Genel: m3u8 veya mp4 tara
  return fetchWithReferer(iframeSrc, MAIN_URL + '/')
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

function fetchWithReferer(url, referer) {
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': referer }) })
    .then(function(r) { return r.text(); });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') {
    console.log('[CizgiMax] Sadece TV/Dizi desteklenir');
    return Promise.resolve([]);
  }

  console.log('[CizgiMax] TMDB:' + tmdbId + ' S' + seasonNum + 'E' + episodeNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      console.log('[CizgiMax] Aranan: ' + info.titleEn + ' / ' + info.titleTr);

      // İngilizce ile ara, bulamazsa Türkçe ile tekrar dene
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
            console.log('[CizgiMax] İçerik bulunamadı: ' + info.titleEn);
            return [];
          }

          var showUrl = fixUrl(best.s_link);
          console.log('[CizgiMax] Bulundu: ' + best.s_name + ' → ' + showUrl);

          var sNum = parseInt(seasonNum) || 1;
          var eNum = parseInt(episodeNum) || 1;

          return fetchShowEpisodes(showUrl)
            .then(function(episodes) {
              console.log('[CizgiMax] Toplam bölüm: ' + episodes.length);

              // Birebir sezon+bölüm eşleşmesi
              var matched = episodes.filter(function(ep) {
                return ep.season === sNum && ep.episode === eNum;
              });

              // Bulunamazsa sadece bölüm numarasıyla dene (sezon 1 varsayımı)
              if (!matched.length) {
                matched = episodes.filter(function(ep) {
                  return ep.episode === eNum;
                });
              }

              if (!matched.length) {
                console.log('[CizgiMax] Bölüm bulunamadı: S' + sNum + 'E' + eNum);
                return [];
              }

              // Eşleşen ilk bölümün iframe'lerini çek
              var epUrl = matched[0].url;
              console.log('[CizgiMax] Bölüm URL: ' + epUrl);

              return fetchEpisodeIframes(epUrl)
                .then(function(iframes) {
                  console.log('[CizgiMax] iframe sayısı: ' + iframes.length);
                  if (!iframes.length) return [];

                  // Tüm iframe'leri paralel işle
                  return Promise.all(iframes.map(extractStream))
                    .then(function(streams) { return streams.filter(Boolean); });
                });
            });
        });
    })
    .then(function(streams) {
      // Tekrar edenleri temizle
      var seen = {};
      var unique = streams.filter(function(s) {
        if (seen[s.url]) return false;
        seen[s.url] = true;
        return true;
      });
      console.log('[CizgiMax] Streams: ' + unique.length);
      return unique;
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
