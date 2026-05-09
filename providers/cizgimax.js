/**
 * CizgiMax — Nuvio Provider
 */

var MAIN_URL     = 'https://cizgimax.online';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         MAIN_URL + '/'
};

// ── Yardımcılar ───────────────────────────────────────────────

function fixUrl(url) {
  if (!url) return '';
  url = url.trim();
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0)   return 'https:' + url;
  if (url.indexOf('/') === 0)    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

function getHtml(url, extra) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extra || {}) })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
}

function mergeCookies(response, existing) {
  var sc = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  var map = {};
  if (existing) existing.split('; ').forEach(function(c) {
    var i = c.indexOf('='); if (i > 0) map[c.slice(0,i).trim()] = c.slice(i+1);
  });
  sc.forEach(function(c) {
    var kv = c.split(';')[0], i = kv.indexOf('=');
    if (i > 0) map[kv.slice(0,i).trim()] = kv.slice(i+1);
  });
  return Object.keys(map).map(function(k) { return k+'='+map[k]; }).join('; ');
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

// ── Arama ────────────────────────────────────────────────────

function searchCizgiMax(query) {
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), {
    headers: HEADERS
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return ((d.data || {}).result || []).filter(function(x) {
        return !/(\.Bölüm|\.Sezon|-Sezon)/i.test(x.s_name || '');
      });
    })
    .catch(function() { return []; });
}

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function findBest(items, en, tr) {
  var ne = normalize(en), nt = normalize(tr);
  var scored = items.map(function(x) {
    var n = normalize(x.s_name || '');
    var s = (n===ne||n===nt) ? 100 : (n.indexOf(ne)!==-1||ne.indexOf(n)!==-1||n.indexOf(nt)!==-1||nt.indexOf(n)!==-1) ? 70 : 0;
    return { x: x, s: s };
  });
  scored.sort(function(a,b){return b.s-a.s;});
  return scored.length && scored[0].s >= 60 ? scored[0].x : null;
}

// ── Bölüm URL parse ──────────────────────────────────────────
// Debug v3'te doğrulandı:
//   big-city-greens-1-sezon-1-bolum-izle  (İngilizce slug)
//   greenlerin-buyuksehir-maceralari-4-sezon-30-bolum (Türkçe slug)

function extractSE(url) {
  var sm = url.match(/-([0-9]+)-sezon-/i);
  var em = url.match(/-sezon-([0-9]+)-bolum/i);
  return { season: sm ? parseInt(sm[1]) : 1, episode: em ? parseInt(em[1]) : 0 };
}

function fetchEpisodeUrl(showUrl, sNum, eNum) {
  return getHtml(showUrl).then(function(html) {
    var seen = {}, episodes = [], re = /href="([^"]+)"/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1].indexOf('http') === 0 ? m[1] : MAIN_URL + m[1];
      if (seen[href] || href.indexOf('sezon') === -1 || href.indexOf('bolum') === -1) continue;
      seen[href] = true;
      var se = extractSE(href);
      if (se.episode > 0) episodes.push({ season: se.season, episode: se.episode, url: href });
    }
    console.log('[CizgiMax] ' + episodes.length + ' bölüm bulundu');

    var matched = episodes.filter(function(e) { return e.season === sNum && e.episode === eNum; });
    if (!matched.length) matched = episodes.filter(function(e) { return e.episode === eNum; });
    return matched.length ? matched[0].url : null;
  });
}

// ── Bölüm sayfasından player linklerini al ───────────────────
// data-frame → CizgiPass embed
// data-src   → Sibnet embed

function fetchPlayerLinks(epUrl) {
  return fetch(epUrl, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var cookies = mergeCookies(r, '');
      return r.text().then(function(html) {
        var links = [], seen = {};

        // MHT'den dogrulandı: her iki player da data-frame kullanıyor
        // sibnet.ru → Sibnet player
        // cizgipass  → CizgiPass/bePlayer
        var re = /data-frame="([^"]+)"/gi, m;
        while ((m = re.exec(html)) !== null) {
          var src = m[1].trim();
          // Tab veya boşluk temizle
          src = src.replace(/\s/g, '');
          if (!src) continue;
          src = src.indexOf('http') === 0 ? src : (src.indexOf('//') === 0 ? 'https:' + src : MAIN_URL + src);
          if (!seen[src]) {
            seen[src] = true;
            var type = src.indexOf('cizgipass') !== -1 ? 'cizgipass'
                     : src.indexOf('sibnet.ru') !== -1 ? 'sibnet'
                     : 'unknown';
            links.push({ url: src, type: type });
            console.log('[CizgiMax] link: ' + type + ' → ' + src.slice(0, 80));
          }
        }

        console.log('[CizgiMax] toplam ' + links.length + ' player linki');
        return { links: links, cookies: cookies };
      });
    });
}

// ── Sibnet extractor ──────────────────────────────────────────

function extractSibnet(url) {
  // data-frame bazen tab karakteri içerebilir, temizle
  url = url.replace(/\s/g, '');

  // Zaten shell.php URL'i mi? (CizgiMax'ta böyle geliyor)
  // ya da /v/ direkt mp4 mi?
  var shellUrl;
  if (url.indexOf('shell.php') !== -1) {
    shellUrl = url; // zaten shell.php
  } else if (url.indexOf('/v/') !== -1 && url.indexOf('.mp4') !== -1) {
    return Promise.resolve({
      url: url, type: 'direct',
      headers: { 'Referer': 'https://video.sibnet.ru/' },
      provider: 'Sibnet'
    });
  } else {
    var idM = url.match(/videoid=(\d+)/) || url.match(/\/video(\d+)/);
    if (!idM) return Promise.resolve(null);
    shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + idM[1];
  }

  return fetch(shellUrl, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      'Referer':    'https://video.sibnet.ru/',
      'Accept':     '*/*'
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i)
           || html.match(/file\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/i);
      if (!m) { console.log('[CizgiMax] Sibnet mp4 bulunamadı'); return null; }
      var videoUrl = m[1].indexOf('http') === 0 ? m[1] : 'https://video.sibnet.ru' + m[1];
      console.log('[CizgiMax] ✓ Sibnet: ' + videoUrl.slice(0, 80));
      return { url: videoUrl, type: 'direct', headers: { 'Referer': shellUrl }, provider: 'Sibnet' };
    })
    .catch(function(e) { console.error('[CizgiMax] Sibnet hata:', e.message); return null; });
}

// ── Saf JS AES-256-CBC ───────────────────────────────────────
// require() YOK, crypto.subtle YOK — her JS ortamında çalışır

var _SB = [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
var _SBI = (function(){ var t=new Array(256); _SB.forEach(function(v,i){t[v]=i;}); return t; })();
var _RC  = [0,1,2,4,8,16,32,64,128,27,54,108,216,171,77,154,47,94,188,99,198,151,53,106,212,179,125,250,239,197,145];

function _gm(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var h=a&0x80;a=(a<<1)&0xFF;if(h)a^=0x1B;b>>=1;}return p;}
function _kx(key){var nk=key.length/4,nr=nk+6,w=[];for(var i=0;i<nk;i++)w[i]=[key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]];for(var i=nk;i<4*(nr+1);i++){var t=w[i-1].slice();if(i%nk===0){t=[_SB[t[1]]^_RC[i/nk],_SB[t[2]],_SB[t[3]],_SB[t[0]]];}else if(nk>6&&i%nk===4){t=t.map(function(b){return _SB[b];});}w[i]=w[i-nk].map(function(b,j){return b^t[j];});}return w;}
function _ark(s,rk){return s.map(function(b,i){return b^rk[i>>2][i&3];});}
function _isr(s){return[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];}
function _isb(s){return s.map(function(b){return _SBI[b];});}
function _imc(s){var r=new Array(16);for(var c=0;c<4;c++){var i=c*4,a=s[i],b=s[i+1],cc=s[i+2],d=s[i+3];r[i]=_gm(a,14)^_gm(b,11)^_gm(cc,13)^_gm(d,9);r[i+1]=_gm(a,9)^_gm(b,14)^_gm(cc,11)^_gm(d,13);r[i+2]=_gm(a,13)^_gm(b,9)^_gm(cc,14)^_gm(d,11);r[i+3]=_gm(a,11)^_gm(b,13)^_gm(cc,9)^_gm(d,14);}return r;}
function _adb(bl,w,nr){var s=_ark(bl.slice(),w.slice(nr*4,(nr+1)*4));for(var r=nr-1;r>0;r--)s=_imc(_ark(_isb(_isr(s)),w.slice(r*4,(r+1)*4)));return _ark(_isb(_isr(s)),w.slice(0,4));}
function _acbc(key,iv,ct){var nr=key.length/4+6,w=_kx(key),out=[],prev=iv.slice();for(var i=0;i<ct.length;i+=16){var bl=ct.slice(i,i+16),dec=_adb(bl,w,nr);for(var j=0;j<16;j++)out.push(dec[j]^prev[j]);prev=bl;}var p=out[out.length-1];return out.slice(0,out.length-p);}

function _md5(data){
  function sa(x,y){var l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|(l&0xFFFF);}
  function rol(n,s){return n<<s|n>>>(32-s);}
  function cmn(q,a,b,x,s,t){return sa(rol(sa(sa(a,q),sa(x,t)),s),b);}
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|(~b&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&~d),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|~d),a,b,x,s,t);}
  var len=data.length,words=[];
  for(var i=0;i<((len+72>>6)<<4)+16;i++)words[i]=0;
  for(var i=0;i<len;i++)words[i>>2]|=data[i]<<(i%4*8);
  words[len>>2]|=0x80<<(len%4*8);words[((len+72>>6)<<4)+14]=len*8;
  var a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;
  for(var i=0;i<words.length;i+=16){var A=a,B=b,C=c,D=d;
    a=ff(a,b,c,d,words[i],7,-680876936);b=ff(d,a,b,c,words[i+1],12,-389564586);c=ff(c,d,a,b,words[i+2],17,606105819);d=ff(b,c,d,a,words[i+3],22,-1044525330);
    a=ff(a,b,c,d,words[i+4],7,-176418897);b=ff(d,a,b,c,words[i+5],12,1200080426);c=ff(c,d,a,b,words[i+6],17,-1473231341);d=ff(b,c,d,a,words[i+7],22,-45705983);
    a=ff(a,b,c,d,words[i+8],7,1770035416);b=ff(d,a,b,c,words[i+9],12,-1958414417);c=ff(c,d,a,b,words[i+10],17,-42063);d=ff(b,c,d,a,words[i+11],22,-1990404162);
    a=ff(a,b,c,d,words[i+12],7,1804603682);b=ff(d,a,b,c,words[i+13],12,-40341101);c=ff(c,d,a,b,words[i+14],17,-1502002290);d=ff(b,c,d,a,words[i+15],22,1236535329);
    a=gg(a,b,c,d,words[i+1],5,-165796510);b=gg(d,a,b,c,words[i+6],9,-1069501632);c=gg(c,d,a,b,words[i+11],14,643717713);d=gg(b,c,d,a,words[i],20,-373897302);
    a=gg(a,b,c,d,words[i+5],5,-701558691);b=gg(d,a,b,c,words[i+10],9,38016083);c=gg(c,d,a,b,words[i+15],14,-660478335);d=gg(b,c,d,a,words[i+4],20,-405537848);
    a=gg(a,b,c,d,words[i+9],5,568446438);b=gg(d,a,b,c,words[i+14],9,-1019803690);c=gg(c,d,a,b,words[i+3],14,-187363961);d=gg(b,c,d,a,words[i+8],20,1163531501);
    a=gg(a,b,c,d,words[i+13],5,-1444681467);b=gg(d,a,b,c,words[i+2],9,-51403784);c=gg(c,d,a,b,words[i+7],14,1735328473);d=gg(b,c,d,a,words[i+12],20,-1926607734);
    a=hh(a,b,c,d,words[i+5],4,-378558);b=hh(d,a,b,c,words[i+8],11,-2022574463);c=hh(c,d,a,b,words[i+11],16,1839030562);d=hh(b,c,d,a,words[i+14],23,-35309556);
    a=hh(a,b,c,d,words[i+1],4,-1530992060);b=hh(d,a,b,c,words[i+4],11,1272893353);c=hh(c,d,a,b,words[i+7],16,-155497632);d=hh(b,c,d,a,words[i+10],23,-1094730640);
    a=hh(a,b,c,d,words[i+13],4,681279174);b=hh(d,a,b,c,words[i],11,-358537222);c=hh(c,d,a,b,words[i+3],16,-722521979);d=hh(b,c,d,a,words[i+6],23,76029189);
    a=hh(a,b,c,d,words[i+9],4,-640364487);b=hh(d,a,b,c,words[i+12],11,-421815835);c=hh(c,d,a,b,words[i+15],16,530742520);d=hh(b,c,d,a,words[i+2],23,-995338651);
    a=ii(a,b,c,d,words[i],6,-198630844);b=ii(d,a,b,c,words[i+7],10,1126891415);c=ii(c,d,a,b,words[i+14],15,-1416354905);d=ii(b,c,d,a,words[i+5],21,-57434055);
    a=ii(a,b,c,d,words[i+12],6,1700485571);b=ii(d,a,b,c,words[i+3],10,-1894986606);c=ii(c,d,a,b,words[i+10],15,-1051523);d=ii(b,c,d,a,words[i+1],21,-2054922799);
    a=ii(a,b,c,d,words[i+8],6,1873313359);b=ii(d,a,b,c,words[i+15],10,-30611744);c=ii(c,d,a,b,words[i+6],15,-1560198380);d=ii(b,c,d,a,words[i+13],21,1309151649);
    a=ii(a,b,c,d,words[i+4],6,-145523070);b=ii(d,a,b,c,words[i+11],10,-1120210379);c=ii(c,d,a,b,words[i+2],15,718787259);d=ii(b,c,d,a,words[i+9],21,-343485551);
    a=sa(a,A);b=sa(b,B);c=sa(c,C);d=sa(d,D);}
  var out=[];
  for(var i=0;i<4;i++)out.push((a>>i*8)&0xFF,(b>>i*8)&0xFF,(c>>i*8)&0xFF,(d>>i*8)&0xFF);
  return out;
}

function _evp(pass, saltHex) {
  var p=[]; for(var i=0;i<pass.length;i++) p.push(pass.charCodeAt(i));
  var s=[]; if(saltHex) for(var i=0;i<saltHex.length;i+=2) s.push(parseInt(saltHex.slice(i,i+2),16));
  function cat(){var r=[];for(var a=0;a<arguments.length;a++)for(var b=0;b<arguments[a].length;b++)r.push(arguments[a][b]);return r;}
  var d0=_md5(cat(p,s)), d1=_md5(cat(d0,p,s));
  return { key: cat(d0,d1) };
}

function bePlayerDecrypt(pass, encJson) {
  var parsed = JSON.parse(encJson);
  var raw = atob(parsed.ct), ct = [];
  for (var i = 0; i < raw.length; i++) ct.push(raw.charCodeAt(i));
  var iv = [];
  for (var i = 0; i < 32; i += 2) iv.push(parseInt(parsed.iv.slice(i,i+2), 16));
  var derived = _evp(pass, parsed.s || '');
  var plain = _acbc(derived.key, iv, ct);
  var text = '';
  for (var i = 0; i < plain.length; i++) text += String.fromCharCode(plain[i]);
  return JSON.parse(text);
}

// ── CizgiPass extractor ───────────────────────────────────────
// debug v3: embed fetch → bePlayer → /list/ (cookie ile) → /m3u/ URL

function extractCizgiPass(embedUrl, epCookies) {
  var cookies = epCookies || '';
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
      if (!r.ok) throw new Error('embed HTTP ' + r.status);
      cookies = mergeCookies(r, cookies);
      return r.text();
    })
    .then(function(html) {
      var m = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']*"ct"[^']*\})'\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]*"ct"[^"]*\})"\s*\)/);
      if (!m) { console.log('[CizgiMax] bePlayer bulunamadı'); return null; }

      var data;
      try { data = bePlayerDecrypt(m[1], m[2]); }
      catch(e) { console.error('[CizgiMax] decrypt hata:', e.message); return null; }

      var listUrl = data.video_location || data.file || data.src;
      if (!listUrl) { console.log('[CizgiMax] video_location yok'); return null; }
      if (listUrl.indexOf('/') === 0) listUrl = 'https://cizgipass100.online' + listUrl;

      // /list/ → master m3u8 → /m3u/ URL çıkar
      return fetch(listUrl, {
        headers: Object.assign({}, HEADERS, {
          'Referer': embedUrl,
          'Cookie':  cookies,
          'Origin':  'https://cizgipass100.online',
          'Accept':  '*/*'
        })
      })
        .then(function(r2) {
          if (!r2.ok) { console.log('[CizgiMax] /list/ ' + r2.status); return null; }
          return r2.text();
        })
        .then(function(m3u8) {
          if (!m3u8 || m3u8.indexOf('#EXTM3U') === -1) return null;

          var streams = [], lines = m3u8.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
              var next = (lines[i+1] || '').trim();
              if (next.indexOf('http') === 0) {
                var bw = line.match(/BANDWIDTH=(\d+)/);
                var nm = line.match(/NAME="([^"]+)"/);
                streams.push({ url: next, bw: bw ? parseInt(bw[1]) : 0, name: nm ? nm[1] : 'HD' });
              }
            }
          }
          // Direkt URL da olabilir
          if (!streams.length) {
            var dm = m3u8.match(/^(https?:\/\/[^\s]+)$/m);
            if (dm) streams.push({ url: dm[1], bw: 0, name: 'HD' });
          }
          if (!streams.length) return null;

          streams.sort(function(a,b){return b.bw-a.bw;});
          var best = streams[0];
          console.log('[CizgiMax] ✓ CizgiPass stream: ' + best.url.slice(0,80));
          return {
            url:      best.url,
            type:     'hls',
            headers:  { 'Referer': embedUrl, 'Origin': 'https://cizgipass100.online' },
            provider: 'CizgiPass',
            quality:  best.name
          };
        });
    })
    .catch(function(e) { console.error('[CizgiMax] CizgiPass hata:', e.message); return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);

  var sNum = parseInt(seasonNum) || 1;
  var eNum = parseInt(episodeNum) || 1;
  console.log('[CizgiMax] başlıyor: TMDB=' + tmdbId + ' S' + sNum + 'E' + eNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      console.log('[CizgiMax] dizi: "' + info.titleEn + '" / "' + info.titleTr + '"');

      // İngilizce ile ara, bulamazsa Türkçe ile
      return searchCizgiMax(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBest(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchCizgiMax(info.titleTr).then(function(r2) {
              return findBest(r2, info.titleEn, info.titleTr);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) { console.log('[CizgiMax] dizi bulunamadı'); return []; }

          var showUrl = best.s_link
            ? (best.s_link.indexOf('http') === 0 ? best.s_link : fixUrl(best.s_link))
            : null;
          if (!showUrl) return [];
          console.log('[CizgiMax] dizi: ' + best.s_name + ' → ' + showUrl);

          // Bölüm URL'ini bul
          return fetchEpisodeUrl(showUrl, sNum, eNum)
            .then(function(epUrl) {
              if (!epUrl) { console.log('[CizgiMax] bölüm URL bulunamadı'); return []; }
              console.log('[CizgiMax] bölüm: ' + epUrl);

              // Bölüm sayfasından player linklerini al
              return fetchPlayerLinks(epUrl)
                .then(function(res) {
                  var links   = res.links;
                  var cookies = res.cookies;

                  if (!links.length) { console.log('[CizgiMax] hiç player linki yok'); return []; }

                  // Her linki paralel işle
                  var promises = links.map(function(link) {
                    if (link.type === 'sibnet') {
                      return extractSibnet(link.url);
                    }
                    if (link.type === 'cizgipass') {
                      return extractCizgiPass(link.url, cookies);
                    }
                    return Promise.resolve(null);
                  });

                  return Promise.all(promises).then(function(streams) {
                    return streams.filter(Boolean).map(function(s) {
                      return {
                        name:    info.title,
                        title:   '⌜ CİZGİMAX ⌟ | ' + s.provider + ' | ' + (s.quality || 'Auto'),
                        url:     s.url,
                        quality: s.quality || 'Auto',
                        type:    s.type,
                        headers: s.headers
                      };
                    });
                  });
                });
            });
        });
    })
    .then(function(streams) {
      console.log('[CizgiMax] toplam stream: ' + (streams ? streams.length : 0));
      return streams || [];
    })
    .catch(function(e) {
      console.error('[CizgiMax] hata:', e.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
