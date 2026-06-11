/**
 * CizgiMax — Nuvio Provider (Yeni API)
 * Site yenilendi - artık kendi API'si var
 *
 * Akış:
 *  1. /api/search/suggest/?q= → dizi bul (animes[].url)
 *  2. /slug-X-sezon-Y-bolum-izle/ → bölüm sayfası → data-ep-id al
 *  3. /api/stream/sibnet/?t=TOKEN → 302 → mp4 URL
 *     Token bölüm sayfasındaki script'ten geliyor
 */

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';
var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};
var JSON_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Accept':          'application/json',
  'Referer':         MAIN_URL + '/'
};

// ── Yardımcılar ───────────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/\u011f/g,'g').replace(/\u00fc/g,'u').replace(/\u015f/g,'s')
    .replace(/\u0131/g,'i').replace(/\u0130/g,'i').replace(/\u00f6/g,'o').replace(/\u00e7/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/tv/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title:   d.name || d.original_name || '',
        titleTr: d.name || '',
        titleEn: d.original_name || ''
      };
    });
}

// ── Arama ─────────────────────────────────────────────────────
// GET /api/search/suggest/?q=QUERY
// Response: { animes: [{ name, url, kind }] }

function searchCizgiMax(query) {
  return fetch(MAIN_URL + '/api/search/suggest/?q=' + encodeURIComponent(query), {
    headers: JSON_HEADERS
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      // Sadece dizi/cizgi-film türlerini al, film değil
      return (d.animes || []).filter(function(x) {
        return x.kind !== 'film';
      });
    })
    .catch(function() { return []; });
}

function findBest(items, titleEn, titleTr) {
  var ne = normalize(titleEn), nt = normalize(titleTr);
  var best = null, bestScore = 0;
  items.forEach(function(x) {
    var n = normalize(x.name || '');
    var score = (n === ne || n === nt) ? 100
              : (n.indexOf(ne) !== -1 || ne.indexOf(n) !== -1) ? 70
              : (n.indexOf(nt) !== -1 || nt.indexOf(n) !== -1) ? 70 : 0;
    if (score > bestScore) { bestScore = score; best = x; }
  });
  return bestScore >= 60 ? best : null;
}

// ── Bölüm URL oluştur ─────────────────────────────────────────
// Dizi URL'i: /diziler/regular-show-izle/
// Bölüm URL'i: /regular-show-1-sezon-1-bolum-izle/
// Slug'u dizilers URL'inden çıkar: /diziler/SLUG-izle/ → SLUG

function buildEpisodeUrl(diziUrl, season, episode) {
  // /diziler/regular-show-izle/ → regular-show
  var m = diziUrl.match(/\/diziler\/(.+?)-izle\//);
  if (!m) return null;
  var slug = m[1];
  return MAIN_URL + '/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
}

// ── Bölüm sayfasından stream token al ────────────────────────
// Sayfada data-ep-id var, ve script içinde stream token

function fetchStreamUrl(epUrl) {
  return fetch(epUrl, { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function(html) {
      // Yöntem 1: art-video src="/api/stream/sibnet/?t=TOKEN" (HTML'de statik geliyor)
      // veya /api/stream/sibnet/?t=TOKEN herhangi bir yerde
      var tokenM = html.match(/art-video[^>]+src="[^"]*\/api\/stream\/sibnet\/\?t=([A-Za-z0-9._\-]+)"/)
                || html.match(/<video[^>]+src="[^"]*\/api\/stream\/sibnet\/\?t=([A-Za-z0-9._\-]+)"/)
                || html.match(/\/api\/stream\/sibnet\/\?t=([A-Za-z0-9._\-]+)/);
      if (tokenM) {
        // Token URL direkt MP4 stream veriyor (206 Partial Content) — redirect yok
        var streamUrl = MAIN_URL + '/api/stream/sibnet/?t=' + tokenM[1];
        return {
          url:      streamUrl,
          quality:  'Auto',
          headers:  { 'Referer': epUrl },
          provider: 'CizgiMax'
        };
      }

      // Yöntem 2: data-ep-id al, sonra stream API çağır
      var epIdM = html.match(/data-ep-id="(\d+)"/);
      if (!epIdM) {
        // active ep-num-btn'dan al
        epIdM = html.match(/ep-num-btn active[^>]*data-ep-id="(\d+)"/);
      }
      if (!epIdM) {
        // class active olan linkte ara
        epIdM = html.match(/class="ep-num-btn active"[^>]*data-ep-id="(\d+)"/);
        if (!epIdM) epIdM = html.match(/ep-num-btn[^>]*active[^>]*data-ep-id="(\d+)"/);
      }

      if (epIdM) {
        var epId = epIdM[1];
        return fetchStreamByEpId(epId, epUrl);
      }

      // Yöntem 3: cizgipass embed
      var embedM = html.match(/data-frame="(https?:\/\/cizgipass[^"]+)"/i);
      if (embedM) {
        return fetchCizgiPass(embedM[1]);
      }

      return null;
    });
}

// Sibnet stream URL'ini çöz (302 redirect)
function resolveStream(streamUrl, referer) {
  return fetch(streamUrl, {
    headers: Object.assign({}, HEADERS, {
      'Referer': referer || MAIN_URL + '/',
      'Accept':  '*/*'
    }),
    redirect: 'manual'
  })
    .then(function(r) {
      // 302 redirect → Location header
      var loc = r.headers.get('location') || r.headers.get('Location');
      if (loc) {
        return {
          url:      loc,
          quality:  'Auto',
          headers:  { 'Referer': MAIN_URL + '/' },
          provider: 'Sibnet'
        };
      }
      // 200 ise direkt URL
      if (r.ok) {
        return {
          url:      streamUrl,
          quality:  'Auto',
          headers:  { 'Referer': MAIN_URL + '/' },
          provider: 'Sibnet'
        };
      }
      return null;
    })
    .catch(function() {
      // redirect: manual desteklenmiyorsa normal fetch dene
      return fetch(streamUrl, {
        headers: Object.assign({}, HEADERS, {
          'Referer': referer || MAIN_URL + '/',
          'Accept':  '*/*'
        })
      }).then(function(r) {
        // Final URL
        var finalUrl = r.url || streamUrl;
        if (finalUrl.indexOf('.mp4') !== -1 || finalUrl.indexOf('sibnet') !== -1) {
          return {
            url:      finalUrl,
            quality:  'Auto',
            headers:  { 'Referer': MAIN_URL + '/' },
            provider: 'Sibnet'
          };
        }
        return null;
      }).catch(function() { return null; });
    });
}

// Episode ID ile stream API çağır
function fetchStreamByEpId(epId, epUrl) {
  // skip-times API'si çağrılıyor (site bunu yapıyor)
  // ama stream token'ı farklı endpoint'ten geliyor
  // Direkt stream URL'ini dene: /api/stream/sibnet/?ep_id=ID gibi
  var streamUrl = MAIN_URL + '/api/stream/sibnet/?ep_id=' + epId;
  return resolveStream(streamUrl, epUrl)
    .then(function(result) {
      if (result) return result;
      // Alternatif: skip-times endpoint'inden token al
      return fetch(MAIN_URL + '/api/skip-times/' + epId + '/', {
        headers: JSON_HEADERS
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          // skip-times'da stream token olabilir
          if (d.stream_token || d.token) {
            var t = d.stream_token || d.token;
            return resolveStream(MAIN_URL + '/api/stream/sibnet/?t=' + t, epUrl);
          }
          return null;
        })
        .catch(function() { return null; });
    });
}

// ── CizgiPass extractor ───────────────────────────────────────
// (Bazı bölümlerde hala cizgipass kullanılıyor olabilir)

function _b64decode(str) {
  try { if (typeof atob === 'function') return atob(str); } catch(e) {}
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var result = '', i = 0;
  str = str.replace(/[^A-Za-z0-9+/]/g, '');
  while (i < str.length) {
    var a=chars.indexOf(str[i++]),b=chars.indexOf(str[i++]),c=chars.indexOf(str[i++]),d=chars.indexOf(str[i++]);
    var n=(a<<18)|(b<<12)|((c&63)<<6)|(d&63);
    result+=String.fromCharCode((n>>16)&255);
    if(c!==64)result+=String.fromCharCode((n>>8)&255);
    if(d!==64)result+=String.fromCharCode(n&255);
  }
  return result;
}

var _SB=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
var _SBI=(function(){var t=new Array(256);_SB.forEach(function(v,i){t[v]=i;});return t;})();
var _RC=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77,154,47,94,188,99,198,151,53,106,212,179,125,250,239,197,145];
function _gm(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var h=a&0x80;a=(a<<1)&0xFF;if(h)a^=0x1B;b>>=1;}return p;}
function _kx(key){var nk=key.length/4,nr=nk+6,w=[];for(var i=0;i<nk;i++)w[i]=[key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]];for(var i=nk;i<4*(nr+1);i++){var t=w[i-1].slice();if(i%nk===0){t=[_SB[t[1]]^_RC[i/nk],_SB[t[2]],_SB[t[3]],_SB[t[0]]];}else if(nk>6&&i%nk===4){t=t.map(function(b){return _SB[b];});}w[i]=w[i-nk].map(function(b,j){return b^t[j];});}return w;}
function _ark(s,rk){return s.map(function(b,i){return b^rk[i>>2][i&3];});}
function _isr(s){return[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];}
function _isb(s){return s.map(function(b){return _SBI[b];});}
function _imc(s){var r=new Array(16);for(var c=0;c<4;c++){var i=c*4,a=s[i],b=s[i+1],cc=s[i+2],d=s[i+3];r[i]=_gm(a,14)^_gm(b,11)^_gm(cc,13)^_gm(d,9);r[i+1]=_gm(a,9)^_gm(b,14)^_gm(cc,11)^_gm(d,13);r[i+2]=_gm(a,13)^_gm(b,9)^_gm(cc,14)^_gm(d,11);r[i+3]=_gm(a,11)^_gm(b,13)^_gm(cc,9)^_gm(d,14);}return r;}
function _adb(bl,w,nr){var s=_ark(bl.slice(),w.slice(nr*4,(nr+1)*4));for(var r=nr-1;r>0;r--)s=_imc(_ark(_isb(_isr(s)),w.slice(r*4,(r+1)*4)));return _ark(_isb(_isr(s)),w.slice(0,4));}
function _acbc(key,iv,ct){var nr=key.length/4+6,w=_kx(key),out=[],prev=iv.slice();for(var i=0;i<ct.length;i+=16){var bl=ct.slice(i,i+16),dec=_adb(bl,w,nr);for(var j=0;j<16;j++)out.push(dec[j]^prev[j]);prev=bl;}var p=out[out.length-1];return out.slice(0,out.length-p);}
function _md5(input){
  function sa(x,y){var l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|(l&0xFFFF);}
  function rol(x,c){return(x<<c)|(x>>>(32-c));}
  function F(x,y,z){return(x&y)|(~x&z);}function G(x,y,z){return(x&z)|(y&~z);}
  function H(x,y,z){return x^y^z;}function I(x,y,z){return y^(x|~z);}
  function XX(f,a,b,c,d,x,s,t){return sa(rol(sa(sa(a,f(b,c,d)),sa(x,t)),s),b);}
  var len=input.length,nb=Math.ceil((len+9)/64),M=new Array(nb*16);
  for(var _i=0;_i<M.length;_i++)M[_i]=0;
  for(var i=0;i<len;i++)M[i>>2]|=input[i]<<((i&3)<<3);
  M[len>>2]|=0x80<<((len&3)<<3);M[M.length-2]=len<<3;M[M.length-1]=len>>>29;
  var a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;
  for(var i=0;i<M.length;i+=16){
    var aa=a,bb=b,cc=c,dd=d;
    a=XX(F,a,b,c,d,M[i],7,-680876936);d=XX(F,d,a,b,c,M[i+1],12,-389564586);c=XX(F,c,d,a,b,M[i+2],17,606105819);b=XX(F,b,c,d,a,M[i+3],22,-1044525330);
    a=XX(F,a,b,c,d,M[i+4],7,-176418897);d=XX(F,d,a,b,c,M[i+5],12,1200080426);c=XX(F,c,d,a,b,M[i+6],17,-1473231341);b=XX(F,b,c,d,a,M[i+7],22,-45705983);
    a=XX(F,a,b,c,d,M[i+8],7,1770035416);d=XX(F,d,a,b,c,M[i+9],12,-1958414417);c=XX(F,c,d,a,b,M[i+10],17,-42063);b=XX(F,b,c,d,a,M[i+11],22,-1990404162);
    a=XX(F,a,b,c,d,M[i+12],7,1804603682);d=XX(F,d,a,b,c,M[i+13],12,-40341101);c=XX(F,c,d,a,b,M[i+14],17,-1502002290);b=XX(F,b,c,d,a,M[i+15],22,1236535329);
    a=XX(G,a,b,c,d,M[i+1],5,-165796510);d=XX(G,d,a,b,c,M[i+6],9,-1069501632);c=XX(G,c,d,a,b,M[i+11],14,643717713);b=XX(G,b,c,d,a,M[i],20,-373897302);
    a=XX(G,a,b,c,d,M[i+5],5,-701558691);d=XX(G,d,a,b,c,M[i+10],9,38016083);c=XX(G,c,d,a,b,M[i+15],14,-660478335);b=XX(G,b,c,d,a,M[i+4],20,-405537848);
    a=XX(G,a,b,c,d,M[i+9],5,568446438);d=XX(G,d,a,b,c,M[i+14],9,-1019803690);c=XX(G,c,d,a,b,M[i+3],14,-187363961);b=XX(G,b,c,d,a,M[i+8],20,1163531501);
    a=XX(G,a,b,c,d,M[i+13],5,-1444681467);d=XX(G,d,a,b,c,M[i+2],9,-51403784);c=XX(G,c,d,a,b,M[i+7],14,1735328473);b=XX(G,b,c,d,a,M[i+12],20,-1926607734);
    a=XX(H,a,b,c,d,M[i+5],4,-378558);d=XX(H,d,a,b,c,M[i+8],11,-2022574463);c=XX(H,c,d,a,b,M[i+11],16,1839030562);b=XX(H,b,c,d,a,M[i+14],23,-35309556);
    a=XX(H,a,b,c,d,M[i+1],4,-1530992060);d=XX(H,d,a,b,c,M[i+4],11,1272893353);c=XX(H,c,d,a,b,M[i+7],16,-155497632);b=XX(H,b,c,d,a,M[i+10],23,-1094730640);
    a=XX(H,a,b,c,d,M[i+13],4,681279174);d=XX(H,d,a,b,c,M[i],11,-358537222);c=XX(H,c,d,a,b,M[i+3],16,-722521979);b=XX(H,b,c,d,a,M[i+6],23,76029189);
    a=XX(H,a,b,c,d,M[i+9],4,-640364487);d=XX(H,d,a,b,c,M[i+12],11,-421815835);c=XX(H,c,d,a,b,M[i+15],16,530742520);b=XX(H,b,c,d,a,M[i+2],23,-995338651);
    a=XX(I,a,b,c,d,M[i],6,-198630844);d=XX(I,d,a,b,c,M[i+7],10,1126891415);c=XX(I,c,d,a,b,M[i+14],15,-1416354905);b=XX(I,b,c,d,a,M[i+5],21,-57434055);
    a=XX(I,a,b,c,d,M[i+12],6,1700485571);d=XX(I,d,a,b,c,M[i+3],10,-1894986606);c=XX(I,c,d,a,b,M[i+10],15,-1051523);b=XX(I,b,c,d,a,M[i+1],21,-2054922799);
    a=XX(I,a,b,c,d,M[i+8],6,1873313359);d=XX(I,d,a,b,c,M[i+15],10,-30611744);c=XX(I,c,d,a,b,M[i+6],15,-1560198380);b=XX(I,b,c,d,a,M[i+13],21,1309151649);
    a=XX(I,a,b,c,d,M[i+4],6,-145523070);d=XX(I,d,a,b,c,M[i+11],10,-1120210379);c=XX(I,c,d,a,b,M[i+2],15,718787259);b=XX(I,b,c,d,a,M[i+9],21,-343485551);
    a=sa(a,aa);b=sa(b,bb);c=sa(c,cc);d=sa(d,dd);
  }
  var out=[];[a,b,c,d].forEach(function(x){out.push(x&0xFF,(x>>>8)&0xFF,(x>>>16)&0xFF,(x>>>24)&0xFF);});
  return out;
}
function _evp(pass,saltHex){
  var p=[],s=[];
  for(var i=0;i<pass.length;i++)p.push(pass.charCodeAt(i));
  if(saltHex)for(var i=0;i<saltHex.length;i+=2)s.push(parseInt(saltHex.slice(i,i+2),16));
  function cat(){var r=[];for(var a=0;a<arguments.length;a++)for(var b=0;b<arguments[a].length;b++)r.push(arguments[a][b]);return r;}
  var d0=_md5(cat(p,s)),d1=_md5(cat(d0,p,s));
  return {key:cat(d0,d1)};
}

function fetchCizgiPass(embedUrl) {
  return fetch(embedUrl, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      'Referer':    MAIN_URL + '/',
      'Accept':     'text/html,application/xhtml+xml'
    }
  })
    .then(function(r) { if (!r.ok) return null; return r.text(); })
    .then(function(html) {
      if (!html) return null;
      var m = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']*"ct"[^']*\})'\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]*"ct"[^"]*\})"\s*\)/);
      if (!m) return null;
      try {
        var parsed = JSON.parse(m[2]);
        var raw = _b64decode(parsed.ct), ct = [];
        for (var i=0;i<raw.length;i++) ct.push(raw.charCodeAt(i));
        var iv = []; for (var i=0;i<32;i+=2) iv.push(parseInt(parsed.iv.slice(i,i+2),16));
        var d = _evp(m[1], parsed.s||'');
        var plain = _acbc(d.key,iv,ct), text = '';
        for (var i=0;i<plain.length;i++) text+=String.fromCharCode(plain[i]);
        var data = JSON.parse(text);
        var url = data.video_location || data.file || data.src;
        if (!url) return null;
        if (url.indexOf('/') === 0) url = 'https://cizgipass100.online' + url;
        return { url: url, quality: 'HD', headers: { 'Referer': MAIN_URL + '/' }, provider: 'CizgiPass' };
      } catch(e) { return null; }
    })
    .catch(function() { return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  var sNum = parseInt(seasonNum) || 1;
  var eNum = parseInt(episodeNum) || 1;

  return fetchTmdbInfo(tmdbId)
  .then(function(info) {
    // İngilizce ile ara, bulamazsa Türkçe
    return searchCizgiMax(info.titleEn || info.titleTr)
    .then(function(r1) {
      var best = findBest(r1, info.titleEn, info.titleTr);
      if (best) return best;
      return searchCizgiMax(info.titleTr)
      .then(function(r2) { return findBest(r2, info.titleEn, info.titleTr); });
    })
    .then(function(best) {
      if (!best) return [];

      // Dizi URL'inden bölüm URL'i oluştur
      var diziUrl = best.url.indexOf('http') === 0 ? best.url : MAIN_URL + best.url;
      var epUrl = buildEpisodeUrl(diziUrl, sNum, eNum);
      if (!epUrl) return [];

      // Stream URL'ini çek
      return fetchStreamUrl(epUrl)
      .then(function(stream) {
        if (!stream || !stream.url) return [];
        return [{
          name:    info.title,
          title:   '\u231c C\u0130ZG\u0130MAX \u231d | ' + stream.provider + ' | ' + (stream.quality || 'Auto'),
          url:     stream.url,
          quality: stream.quality || 'Auto',
          headers: stream.headers || {}
        }];
      });
    });
  })
  .catch(function() { return []; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
