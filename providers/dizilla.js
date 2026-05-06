// ============================================================
//  DiziPal Orijinal — Nuvio Provider
// ============================================================

var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

// Domain listesi GitHub'dan çekiliyor (orijinal plugin mantığı)
var DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt';
var BASE_URL = null; // getDomain() ile doldurulacak

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
};

// ── Domain Bulma (GitHub'dan canlı domain listesi) ───────────
function getDomain() {
  if (BASE_URL) return Promise.resolve(BASE_URL);

  return fetch(DOMAIN_LIST_URL, { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('Domain listesi alınamadı');
      return r.text();
    })
    .then(function(text) {
      // "dizipal" içeren satırı bul
      var lines = text.split('\n');
      var domain = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.toLowerCase().indexOf('dizipal') !== -1 && line.startsWith('http')) {
          domain = line.replace(/\/$/, '');
          break;
        }
      }
      if (!domain) throw new Error('DiziPal domaini bulunamadı');
      BASE_URL = domain;
      console.log('[DiziPalOrijinal] Domain: ' + BASE_URL);
      return BASE_URL;
    })
    .catch(function(err) {
      // Fallback domain
      BASE_URL = 'https://dizifilm.org';
      console.warn('[DiziPalOrijinal] Domain fallback: ' + BASE_URL + ' | Hata: ' + err.message);
      return BASE_URL;
    });
}

// ── TMDB Film Bilgisi ────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'tv') ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR';

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr:  d.title  || d.name || '',
        titleEn:  d.original_title || d.original_name || '',
        year:     (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── TMDB ile Dizi/Film Arama (site arama yerine TMDB kullanılır)
function searchTmdbByName(title, mediaType, year) {
  var type = (mediaType === 'tv') ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/search/' + type
    + '?api_key=' + TMDB_API_KEY
    + '&query=' + encodeURIComponent(title)
    + '&language=tr-TR';
  if (year) url += '&year=' + year;

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return (d.results || []).slice(0, 5);
    });
}

// ── Slug Dönüştürücü ─────────────────────────────────────────
function titleToSlug(title) {
  return (title || '').toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── DiziPal'de İçerik Sayfasını Bul ─────────────────────────
// Film: BASE_URL/filmler/SLUG.html
// Dizi: BASE_URL/diziler/SLUG.html
function findContentPage(titleTr, titleEn, mediaType, base) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var section = (mediaType === 'tv') ? 'diziler' : 'filmler';

  var candidates = [];
  if (slugTr) candidates.push(base + '/' + section + '/' + slugTr + '.html');
  if (slugEn && slugEn !== slugTr) candidates.push(base + '/' + section + '/' + slugEn + '.html');

  // Arama sayfası fallback
  candidates.push(base + '/bg/searchcontent?keywords=' + encodeURIComponent(titleTr || titleEn));

  function tryNext(i) {
    if (i >= candidates.length) return Promise.resolve(null);
    var url = candidates[i];
    return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': base + '/' }) })
      .then(function(r) {
        if (!r.ok || r.status === 404) return tryNext(i + 1);
        return r.text().then(function(html) {
          // Geçerli içerik sayfası kontrolü
          if (
            html.indexOf('data-id') === -1 &&
            html.indexOf('bolum') === -1 &&
            html.indexOf('/season/') === -1
          ) return tryNext(i + 1);
          return { url: url, html: html };
        });
      })
      .catch(function() { return tryNext(i + 1); });
  }
  return tryNext(0);
}

// ── Film ID'sini Sayfadan Al ─────────────────────────────────
function parseContentId(html) {
  var patterns = [
    /data-id="(\d+)"/,
    /id="wip"[^>]*data-id="(\d+)"/,
    /"id"\s*:\s*(\d+)/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

// ── Bölüm URL'sini Oluştur (dizi için) ──────────────────────
function buildEpisodeUrl(base, slug, season, episode) {
  // Önce /SLUG/S-sezon-E-bolum.html formatını dene
  return base + '/' + slug + '/' + season + '-sezon-' + episode + '-bolum.html';
}

// ── Bölüm Sayfasından ID al ─────────────────────────────────
function fetchEpisodePage(base, titleTr, titleEn, season, episode) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var candidates = [];

  if (slugTr) candidates.push(buildEpisodeUrl(base, slugTr, season, episode));
  if (slugEn && slugEn !== slugTr) candidates.push(buildEpisodeUrl(base, slugEn, season, episode));

  function tryNext(i) {
    if (i >= candidates.length) return Promise.resolve(null);
    var url = candidates[i];
    return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': base + '/' }) })
      .then(function(r) {
        if (!r.ok || r.status === 404) return tryNext(i + 1);
        return r.text().then(function(html) {
          var id = parseContentId(html);
          if (!id) return tryNext(i + 1);
          return { id: id, html: html, url: url };
        });
      })
      .catch(function() { return tryNext(i + 1); });
  }
  return tryNext(0);
}

// ── Alternatifleri Getir ─────────────────────────────────────
// DiziPal'ın /bg/getserielistbychannel veya /multiplayer mantığı
function fetchMultiplayer(contentId, season, episode, base, referer) {
  // Önce multiplayer endpoint'ini dene
  var mpUrl = base + '/multiplayer?id=' + contentId;
  if (season) mpUrl += '&season=' + season + '&episode=' + episode;

  return fetch(mpUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer || base + '/' })
  })
  .then(function(r) {
    if (!r.ok) return null;
    return r.text();
  })
  .catch(function() { return null; });
}

// DiziPal embed/playback endpoint
function fetchPlayback(contentId, base, referer) {
  var url = base + '/embed/playback?id=' + contentId;
  return fetch(url, {
    headers: Object.assign({}, HEADERS, {
      'Referer': referer || base + '/',
      'X-Requested-With': 'XMLHttpRequest'
    })
  })
  .then(function(r) {
    if (!r.ok) return null;
    return r.text();
  })
  .catch(function() { return null; });
}

// ── AES-CBC Şifre Çözme (PBKDF2 tabanlı) ─────────────────────
// DiziPalOrijinal'in decryptManuelPBKDF2 fonksiyonu
function decryptPBKDF2AES(encryptedBase64, password) {
  try {
    // Base64 decode
    var raw = atob(encryptedBase64);
    var rawBytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) rawBytes[i] = raw.charCodeAt(i);

    // OpenSSL formatı: "Salted__" + 8 byte salt + ciphertext
    var saltHex = '';
    var ivHex   = '';
    var keyHex  = '';
    var cipherBytes;

    if (raw.startsWith('Salted__')) {
      var salt = rawBytes.slice(8, 16);
      cipherBytes = rawBytes.slice(16);
      // EVP_BytesToKey ile key+iv türet (MD5 tabanlı, PBKDF2 değil)
      // Bu kısım Web Crypto API gerektiriyor; tarayıcı ortamında çalışır
      return deriveKeyIvMD5(password, salt, 32, 16).then(function(keyIv) {
        return aesDecryptCBC(cipherBytes, keyIv.key, keyIv.iv);
      });
    }

    // Manuel hex format: key:iv:encrypted (bazı DiziPal versiyonları)
    var parts = encryptedBase64.split(':');
    if (parts.length >= 3) {
      keyHex  = parts[0];
      ivHex   = parts[1];
      var enc = parts[2];
      cipherBytes = hexToBytes(enc);
      var keyBytes = hexToBytes(keyHex);
      var ivBytes  = hexToBytes(ivHex);
      return aesDecryptCBCSync(cipherBytes, keyBytes, ivBytes);
    }

    return Promise.resolve(null);
  } catch(e) {
    console.error('[DiziPalOrijinal] Şifre çözme hatası: ' + e.message);
    return Promise.resolve(null);
  }
}

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function deriveKeyIvMD5(password, salt, keyLen, ivLen) {
  // OpenSSL EVP_BytesToKey (MD5 türetme)
  var passBytes = new TextEncoder().encode(password);
  var data = new Uint8Array(passBytes.length + salt.length);
  data.set(passBytes);
  data.set(salt, passBytes.length);

  return crypto.subtle.digest('MD5', data).then(function(d1Hash) {
    // MD5 kullanılamıyorsa SHA-256 fallback
    return crypto.subtle.digest('SHA-256', data);
  }).then(function(hash) {
    var bytes = new Uint8Array(hash);
    var key = bytes.slice(0, keyLen);
    var iv  = bytes.slice(keyLen, keyLen + ivLen);
    return { key: key, iv: iv };
  }).catch(function() {
    // Crypto API yoksa basit fallback
    return { key: new Uint8Array(32), iv: new Uint8Array(16) };
  });
}

function aesDecryptCBC(cipherBytes, keyBytes, ivBytes) {
  return crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']
  ).then(function(key) {
    return crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBytes }, key, cipherBytes
    );
  }).then(function(buf) {
    return new TextDecoder().decode(buf);
  }).catch(function(e) {
    console.error('[DiziPalOrijinal] AES-CBC hata: ' + e.message);
    return null;
  });
}

function aesDecryptCBCSync(cipherBytes, keyBytes, ivBytes) {
  return aesDecryptCBC(cipherBytes, keyBytes, ivBytes);
}

// ── Video URL'lerini HTML'den Çıkar ─────────────────────────
function extractVideoUrls(html, pageUrl) {
  var urls = [];

  // M3U8 linkleri
  var m3u8Pattern = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
  var m;
  while ((m = m3u8Pattern.exec(html)) !== null) {
    urls.push({ url: m[1], type: 'hls' });
  }

  // MP4 linkleri
  var mp4Pattern = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi;
  while ((m = mp4Pattern.exec(html)) !== null) {
    urls.push({ url: m[1], type: 'direct' });
  }

  // file: veya src: pattern (JWPlayer/DPlayer)
  var filePattern = /(?:file|src)\s*:\s*['"]?(https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4)[^\s"'<>]*)/gi;
  while ((m = filePattern.exec(html)) !== null) {
    urls.push({ url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct' });
  }

  // Tekrar kaldır
  var seen = {};
  return urls.filter(function(v) {
    if (seen[v.url]) return false;
    seen[v.url] = true;
    return true;
  });
}

// ── RapidVid Extractor ───────────────────────────────────────
// https://rapidvid.net/?video_id=XXX veya /api/video/XXX
function extractRapidVid(embedUrl, base) {
  console.log('[DiziPalOrijinal] RapidVid: ' + embedUrl);
  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // "videos":[...] JSON pattern (orijinal regex: "videos":(\[[^\]]*\]))
    var m = html.match(/"videos"\s*:\s*(\[[^\]]*\])/);
    if (m) {
      try {
        var videos = JSON.parse(m[1]);
        return videos.map(function(v) {
          return {
            url:  v.file || v.src || v.url || '',
            type: (v.file || '').indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
            label: v.label || 'HD'
          };
        }).filter(function(v) { return v.url; });
      } catch(e) {}
    }

    // Alternatif: /api/videos/
    var apiMatch = html.match(/\/api\/videos\/([^"'\/\s]+)/);
    if (apiMatch) {
      var apiUrl = embedUrl.split('/').slice(0, 3).join('/') + '/api/videos/' + apiMatch[1];
      return fetch(apiUrl, { headers: Object.assign({}, HEADERS, { 'Referer': embedUrl }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var srcs = data.sources || data.videos || data || [];
          return srcs.map(function(s) {
            return {
              url:  s.file || s.src || s.url || '',
              type: (s.file || s.src || '').indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
              label: s.label || 'HD'
            };
          }).filter(function(v) { return v.url; });
        });
    }

    return extractVideoUrls(html, embedUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] RapidVid hatası: ' + e.message);
    return [];
  });
}

// ── TurkeyPlayer Extractor ───────────────────────────────────
// https://watch.turkeyplayer.com
function extractTurkeyPlayer(embedUrl, base) {
  console.log('[DiziPalOrijinal] TurkeyPlayer: ' + embedUrl);
  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // TurkeyPlayer gizli div'de şifreli kaynak tutar
    // div[data-rm-k] → şifreli veri
    var keyMatch  = html.match(/div\.key[^>]*>(.*?)<\/div>/i)
                 || html.match(/"key_parts"\s*:\s*"([^"]+)"/);
    var dataMatch = html.match(/data-rm-k="([^"]+)"/);

    if (keyMatch && dataMatch) {
      return decryptPBKDF2AES(dataMatch[1], keyMatch[1])
        .then(function(decrypted) {
          if (!decrypted) return [];
          var urls = extractVideoUrls(decrypted, embedUrl);
          return urls.map(function(v) { return Object.assign(v, { label: 'HD' }); });
        });
    }

    // Direkt M3U8 arama
    return extractVideoUrls(html, embedUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] TurkeyPlayer hatası: ' + e.message);
    return [];
  });
}

// ── Dplayer82 / SNDplayer / ORGDplayer / FourDplayer Extractor
function extractDplayer(embedUrl, base) {
  console.log('[DiziPalOrijinal] Dplayer: ' + embedUrl);
  var host = embedUrl.split('/').slice(0, 3).join('/');

  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // /source2.php?v=XXX endpoint
    var sourceMatch = html.match(/\/source2\.php\?v=([^"'&\s]+)/);
    if (sourceMatch) {
      var sourceUrl = host + '/source2.php?v=' + sourceMatch[1];
      return fetch(sourceUrl, {
        headers: Object.assign({}, HEADERS, { 'Referer': embedUrl })
      })
      .then(function(r) { return r.text(); })
      .then(function(src) {
        return extractVideoUrls(src, sourceUrl).map(function(v) {
          return Object.assign(v, { label: 'HD' });
        });
      });
    }

    // action=get_video POST
    var idMatch = html.match(/\/api\/video\/([^"'\/\s]+)/)
               || html.match(/\?video_id=([^"'&\s]+)/);
    if (idMatch) {
      var apiUrl = host + '/api/video/' + idMatch[1];
      return fetch(apiUrl, {
        headers: Object.assign({}, HEADERS, {
          'Referer': embedUrl,
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var url = data.source || data.src || data.url || data.video_location || data.videoLocation || '';
        if (!url) return [];
        return [{ url: url, type: url.indexOf('.m3u8') !== -1 ? 'hls' : 'direct', label: 'HD' }];
      });
    }

    return extractVideoUrls(html, embedUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] Dplayer hatası: ' + e.message);
    return [];
  });
}

// ── HotStream Extractor ──────────────────────────────────────
// https://hotstream.club — action=get_video
function extractHotStream(embedUrl, base) {
  console.log('[DiziPalOrijinal] HotStream: ' + embedUrl);
  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // video_location pattern
    var locMatch = html.match(/video_location['":\s]+([^"',}\s]+)/);
    if (locMatch) {
      var loc = locMatch[1];
      return [{ url: loc, type: loc.indexOf('.m3u8') !== -1 ? 'hls' : 'direct', label: 'HD' }];
    }

    // action=get_video POST
    var idMatch = html.match(/action=get_video&[^"'<\s]*/);
    if (idMatch) {
      var hotUrl = 'https://hotstream.club/' + idMatch[0];
      return fetch(hotUrl, {
        method: 'POST',
        headers: Object.assign({}, HEADERS, {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': embedUrl
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var loc = data.video_location || data.source || '';
        if (!loc) return [];
        return [{ url: loc, type: loc.indexOf('.m3u8') !== -1 ? 'hls' : 'direct', label: 'HD' }];
      });
    }

    return extractVideoUrls(html, embedUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] HotStream hatası: ' + e.message);
    return [];
  });
}

// ── VidMoly Extractor ────────────────────────────────────────
function extractVidMoly(embedUrl, base) {
  console.log('[DiziPalOrijinal] VidMoly: ' + embedUrl);
  var fullUrl = embedUrl.startsWith('//') ? 'https:' + embedUrl : embedUrl;
  fullUrl = fullUrl.replace('vidmoly.to', 'vidmoly.net');

  return fetch(fullUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    if (m) return [{ url: m[1], type: 'hls', label: 'HD' }];
    return extractVideoUrls(html, fullUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] VidMoly hatası: ' + e.message);
    return [];
  });
}

// ── Filemoon Extractor ───────────────────────────────────────
// https://filemoon.sx/e/XXX
function extractFilemoon(embedUrl, base) {
  console.log('[DiziPalOrijinal] Filemoon: ' + embedUrl);
  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // Filemoon /embed/playback endpoint
    var idMatch = embedUrl.match(/\/e\/([^\/\?]+)/);
    if (idMatch) {
      var playbackUrl = 'https://filemoon.sx/embed/playback?id=' + idMatch[1];
      return fetch(playbackUrl, {
        headers: Object.assign({}, HEADERS, {
          'Referer': embedUrl,
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // PlaybackResponse(sources=...)
        var sources = data.sources || data.data || [];
        return sources.map(function(s) {
          return { url: s.file || s.src || s.url || '', type: 'hls', label: s.label || 'HD' };
        }).filter(function(v) { return v.url; });
      })
      .catch(function() {
        return extractVideoUrls(html, embedUrl).map(function(v) {
          return Object.assign(v, { label: 'HD' });
        });
      });
    }

    return extractVideoUrls(html, embedUrl).map(function(v) {
      return Object.assign(v, { label: 'HD' });
    });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] Filemoon hatası: ' + e.message);
    return [];
  });
}

// ── Odnoklassniki (ok.ru) Extractor ─────────────────────────
function extractOdnoklassniki(embedUrl, base) {
  console.log('[DiziPalOrijinal] Odnoklassniki: ' + embedUrl);
  var videoId = embedUrl.replace(/.*videoembed\/|.*video\//, '').split(/[?#]/)[0];
  var apiUrl = 'https://ok.ru/dk?cmd=videoPlayerMetadata&mid=' + videoId;

  return fetch(apiUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': embedUrl })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var videos = data.videos || [];
    return videos.map(function(v) {
      return { url: v.url || '', type: v.url.indexOf('.m3u8') !== -1 ? 'hls' : 'direct', label: v.name || 'HD' };
    }).filter(function(v) { return v.url; });
  })
  .catch(function(e) {
    console.error('[DiziPalOrijinal] Odnoklassniki hatası: ' + e.message);
    return [];
  });
}

// ── Embed URL Tipini Belirle ve İşle ─────────────────────────
function processEmbed(embedUrl, dilLabel, title, base) {
  if (!embedUrl) return Promise.resolve([]);

  var url = embedUrl.startsWith('//') ? 'https:' + embedUrl : embedUrl;

  var extractorPromise;

  if (url.indexOf('rapidvid.net') !== -1) {
    extractorPromise = extractRapidVid(url, base);
  } else if (url.indexOf('turkeyplayer') !== -1 || url.indexOf('watch.turkeyplayer') !== -1) {
    extractorPromise = extractTurkeyPlayer(url, base);
  } else if (
    url.indexOf('dplayer82') !== -1 ||
    url.indexOf('sn.dplayer') !== -1 ||
    url.indexOf('org.dplayer') !== -1 ||
    url.indexOf('four.dplayer') !== -1
  ) {
    extractorPromise = extractDplayer(url, base);
  } else if (url.indexOf('hotstream') !== -1) {
    extractorPromise = extractHotStream(url, base);
  } else if (url.indexOf('vidmoly') !== -1) {
    extractorPromise = extractVidMoly(url, base);
  } else if (url.indexOf('filemoon') !== -1) {
    extractorPromise = extractFilemoon(url, base);
  } else if (url.indexOf('odnoklassniki') !== -1 || url.indexOf('ok.ru') !== -1) {
    extractorPromise = extractOdnoklassniki(url, base);
  } else {
    // Genel extractor
    extractorPromise = fetch(url, {
      headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
    })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      return extractVideoUrls(html, url).map(function(v) {
        return Object.assign(v, { label: 'HD' });
      });
    })
    .catch(function() { return []; });
  }

  return extractorPromise.then(function(videos) {
    return videos.map(function(v) {
      return {
        name:    title,
        title:   '⌜ DiziPalOrijinal ⌟ | ' + getProviderName(url) + ' | ' + dilLabel,
        url:     v.url,
        quality: v.label || 'HD',
        type:    v.type || 'hls',
        headers: { 'Referer': url, 'User-Agent': HEADERS['User-Agent'] }
      };
    });
  });
}

function getProviderName(url) {
  if (url.indexOf('rapidvid') !== -1) return 'RapidVid';
  if (url.indexOf('turkeyplayer') !== -1) return 'TurkeyPlayer';
  if (url.indexOf('dplayer82') !== -1) return 'Dplayer82';
  if (url.indexOf('sn.dplayer') !== -1) return 'SNDplayer';
  if (url.indexOf('org.dplayer') !== -1) return 'ORGDplayer';
  if (url.indexOf('four.dplayer') !== -1) return 'FourDplayer';
  if (url.indexOf('hotstream') !== -1) return 'HotStream';
  if (url.indexOf('vidmoly') !== -1) return 'VidMoly';
  if (url.indexOf('filemoon') !== -1) return 'Filemoon';
  if (url.indexOf('odnoklassniki') !== -1 || url.indexOf('ok.ru') !== -1) return 'OK.ru';
  if (url.indexOf('gdplayer') !== -1) return 'GDPlayer';
  if (url.indexOf('drive.google') !== -1) return 'GDrive';
  return 'Video';
}

// ── Sayfadaki Tüm Embed Linklerini Çek ──────────────────────
function extractEmbedLinks(html, pageUrl, base) {
  var embeds = [];
  var seen = {};

  // iframe src
  var iframePattern = /<iframe[^>]+src=["']([^"']+)["']/gi;
  var m;
  while ((m = iframePattern.exec(html)) !== null) {
    var src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    if (!seen[src] && src.indexOf(base) === -1) {
      seen[src] = true;
      embeds.push({ url: src, dil: guessDil(src, html) });
    }
  }

  // data-src attribute
  var dataSrcPattern = /data-src=["']([^"']+)["']/gi;
  while ((m = dataSrcPattern.exec(html)) !== null) {
    var src2 = m[1];
    if (src2.startsWith('//')) src2 = 'https:' + src2;
    if (!seen[src2] && isEmbedUrl(src2)) {
      seen[src2] = true;
      embeds.push({ url: src2, dil: guessDil(src2, html) });
    }
  }

  // /multiplayer link pattern
  var mpPattern = /href=["']([^"']*\/multiplayer[^"']*)["']/gi;
  while ((m = mpPattern.exec(html)) !== null) {
    var mpUrl = m[1].startsWith('http') ? m[1] : base + m[1];
    if (!seen[mpUrl]) {
      seen[mpUrl] = true;
      // Bu bir yönlendirme linki, fetch et
      embeds.push({ url: mpUrl, dil: guessDil(mpUrl, html), isMultiplayer: true });
    }
  }

  return embeds;
}

function isEmbedUrl(url) {
  var providers = ['rapidvid', 'turkeyplayer', 'dplayer82', 'hotstream', 'vidmoly',
                   'filemoon', 'odnoklassniki', 'ok.ru', 'gdplayer', 'pichive',
                   'vidmoxy', 'playru', 'drive.google', 'sibnet'];
  return providers.some(function(p) { return url.indexOf(p) !== -1; });
}

function guessDil(url, context) {
  if (url.indexOf('dublaj') !== -1 || url.indexOf('tr-dublaj') !== -1) return '🇹🇷 TR Dublaj';
  if (url.indexOf('altyazi') !== -1 || url.indexOf('sub') !== -1) return '🌐 TR Altyazı';
  return '🇹🇷 TR';
}

// ── Multiplayer Sayfasından Embed'leri Al ────────────────────
function resolveMultiplayerEmbeds(mpUrl, base) {
  return fetch(mpUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': base + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    return extractEmbedLinks(html, mpUrl, base);
  })
  .catch(function() { return []; });
}

// ── Ana Fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log('[DiziPalOrijinal] === Başlıyor | TMDB: ' + tmdbId + ' | Tür: ' + mediaType
    + (mediaType === 'tv' ? ' | S' + seasonNum + 'E' + episodeNum : '') + ' ===');

  return getDomain().then(function(base) {
    return fetchTmdbInfo(tmdbId, mediaType).then(function(info) {
      if (!info.titleTr && !info.titleEn) {
        console.log('[DiziPalOrijinal] TMDB başlık yok');
        return [];
      }

      var movieTitle = info.titleTr || info.titleEn;
      console.log('[DiziPalOrijinal] İçerik: ' + movieTitle + ' (' + info.year + ')');

      // Dizi için bölüm sayfasına git, film için içerik sayfasına
      var pagePromise;
      if (mediaType === 'tv') {
        pagePromise = fetchEpisodePage(base, info.titleTr, info.titleEn, seasonNum, episodeNum);
      } else {
        pagePromise = findContentPage(info.titleTr, info.titleEn, mediaType, base);
      }

      return pagePromise.then(function(result) {
        if (!result) {
          console.log('[DiziPalOrijinal] İçerik sayfası bulunamadı');
          return [];
        }

        var html = result.html;
        var pageUrl = result.url;
        console.log('[DiziPalOrijinal] Sayfa: ' + pageUrl);

        // Embed linklerini çıkar
        var embeds = extractEmbedLinks(html, pageUrl, base);

        // Multiplayer linklerini çöz
        var directEmbeds = embeds.filter(function(e) { return !e.isMultiplayer; });
        var mpEmbeds     = embeds.filter(function(e) { return e.isMultiplayer; });

        var mpResolvePromises = mpEmbeds.map(function(e) {
          return resolveMultiplayerEmbeds(e.url, base);
        });

        return Promise.all(mpResolvePromises).then(function(resolved) {
          resolved.forEach(function(list) {
            list.forEach(function(e) { directEmbeds.push(e); });
          });

          if (directEmbeds.length === 0) {
            console.log('[DiziPalOrijinal] Embed link bulunamadı');
            return [];
          }

          console.log('[DiziPalOrijinal] İşlenecek embed sayısı: ' + directEmbeds.length);

          var streamPromises = directEmbeds.map(function(embed) {
            return processEmbed(embed.url, embed.dil || '🇹🇷 TR', movieTitle, base)
              .catch(function() { return []; });
          });

          return Promise.all(streamPromises).then(function(results) {
            var allStreams = [];
            results.forEach(function(arr) {
              arr.forEach(function(s) {
                if (s && s.url) allStreams.push(s);
              });
            });
            console.log('[DiziPalOrijinal] Toplam stream: ' + allStreams.length);
            return allStreams;
          });
        });
      });
    });
  })
  .catch(function(err) {
    console.error('[DiziPalOrijinal] Genel hata: ' + err.message);
    return [];
  });
}

// ── Export ───────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
