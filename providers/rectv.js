// ============================================================
//  RecTV — Nuvio Provider
//  KekikStream RecTV.py'den dönüştürüldü
//  Film + Dizi destekler
//  API tabanlı — HTML parse yok
// ============================================================

var MAIN_URL = 'https://a.prectv70.lol';
var SW_KEY   = '4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452';

// RecTV APK ile aynı User-Agent
var API_HEADERS = {
  'User-Agent': 'okhttp/4.12.0',
  'Accept':     'application/json'
};

var STREAM_HEADERS = {
  'User-Agent': 'googleusercontent',
  'Referer':    'https://twitter.com/'
};

// Ana sayfa kategorileri (RecTV.py main_page'den)
var CATEGORIES = {
  'movie/created':  'Son Filmler',
  'serie/created':  'Son Diziler',
  'movie/26':       'Türkçe Dublaj',
  'movie/27':       'Türkçe Altyazı',
  'movie/42':       'Şarj Bitiren İçerikler',
  'movie/20':       'Ödüllü Filmler',
  'movie/1':        'Aksiyon',
  'movie/2':        'Dram',
  'movie/3':        'Komedi',
  'movie/4':        'Bilim Kurgu',
  'movie/5':        'Romantik',
  'movie/7':        'Polisiye - Suç',
  'movie/8':        'Korku',
  'movie/9':        'Gerilim',
  'movie/10':       'Fantastik',
  'movie/13':       'Animasyon',
  'movie/14':       'Aile',
  'movie/15':       'Gizem',
  'movie/17':       'Macera',
  'movie/19':       'Belgesel',
  'movie/21':       'Tarih',
  'movie/32':       'Savaş'
};

// ── Yardımcı: Unicode escape decode ─────────────────────────
// RecTV.py'deki _decode_unicode() — API bazen \u00c7 döndürür
function decodeUnicode(text) {
  if (!text) return text;
  try {
    return text.replace(/(?<!\\)u([0-9a-fA-F]{4})/g, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  } catch (e) {
    return text;
  }
}

// ── Yardımcı: API isteği ─────────────────────────────────────
function apiGet(path) {
  var url = MAIN_URL + path;
  return fetch(url, { headers: API_HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('API hata: ' + r.status + ' ' + url);
      return r.json();
    });
}

// ── Yardımcı: URL düzelt ─────────────────────────────────────
function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url.replace(/\\/g, '');
  if (url.startsWith('//')) return 'https:' + url.replace(/\\/g, '');
  return (MAIN_URL + '/' + url).replace(/\\/g, '');
}

// ── Yardımcı: Süre parse (RecTV.py'deki logic) ──────────────
// "1h 59min" → 119 (dakika)
function parseDuration(raw) {
  if (!raw) return null;
  var h = 0, m = 0;
  var hMatch = String(raw).match(/(\d+)h/);
  var mMatch = String(raw).match(/(\d+)min/);
  if (hMatch) h = parseInt(hMatch[1]);
  if (mMatch) m = parseInt(mMatch[1]);
  return (h * 60 + m) || null;
}

// ── TMDB → RecTV arama (TMDB ID ile direkt eşleştir) ────────
// RecTV API'si title bazlı değil, kendi DB'si kullanıyor.
// TMDB ID'sinden title+year alıp RecTV'de search yapıyoruz.
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'movie') ? 'movie' : 'tv';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
    + '?api_key=4ef0d7355d9ffb5151e987764708ce96&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── RecTV arama ──────────────────────────────────────────────
function searchRecTV(query) {
  return apiGet('/api/search/' + encodeURIComponent(query) + '/' + SW_KEY + '/')
    .then(function(data) {
      var kanallar  = data.channels  || [];
      var icerikler = data.posters   || [];
      return kanallar.concat(icerikler);
    });
}

// ── En iyi eşleşmeyi bul ─────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ıi]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBestMatch(results, titleEn, titleTr, year) {
  var nEn   = normalize(titleEn);
  var nTr   = normalize(titleTr);
  var scored = results.map(function(item) {
    var nItem = normalize(item.title || '');
    var score = 0;
    if (nItem === nEn || nItem === nTr) score += 100;
    else if (nItem.indexOf(nEn) !== -1 || nEn.indexOf(nItem) !== -1) score += 60;
    else if (nItem.indexOf(nTr) !== -1 || nTr.indexOf(nItem) !== -1) score += 60;
    if (year && String(item.year) === String(year)) score += 20;
    return { item: item, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  if (scored.length && scored[0].score >= 60) return scored[0].item;
  return null;
}

// ── Dizi bölümlerini getir (RecTV.py load_item → serie) ─────
function fetchSeriesEpisodes(serieId) {
  return apiGet('/api/season/by/serie/' + serieId + '/' + SW_KEY + '/')
    .then(function(seasons) {
      var episodes = [];
      seasons.forEach(function(season) {
        var sTitle  = (season.title || '').trim();
        var sNum    = 1;
        var sMatch  = sTitle.match(/(\d+)/);
        if (sMatch) sNum = parseInt(sMatch[1]);

        // Dublaj/altyazı tag tespiti (RecTV.py logic)
        var tag = '';
        if (/dublaj/i.test(sTitle))  tag = ' (Dublaj)';
        if (/altyaz/i.test(sTitle))  tag = ' (Altyazı)';

        (season.episodes || []).forEach(function(ep) {
          var eTitle = (ep.title || '').trim();
          var eNum   = 1;
          var eMatch = eTitle.match(/(\d+)/);
          if (eMatch) eNum = parseInt(eMatch[1]);

          (ep.sources || []).forEach(function(source) {
            episodes.push({
              season:  sNum,
              episode: eNum,
              // RecTV.py title formatı: "Sezon Başlığı Bölüm Başlığı (Dil) - Kaynak Adı"
              title:   sTitle + ' ' + eTitle + tag + ' - ' + (source.title || ''),
              url:     fixUrl(source.url),
              name:    decodeUnicode(source.title) || 'Video'
            });
          });
        });
      });
      return episodes;
    });
}

// ── Film stream'lerini döndür (RecTV.py load_links → movie) ──
function buildMovieStreams(veri, providerLabel) {
  var results = [];
  var sources = veri.sources || [];

  sources.forEach(function(kaynak) {
    var videoUrl = fixUrl(kaynak.url);
    if (!videoUrl) return;
    if (videoUrl.indexOf('otolinkaff') !== -1) return;  // RecTV.py'den: filtrele

    var sourceName = decodeUnicode(kaynak.title) || 'Video';
    results.push({
      name:    providerLabel,
      title:   '⌜ RECTV ⌟ | ' + sourceName,
      url:     videoUrl,
      quality: 'Auto',
      headers: STREAM_HEADERS
    });
  });

  return results;
}

// ── Dizi stream'lerini döndür ─────────────────────────────────
function buildEpisodeStreams(episodes, seasonNum, episodeNum) {
  var sNum = parseInt(seasonNum) || 1;
  var eNum = parseInt(episodeNum) || 1;
  var results = [];

  // Eşleşen bölümleri bul
  var matched = episodes.filter(function(ep) {
    return ep.season === sNum && ep.episode === eNum;
  });

  // Eşleşme yoksa sezon 1, bölüm 1 dene
  if (!matched.length) {
    matched = episodes.filter(function(ep) {
      return ep.season === 1 && ep.episode === eNum;
    });
  }

  matched.forEach(function(ep) {
    if (!ep.url) return;
    results.push({
      name:    'RecTV',
      title:   '⌜ RECTV ⌟ | ' + ep.title,
      url:     ep.url,
      quality: 'Auto',
      headers: STREAM_HEADERS
    });
  });

  return results;
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isMovie = (mediaType === 'movie');
  var label   = '⌜ RECTV ⌟';

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      // 1. İngilizce başlıkla ara, bulamazsa Türkçe ile dene
      return searchRecTV(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr, info.year);

          // Bulunamadıysa Türkçe başlıkla tekrar ara
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchRecTV(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr, info.year);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[RecTV] İçerik bulunamadı: ' + info.titleEn);
            return [];
          }

          console.log('[RecTV] Bulundu: ' + best.title + ' (id=' + best.id + ')');

          if (isMovie) {
            // Film: sources doğrudan best içinde
            return buildMovieStreams(best, label);
          } else {
            // Dizi: seasons API'sinden bölüm çek
            return fetchSeriesEpisodes(best.id)
              .then(function(episodes) {
                return buildEpisodeStreams(episodes, seasonNum, episodeNum);
              });
          }
        });
    })
    .catch(function(err) {
      console.error('[RecTV] Hata:', err.message || err);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
