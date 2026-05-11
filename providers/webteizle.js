// ============================================================
//  WebteIzle — Nuvio Provider
// ============================================================

var BASE_URL     = 'https://webteizle3.xyz';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

var JSON_HEADERS = {
  'User-Agent': HEADERS['User-Agent'],
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
};

// ── TMDB ─────────────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var ep = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + ep + '/' + tmdbId
      + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title || d.name || '',
        titleEn: d.original_title || d.original_name || '',
        year: (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Slug ──────────────────────────────────────────────────────
function titleToSlug(t) {
  return (t || '').toLowerCase()
    .replace(/\u011f/g,'g').replace(/\u00fc/g,'u').replace(/\u015f/g,'s')
    .replace(/\u0131/g,'i').replace(/\u0130/g,'i').replace(/\u00f6/g,'o').replace(/\u00e7/g,'c')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// ── Sayfa Bulma ───────────────────────────────────────────────
function findContentPage(titleTr, titleEn, mediaType, season, episode) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var baseSlugs = [];
  if (slugTr) baseSlugs.push(slugTr);
  if (slugEn && slugEn !== slugTr) baseSlugs.push(slugEn);
  var prefixes = ['/izle/dublaj/', '/izle/altyazi/'];

  if (mediaType !== 'tv') {
    var filmCandidates = [];
    baseSlugs.forEach(function(s) { prefixes.forEach(function(p) { filmCandidates.push(BASE_URL + p + s); }); });
    return tryUrls(filmCandidates, 0, false)
      .then(function(r) { return r || searchFallback(titleTr, titleEn, mediaType, season, episode); });
  }

  var epCandidates = [];
  baseSlugs.forEach(function(s) {
    prefixes.forEach(function(p) {
      epCandidates.push(BASE_URL + p + s + '/' + season + '-sezon-' + episode + '-bolum');
    });
  });
  return tryUrls(epCandidates, 0, true)
    .then(function(r) { return r || searchFallback(titleTr, titleEn, mediaType, season, episode); });
}

function tryUrls(candidates, i, needEpisode) {
  if (i >= candidates.length) return Promise.resolve(null);
  return fetch(candidates[i], { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) return tryUrls(candidates, i + 1, needEpisode);
      return r.text().then(function(html) {
        var hasId = html.indexOf('data-id') !== -1;
        var hasEp = html.indexOf('data-s=') !== -1;
        if (needEpisode && (!hasId || !hasEp)) return tryUrls(candidates, i + 1, needEpisode);
        if (!needEpisode && !hasId) return tryUrls(candidates, i + 1, needEpisode);
        return { url: candidates[i], html: html };
      });
    })
    .catch(function() { return tryUrls(candidates, i + 1, needEpisode); });
}

function searchFallback(titleTr, titleEn, mediaType, season, episode) {
  return fetch(BASE_URL + '/ajax/arama.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    }),
    body: 'q=' + encodeURIComponent(titleTr || titleEn)
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.status !== 'success') throw new Error('Arama basarisiz');
    var f = (data.results && data.results.filmler && data.results.filmler.results) || [];
    var d = (data.results && data.results.diziler && data.results.diziler.results) || [];
    var items = (mediaType === 'tv') ? d.concat(f) : f.concat(d);
    if (!items.length) throw new Error('Bulunamadi');
    var pageUrl = items[0].url.startsWith('http') ? items[0].url : BASE_URL + items[0].url;
    if (mediaType !== 'tv') {
      return fetch(pageUrl, { headers: HEADERS })
        .then(function(r) { return r.text().then(function(html) { return { url: pageUrl, html: html }; }); });
    }
    var epUrl = pageUrl.replace(/\/?$/, '') + '/' + season + '-sezon-' + episode + '-bolum';
    return fetch(epUrl, { headers: HEADERS })
      .then(function(r) {
        if (!r.ok) throw new Error('Bolum 404');
        return r.text().then(function(html) {
          if (html.indexOf('data-s=') === -1) throw new Error('Bolum sayfasi degil');
          return { url: epUrl, html: html };
        });
      });
  });
}

// ── Parsers ───────────────────────────────────────────────────
function parseFilmId(html) {
  var m = html.match(/id="wip"[^>]*data-id="(\d+)"/)
       || html.match(/data-id="(\d+)"[^>]*id="wip"/)
       || html.match(/id="dilsec"[^>]*data-id="(\d+)"/)
       || html.match(/data-id="(\d+)"[^>]*id="dilsec"/)
       || html.match(/data-id="(\d+)"/);
  return m ? m[1] : null;
}
function parseAk(html) { var m = html.match(/data-ak="(\d+)"/); return m ? m[1] : '0'; }
function parseDilList(html, pageUrl) {
  var diller = [];
  if (html.indexOf('/izle/dublaj/')  !== -1 || pageUrl.indexOf('/izle/dublaj/')  !== -1) diller.push({ dil: '0', ad: 'TR Dublaj' });
  if (html.indexOf('/izle/altyazi/') !== -1 || pageUrl.indexOf('/izle/altyazi/') !== -1) diller.push({ dil: '1', ad: 'TR Altyazı' });
  if (!diller.length) { diller.push({ dil: '0', ad: 'TR Dublaj' }); diller.push({ dil: '1', ad: 'TR Altyazı' }); }
  return diller;
}

// ── Alternatifleri Getir ──────────────────────────────────────
function fetchAlternatifler(filmId, dil, s, b, ak, pageUrl) {
  var body = 'filmid=' + filmId + '&dil=' + dil + '&s=' + (s||'') + '&b=' + (b||'') + '&bot=0&ak=' + (ak||'0');
  return fetch(BASE_URL + '/ajax/dataAlternatif3.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL,
      'Referer': pageUrl || (BASE_URL + '/')
    }),
    body: body
  })
  .then(function(r) { return r.json(); })
  .then(function(data) { return (data.status === 'success' && Array.isArray(data.data)) ? data.data : []; })
  .catch(function() { return []; });
}

// ── Embed İframe Çözücü ───────────────────────────────────────
function fetchEmbedIframe(embedId, pageUrl) {
  return fetch(BASE_URL + '/ajax/dataEmbed.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL,
      'Referer': pageUrl || (BASE_URL + '/')
    }),
    body: 'id=' + embedId
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var m = html.match(/<iframe[^>]+src="([^"]+)"/i);
    if (m) return m[1];
    var sm = html.match(/(vidmoly|okru|filemoon|dzen|sibnet|sruby|pixel|mailru)\s*\(\s*'([^']+)'/i);
    if (sm) {
      var p = sm[1].toLowerCase(), vid = sm[2];
      if (p === 'vidmoly')  return 'https://vidmoly.net/embed-' + vid + '.html';
      if (p === 'okru')     return 'https://odnoklassniki.ru/videoembed/' + vid;
      if (p === 'filemoon') return 'https://filemoon.sx/e/' + vid;
      if (p === 'dzen')     return 'https://dzen.ru/video/watch/' + vid;
      if (p === 'sibnet')   return 'https://video.sibnet.ru/shell.php?videoid=' + vid;
      if (p === 'sruby')    return 'https://rubyvidhub.com/embed-' + vid + '.html';
      if (p === 'pixel')    return 'https://pixeldrain.com/u/' + vid;
      if (p === 'mailru')   return 'https://my.mail.ru/video/embed/' + vid;
    }
    return null;
  });
}

// ── Base64URL Decode (AES için) ───────────────────────────────
function b64urlToUint8(str) {
  var b64 = str.replace(/-/g,'+').replace(/_/g,'/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── AES-256-GCM Decrypt (Web Crypto API) ─────────────────────
// key_parts[0] + key_parts[1] concat → 32 byte key
function aesGcmDecrypt(keyParts, ivStr, payloadStr) {
  var keyBytes = new Uint8Array(
    Array.prototype.slice.call(b64urlToUint8(keyParts[0])).concat(
    Array.prototype.slice.call(b64urlToUint8(keyParts[1])))
  );
  var iv      = b64urlToUint8(ivStr);
  var payload = b64urlToUint8(payloadStr);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'AES-GCM' }, false, ['decrypt'])
      .then(function(key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, payload);
      })
      .then(function(decrypted) {
        return JSON.parse(new TextDecoder().decode(decrypted));
      });
  }
  // Hermes fallback: crypto.subtle yok → manuel AES-GCM
  return Promise.reject(new Error('crypto.subtle unavailable'));
}

// ── FileMoon TAM AKIŞ ─────────────────────────────────────────
//
//  HAR'dan öğrenilen akış:
//  bysezoxexe.com/e/{slug}
//    → /api/videos/{slug}/embed/details  → embed_frame_url = 398fitus.com/je8/{slug}
//    → 398fitus.com/api/videos/access/challenge (POST empty)
//    → 398fitus.com/api/videos/access/attest    (POST ECDSA signed)
//    → 398fitus.com/api/videos/{slug}/embed/playback (POST fingerprint token)
//    → AES-GCM decrypt(key_parts, iv, payload) → sources[].url
//
//  Hermes'te crypto.subtle YOK → ECDSA imzası yapılamıyor
//  STRATEJI:
//  1. Fingerprint olmadan GET playback dene (JS'de n? branch → GET)
//  2. Başarısız → challenge+attest+playback tam akış (crypto.subtle varsa)
//  3. Başarısız → HTML embed sayfasından packed JS parse (eski yöntem)
// ─────────────────────────────────────────────────────────────
function fetchFilemoonStream(iframeSrc) {
  var fullUrl = iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc;

  // Slug çıkar: /e/{slug} veya /ys8/{slug} veya /je8/{slug}
  var slugM = fullUrl.match(/\/(?:e|ys8|je8|v|f)\/([a-zA-Z0-9]+)/);
  var slug  = slugM ? slugM[1] : null;
  if (!slug) return Promise.resolve(null);

  // Domain tespiti
  var frontDomain = null;
  var playerDomain = null;
  if (fullUrl.indexOf('bysezoxexe') !== -1) {
    frontDomain  = 'https://bysezoxexe.com';
    playerDomain = 'https://398fitus.com';
  } else if (fullUrl.indexOf('398fitus') !== -1) {
    frontDomain  = 'https://398fitus.com';
    playerDomain = 'https://398fitus.com';
  } else if (fullUrl.indexOf('filemoon.sx') !== -1) {
    frontDomain  = 'https://filemoon.sx';
    playerDomain = 'https://filemoon.sx';
  } else if (fullUrl.indexOf('filemoon') !== -1) {
    frontDomain  = 'https://filemoon.sx';
    playerDomain = 'https://filemoon.sx';
  }
  if (!playerDomain) return fetchFilemoonHtml(fullUrl);

  var playerReferer = playerDomain + '/je8/' + slug;
  var embedReferer  = frontDomain  + '/e/'   + slug;

  // ADIM 1: embed/details → gerçek playerDomain'i bul
  function getEmbedDetails() {
    return fetch(frontDomain + '/api/videos/' + slug + '/embed/details', {
      headers: Object.assign({}, JSON_HEADERS, {
        'Referer': embedReferer,
        'Origin':  frontDomain
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var embedFrameUrl = d.embed_frame_url || '';
      var m = embedFrameUrl.match(/^(https?:\/\/[^\/]+)/);
      if (m) playerDomain = m[1];
      playerReferer = playerDomain + '/je8/' + slug;
      return d;
    })
    .catch(function() { return {}; });
  }

  // ADIM 2: settings
  function getSettings() {
    return fetch(playerDomain + '/api/videos/' + slug + '/embed/settings', {
      headers: Object.assign({}, JSON_HEADERS, { 'Referer': playerReferer })
    })
    .then(function(r) { return r.json(); })
    .catch(function() { return {}; });
  }

  // ADIM 3: challenge
  function getChallenge() {
    return fetch(playerDomain + '/api/videos/access/challenge', {
      method: 'POST',
      headers: Object.assign({}, JSON_HEADERS, {
        'Referer': playerReferer,
        'Origin':  playerDomain,
        'Content-Length': '0'
      }),
      body: ''
    })
    .then(function(r) { return r.json(); });
  }

  // ADIM 4: attest (ECDSA P-256 imzası gerekiyor - Web Crypto ile)
  function doAttest(challenge) {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return Promise.reject(new Error('crypto.subtle yok'));
    }
    var viewerId  = challenge.viewer_hint;
    var deviceId  = generateUUID();
    var nonce     = challenge.nonce;
    var chalId    = challenge.challenge_id;

    return crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )
    .then(function(keyPair) {
      var encoder = new TextEncoder();
      var msg = encoder.encode(chalId + '.' + nonce + '.' + viewerId + '.' + deviceId);
      return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, msg)
        .then(function(sigBuf) {
          var sigArr = new Uint8Array(sigBuf);
          var sigB64 = uint8ToB64url(sigArr);
          return crypto.subtle.exportKey('jwk', keyPair.publicKey)
            .then(function(pubJwk) {
              var attestBody = {
                viewer_id:    viewerId,
                device_id:    deviceId,
                challenge_id: chalId,
                nonce:        nonce,
                signature:    sigB64,
                public_key:   pubJwk,
                client:       buildClientInfo(),
                storage: {
                  cookie:       viewerId,
                  local_storage: viewerId,
                  indexed_db:   viewerId + ':' + deviceId,
                  cache_storage: viewerId + ':' + deviceId
                },
                attributes: { entropy: 'high' }
              };
              return fetch(playerDomain + '/api/videos/access/attest', {
                method: 'POST',
                headers: Object.assign({}, JSON_HEADERS, {
                  'Referer': playerReferer,
                  'Origin':  playerDomain,
                  'Content-Type': 'application/json'
                }),
                body: JSON.stringify(attestBody)
              });
            });
        });
    })
    .then(function(r) { return r.json(); });
  }

  // ADIM 5: playback
  function getPlayback(fingerprint) {
    var opts = {
      headers: Object.assign({}, JSON_HEADERS, {
        'Referer': playerReferer,
        'Origin':  playerDomain,
        'X-Embed-Origin':  BASE_URL.replace('https://',''),
        'X-Embed-Referer': BASE_URL + '/'
      })
    };
    if (fingerprint) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ fingerprint: fingerprint });
    }
    return fetch(playerDomain + '/api/videos/' + slug + '/embed/playback', opts)
      .then(function(r) {
        if (!r.ok) throw new Error('playback ' + r.status);
        return r.json();
      });
  }

  // ADIM 6: AES-GCM decrypt
  function decryptPlayback(json) {
    var pb = json.playback;
    if (!pb || !pb.key_parts || !pb.iv || !pb.payload) return Promise.resolve(null);
    return aesGcmDecrypt(pb.key_parts, pb.iv, pb.payload)
      .then(function(dec) {
        var sources = dec.sources || [];
        if (!sources.length) return null;
        // En yüksek kalite
        var best = sources[0];
        var order = ['2160','1080','720','480'];
        for (var qi = 0; qi < order.length; qi++) {
          for (var si = 0; si < sources.length; si++) {
            if (((sources[si].label||'')+'' ).indexOf(order[qi]) !== -1) {
              best = sources[si]; break;
            }
          }
          if (best !== sources[0]) break;
        }
        var url = best.url;
        return { url: url, type: url.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4', referer: playerDomain + '/' };
      })
      .catch(function() { return null; });
  }

  // TAM AKIŞ
  return getEmbedDetails()
    .then(function() { return getSettings(); })
    .then(function() {
      // Önce fingerprint olmadan GET dene
      return getPlayback(null)
        .then(decryptPlayback)
        .catch(function() {
          // GET başarısız → challenge+attest+playback
          return getChallenge()
            .then(function(challenge) { return doAttest(challenge); })
            .then(function(attest) {
              return getPlayback({ token: attest.token, viewer_id: attest.viewer_id });
            })
            .then(decryptPlayback)
            .catch(function() { return null; });
        });
    })
    .catch(function() { return fetchFilemoonHtml(fullUrl); });
}

// ── FileMoon HTML Fallback (eski yöntem) ──────────────────────
function fetchFilemoonHtml(fullUrl) {
  return fetch(fullUrl, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var unpacked = html;
      var pm = html.match(/eval\(function\(p,a,c,k,e,[^)]*\)[\s\S]+?\)\)/);
      if (pm) {
        try {
          var parts = pm[0].match(/\('([\s\S]+?)',(\d+),(\d+),'([^']*)'/);
          if (parts) {
            var p2 = parts[1], a = parseInt(parts[2]), c = parseInt(parts[3]);
            var k = parts[4].split('|');
            function e(n) { return (n<a?'':e(Math.floor(n/a)))+((n=n%a)>35?String.fromCharCode(n+29):n.toString(36)); }
            while (c--) { if (k[c]) p2 = p2.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c]); }
            unpacked = p2;
          }
        } catch(ex) {}
      }
      var m = unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: fullUrl } : null;
    })
    .catch(function() { return null; });
}

// ── VidMoly ───────────────────────────────────────────────────
function fetchVidMolyStream(src) {
  var url = (src.startsWith('//') ? 'https:' + src : src).replace('vidmoly.to','vidmoly.net');
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: url } : null;
    })
    .catch(function() { return null; });
}

// ── Sibnet ────────────────────────────────────────────────────
function fetchSibnetStream(src) {
  var id = (src.match(/videoid=(\d+)/) || [])[1];
  if (!id) return Promise.resolve(null);
  var u = 'https://video.sibnet.ru/shell.php?videoid=' + id;
  return fetch(u, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
      return m ? { url: 'https://video.sibnet.ru' + m[1], type: 'mp4', referer: u } : null;
    })
    .catch(function() { return null; });
}

// ── Dzen ──────────────────────────────────────────────────────
function fetchDzenStream(src) {
  var idM = src.match(/watch\/([a-f0-9]{10,})/i) || src.match(/embed\/([a-f0-9]{10,})/i);
  var videoId = idM ? idM[1] : null;
  if (videoId) {
    return fetch('https://dzen.ru/api/v3/video/player/url?videoId=' + videoId, {
      headers: Object.assign({}, HEADERS, { 'Referer': 'https://dzen.ru/', 'Origin': 'https://dzen.ru' })
    })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      var url = json.url || (json.streams && json.streams[0] && json.streams[0].url);
      if (url) return { url: url, type: url.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4', referer: 'https://dzen.ru/' };
      return fetchDzenHtml(src);
    })
    .catch(function() { return fetchDzenHtml(src); });
  }
  return fetchDzenHtml(src);
}
function fetchDzenHtml(u) {
  return fetch(u, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://dzen.ru/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var re = /https:\/\/vd\d+\.okcdn\.ru\/\?[^\s"'\\<>]+/g;
      var m, links = [], seen = {};
      while ((m = re.exec(html)) !== null) { if (!seen[m[0]]) { seen[m[0]] = true; links.push(m[0]); } }
      if (links.length) return { url: links[links.length-1], type: 'mp4', referer: 'https://dzen.ru/' };
      var fm = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return fm ? { url: fm[1], type: 'hls', referer: 'https://dzen.ru/' } : null;
    })
    .catch(function() { return null; });
}

// ── OkRu ──────────────────────────────────────────────────────
function fetchOkRuStream(src) {
  var url = src.indexOf('/videoembed/') === -1 ? src.replace('/video/','/videoembed/') : src;
  if (!url.startsWith('http')) url = 'https://ok.ru' + url;
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://ok.ru/', 'Origin': 'https://ok.ru' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var dataM = html.match(/data-options="([^"]+)"/i);
      if (dataM) {
        try {
          var opts = JSON.parse(dataM[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"'));
          var meta = opts.flashvars && opts.flashvars.metadata ? JSON.parse(opts.flashvars.metadata) : null;
          if (meta) {
            if (meta.ondemandHls) return { url: meta.ondemandHls.replace(/\\u0026/g,'&'), type: 'hls', referer: url };
            var order = ['ULTRA','QUAD','FULL','HD','SD','LOW','MOBILE'];
            var vids = meta.videos || [];
            for (var qi = 0; qi < order.length; qi++)
              for (var vi = 0; vi < vids.length; vi++)
                if ((vids[vi].name||'').toUpperCase() === order[qi] && vids[vi].url)
                  return { url: vids[vi].url.replace(/\\u0026/g,'&'), type: 'mp4', referer: url };
          }
        } catch(e) {}
      }
      var hm = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return hm ? { url: hm[1], type: 'hls', referer: url } : null;
    })
    .catch(function() { return null; });
}

// ── Yardımcı Fonksiyonlar ─────────────────────────────────────
function generateUUID() {
  var s = '';
  for (var i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}
function uint8ToB64url(arr) {
  var bin = '';
  for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function buildClientInfo() {
  return {
    user_agent: HEADERS['User-Agent'],
    architecture: '', bitness: '64', platform: 'iOS',
    platform_version: '18.5', model: 'iPhone',
    ua_full_version: '146.0.0.0',
    brand_full_versions: [
      { brand: 'Chromium', version: '146.0.0.0' },
      { brand: 'Not-A.Brand', version: '24.0.0.0' }
    ],
    pixel_ratio: 2, screen_width: 390, screen_height: 844,
    color_depth: 32, languages: ['tr-TR'], timezone: 'Europe/Istanbul',
    hardware_concurrency: 4, device_memory: 4, touch_points: 5,
    webgl_vendor: 'Apple', webgl_renderer: 'Apple GPU',
    canvas_hash: generateUUID(), audio_hash: generateUUID(),
    pointer_type: 'coarse,touch', extra: {}
  };
}

// ── Embed Tür Tespiti ─────────────────────────────────────────
function detectType(src) {
  if (!src) return 'unknown';
  if (src.indexOf('vidmoly')        !== -1) return 'vidmoly';
  if (src.indexOf('sibnet.ru')      !== -1) return 'sibnet';
  if (src.indexOf('dzen.ru')        !== -1) return 'dzen';
  if (src.indexOf('ok.ru')          !== -1 || src.indexOf('odnoklassniki') !== -1) return 'okru';
  if (src.indexOf('filemoon')       !== -1 || src.indexOf('bysezoxexe')    !== -1 || src.indexOf('398fitus') !== -1) return 'filemoon';
  if (src.indexOf('rubyvidhub')     !== -1) return 'rubyvid';
  if (src.indexOf('pixeldrain')     !== -1) return 'pixeldrain';
  if (src.indexOf('mail.ru')        !== -1) return 'mailru';
  return 'generic';
}

// ── Embed İşleyici ────────────────────────────────────────────
function processEmbed(embedData, dilAd, contentTitle, pageUrl) {
  var baslik = (embedData.baslik || '').toLowerCase();
  if (baslik === 'pixel' || baslik === 'netu') return Promise.resolve(null);

  return fetchEmbedIframe(embedData.id, pageUrl).then(function(src) {
    if (!src) return null;
    var type  = detectType(src);
    var flag  = dilAd.indexOf('Dublaj') !== -1 ? '🇹🇷 ' : '🌐 ';
    var q     = embedData.kalite || 'Auto';
    var names = { vidmoly:'VidMoly', sibnet:'Sibnet', dzen:'Dzen', okru:'Ok.Ru',
                  filemoon:'FileMoon', rubyvid:'RubyVid', pixeldrain:'PixelDrain',
                  mailru:'MailRu', generic: embedData.baslik || 'Kaynak' };
    var pName = names[type] || 'Kaynak';

    function makeStream(s) {
      if (!s) return null;
      return {
        url: s.url, name: contentTitle,
        title: '⌜ WEBTEIZLE ⌟ | ' + pName + ' | ' + flag + dilAd,
        quality: s.quality || q, type: s.type || 'hls',
        headers: { 'Referer': s.referer || src, 'User-Agent': HEADERS['User-Agent'] }
      };
    }

    var sp;
    switch (type) {
      case 'vidmoly':  sp = fetchVidMolyStream(src).then(makeStream);  break;
      case 'sibnet':   sp = fetchSibnetStream(src).then(makeStream);   break;
      case 'dzen':     sp = fetchDzenStream(src).then(makeStream);     break;
      case 'okru':     sp = fetchOkRuStream(src).then(makeStream);     break;
      case 'filemoon': sp = fetchFilemoonStream(src).then(makeStream); break;
      case 'pixeldrain':
        var fid = src.split('/u/').pop().split('?')[0];
        sp = Promise.resolve(makeStream({ url: 'https://pixeldrain.com/api/file/' + fid + '?download', type: 'mp4', referer: 'https://pixeldrain.com/' }));
        break;
      default:
        sp = fetch(src, { headers: Object.assign({}, HEADERS, { 'Referer': pageUrl || (BASE_URL + '/') }) })
          .then(function(r) { return r.text(); })
          .then(function(html) {
            var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
            return makeStream(m ? { url: m[1], type: 'hls', referer: src } : null);
          })
          .catch(function() { return null; });
    }
    return sp;
  });
}

// ── Ana Fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var title = info.titleTr || info.titleEn;
      return findContentPage(info.titleTr, info.titleEn, mediaType, season, episode)
        .then(function(result) {
          var filmId = parseFilmId(result.html);
          if (!filmId) throw new Error('ID yok');
          var ak     = parseAk(result.html);
          var diller = parseDilList(result.html, result.url);
          var streams = [];
          return Promise.all(diller.map(function(d) {
            var s = (mediaType === 'tv') ? season  : '';
            var b = (mediaType === 'tv') ? episode : '';
            return fetchAlternatifler(filmId, d.dil, s, b, ak, result.url)
              .then(function(embedList) {
                return Promise.all(embedList.map(function(e) {
                  return processEmbed(e, d.ad, title, result.url);
                }));
              })
              .then(function(res) { res.forEach(function(s) { if (s) streams.push(s); }); });
          }))
          .then(function() { return streams; });
        });
    })
    .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
