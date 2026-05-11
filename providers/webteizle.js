// ============================================================
//  WebteIzle — Nuvio Provider  v10
// ============================================================

var BASE_URL     = 'https://webteizle3.xyz';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ═══════════════════════════════════════════════════════════
//  YARDIMCILAR
// ═══════════════════════════════════════════════════════════

function getCrypto() {
  if (typeof crypto !== 'undefined' && crypto && crypto.subtle) return crypto;
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
  if (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) return self.crypto;
  return null;
}

// güvenli random — crypto.getRandomValues varsa kullan, yoksa Math.random
function secureRandom(n) {
  var buf = new Uint8Array(n);
  var c = typeof crypto !== 'undefined' ? crypto
        : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (c && c.getRandomValues) {
    c.getRandomValues(buf);
  } else {
    for (var i = 0; i < n; i++) buf[i] = Math.random() * 256 | 0;
  }
  return buf;
}

function b64urlToBytes(str) {
  var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(buf) {
  var bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf);
  // normalise — typed array'in tamamını al
  if (buf instanceof Uint8Array) bytes = buf;
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomHex(n) {
  return Array.from(secureRandom(n)).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function cookieStr(map) {
  return Object.keys(map).map(function(k) { return k + '=' + map[k]; }).join('; ');
}
function parseCookies(header, map) {
  if (!header) return;
  header.split(',').forEach(function(c) {
    var kv = c.trim().split(';')[0]; var eq = kv.indexOf('=');
    if (eq > 0) map[kv.slice(0, eq).trim()] = kv.slice(eq + 1);
  });
}

// ═══════════════════════════════════════════════════════════
//  PURE-JS SHA-256
//  (kullanılır: ECDSA signing için mesaj hash'i)
// ═══════════════════════════════════════════════════════════
var _SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];

function sha256(data) {
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var len = data.length;
  var padLen = Math.ceil((len + 9) / 64) * 64;
  var padded = new Uint8Array(padLen);
  padded.set(data);
  padded[len] = 0x80;
  var bitHi = Math.floor(len * 8 / 0x100000000);
  var bitLo = (len * 8) >>> 0;
  var dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitHi >>> 0);
  dv.setUint32(padLen - 4, bitLo >>> 0);

  var rot = function(x, n) { return (x >>> n) | (x << (32 - n)); };
  var w = new Array(64);

  for (var i = 0; i < padLen; i += 64) {
    for (var j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
    for (var j = 16; j < 64; j++) {
      var s0 = rot(w[j-15],7) ^ rot(w[j-15],18) ^ (w[j-15] >>> 3);
      var s1 = rot(w[j-2],17) ^ rot(w[j-2],19)  ^ (w[j-2]  >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var j = 0; j < 64; j++) {
      var S1  = rot(e,6) ^ rot(e,11) ^ rot(e,25);
      var ch  = (e & f) ^ (~e & g);
      var t1  = (h + S1 + ch + _SHA256_K[j] + w[j]) >>> 0;
      var S0  = rot(a,2) ^ rot(a,13) ^ rot(a,22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2  = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }

  var out = new Uint8Array(32);
  var dvo = new DataView(out.buffer);
  for (var i = 0; i < 8; i++) dvo.setUint32(i * 4, H[i]);
  return out;
}

// ═══════════════════════════════════════════════════════════
//  PURE-JS P-256 ECDSA  (BigInt required — Hermes 0.11+)
// ═══════════════════════════════════════════════════════════
var _EC = (function() {
  var p  = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  var a  = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC');
  var n  = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  var Gx = BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296');
  var Gy = BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5');
  var _0 = BigInt(0), _1 = BigInt(1), _2 = BigInt(2), _3 = BigInt(3);

  function mod(x, m) { return ((x % m) + m) % m; }

  function inv(a, m) {
    var r=m, nr=mod(a,m), t=_0, nt=_1, q, tmp;
    while (nr !== _0) {
      q=r/nr;
      tmp=r-q*nr; r=nr; nr=tmp;
      tmp=t-q*nt; t=nt; nt=tmp;
    }
    return mod(t, m);
  }

  // Affine point add/double (null = point at infinity)
  function add(P, Q) {
    if (!P) return Q;
    if (!Q) return P;
    var x1=P[0],y1=P[1],x2=Q[0],y2=Q[1];
    if (x1===x2) {
      if (y1!==y2) return null;
      // double
      var l=mod((_3*x1*x1+a)*inv(_2*y1,p),p);
      var x3=mod(l*l-_2*x1,p);
      return [x3, mod(l*(x1-x3)-y1,p)];
    }
    var l2=mod((y2-y1)*inv(x2-x1,p),p);
    var x3=mod(l2*l2-x1-x2,p);
    return [x3, mod(l2*(x1-x3)-y1,p)];
  }

  function mul(k, P) {
    var R=null, A=P;
    while (k>_0) { if (k&_1) R=add(R,A); A=add(A,A); k>>=_1; }
    return R;
  }

  var G=[Gx,Gy];

  function fromBytes(bytes) {
    var hex='';
    for (var i=0;i<bytes.length;i++) hex+=('0'+bytes[i].toString(16)).slice(-2);
    return BigInt('0x'+hex);
  }
  function toBytes32(bi) {
    var hex=bi.toString(16).padStart(64,'0');
    var out=new Uint8Array(32);
    for (var i=0;i<32;i++) out[i]=parseInt(hex.slice(i*2,i*2+2),16);
    return out;
  }

  // Text encode UTF-8
  function encodeUtf8(str) {
    var bytes=[], i=0;
    while(i<str.length){
      var c=str.charCodeAt(i);
      if(c<0x80){bytes.push(c);}
      else if(c<0x800){bytes.push(0xC0|(c>>6),0x80|(c&0x3F));}
      else{bytes.push(0xE0|(c>>12),0x80|((c>>6)&0x3F),0x80|(c&0x3F));}
      i++;
    }
    return new Uint8Array(bytes);
  }

  function genKey() {
    var db, d;
    do {
      db = secureRandom(32);
      d  = mod(fromBytes(db), n-_1)+_1;
    } while (d===_0);
    var Q = mul(d, G);
    return { d:d, x:Q[0], y:Q[1], xBytes:toBytes32(Q[0]), yBytes:toBytes32(Q[1]), dBytes:toBytes32(d) };
  }

  function sign(key, message) {
    // message is a string (nonce)
    var msgBytes = encodeUtf8(message);
    var hash = sha256(msgBytes);
    var e = fromBytes(hash);
    var d = key.d;
    var r, s, k;
    var attempts = 0;
    do {
      do {
        var kb = secureRandom(32);
        k = mod(fromBytes(kb), n-_1)+_1;
        var R = mul(k, G);
        r = mod(R[0], n);
        attempts++;
        if (attempts > 100) throw new Error('ECDSA sign: too many retries');
      } while (r===_0);
      s = mod(inv(k,n)*(e+r*d), n);
    } while (s===_0);
    var sig = new Uint8Array(64);
    sig.set(toBytes32(r), 0);
    sig.set(toBytes32(s), 32);
    return sig;
  }

  // Export public key as JWK (for attest body)
  function pubJwk(key) {
    return {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(key.xBytes),
      y: bytesToB64url(key.yBytes),
      key_ops: ['verify'],
      ext: true
    };
  }

  return { genKey: genKey, sign: sign, pubJwk: pubJwk };
})();

// ═══════════════════════════════════════════════════════════
//  FILEMOON ECDSA: crypto.subtle varsa native, yoksa pure-JS
// ═══════════════════════════════════════════════════════════

function fmGenerateAndSign(nonce) {
  var c = getCrypto();

  if (c) {
    // Native path — crypto.subtle
    return c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      .then(function(kp) {
        return c.subtle.sign(
          { name: 'ECDSA', hash: { name: 'SHA-256' } },
          kp.privateKey,
          new TextEncoder().encode(nonce)
        ).then(function(sig) {
          return c.subtle.exportKey('jwk', kp.publicKey).then(function(pub) {
            return { signature: bytesToB64url(new Uint8Array(sig)), public_key: pub };
          });
        });
      });
  }

  // Pure-JS fallback (Hermes / no crypto.subtle)
  try {
    if (typeof BigInt === 'undefined') throw new Error('BigInt yok');
    var key = _EC.genKey();
    var sig = _EC.sign(key, nonce);
    return Promise.resolve({
      signature:  bytesToB64url(sig),
      public_key: _EC.pubJwk(key)
    });
  } catch(e) {
    return Promise.reject(new Error('ECDSA fallback hata: ' + e.message));
  }
}

// AES-256-GCM decrypt — crypto.subtle gerekli
// (playback decrypt için — bu crypto.subtle olmadan çalışmaz;
//  Hermes'te crypto.subtle yoksa ve de getRandomValues varsa decrypt çalışmayabilir.
//  Nuvio'nun crypto.subtle desteği için test edilmeli.)
function aesGcmDecrypt(keyBytes, ivBytes, dataBytes) {
  var c = getCrypto();
  if (!c) return Promise.reject(new Error('crypto.subtle yok — AES decrypt mümkün değil'));
  return c.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
    .then(function(k) {
      return c.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, k, dataBytes);
    })
    .then(function(buf) {
      var bytes = new Uint8Array(buf);
      var str = '';
      for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
      return str;
    });
}

// ═══════════════════════════════════════════════════════════
//  TMDB + SAYFA BULMA
// ═══════════════════════════════════════════════════════════

function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
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

function titleToSlug(t) {
  return (t || '').toLowerCase()
    .replace(/\u011f/g,'g').replace(/\u00fc/g,'u').replace(/\u015f/g,'s')
    .replace(/\u0131/g,'i').replace(/\u0130/g,'i').replace(/\u00f6/g,'o').replace(/\u00e7/g,'c')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function findFilmPage(titleTr, titleEn, mediaType, season, episode) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var candidates = [];

  if (mediaType === 'tv' && season && episode) {
    // Dizi: direkt bölüm URL'si dene
    var suffix = '/' + season + '-sezon-' + episode + '-bolum';
    if (slugTr) {
      candidates.push(BASE_URL + '/izle/dublaj/'  + slugTr + suffix);
      candidates.push(BASE_URL + '/izle/altyazi/' + slugTr + suffix);
    }
    if (slugEn && slugEn !== slugTr) {
      candidates.push(BASE_URL + '/izle/dublaj/'  + slugEn + suffix);
      candidates.push(BASE_URL + '/izle/altyazi/' + slugEn + suffix);
    }
  } else {
    // Film: ana sayfa
    if (slugTr) {
      candidates.push(BASE_URL + '/izle/dublaj/'  + slugTr);
      candidates.push(BASE_URL + '/izle/altyazi/' + slugTr);
    }
    if (slugEn && slugEn !== slugTr) {
      candidates.push(BASE_URL + '/izle/dublaj/'  + slugEn);
      candidates.push(BASE_URL + '/izle/altyazi/' + slugEn);
    }
  }

  function tryNext(i) {
    if (i >= candidates.length) return searchFallback(titleTr, titleEn, mediaType, season, episode);
    return fetch(candidates[i], { headers: HEADERS })
      .then(function(r) {
        if (!r.ok) return tryNext(i + 1);
        return r.text().then(function(html) {
          if (html.indexOf('data-id') === -1) return tryNext(i + 1);
          // Dizi sayfasında data-s= olmalı
          if (mediaType === 'tv' && html.indexOf('data-s=') === -1) return tryNext(i + 1);
          return { url: candidates[i], html: html };
        });
      }).catch(function() { return tryNext(i + 1); });
  }
  return tryNext(0);
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
    var filmler = (data.results && data.results.filmler && data.results.filmler.results) || [];
    var diziler = (data.results && data.results.diziler && data.results.diziler.results) || [];
    var items = (mediaType === 'tv') ? diziler.concat(filmler) : filmler.concat(diziler);
    if (!items.length) throw new Error('Icerik bulunamadi');
    var pageUrl = items[0].url.startsWith('http') ? items[0].url : BASE_URL + items[0].url;
    if (mediaType === 'tv' && season && episode) {
      pageUrl = pageUrl.replace(/\/?$/, '') + '/' + season + '-sezon-' + episode + '-bolum';
    }
    return fetch(pageUrl, { headers: HEADERS })
      .then(function(r) { return r.text().then(function(html) { return { url: pageUrl, html: html }; }); });
  });
}

function parseFilmId(html) {
  var m = html.match(/data-id="(\d+)"[^>]*id="wip"/)
       || html.match(/id="wip"[^>]*data-id="(\d+)"/)
       || html.match(/data-id="(\d+)"/);
  return m ? m[1] : null;
}

function parseDilList(html, pageUrl) {
  var d = [];
  if (html.indexOf('/izle/dublaj/')  !== -1 || pageUrl.indexOf('/izle/dublaj/')  !== -1) d.push({ dil: '0', ad: 'TR Dublaj' });
  if (html.indexOf('/izle/altyazi/') !== -1 || pageUrl.indexOf('/izle/altyazi/') !== -1) d.push({ dil: '1', ad: 'TR Altyazı' });
  if (!d.length) { d.push({ dil: '0', ad: 'TR Dublaj' }); d.push({ dil: '1', ad: 'TR Altyazı' }); }
  return d;
}

function fetchAlternatifler(filmId, dil, season, episode) {
  return fetch(BASE_URL + '/ajax/dataAlternatif3.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL
    }),
    body: 'filmid=' + filmId + '&dil=' + dil + '&s=' + (season || '') + '&b=' + (episode || '') + '&bot=0'
  })
  .then(function(r) { return r.json(); })
  .then(function(d) { return (d.status === 'success' && Array.isArray(d.data)) ? d.data : []; });
}

function fetchEmbedData(embedId) {
  return fetch(BASE_URL + '/ajax/dataEmbed.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL
    }),
    body: 'id=' + embedId
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var mIframe = html.match(/<iframe[^>]+src="([^"]+)"/i);
    if (mIframe) {
      var iSrc = mIframe[1];
      // bysezoxexe / 398fitus / filemoon → slug çıkar, filemoon tipine yönlendir
      var fmSlugM = iSrc.match(/\/(?:e|ys8|je8)\/([a-zA-Z0-9]+)/);
      if (fmSlugM && (iSrc.indexOf('bysezoxexe') !== -1 || iSrc.indexOf('398fitus') !== -1 || iSrc.indexOf('filemoon') !== -1)) {
        return { type: 'filemoon', videoId: fmSlugM[1], iframeSrc: iSrc };
      }
      return { type: 'iframe', url: iSrc };
    }
    var mFm = html.match(/filemoon\s*\(\s*['"]([^'"]+)['"]/i);
    if (mFm) return { type: 'filemoon', videoId: mFm[1] };
    var mVm = html.match(/vidmoly\s*\(\s*['"]([^'"]+)['"]/i);
    if (mVm) return { type: 'vidmoly', videoId: mVm[1] };
    var mMr = html.match(/mailru\s*\(\s*['"]([^'"]+)['"]/i);
    if (mMr) return { type: 'mailru', videoId: mMr[1] };
    return null;
  });
}

// ═══════════════════════════════════════════════════════════
//  PROVIDER: VidMoly
// ═══════════════════════════════════════════════════════════
function extractVidMoly(videoId) {
  var url = 'https://vidmoly.net/embed-' + videoId + '.html';
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: url } : null;
    })
    .catch(function() { return null; });
}

// ═══════════════════════════════════════════════════════════
//  PROVIDER: FileMoon (ECDSA-P256 + AES-256-GCM)
// ═══════════════════════════════════════════════════════════
var FM_API    = 'https://398fitus.com';
var FM_DOMAIN = 'bysezoxexe.com';

function fmBaseH(cookies, playerDomain) {
  var domain = playerDomain || FM_DOMAIN;
  var h = {
    'User-Agent':      HEADERS['User-Agent'],
    'Accept':          'application/json, */*',
    'Accept-Language': 'tr-TR,tr;q=0.7',
    'Origin':          'https://' + domain,
    'Referer':         'https://' + domain + '/'
  };
  if (cookies && Object.keys(cookies).length) h['Cookie'] = cookieStr(cookies);
  return h;
}

function fmEmbedH(videoId) {
  return {
    'x-embed-origin':  BASE_URL.replace('https://', ''),
    'x-embed-parent':  'https://' + FM_DOMAIN + '/e/' + videoId,
    'x-embed-referer': BASE_URL + '/'
  };
}

function extractFileMoon(videoId, iframeSrc) {
  var cookies  = {};
  var viewerId = randomHex(16);
  var deviceId = randomHex(16);

  // playerDomain: iframeSrc'den belirle
  var playerApi    = FM_API;       // default: https://398fitus.com
  var playerDomain = '398fitus.com'; // default
  if (iframeSrc) {
    if (iframeSrc.indexOf('398fitus') !== -1)   { playerApi = 'https://398fitus.com'; playerDomain = '398fitus.com'; }
    else if (iframeSrc.indexOf('filemoon.sx') !== -1) { playerApi = 'https://filemoon.sx'; playerDomain = 'filemoon.sx'; }
    else if (iframeSrc.indexOf('filemoon.to') !== -1) { playerApi = 'https://filemoon.to'; playerDomain = 'filemoon.to'; }
    // bysezoxexe.com → 398fitus'a git (embed_frame_url 398fitus döndürüyor)
  }

  // 1) Settings
  return fetch(playerApi + '/api/videos/' + videoId + '/embed/settings', {
    headers: Object.assign(fmBaseH(cookies, playerDomain), fmEmbedH(videoId))
  })
  .then(function(r) { parseCookies(r.headers.get('set-cookie'), cookies); return r.json(); })

  // 2) Challenge
  .then(function() {
    return fetch(playerApi + '/api/videos/access/challenge', {
      method: 'POST',
      headers: Object.assign(fmBaseH(cookies, playerDomain), { 'Content-Type': 'application/json' }),
      body: ''
    });
  })
  .then(function(r) { parseCookies(r.headers.get('set-cookie'), cookies); return r.json(); })

  // 3) ECDSA sign + Attest
  .then(function(ch) {
    if (!ch.challenge_id) throw new Error('challenge_id yok');
    return fmGenerateAndSign(ch.nonce).then(function(ec) {
      var body = {
        viewer_id: viewerId, device_id: deviceId,
        challenge_id: ch.challenge_id, nonce: ch.nonce,
        signature: ec.signature, public_key: ec.public_key,
        client: {
          user_agent: HEADERS['User-Agent'],
          architecture: 'x86', bitness: '64',
          platform: 'Windows', platform_version: '10.0.0', model: '',
          ua_full_version: '137.0.0.0',
          brand_full_versions: [{ brand: 'Firefox', version: '137.0.0.0' }],
          pixel_ratio: 1, screen_width: 1920, screen_height: 1080,
          color_depth: 24, languages: ['tr-TR', 'tr'],
          timezone: 'Europe/Istanbul', hardware_concurrency: 4,
          device_memory: 8, touch_points: 0,
          webgl_vendor: 'Mozilla', webgl_renderer: 'Mozilla',
          canvas_hash: bytesToB64url(secureRandom(32)),
          audio_hash:  bytesToB64url(secureRandom(32)),
          pointer_type: 'fine,mouse',
          extra: { vendor: 'Mozilla', appVersion: '5.0 (Windows)' }
        },
        storage: {
          cookie: viewerId, local_storage: viewerId,
          indexed_db: viewerId + ':' + deviceId,
          cache_storage: viewerId + ':' + deviceId
        },
        attributes: { entropy: 'high' }
      };
      return fetch(playerApi + '/api/videos/access/attest', {
        method: 'POST',
        headers: Object.assign(fmBaseH(cookies, playerDomain), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
    });
  })
  .then(function(r) { parseCookies(r.headers.get('set-cookie'), cookies); return r.json(); })

  // 4) Playback — fingerprint wrapper
  .then(function(at) {
    if (!at.token) throw new Error('attest token yok: ' + JSON.stringify(at).slice(0, 100));
    console.log('[WebteIzle] FileMoon attest OK confidence=' + at.confidence);
    return fetch(playerApi + '/api/videos/' + videoId + '/embed/playback', {
      method: 'POST',
      headers: Object.assign(fmBaseH(cookies, playerDomain), fmEmbedH(videoId), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fingerprint: {
          token:      at.token,
          viewer_id:  at.viewer_id,
          device_id:  at.device_id,
          confidence: at.confidence
        }
      })
    });
  })
  .then(function(r) { return r.json(); })

  // 5) AES-256-GCM decrypt
  .then(function(data) {
    if (!data || !data.playback) throw new Error('playback yok');
    var pb = data.playback;
    var kp = pb.key_parts;
    if (!kp || kp.length < 2) throw new Error('key_parts eksik');
    var k0 = b64urlToBytes(kp[0]);
    var k1 = b64urlToBytes(kp[1]);
    var key = new Uint8Array(k0.length + k1.length);
    key.set(k0); key.set(k1, k0.length);
    return aesGcmDecrypt(key, b64urlToBytes(pb.iv), b64urlToBytes(pb.payload));
  })

  // 6) Parse sources → m3u8 URL
  .then(function(plain) {
    var parsed;
    try { parsed = JSON.parse(plain); } catch(e) { throw new Error('JSON parse hata'); }
    var sources = parsed.sources || [];
    if (!sources.length) throw new Error('sources boş');
    // 1080p tercih et
    var best = sources[0];
    for (var i = 0; i < sources.length; i++) {
      if ((sources[i].label || '').indexOf('1080') !== -1 || (sources[i].height || 0) >= 1080) {
        best = sources[i]; break;
      }
    }
    var url = best.url || '';
    if (!url) throw new Error('url boş');
    console.log('[WebteIzle] FileMoon ✓ ' + url.slice(0, 80));
    return { url: url, type: 'hls', referer: 'https://' + FM_DOMAIN + '/' };
  })
  .catch(function(e) {
    console.error('[WebteIzle] FileMoon hata:', e.message);
    return null;
  });
}

// ═══════════════════════════════════════════════════════════
//  PROVIDER: Mail.ru (Meta API → direct MP4)
// ═══════════════════════════════════════════════════════════
function extractMailRu(videoId) {
  var parts = videoId.split('/');
  if (parts.length < 3) return Promise.resolve(null);
  var mobileUrl = 'https://m.my.mail.ru/' + parts[0] + '/' + parts[1]
                + '/video/' + parts.slice(2).join('/') + '.html?from=videoplayer';
  var mrH = {
    'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.7',
    'Referer':         BASE_URL + '/'
  };
  return fetch(mobileUrl, { headers: mrH })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var metaM = html.match(/data-meta-url="([^"]+)"/);
      if (!metaM) { console.error('[WebteIzle] MailRu: data-meta-url yok'); return null; }
      return fetch(metaM[1], {
        headers: { 'User-Agent': mrH['User-Agent'], 'Accept': 'application/json,*/*', 'Referer': mobileUrl }
      })
      .then(function(r2) { return r2.json(); })
      .then(function(meta) {
        var videos = meta.videos || [];
        if (!videos.length) { console.error('[WebteIzle] MailRu: videos boş'); return null; }
        var raw = videos[0].url || '';
        if (!raw) return null;
        if (raw.startsWith('//')) raw = 'https:' + raw;
        console.log('[WebteIzle] MailRu ✓ ' + raw.slice(0, 80));
        return { url: raw, type: 'direct', referer: 'https://my.mail.ru/' };
      });
    })
    .catch(function(e) { console.error('[WebteIzle] MailRu hata:', e.message); return null; });
}

// ═══════════════════════════════════════════════════════════
//  EMBED İŞLEYİCİ
// ═══════════════════════════════════════════════════════════
function processEmbed(embedData, dilAd, movieTitle) {
  var baslik = (embedData.baslik || '').toLowerCase();
  if (baslik === 'pixel' || baslik === 'netu') return Promise.resolve(null);

  var flag     = dilAd.includes('Dublaj') ? '🇹🇷 ' : '🌐 ';
  var q        = (embedData.kalitesi === 1) ? '1080p' : (embedData.kalite || 'Auto');

  return fetchEmbedData(embedData.id).then(function(embed) {
    if (!embed) return null;
    var titleStr = '⌜ WEBTEIZLE ⌟ | ' + (embedData.baslik || 'Kaynak') + ' | ' + flag + dilAd;

    if (embed.type === 'vidmoly') {
      return extractVidMoly(embed.videoId).then(function(s) {
        if (!s) return null;
        return { url: s.url, name: movieTitle, title: titleStr, quality: q,
                 type: 'hls', headers: { 'Referer': s.referer } };
      });
    }

    if (embed.type === 'filemoon') {
      return extractFileMoon(embed.videoId, embed.iframeSrc).then(function(s) {
        if (!s) return null;
        return { url: s.url, name: movieTitle, title: titleStr, quality: q,
                 type: 'hls', headers: { 'Referer': s.referer } };
      });
    }

    if (embed.type === 'mailru') {
      return extractMailRu(embed.videoId).then(function(s) {
        if (!s) return null;
        return { url: s.url, name: movieTitle, title: titleStr, quality: q,
                 type: s.type, headers: { 'Referer': s.referer, 'Origin': 'https://my.mail.ru' } };
      });
    }

    if (embed.type === 'iframe' && embed.url) {
      var src = embed.url.startsWith('//') ? 'https:' + embed.url : embed.url;
      return fetch(src, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
        .then(function(r) { return r.text(); })
        .then(function(html) {
          var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
          if (!m) return null;
          return { url: m[1], name: movieTitle, title: titleStr, quality: q,
                   type: 'hls', headers: { 'Referer': src } };
        })
        .catch(function() { return null; });
    }

    return null;
  });
}

// ═══════════════════════════════════════════════════════════
//  ANA FONKSİYON
// ═══════════════════════════════════════════════════════════
function getStreams(tmdbId, mediaType, season, episode) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var movieName = info.titleTr || info.titleEn;
      return findFilmPage(info.titleTr, info.titleEn, mediaType, season, episode)
        .then(function(result) {
          var filmId = parseFilmId(result.html);
          if (!filmId) throw new Error('Film ID bulunamadi');
          var diller  = parseDilList(result.html, result.url);
          var streams = [];
          return Promise.all(diller.map(function(d) {
            return fetchAlternatifler(filmId, d.dil, season, episode)
              .then(function(list) {
                return Promise.all(list.map(function(e) {
                  return processEmbed(e, d.ad, movieName);
                }));
              })
              .then(function(results) {
                results.forEach(function(s) { if (s) streams.push(s); });
              });
          })).then(function() { return streams; });
        });
    })
    .catch(function(e) {
      console.error('[WebteIzle] hata:', e.message || e);
      return [];
    });
}

module.exports = { getStreams: getStreams };
