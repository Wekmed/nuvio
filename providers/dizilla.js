// ============================================================
//  Dizilla — Nuvio Provider
//  KekikStream Dizilla.py'den dönüştürüldü
//  Sadece Dizi destekler (TV only)
//  AES/CBC şifreli API — HTML + Next.js
// ============================================================

var MAIN_URL    = 'https://dizilla.to';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

// AES şifreleme parametreleri (Dizilla.py'den)
var AES_KEY = '9bYMCNQiWsXIYFWYAu7EkdsSbmGBTyUI'; // 32 bytes
var AES_IV  = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];   // 16 sıfır byte

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': MAIN_URL + '/'
};

// ── AES/CBC Şifre Çözme ───────────────────────────────────────
// Dizilla.py decrypt_response() fonksiyonunun JS karşılığı
// Tarayıcı Web Crypto API kullanır

function decryptResponse(base64Text) {
  // Base64 → Uint8Array
  var binary     = atob(base64Text);
  var encBytes   = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) encBytes[i] = binary.charCodeAt(i);

  // Key ve IV byte dizisi
  var keyBytes = new TextEncoder().encode(AES_KEY);         // 32 bytes
  var ivBytes  = new Uint8Array(AES_IV);                    // 16 sıfır

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
    .then(function(cryptoKey) {
      return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, cryptoKey, encBytes);
    })
    .then(function(decryptedBuffer) {
      var decryptedBytes = new Uint8Array(decryptedBuffer);
      // PKCS7 padding kaldır
      var padLen = decryptedBytes[decryptedBytes.length - 1];
      var unpaddedBytes = decryptedBytes.slice(0, decryptedBytes.length - padLen);
      var text = new TextDecoder('utf-8').decode(unpaddedBytes);
      return JSON.parse(text);
    });
}

// ── Yardımcı: URL düzelt ─────────────────────────────────────
function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  if (url.startsWith('/'))    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

// ── Yardımcı: AMP CDN poster URL düzelt ─────────────────────
// Dizilla.py fix_poster_url() fonksiyonunun karşılığı
function fixPosterUrl(url) {
  if (!url) return url;
  if (url.indexOf('cdn.ampproject.org') !== -1) {
    var m = url.match(/cdn\.ampproject\.org\/[^/]+\/s\/(.+)$/);
    if (m) return 'https://' + m[1];
  }
  return url;
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

// ── Dizilla Arama (POST + AES decrypt) ─────────────────────
function searchDizilla(query) {
  var url = MAIN_URL + '/api/bg/searchcontent?searchterm=' + encodeURIComponent(query);
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json' })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var encrypted = data.response;
      if (!encrypted) return [];
      return decryptResponse(encrypted);
    })
    .then(function(decrypted) {
      return decrypted.result || [];
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

function findBestMatch(results, titleEn, titleTr) {
  var nEn = normalize(titleEn);
  var nTr = normalize(titleTr);

  var scored = results.map(function(item) {
    // API search sonuçlarında alan adları: object_name, used_slug, object_poster_url
    var nItem = normalize(item.object_name || item.original_title || '');
    var score = 0;
    if (nItem === nEn || nItem === nTr) score += 100;
    else if (nItem.indexOf(nEn) !== -1 || nEn.indexOf(nItem) !== -1) score += 60;
    else if (nItem.indexOf(nTr) !== -1 || nTr.indexOf(nItem) !== -1) score += 60;
    return { item: item, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });
  if (scored.length && scored[0].score >= 60) return scored[0].item;
  return null;
}

// ── Dizi detay sayfasını yükle (load_item mantığı) ──────────
// slug → show URL → Next.js secureData → AES decrypt → bölüm listesi
function fetchShowData(slug) {
  var showUrl = MAIN_URL + '/' + slug;
  return fetch(showUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // Next.js __NEXT_DATA__ script bloğunu bul
      var m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (!m) throw new Error('__NEXT_DATA__ bulunamadı');
      return JSON.parse(m[1]);
    })
    .then(function(nextData) {
      var secureData = (nextData.props || {}).pageProps && nextData.props.pageProps.secureData;
      if (!secureData) throw new Error('secureData bulunamadı');
      return decryptResponse(secureData);
    });
}

// ── Bölüm URL'sini bul (load_item → episodes) ───────────────
function findEpisodeSlug(showDecrypted, seasonNum, episodeNum) {
  var sNo = parseInt(seasonNum) || 1;
  var eNo = parseInt(episodeNum) || 1;

  var relatedResults = showDecrypted.RelatedResults || {};
  var seasons        = (relatedResults.getSerieSeasonAndEpisodes || {}).result || [];

  for (var i = 0; i < seasons.length; i++) {
    var season = seasons[i];
    if (parseInt(season.season_no) !== sNo) continue;
    var episodes = season.episodes || [];
    for (var j = 0; j < episodes.length; j++) {
      var ep = episodes[j];
      if (parseInt(ep.episode_no) === eNo) {
        return ep.used_slug || null;
      }
    }
  }
  return null;
}

// ── Bölüm stream linklerini çek (load_links mantığı) ────────
function fetchEpisodeStreams(episodeSlug) {
  var epUrl = MAIN_URL + '/' + episodeSlug;

  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (!m) return [];
      return JSON.parse(m[1]);
    })
    .then(function(nextData) {
      var secureData = (nextData.props || {}).pageProps && nextData.props.pageProps.secureData;
      if (!secureData) return null;
      return decryptResponse(secureData);
    })
    .then(function(decrypted) {
      if (!decrypted) return [];

      var related = decrypted.RelatedResults || {};
      var results = (related.getEpisodeSources || {}).result
                 || (related.getEpisodeSourcesById || {}).result
                 || [];

      if (!results.length) return [];

      // İlk source'dan iframe al (Dizilla.py load_links mantığı)
      var firstResult    = results[0];
      var sourceContent  = String(firstResult.source_content || '');
      var cleanedSource  = sourceContent.replace(/"/g, '').replace(/\\/g, '');

      // iframe src bul
      var iframeMatch = cleanedSource.match(/<iframe[^>]+src=[\s\S]*?(https?:\/\/[^\s"'<>]+)/i)
                     || cleanedSource.match(/src=(https?:\/\/[^\s"'<>]+)/i);

      if (!iframeMatch) return [];

      var iframeSrc  = iframeMatch[1];
      var langName   = firstResult.language_name || 'Bilinmeyen';

      // Tüm source'lardan iframe topla (paralel)
      var iframePromises = results.map(function(res) {
        var sc      = String(res.source_content || '').replace(/"/g, '').replace(/\\/g, '');
        var im      = sc.match(/<iframe[^>]+src=[\s\S]*?(https?:\/\/[^\s"'<>]+)/i)
                   || sc.match(/src=(https?:\/\/[^\s"'<>]+)/i);
        var src     = im ? im[1] : null;
        var lang    = res.language_name || 'Bilinmeyen';
        if (!src) return Promise.resolve(null);
        return extractStream(fixUrl(src), lang, MAIN_URL + '/');
      });

      return Promise.all(iframePromises)
        .then(function(streams) { return streams.filter(Boolean); });
    })
    .catch(function(e) {
      console.error('[Dizilla] fetchEpisodeStreams hata:', e.message || e);
      return [];
    });
}

// ── Evrensel stream extractor ────────────────────────────────
// iframe URL'sine göre hangi extractor kullanılacağına karar verir
function extractStream(iframeSrc, langLabel, referer) {
  var label = '⌜ DİZİLLA ⌟ | ' + langLabel;

  // Vidmoly
  if (iframeSrc.indexOf('vidmoly') !== -1) {
    return fetchWithReferer(iframeSrc, referer)
      .then(function(html) {
        var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        if (!m) return null;
        return {
          url:     m[1],
          name:    label,
          title:   '⌜ DİZİLLA ⌟ | VidMoly',
          quality: 'Auto',
          type:    'hls',
          headers: { 'Referer': iframeSrc }
        };
      })
      .catch(function() { return null; });
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
        return {
          url:     'https://video.sibnet.ru' + m[1],
          name:    label,
          title:   '⌜ DİZİLLA ⌟ | Sibnet',
          quality: 'Auto',
          type:    'direct',
          headers: { 'Referer': shellUrl }
        };
      })
      .catch(function() { return null; });
  }

  // SendVid
  if (iframeSrc.indexOf('sendvid.com') !== -1) {
    return fetchWithReferer(iframeSrc, referer)
      .then(function(html) {
        var m = html.match(/source src="([^"]+\.mp4[^"]*)"/i)
             || html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
        if (!m) return null;
        return {
          url:     m[1],
          name:    label,
          title:   '⌜ DİZİLLA ⌟ | SendVid',
          quality: 'Auto',
          type:    'direct',
          headers: { 'Referer': iframeSrc }
        };
      })
      .catch(function() { return null; });
  }

  // Genel m3u8 / mp4 deneme (bilinmeyen embed)
  return fetchWithReferer(iframeSrc, referer)
    .then(function(html) {
      var m3u8 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m3u8) {
        return {
          url:     m3u8[1],
          name:    label,
          title:   '⌜ DİZİLLA ⌟',
          quality: 'Auto',
          type:    'hls',
          headers: { 'Referer': iframeSrc }
        };
      }
      var mp4 = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
      if (mp4) {
        return {
          url:     mp4[1],
          name:    label,
          title:   '⌜ DİZİLLA ⌟',
          quality: 'Auto',
          type:    'direct',
          headers: { 'Referer': iframeSrc }
        };
      }
      return null;
    })
    .catch(function() { return null; });
}

function fetchWithReferer(url, referer) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer || MAIN_URL + '/' })
  }).then(function(r) { return r.text(); });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') {
    console.log('[Dizilla] Sadece TV/Dizi desteklenir');
    return Promise.resolve([]);
  }

  console.log('[Dizilla] TMDB:' + tmdbId + ' S' + seasonNum + 'E' + episodeNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      console.log('[Dizilla] Aranan: ' + info.titleEn + ' / ' + info.titleTr);

      // İngilizce başlıkla ara, bulamazsa Türkçe ile dene
      return searchDizilla(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr);

          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchDizilla(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[Dizilla] İçerik bulunamadı: ' + info.titleEn);
            return [];
          }

          var slug = best.used_slug || '';
          console.log('[Dizilla] Bulundu: ' + (best.object_name || best.original_title) + ' → /' + slug);

          // Dizi detay sayfasından bölüm slug'ı bul
          return fetchShowData(slug)
            .then(function(showDecrypted) {
              var episodeSlug = findEpisodeSlug(showDecrypted, seasonNum, episodeNum);
              if (!episodeSlug) {
                console.log('[Dizilla] Bölüm bulunamadı: S' + seasonNum + 'E' + episodeNum);
                return [];
              }

              console.log('[Dizilla] Bölüm slug: ' + episodeSlug);
              return fetchEpisodeStreams(episodeSlug);
            });
        });
    })
    .then(function(streams) {
      console.log('[Dizilla] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.error('[Dizilla] Hata:', err.message || err);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
