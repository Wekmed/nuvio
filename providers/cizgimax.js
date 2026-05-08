// ============================================================
//  CizgiMax — Nuvio Provider
// ============================================================

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
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  if (url.startsWith('/'))    return MAIN_URL + url;
  return MAIN_URL + '/' + url;
}

function getHtml(url, extraHeaders) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extraHeaders || {}) })
    .then(function(r) { return r.text(); });
}

function reFind(html, pattern) {
  var m = html.match(pattern);
  return m ? m[1] : null;
}

// ── TMDB ─────────────────────────────────────────────────────
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

// ── Arama ────────────────────────────────────────────────────
function searchCizgiMax(query) {
  return fetch(MAIN_URL + '/ajaxservice/index.php?qr=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var items = (data.data || {}).result || [];
      return items.filter(function(item) {
        return !/(\.Bölüm|\.Sezon|-Sezon|-izle)/i.test(item.s_name || '');
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

function findBestMatch(items, titleEn, titleTr) {
  var nEn = normalize(titleEn), nTr = normalize(titleTr);
  var scored = items.map(function(item) {
    var n = normalize(item.s_name || '');
    var s = 0;
    if (n === nEn || n === nTr) s = 100;
    else if (n.indexOf(nEn) !== -1 || nEn.indexOf(n) !== -1) s = 60;
    else if (n.indexOf(nTr) !== -1 || nTr.indexOf(n) !== -1) s = 60;
    return { item: item, score: s };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored.length && scored[0].score >= 60) ? scored[0].item : null;
}

// ── Sezon/Bölüm parse ─────────────────────────────────────────
function extractSeasonEpisode(text) {
  var s = 1, e = 1;
  var sm = text.match(/(\d+)\s*\.?\s*[Ss]ezon/i);
  var em = text.match(/(\d+)\s*\.?\s*[Bb]ölüm/i)
        || text.match(/[Bb]ölüm\s*(\d+)/i)
        || text.match(/Ep\.?\s*(\d+)/i);
  if (sm) s = parseInt(sm[1]);
  if (em) e = parseInt(em[1]);
  return { season: s, episode: e };
}

// ── Bölüm listesi ─────────────────────────────────────────────
// URL'den S/E parse: /slug-X-sezon-Y-bolum[-izle]/ (debug ile doğrulandı)
function extractSE(url) {
  var sm = url.match(/-([0-9]+)-sezon-/i);
  var em = url.match(/-sezon-([0-9]+)-bolum/i);
  return {
    season:  sm ? parseInt(sm[1]) : 1,
    episode: em ? parseInt(em[1]) : 0
  };
}

function fetchShowEpisodes(showUrl) {
  return getHtml(showUrl).then(function(html) {
    var episodes = [], seen = {}, re = /href="([^"]+)"/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1].indexOf('http') === 0 ? m[1] : MAIN_URL + m[1];
      if (seen[href]) continue;
      if (href.indexOf('sezon') === -1 || href.indexOf('bolum') === -1) continue;
      seen[href] = true;
      var se = extractSE(href);
      if (se.episode > 0) episodes.push({ season: se.season, episode: se.episode, url: href });
    }
    console.log('[CizgiMax] ' + episodes.length + ' bolum');
    return episodes;
  });
}

// ── data-frame iframe'leri ────────────────────────────────────
function fetchEpisodeIframes(epUrl) {
  return getHtml(epUrl, { 'Referer': MAIN_URL + '/' }).then(function(html) {
    var iframes = [], re = /data-frame="([^"]+)"/gi, m;
    while ((m = re.exec(html)) !== null) {
      var src = fixUrl(m[1].trim());
      if (src && iframes.indexOf(src) === -1) iframes.push(src);
    }
    return iframes;
  });
}

// ── BePlayer AES Decrypt (OpenSSL EVP_BytesToKey + AES-256-CBC) ───
// KekikStream BePlayerExtractor.decrypt_beplayer() tam JS karşılığı
// CryptoJS.AES şifreleme: bePlayer("PASSWORD", '{"ct":"...","iv":"...","s":"..."}')

function md5(data) {
  // Lightweight MD5 — SubtleCrypto MD5 desteklemediği için
  function safeAdd(x, y) {
    var l = (x & 0xFFFF) + (y & 0xFFFF);
    return ((x >> 16) + (y >> 16) + (l >> 16)) << 16 | (l & 0xFFFF);
  }
  function rol(n, s) { return n << s | n >>> (32 - s); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t) { return cmn((b&c)|(~b&d),a,b,x,s,t); }
  function gg(a,b,c,d,x,s,t) { return cmn((b&d)|(c&~d),a,b,x,s,t); }
  function hh(a,b,c,d,x,s,t) { return cmn(b^c^d,a,b,x,s,t); }
  function ii(a,b,c,d,x,s,t) { return cmn(c^(b|~d),a,b,x,s,t); }

  var len = data.length;
  var words = [];
  for (var i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | data[i] << (i % 4 * 8);
  words[len >> 2] |= 0x80 << (len % 4 * 8);
  words[((len + 72 >> 6) << 4) + 14] = len * 8;

  var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  for (var i = 0; i < words.length; i += 16) {
    var A=a, B=b, C=c, D=d;
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
    a=safeAdd(a,A); b=safeAdd(b,B); c=safeAdd(c,C); d=safeAdd(d,D);
  }
  var out = new Uint8Array(16);
  for (var i = 0; i < 4; i++) {
    out[i]    = (a >> i*8) & 0xFF; out[i+4]  = (b >> i*8) & 0xFF;
    out[i+8]  = (c >> i*8) & 0xFF; out[i+12] = (d >> i*8) & 0xFF;
  }
  return out;
}


// ── Saf JS AES-256-CBC fallback (crypto.subtle çalışmazsa) ───
var _SB=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
var _SBI=(function(){var t=new Array(256);_SB.forEach(function(v,i){t[v]=i;});return t;})();
var _RC=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77,154,47,94,188,99,198,151,53,106,212,179,125,250,239,197,145,57,114,228,211,189,97,194,159,37,74,148,51,102,204,131,29,58,116,232,203,141,9,18,36,72,144,55,110,220,163,77,154,47];
function _gm(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var h=a&0x80;a=(a<<1)&0xFF;if(h)a^=0x1B;b>>=1;}return p;}
function _kx(key){var nk=key.length/4,nr=nk+6,w=[];for(var i=0;i<nk;i++)w[i]=[key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]];for(var i=nk;i<4*(nr+1);i++){var t=w[i-1].slice();if(i%nk===0){t=[_SB[t[1]]^_RC[i/nk],_SB[t[2]],_SB[t[3]],_SB[t[0]]];}else if(nk>6&&i%nk===4){t=t.map(function(b){return _SB[b];});}w[i]=w[i-nk].map(function(b,j){return b^t[j];});}return w;}
function _ark(s,rk){return s.map(function(b,i){return b^rk[i>>2][i&3];});}
function _isr(s){return[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];}
function _isb(s){return s.map(function(b){return _SBI[b];});}
function _imc(s){var r=new Array(16);for(var c=0;c<4;c++){var i=c*4,a=s[i],b=s[i+1],cc=s[i+2],d=s[i+3];r[i]=_gm(a,14)^_gm(b,11)^_gm(cc,13)^_gm(d,9);r[i+1]=_gm(a,9)^_gm(b,14)^_gm(cc,11)^_gm(d,13);r[i+2]=_gm(a,13)^_gm(b,9)^_gm(cc,14)^_gm(d,11);r[i+3]=_gm(a,11)^_gm(b,13)^_gm(cc,9)^_gm(d,14);}return r;}
function _adb(block,w,nr){var s=_ark(block.slice(),w.slice(nr*4,(nr+1)*4));for(var r=nr-1;r>0;r--)s=_imc(_ark(_isb(_isr(s)),w.slice(r*4,(r+1)*4)));return _ark(_isb(_isr(s)),w.slice(0,4));}
function _acbc(key,iv,ct){var nr=key.length/4+6,w=_kx(key),out=[],prev=iv.slice();for(var i=0;i<ct.length;i+=16){var bl=ct.slice(i,i+16),dec=_adb(bl,w,nr);for(var j=0;j<16;j++)out.push(dec[j]^prev[j]);prev=bl;}var p=out[out.length-1];return out.slice(0,out.length-p);}

function bePlayerDecryptPure(password, encryptedData) {
  try {
    var parsed = JSON.parse(encryptedData);
    var raw = atob(parsed.ct), ct = [];
    for (var i = 0; i < raw.length; i++) ct.push(raw.charCodeAt(i));
    var iv = [];
    for (var i = 0; i < 32; i += 2) iv.push(parseInt(parsed.iv.slice(i, i+2), 16));
    var salt = [];
    if (parsed.s) for (var i = 0; i < parsed.s.length; i += 2) salt.push(parseInt(parsed.s.slice(i, i+2), 16));
    // MD5 saf JS (data array)
    function md5a(data) {
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
        a=sa(a,A);b=sa(b,B);c=sa(c,C);d=sa(d,D);
      }
      var out=[];for(var i=0;i<4;i++){out.push((a>>i*8)&0xFF,((b>>i*8)&0xFF),((c>>i*8)&0xFF),((d>>i*8)&0xFF));}return out;
    }
    var p=[];for(var i=0;i<password.length;i++)p.push(password.charCodeAt(i));
    function cat(){var r=[];for(var i=0;i<arguments.length;i++)for(var j=0;j<arguments[i].length;j++)r.push(arguments[i][j]);return r;}
    var d0=md5a(cat(p,salt)),d1=md5a(cat(d0,p,salt)),key=cat(d0,d1);
    var plain=_acbc(key,iv,ct);
    var text='';for(var i=0;i<plain.length;i++)text+=String.fromCharCode(plain[i]);
    return text;
  } catch(e) { throw new Error('pureAES: ' + e.message); }
}

function evpBytesToKey(password, salt) {
  // OpenSSL EVP_BytesToKey: key(32) + iv(16) türet
  var p = new TextEncoder().encode(password);
  var s = salt || new Uint8Array(0);

  function concat() {
    var args = Array.prototype.slice.call(arguments);
    var len = args.reduce(function(acc, a) { return acc + a.length; }, 0);
    var out = new Uint8Array(len), off = 0;
    args.forEach(function(a) { out.set(a, off); off += a.length; });
    return out;
  }

  var d0 = md5(concat(p, s));
  var d1 = md5(concat(d0, p, s));
  var d2 = md5(concat(d1, p, s));

  return { key: concat(d0, d1), iv: d2.slice(0, 16) };
}

function bePlayerDecrypt(password, encryptedData) {
  // CryptoJS JSON formatı: {"ct":"...","iv":"HEX","s":"HEX"}
  var parsed = null;
  try { parsed = JSON.parse(encryptedData); } catch(e) {}

  var cipherBytes, ivBytes, saltBytes;

  if (parsed && parsed.ct) {
    // Base64 → bytes
    var raw = atob(parsed.ct);
    cipherBytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) cipherBytes[i] = raw.charCodeAt(i);

    // Salt (hex)
    if (parsed.s) {
      saltBytes = new Uint8Array(8);
      for (var i = 0; i < 8; i++) saltBytes[i] = parseInt(parsed.s.slice(i*2, i*2+2), 16);
    } else {
      saltBytes = new Uint8Array(0);
    }

    // IV (hex) varsa EVP'siz direkt kullan
    if (parsed.iv) {
      ivBytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) ivBytes[i] = parseInt(parsed.iv.slice(i*2, i*2+2), 16);
      var derived = evpBytesToKey(password, saltBytes);

      return crypto.subtle.importKey('raw', derived.key, { name: 'AES-CBC' }, false, ['decrypt'])
        .then(function(k) { return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, k, cipherBytes); })
        .then(unpad);
    }
  }

  // OpenSSL Salted__ formatı: Base64("Salted__" + 8b_salt + cipher)
  var raw2 = atob((encryptedData || '').trim());
  var rawBytes = new Uint8Array(raw2.length);
  for (var i = 0; i < raw2.length; i++) rawBytes[i] = raw2.charCodeAt(i);

  var hasSalt = raw2.slice(0, 8) === 'Salted__';
  if (hasSalt) {
    saltBytes   = rawBytes.slice(8, 16);
    cipherBytes = rawBytes.slice(16);
  } else {
    saltBytes   = new Uint8Array(0);
    cipherBytes = rawBytes;
  }

  var derived = evpBytesToKey(password, saltBytes);
  return crypto.subtle.importKey('raw', derived.key, { name: 'AES-CBC' }, false, ['decrypt'])
    .then(function(k) { return crypto.subtle.decrypt({ name: 'AES-CBC', iv: derived.iv }, k, cipherBytes); })
    .then(unpad);
}

function unpad(buf) {
  var bytes = new Uint8Array(buf);
  var pad   = bytes[bytes.length - 1];
  if (pad > 0 && pad <= 16) bytes = bytes.slice(0, bytes.length - pad);
  return new TextDecoder().decode(bytes);
}

// ── CizgiPass / BePlayer extractor ───────────────────────────
function extractCizgiPass(iframeSrc) {
  var label = '⌜ CİZGİMAX ⌟';

  return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // bePlayer("PASS", '{"ct":"...","iv":"...","s":"..."}')  — çeşitli tırnak kombinasyonları
      var m = html.match(/bePlayer\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"](\{[\s\S]+?\})['"]\s*\)/)
           || html.match(/bePlayer\s*\(\s*"([^"]+)"\s*,\s*"(\{[^"]+\})"\s*\)/)
           || html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^']+\})'\s*\)/);

      if (!m) {
        // Fallback: düz file:
        var fm = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i)
              || html.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)['"]/i);
        if (fm) return {
          url: fm[1], name: label, title: label,
          quality: 'Auto', type: fm[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct',
          headers: { 'Referer': iframeSrc }
        };
        console.log('[CizgiMax] bePlayer bulunamadı: ' + iframeSrc);
        return null;
      }

      var pass      = m[1];
      var encrypted = m[2];
      console.log('[CizgiMax] bePlayer bulundu, çözülüyor...');

      return bePlayerDecrypt(pass, encrypted)
        .catch(function() {
          // crypto.subtle başarısız olursa saf JS AES dene
          return bePlayerDecryptPure(pass, encrypted);
        })
        .then(function(decrypted) {
          var data;
          try { data = JSON.parse(decrypted); }
          catch(e) {
            var u = decrypted.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i)
                 || decrypted.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
            return u ? { url: u[1], name: label, title: label, quality: 'Auto',
                         type: 'direct', headers: { 'Referer': iframeSrc } } : null;
          }

          // video_location — BePlayerExtractor'ın beklediği alan
          var videoUrl = data.video_location
            || (data.schedule && data.schedule.client &&
                reFind(String(data.schedule.client), /"video_location":"([^"]+)"/))
            || data.file || data.src || data.url;

          if (!videoUrl) return null;
          if (videoUrl.indexOf('/') === 0) videoUrl = 'https://cizgipass100.online' + videoUrl;

          var subs = [];
          (data.strSubtitles || []).forEach(function(sub) {
            if (sub.file && sub.label && sub.label.indexOf('Forced') === -1)
              subs.push({ label: sub.label.toUpperCase(), url: sub.file });
          });

          // /list/ URL'ini fetch edip gerçek /m3u/ stream URL'ini çıkar
          return fetch(videoUrl, {
            headers: Object.assign({}, HEADERS, { 'Referer': iframeSrc, 'Origin': 'https://cizgipass100.online' })
          })
          .then(function(r3) {
            if (!r3.ok) return null;
            return r3.text().then(function(m3u8txt) {
              var streams = [], lines = m3u8txt.split('\n');
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
                  var next = (lines[i+1]||'').trim();
                  if (next.indexOf('http') === 0) {
                    var bw = line.match(/BANDWIDTH=(\d+)/);
                    var nm = line.match(/NAME="([^"]+)"/);
                    streams.push({url:next, bw:bw?parseInt(bw[1]):0, name:nm?nm[1]:'HD'});
                  }
                }
              }
              if (!streams.length) {
                var dm = m3u8txt.match(/^(https?:\/\/[^\s]+)$/m);
                if (dm) streams.push({url:dm[1],bw:0,name:'HD'});
              }
              if (!streams.length) return null;
              streams.sort(function(a,b){return b.bw-a.bw;});
              var best = streams[0];
              console.log('[CizgiMax] ✓ ' + best.url.slice(0,80));
              return {
                url:       best.url,
                name:      label,
                title:     label + ' | ' + best.name,
                quality:   best.name,
                type:      'hls',
                headers:   { 'Referer': iframeSrc, 'Origin': 'https://cizgipass100.online' },
                subtitles: subs
              };
            });
          })
          .catch(function() { return null; });
        })
        .catch(function(e) { console.error('[CizgiMax] Decrypt hata:', e.message); return null; });
    })
    .catch(function(e) { console.error('[CizgiMax] Fetch hata:', e.message); return null; });
}

// ── Genel extractor ───────────────────────────────────────────
function extractStream(iframeSrc) {
  // CizgiPass player (cizgimax'ın kendi player'ı)
  if (iframeSrc.indexOf('cizgipass') !== -1) return extractCizgiPass(iframeSrc);

  var label = '⌜ CİZGİMAX ⌟';

  if (iframeSrc.indexOf('vidmoly') !== -1) {
    return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        return m ? { url: m[1], name: label, title: label + ' | VidMoly',
                     quality: 'Auto', type: 'hls', headers: { 'Referer': iframeSrc } } : null;
      }).catch(function() { return null; });
  }

  if (iframeSrc.indexOf('sibnet.ru') !== -1) {
    var idM = iframeSrc.match(/videoid=(\d+)/) || iframeSrc.match(/video(\d+)/);
    if (!idM) return Promise.resolve(null);
    var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + idM[1];
    return fetch(shellUrl, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' }) })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
        return m ? { url: 'https://video.sibnet.ru' + m[1], name: label, title: label + ' | Sibnet',
                     quality: 'Auto', type: 'direct', headers: { 'Referer': shellUrl } } : null;
      }).catch(function() { return null; });
  }

  if (iframeSrc.indexOf('youtube.com/embed') !== -1 || iframeSrc.indexOf('youtu.be') !== -1) {
    var ytId = reFind(iframeSrc, /(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return Promise.resolve(ytId ? { url: 'https://www.youtube.com/watch?v=' + ytId,
      name: label, title: label + ' | YouTube', quality: 'Auto', type: 'direct', headers: {} } : null);
  }

  // Generic fallback
  return fetch(iframeSrc, { headers: Object.assign({}, HEADERS, { 'Referer': MAIN_URL + '/' }) })
    .then(function(r) { return r.text(); })
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

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== 'tv') return Promise.resolve([]);
  console.log('[CizgiMax] TMDB:' + tmdbId + ' S' + seasonNum + 'E' + episodeNum);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];
      return searchCizgiMax(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBestMatch(results, info.titleEn, info.titleTr);
          if (!best && info.titleTr && info.titleTr !== info.titleEn)
            return searchCizgiMax(info.titleTr).then(function(r2) {
              return findBestMatch(r2, info.titleEn, info.titleTr);
            });
          return best;
        })
        .then(function(best) {
          if (!best) { console.log('[CizgiMax] Bulunamadı: ' + info.titleEn); return []; }
          var showUrl = fixUrl(best.s_link);
          console.log('[CizgiMax] Bulundu: ' + best.s_name + ' → ' + showUrl);

          var sNum = parseInt(seasonNum) || 1;
          var eNum = parseInt(episodeNum) || 1;

          return fetchShowEpisodes(showUrl).then(function(episodes) {
            // Önce S+E birebir eşleştir
            var matched = episodes.filter(function(ep) {
              return ep.season === sNum && ep.episode === eNum;
            });
            // Bulunamazsa sadece E ile eşleştir (karma İng/Tr slug için)
            if (!matched.length)
              matched = episodes.filter(function(ep) { return ep.episode === eNum; });
            if (!matched.length) {
              console.log('[CizgiMax] Bölüm bulunamadı S' + sNum + 'E' + eNum);
              return [];
            }

            console.log('[CizgiMax] Bölüm: ' + matched[0].url);
            return fetchEpisodeIframes(matched[0].url).then(function(iframes) {
              if (!iframes.length) return [];
              return Promise.all(iframes.map(extractStream))
                .then(function(s) { return s.filter(Boolean); });
            });
          });
        });
    })
    .then(function(streams) {
      var seen = {}, unique = streams.filter(function(s) {
        if (seen[s.url]) return false;
        seen[s.url] = true; return true;
      });
      console.log('[CizgiMax] Toplam stream: ' + unique.length);
      return unique;
    })
    .catch(function(err) { console.error('[CizgiMax] Hata:', err.message || err); return []; });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
                                                  
