// ============================================================
//  CizgiMax — Nuvio Provider
// ============================================================

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
};

// ── Saf JS AES-256-CBC ────────────────────────────────────────
// require() veya crypto.subtle kullanmaz — her JS ortamında çalışır

var _SBOX = [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
var _SBOX_INV = (function(){ var t = new Array(256); _SBOX.forEach(function(v,i){ t[v]=i; }); return t; })();
var _RCON = [0,1,2,4,8,16,32,64,128,27,54,108,216,171,77,154,47,94,188,99,198,151,53,106,212,179,125,250,239,197,145,57,114,228,211,189,97,194,159,37,74,148,51,102,204,131,29,58,116,232,203,141,9,18,36,72,144,55,110,220,163,77,154,47];

function _gmul(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hb = a & 0x80;
    a = (a << 1) & 0xFF;
    if (hb) a ^= 0x1B;
    b >>= 1;
  }
  return p;
}

function _keyExpansion(key) {
  var nk = key.length / 4, nr = nk + 6, w = [];
  for (var i = 0; i < nk; i++)
    w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
  for (var i = nk; i < 4*(nr+1); i++) {
    var temp = w[i-1].slice();
    if (i % nk === 0) {
      temp = [_SBOX[temp[1]] ^ _RCON[i/nk], _SBOX[temp[2]], _SBOX[temp[3]], _SBOX[temp[0]]];
    } else if (nk > 6 && i % nk === 4) {
      temp = temp.map(function(b){ return _SBOX[b]; });
    }
    w[i] = w[i-nk].map(function(b, j){ return b ^ temp[j]; });
  }
  return w;
}

function _addRoundKey(s, rk) {
  return s.map(function(b, i){ return b ^ rk[i>>2][i&3]; });
}

function _invShiftRows(s) {
  return [s[0],s[13],s[10],s[7], s[4],s[1],s[14],s[11], s[8],s[5],s[2],s[15], s[12],s[9],s[6],s[3]];
}

function _invSubBytes(s) {
  return s.map(function(b){ return _SBOX_INV[b]; });
}

function _invMixCols(s) {
  var r = new Array(16);
  for (var c = 0; c < 4; c++) {
    var i = c*4, a = s[i], b = s[i+1], cc = s[i+2], d = s[i+3];
    r[i]   = _gmul(a,14) ^ _gmul(b,11) ^ _gmul(cc,13) ^ _gmul(d,9);
    r[i+1] = _gmul(a,9)  ^ _gmul(b,14) ^ _gmul(cc,11) ^ _gmul(d,13);
    r[i+2] = _gmul(a,13) ^ _gmul(b,9)  ^ _gmul(cc,14) ^ _gmul(d,11);
    r[i+3] = _gmul(a,11) ^ _gmul(b,13) ^ _gmul(cc,9)  ^ _gmul(d,14);
  }
  return r;
}

function _aesDecryptBlock(block, w, nr) {
  var s = _addRoundKey(block.slice(), w.slice(nr*4, (nr+1)*4));
  for (var r = nr-1; r > 0; r--)
    s = _invMixCols(_addRoundKey(_invSubBytes(_invShiftRows(s)), w.slice(r*4, (r+1)*4)));
  return _addRoundKey(_invSubBytes(_invShiftRows(s)), w.slice(0, 4));
}

function _aesCbcDecrypt(key, iv, ciphertext) {
  var nr = key.length/4 + 6;
  var w  = _keyExpansion(key);
  var out = [], prev = iv.slice();
  for (var i = 0; i < ciphertext.length; i += 16) {
    var block = ciphertext.slice(i, i+16);
    var dec   = _aesDecryptBlock(block, w, nr);
    for (var j = 0; j < 16; j++) out.push(dec[j] ^ prev[j]);
    prev = block;
  }
  var pad = out[out.length - 1];
  return out.slice(0, out.length - pad);
}

// ── Saf JS MD5 ────────────────────────────────────────────────
function _md5(data) {
  function sa(x,y){var l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|(l&0xFFFF);}
  function rol(n,s){return n<<s|n>>>(32-s);}
  function cmn(q,a,b,x,s,t){return sa(rol(sa(sa(a,q),sa(x,t)),s),b);}
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|(~b&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&~d),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|~d),a,b,x,s,t);}
  var len=data.length, words=[];
  for(var i=0;i<((len+72>>6)<<4)+16;i++) words[i]=0;
  for(var i=0;i<len;i++) words[i>>2]|=data[i]<<(i%4*8);
  words[len>>2]|=0x80<<(len%4*8);
  words[((len+72>>6)<<4)+14]=len*8;
  var a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;
  for(var i=0;i<words.length;i+=16){
    var A=a,B=b,C=c,D=d;
    a=ff(a,b,c,d,words[i+0],7,-680876936);   b=ff(d,a,b,c,words[i+1],12,-389564586);
    c=ff(c,d,a,b,words[i+2],17,606105819);   d=ff(b,c,d,a,words[i+3],22,-1044525330);
    a=ff(a,b,c,d,words[i+4],7,-176418897);   b=ff(d,a,b,c,words[i+5],12,1200080426);
    c=ff(c,d,a,b,words[i+6],17,-1473231341); d=ff(b,c,d,a,words[i+7],22,-45705983);
    a=ff(a,b,c,d,words[i+8],7,1770035416);   b=ff(d,a,b,c,words[i+9],12,-1958414417);
    c=ff(c,d,a,b,words[i+10],17,-42063);     d=ff(b,c,d,a,words[i+11],22,-1990404162);
    a=ff(a,b,c,d,words[i+12],7,1804603682);  b=ff(d,a,b,c,words[i+13],12,-40341101);
    c=ff(c,d,a,b,words[i+14],17,-1502002290);d=ff(b,c,d,a,words[i+15],22,1236535329);
    a=gg(a,b,c,d,words[i+1],5,-165796510);   b=gg(d,a,b,c,words[i+6],9,-1069501632);
    c=gg(c,d,a,b,words[i+11],14,643717713);  d=gg(b,c,d,a,words[i+0],20,-373897302);
    a=gg(a,b,c,d,words[i+5],5,-701558691);   b=gg(d,a,b,c,words[i+10],9,38016083);
    c=gg(c,d,a,b,words[i+15],14,-660478335); d=gg(b,c,d,a,words[i+4],20,-405537848);
    a=gg(a,b,c,d,words[i+9],5,568446438);    b=gg(d,a,b,c,words[i+14],9,-1019803690);
    c=gg(c,d,a,b,words[i+3],14,-187363961);  d=gg(b,c,d,a,words[i+8],20,1163531501);
    a=gg(a,b,c,d,words[i+13],5,-1444681467); b=gg(d,a,b,c,words[i+2],9,-51403784);
    c=gg(c,d,a,b,words[i+7],14,1735328473);  d=gg(b,c,d,a,words[i+12],20,-1926607734);
    a=hh(a,b,c,d,words[i+5],4,-378558);      b=hh(d,a,b,c,words[i+8],11,-2022574463);
    c=hh(c,d,a,b,words[i+11],16,1839030562); d=hh(b,c,d,a,words[i+14],23,-35309556);
    a=hh(a,b,c,d,words[i+1],4,-1530992060);  b=hh(d,a,b,c,words[i+4],11,1272893353);
    c=hh(c,d,a,b,words[i+7],16,-155497632);  d=hh(b,c,d,a,words[i+10],23,-1094730640);
    a=hh(a,b,c,d,words[i+13],4,681279174);   b=hh(d,a,b,c,words[i+0],11,-358537222);
    c=hh(c,d,a,b,words[i+3],16,-722521979);  d=hh(b,c,d,a,words[i+6],23,76029189);
    a=hh(a,b,c,d,words[i+9],4,-640364487);   b=hh(d,a,b,c,words[i+12],11,-421815835);
    c=hh(c,d,a,b,words[i+15],16,530742520);  d=hh(b,c,d,a,words[i+2],23,-995338651);
    a=ii(a,b,c,d,words[i+0],6,-198630844);   b=ii(d,a,b,c,words[i+7],10,1126891415);
    c=ii(c,d,a,b,words[i+14],15,-1416354905);d=ii(b,c,d,a,words[i+5],21,-57434055);
    a=ii(a,b,c,d,words[i+12],6,1700485571);  b=ii(d,a,b,c,words[i+3],10,-1894986606);
    c=ii(c,d,a,b,words[i+10],15,-1051523);   d=ii(b,c,d,a,words[i+1],21,-2054922799);
    a=ii(a,b,c,d,words[i+8],6,1873313359);   b=ii(d,a,b,c,words[i+15],10,-30611744);
    c=ii(c,d,a,b,words[i+6],15,-1560198380); d=ii(b,c,d,a,words[i+13],21,1309151649);
    a=ii(a,b,c,d,words[i+4],6,-145523070);   b=ii(d,a,b,c,words[i+11],10,-1120210379);
    c=ii(c,d,a,b,words[i+2],15,718787259);   d=ii(b,c,d,a,words[i+9],21,-343485551);
    a=sa(a,A);b=sa(b,B);c=sa(c,C);d=sa(d,D);
  }
  var out=new Array(16);
  for(var i=0;i<4;i++){out[i]=(a>>i*8)&0xFF;out[i+4]=(b>>i*8)&0xFF;out[i+8]=(c>>i*8)&0xFF;out[i+12]=(d>>i*8)&0xFF;}
  return out;
}

// ── OpenSSL EVP_BytesToKey (saf JS MD5) ───────────────────────
function _evpBytesToKey(password, saltHex) {
  var p = [];
  for (var i = 0; i < password.length; i++) p.push(password.charCodeAt(i));
  var s = [];
  if (saltHex) {
    for (var i = 0; i < saltHex.length; i += 2)
      s.push(parseInt(saltHex.slice(i, i+2), 16));
  }
  var cat = function() {
    var r = [];
    for (var i = 0; i < arguments.length; i++)
      r = r.concat(Array.prototype.slice.call(arguments[i]));
    return r;
  };
  var d0 = _md5(cat(p, s));
  var d1 = _md5(cat(d0, p, s));
  var d2 = _md5(cat(d1, p, s));
  return { key: d0.concat(d1), iv: d2.slice(0, 16) };
}

// ── BePlayer AES-256-CBC Decrypt (saf JS) ────────────────────
function _bePlayerDecrypt(password, encryptedJson) {
  try {
    var parsed = JSON.parse(encryptedJson);

    // ct: base64 → byte array (atob kullan)
    var ctB64 = parsed.ct;
    var ctRaw = atob(ctB64);
    var ct    = [];
    for (var i = 0; i < ctRaw.length; i++) ct.push(ctRaw.charCodeAt(i));

    // iv: hex → byte array
    var iv = [];
    for (var i = 0; i < 32; i += 2) iv.push(parseInt(parsed.iv.slice(i, i+2), 16));

    // key türet
    var derived = _evpBytesToKey(password, parsed.s || '');

    // Decrypt
    var plainBytes = _aesCbcDecrypt(derived.key, iv, ct);
    var text = '';
    for (var i = 0; i < plainBytes.length; i++)
      text += String.fromCharCode(plainBytes[i]);

    return { ok: true, data: JSON.parse(text) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Yardımcılar ───────────────────────────────────────────────
function _fixUrl(url) {
  if (!url) return '';
  url = url.trim();
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0)   return 'https:' + url;
  if (url.indexOf('/') === 0)    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

function _mergeCookies(response, existing) {
  var setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  var map = {};
  if (existing) {
    existing.split('; ').forEach(function(c) {
      var idx = c.indexOf('=');
      if (idx > 0) map[c.slice(0, idx).trim()] = c.slice(idx+1);
    });
  }
  setCookies.forEach(function(c) {
    var kv  = c.split(';')[0];
    var idx = kv.indexOf('=');
    if (idx > 0) map[kv.slice(0, idx).trim()] = kv.slice(idx+1);
  });
  return Object.keys(map).map(function(k){ return k+'='+map[k]; }).join('; ');
}

// ── TMDB ─────────────────────────────────────────────────────
function _fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/tv/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return { titleTr: d.name || '', titleEn: d.original_name || '' };
    });
}

// ── Arama ────────────────────────────────────────────────────
function _searchCizgiMax(query) {
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), {
    headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return ((data.data || {}).result || []).filter(function(item) {
        return !/(\.Bölüm|\.Sezon|-Sezon)/i.test(item.s_name || '');
      });
    })
    .catch(function() { return []; });
}

function _normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function _findBestMatch(items, titleEn, titleTr) {
  var nEn = _normalize(titleEn), nTr = _normalize(titleTr);
  var scored = items.map(function(item) {
    var n = _normalize(item.s_name || '');
    var s = 0;
    if (n === nEn || n === nTr)                               s = 100;
    else if (n.indexOf(nEn) !== -1 || nEn.indexOf(n) !== -1) s = 70;
    else if (n.indexOf(nTr) !== -1 || nTr.indexOf(n) !== -1) s = 70;
    return { item: item, score: s };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 60) ? scored[0].item : null;
}

// ── Sezon/Bölüm URL parse ─────────────────────────────────────
function _extractSE(url) {
  var sm = url.match(/-(\d+)-sezon-/i);
  var em = url.match(/-sezon-(\d+)-bolum/i);
  return {
    season:  sm ? parseInt(sm[1]) : 1,
    episode: em ? parseInt(em[1]) : 0
  };
}

// ── Dizi sayfasından bölüm listesi ────────────────────────────
function _fetchShowEpisodes(showUrl) {
  return fetch(showUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var episodes = [], seen = {}, re = /href="([^"]+)"/gi, m;
      while ((m = re.exec(html)) !== null) {
        var href = m[1].indexOf('http') === 0 ? m[1] : MAIN_URL + m[1];
        if (seen[href]) continue;
        if (href.indexOf('sezon') === -1 || href.indexOf('bolum') === -1) continue;
        seen[href] = true;
        var se = _extractSE(href);
        if (se.episode > 0) episodes.push({ season: se.season, episode: se.episode, url: href });
      }
      console.log('[CizgiMax] ' + episodes.length + ' bölüm');
      return episodes;
    });
}

// ── Bölüm sayfasından embed URL + ilk cookie ─────────────────
function _fetchEpisodeEmbed(epUrl) {
  return fetch(epUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var cookies = _mergeCookies(r, '');
    return r.text().then(function(html) {
      var m = html.match(/data-frame="(https?:\/\/cizgipass[^"]+)"/i)
           || html.match(/(https?:\/\/cizgipass\d*\.online\/embed\/[a-zA-Z0-9]+)/i);
      if (!m) throw new Error('Embed URL bulunamadı');
      return { embedUrl: m[1], cookies: cookies };
    });
  });
}

// ── Embed'den stream çek ──────────────────────────────────────
function _extractFromEmbed(embedUrl, cookies) {
  var label = '⌜ CİZGİMAX ⌟';

  return fetch(embedUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer':        MAIN_URL + '/',
      'Cookie':         cookies,
      'sec-fetch-dest': 'iframe',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'cross-site'
    })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('Embed HTTP ' + r.status);
      var newCookies = _mergeCookies(r, cookies);
      return r.text().then(function(html) { return { html: html, cookies: newCookies }; });
    })
    .then(function(res) {
      var html       = res.html;
      var newCookies = res.cookies;

      var m = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']*"ct"[^']*\})'\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]*"ct"[^"]*\})"\s*\)/);

      if (!m) { console.log('[CizgiMax] bePlayer bulunamadı'); return null; }

      var result = _bePlayerDecrypt(m[1], m[2]);
      if (!result.ok) { console.error('[CizgiMax] Decrypt:', result.error); return null; }

      var data     = result.data;
      var videoUrl = data.video_location || data.file || data.src;
      var subs     = [];

      (data.strSubtitles || []).forEach(function(sub) {
        if (sub.file && sub.label && sub.label.indexOf('Forced') === -1)
          subs.push({ label: sub.label.toUpperCase(), url: sub.file });
      });

      if (!videoUrl) { console.log('[CizgiMax] video_location yok'); return null; }
      if (videoUrl.indexOf('/') === 0) videoUrl = 'https://cizgipass100.online' + videoUrl;

      console.log('[CizgiMax] ✓ Stream: ' + videoUrl.slice(0, 80));

      return {
        url:       videoUrl,
        name:      label,
        title:     label + (subs.length ? ' | ' + subs.map(function(s){ return s.label; }).join('/') : ''),
        quality:   'Auto',
        type:      'hls',
        headers:   {
          'Referer': embedUrl,
          'Cookie':  newCookies,
          'Origin':  'https://cizgipass100.online'
        },
        subtitles: subs
      };
    })
    .catch(function(e) { console.error('[CizgiMax] extractFromEmbed:', e.message); return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  var sNum = parseInt(seasonNum) || 1;
  var eNum = parseInt(episodeNum) || 1;
  console.log('[CizgiMax] TMDB:' + tmdbId + ' S' + sNum + 'E' + eNum);

  return _fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
      console.log('[CizgiMax] "' + info.titleEn + '" / "' + info.titleTr + '"');

      return _searchCizgiMax(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = _findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return _searchCizgiMax(info.titleTr).then(function(r2) {
              return _findBestMatch(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) { console.log('[CizgiMax] Dizi bulunamadı'); return []; }

          var showUrl = best.s_link
            ? (best.s_link.indexOf('http') === 0 ? best.s_link : _fixUrl(best.s_link))
            : null;
          if (!showUrl) return [];
          console.log('[CizgiMax] Dizi: ' + best.s_name + ' → ' + showUrl);

          return _fetchShowEpisodes(showUrl)
            .then(function(episodes) {
              var matched = episodes.filter(function(ep) {
                return ep.season === sNum && ep.episode === eNum;
              });
              if (!matched.length)
                matched = episodes.filter(function(ep) { return ep.episode === eNum; });
              if (!matched.length) {
                console.log('[CizgiMax] S' + sNum + 'E' + eNum + ' bulunamadı');
                return [];
              }

              var epUrl = matched[0].url;
              console.log('[CizgiMax] Bölüm: ' + epUrl);

              return _fetchEpisodeEmbed(epUrl)
                .then(function(res) {
                  console.log('[CizgiMax] Embed: ' + res.embedUrl);
                  return _extractFromEmbed(res.embedUrl, res.cookies);
                })
                .then(function(stream) { return stream ? [stream] : []; });
            });
        });
    })
    .then(function(streams) {
      console.log('[CizgiMax] Toplam stream: ' + streams.length);
      return streams;
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
            
