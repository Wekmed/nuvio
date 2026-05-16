/**
 * CizgiVeDizi — Nuvio Provider 
 * cizgivedizi.com üzerinden çizgi film, dizi ve film stream sağlar.
 */

var BASE_URL    = 'https://www.cizgivedizi.com';
var TMDB_KEY    = '500330721680edb6d5f7f12ba7cd9023';
var SIBNET_HOST = 'https://video.sibnet.ru';
var LOG_TAG     = '[CizgiVeDizi]';

// GitHub raw TXT listeleri — kendi repo'nuzun raw linklerini buraya yazın
var GITHUB_DIZI_TXT = 'https://raw.githubusercontent.com/Wekmed/nuvio/refs/heads/main/providers/cizgivedizi_liste.txt';
var GITHUB_FILM_TXT = 'https://raw.githubusercontent.com/Wekmed/nuvio/refs/heads/main/providers/cizgivedizi_filmler.txt';

// Runtime cache (aynı JS context içinde tekrar çağrılırsa)
var _diziList = null;
var _filmList = null;

var HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer':         BASE_URL + '/'
};

var STOP = ['the','a','an','of','in','on','at','to','and','or','for',
            've','bir','ile','bu','mi','mu','mı','mü','da','de'];

// ── Log ──────────────────────────────────────────────────────

function log(msg) {
  console.log(LOG_TAG + ' ' + msg);
}

// ── Normalize ────────────────────────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/[^a-z0-9]/g,'');
}

// ── Fetch ────────────────────────────────────────────────────

function getHtml(url, extra) {
  return fetch(url, { headers: Object.assign({}, HEADERS, extra || {}) })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' → ' + url);
      return r.text();
    });
}

// ── Base64 decode (Hermes uyumlu) ────────────────────────────

function b64decode(b64) {
  // Buffer: RN'de her zaman var, atob'dan daha güvenli
  if (typeof Buffer !== 'undefined') {
    try {
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch(e) {}
  }
  // atob: RN 0.73+ ve tarayıcı
  if (typeof atob !== 'undefined') {
    try { return JSON.parse(atob(b64)); } catch(e) {}
  }
  return null;
}

// ── Slug encode ──────────────────────────────────────────────

function encPath(s) {
  var out = '';
  for (var i = 0; i < (s || '').length; i++) {
    var code = s.charCodeAt(i);
    if (code > 127) out += encodeURIComponent(s[i]);
    else out += s[i];
  }
  return out;
}

// ── 1. TMDB ──────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId, mediaType) {
  var ep  = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + ep + '/' + tmdbId
          + '?api_key=' + TMDB_KEY + '&language=tr-TR';
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var info = {
        title:   d.title   || d.name                 || '',
        titleTr: d.title   || d.name                 || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date  || '').slice(0, 4)
      };
      log('TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ')');
      return info;
    });
}

// ── 2. Arama ─────────────────────────────────────────────────

/**
 * Sorgu listesi — en spesifik'ten en genel'e:
 * TR tam → EN tam → EN son kelime → EN ilk → TR son → TR ilk → 2-kelime combolar
 */
function buildQueries(titleTr, titleEn) {
  var seen = {}, out = [];
  function add(q) {
    q = (q || '').trim();
    if (q && !seen[q]) { seen[q] = true; out.push(q); }
  }
  var enW = (titleEn||'').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });
  var trW = (titleTr||'').split(/[\s\-:,]+/).filter(function(w) {
    return STOP.indexOf(w.toLowerCase()) === -1 && w.length > 2;
  });

  add(titleTr);
  add(titleEn);
  if (enW.length > 0) add(enW[enW.length - 1]);            // EN son kelime: "Gumball"
  if (enW.length > 1) add(enW[0]);                          // EN ilk kelime
  if (enW.length >= 2) add(enW[0] + ' ' + enW[1]);         // EN ilk 2: "Adventure Time"
  if (enW.length >= 3) add(enW[0] + ' ' + enW[1] + ' ' + enW[2]); // EN ilk 3
  if (trW.length > 0) add(trW[trW.length - 1]);             // TR son kelime
  if (trW.length > 1) add(trW[0]);
  if (trW.length >= 2) add(trW[0] + ' ' + trW[1]);         // TR ilk 2
  for (var i = 0; i < trW.length - 1; i++) add(trW[i] + ' ' + trW[i+1]);
  for (var j = 1; j < enW.length - 1; j++) add(enW[j] + ' ' + enW[j+1]);
  return out;
}

// ── TXT Listesi Yükle ────────────────────────────────────────
//
// Öncelik:
//   1. SCRAPER_SETTINGS.diziList / filmList  →  Nuvio Kotlin tarafı inject eder
//      (async Promise zinciri yok, QuickJS job-queue sorunu yok)
//   2. Runtime cache  →  aynı context içinde 2. çağrı
//   3. fetch() fallback  →  eski test ekranı / Nuvio inject etmezse
//
function loadList(mediaType) {
  var isFilm = (mediaType === 'movie');
  var listKey = isFilm ? 'filmList' : 'diziList';

  // 1) Nuvio inject ettiyse senkron kullan
  var injected = globalThis.SCRAPER_SETTINGS && globalThis.SCRAPER_SETTINGS[listKey];
  if (Array.isArray(injected) && injected.length > 0) {
    log((isFilm ? 'Film' : 'Dizi') + ' listesi SCRAPER_SETTINGS: ' + injected.length + ' kayıt');
    if (isFilm) _filmList = injected; else _diziList = injected;
    return Promise.resolve(injected);
  }

  // 2) Runtime cache
  if (isFilm && _filmList) return Promise.resolve(_filmList);
  if (!isFilm && _diziList) return Promise.resolve(_diziList);

  // 3) fetch fallback (eski test ekranı)
  var url  = isFilm ? GITHUB_FILM_TXT : GITHUB_DIZI_TXT;
  var type = isFilm ? 'film' : 'dizi';
  return fetch(url)
    .then(function(r) { return r.ok ? r.text() : ''; })
    .then(function(txt) {
      var list = parseTxt(txt, type);
      log((isFilm ? 'Film' : 'Dizi') + ' listesi fetch: ' + list.length + ' kayıt');
      if (isFilm) _filmList = list; else _diziList = list;
      return list;
    })
    .catch(function() {
      if (isFilm) { _filmList = []; return []; }
      _diziList = []; return [];
    });
}

/**
 * TXT'yi parse et → [{name, id, slug}] dizisi döner
 * URL yapısı: /dizi/ID/SLUG  veya  /film/ID/SLUG
 */
function parseTxt(txt, type) {
  var lines   = txt.split('\n');
  var results = [];
  var nameRe  = /^\s{0,4}\d+\.\s+(.+)$/;
  var urlRe   = new RegExp('cizgivedizi\\.com\\/' + type + '\\/([^\\/]+)\\/([^\\s\\/]+)');
  var i = 0;
  while (i < lines.length) {
    var nm = lines[i].match(nameRe);
    if (nm && i + 1 < lines.length) {
      var um = lines[i + 1].match(urlRe);
      if (um) {
        results.push({
          name: nm[1].trim(),
          id:   decodeURIComponent(um[1]),
          slug: decodeURIComponent(um[2])
        });
        i += 2;
        continue;
      }
    }
    i++;
  }
  return results;
}

// ── TXT'den Arama ────────────────────────────────────────────

function searchSite(query, mediaType) {
  return loadList(mediaType).then(function(list) {
    var qn = norm(query);
    var hits = list.filter(function(item) {
      var n  = norm(item.name);
      var ns = norm(item.slug);  // slug EN ismi taşır: "adventure_time_uzak_diyarlar"
      return n.indexOf(qn) !== -1 || qn.indexOf(n) !== -1
          || ns.indexOf(qn) !== -1 || qn.indexOf(ns) !== -1;
    });
    log('TXT arama "' + query + '" → ' + hits.length + ' sonuç');
    return hits;
  });
}

/**
 * Skorlama:
 * - Slug da karşılaştırılır (EN isim slug içinde geçiyor olabilir)
 * - name içinde yıl varsa: TMDB yılı ile karşılaştır → net seçim
 * - Yıl yoksa: isim benzerliği (tam, kapsama, kısmi)
 *
 * Örnek: site adı "Adventure Time Uzak Diyarlar", slug "adventure_time_uzak_diyarlar"
 *        TMDB EN: "Adventure Time Distant Lands"
 *        → slug norm "adventuretimeuzakdiyarlar" ⊄ "adventuretimedistantlands"
 *        → ama her iki slug da "adventuretime" ile başlıyor → wordOverlap ile yakalanır
 */
function wordOverlap(a, b) {
  // İki normalize string arasındaki ortak 4+ karakter kelime parçası oranı
  var wa = a.match(/[a-z0-9]{4,}/g) || [];
  var wb = b.match(/[a-z0-9]{4,}/g) || [];
  if (!wa.length || !wb.length) return 0;
  var matches = wa.filter(function(w) { return wb.indexOf(w) !== -1; });
  return matches.length / Math.max(wa.length, wb.length);
}

function scoreItem(item, titleEn, titleTr, year) {
  var raw  = item.name || '';
  var slug = norm(item.slug || '');
  var n    = norm(raw);
  var ne   = norm(titleEn);
  var nt   = norm(titleTr);

  var nyM = raw.match(/\b(19[89]\d|20[0-3]\d)\b/);
  var ny  = nyM ? nyM[1] : null;

  var nc  = n.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var nsc = slug.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var nec = ne.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');
  var ntc = nt.replace(/\d{4}/g,'').replace(/[^a-z0-9]/g,'');

  var s = 0;

  // 1) İsim tam eşleşme veya kapsama (mevcut mantık)
  if (nc === nec || nc === ntc)                         s = 80;
  else if (nec.length > 2 && nec.indexOf(nc) !== -1)   s = 80; // EN ⊃ name
  else if (ntc.length > 2 && ntc.indexOf(nc) !== -1)   s = 75; // TR ⊃ name
  else if (nc.length > 4  && nc.indexOf(nec) !== -1)   s = 70;
  else if (nc.length > 4  && nc.indexOf(ntc) !== -1)   s = 70;

  // 2) Slug üzerinden EN eşleşme (TR çeviri farkını atlar)
  //    "adventure_time_uzak_diyarlar" slug'ı "adventuretime" içeriyor
  //    ve TMDB EN "adventuretimedistantlands" da "adventuretime" içeriyor
  if (s === 0) {
    if (nsc === nec || nsc === ntc)                       s = 75;
    else if (nec.length > 2 && nsc.indexOf(nec) !== -1)  s = 75;
    else if (nec.length > 2 && nec.indexOf(nsc) !== -1)  s = 70;
    else if (ntc.length > 2 && nsc.indexOf(ntc) !== -1)  s = 70;
  }

  // 3) Kelime örtüşmesi — "Adventure Time Distant Lands" vs slug "adventuretimeuzakdiyarlar"
  //    "adventure" + "time" ikisi de var → %50+ örtüşme → skor 70
  if (s === 0) {
    var overlapEn = wordOverlap(nsc, nec);
    var overlapTr = wordOverlap(nc,  ntc);
    if (overlapEn >= 0.5)      s = 70;
    else if (overlapTr >= 0.5) s = 70;
    else if (overlapEn >= 0.3) s = 60;
    else if (overlapTr >= 0.3) s = 60;
  }

  if (s === 0) return 0;
  if (ny && year) return ny === year ? s + 20 : 5;
  return s;
}

/**
 * Eşit skorlu (tie) adaylarda dizi sayfasından yıl çek.
 * badge-date-text span içindeki ilk yılı al.
 */
function fetchYearFromPage(item, mediaType) {
  var type = mediaType === 'movie' ? 'film' : 'dizi';
  var url  = BASE_URL + '/' + type + '/' + encPath(item.id) + '/' + encPath(item.slug);
  // İlk 60KB'da badge-date-text bulunabilir
  return getHtml(url, { 'Range': 'bytes=0-61440' })
    .then(function(html) {
      var m = html.match(/badge-date-text[^>]*>[^<]*((?:19[89]|20[0-3])\d)/i);
      return m ? m[1] : null;
    })
    .catch(function() { return null; });
}

function findContent(info, mediaType) {
  var queries = buildQueries(info.titleTr, info.titleEn);
  log('Sorgular: ' + JSON.stringify(queries.slice(0, 5)) + (queries.length > 5 ? '...' : ''));

  // TXT listesi bir kez yüklensin, sonra tüm sorgular üzerinde çalışsın
  return loadList(mediaType).then(function(list) {
    return queries.reduce(function(chain, query) {
      return chain.then(function(found) {
        if (found) return found;
        return searchSite(query, mediaType).then(function(results) {
          if (!results.length) {
            log('Sorgu "' + query + '" → 0 sonuç');
            return null;
          }
          log('Sorgu "' + query + '" → ' + results.length + ' sonuç: [' +
              results.map(function(r) { return r.id; }).join(', ') + ']');

          var candidates = results
            .map(function(item) {
              return { item: item, score: scoreItem(item, info.titleEn, info.titleTr, info.year) };
            })
            .filter(function(c) { return c.score >= 70; })
            .sort(function(a, b) { return b.score - a.score; });

          if (!candidates.length) {
            log('Hiç aday kalmadı (min score 70)');
            return null;
          }

          log('Adaylar: ' + candidates.map(function(c) {
            return c.item.id + '(' + c.score + ')';
          }).join(', '));

          // Net fark varsa direkt al
          if (candidates.length === 1 || candidates[0].score - candidates[1].score >= 10) {
            log('Seçildi: ' + candidates[0].item.id + ' score=' + candidates[0].score);
            return candidates[0].item;
          }

          // Tie: yıl ile ayırt et
          log('Tie durumu — yıl fetch ediliyor');
          return Promise.all(
            candidates.slice(0, 3).map(function(c) {
              return fetchYearFromPage(c.item, mediaType).then(function(yr) {
                log('  ' + c.item.id + ' yıl=' + (yr || '?'));
                return { item: c.item, year: yr, score: c.score };
              });
            })
          ).then(function(withYears) {
            var exact = withYears.find(function(c) { return c.year === info.year; });
            if (exact) {
              log('Yıl eşleşti: ' + exact.item.id);
              return exact.item;
            }
            log('Yıl eşleşmedi, ilk aday: ' + withYears[0].item.id);
            return withYears[0].item;
          });
        });
      });
    }, Promise.resolve(null));
  });
}

// ── 3. Global bölüm numarası ──────────────────────────────────

function fetchGlobalEpNo(tmdbId, seasonNum, episodeNum) {
  if (seasonNum <= 1) return Promise.resolve(episodeNum);

  var promises = [];
  for (var s = 1; s < seasonNum; s++) {
    (function(sn) {
      promises.push(
        fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + sn +
              '?api_key=' + TMDB_KEY)
          .then(function(r) { return r.json(); })
          .then(function(d) { return (d.episodes && d.episodes.length) || 0; })
          .catch(function() { return 0; })
      );
    })(s);
  }

  return Promise.all(promises).then(function(counts) {
    var total = counts.reduce(function(a, b) { return a + b; }, 0);
    log('Global ep: S' + seasonNum + 'E' + episodeNum +
        ' → önceki sezonlar=' + total + ' → global #' + (total + episodeNum));
    return total + episodeNum;
  });
}

// ── 4. HTML → embed URL'leri ─────────────────────────────────

function parseEmbeds(html) {
  // A: window.__embeds_b64 = 'BASE64'
  var b64m = html.match(/window\.__embeds_b64\s*=\s*'([^']+)'/)
          || html.match(/window\.__embeds_b64\s*=\s*"([^"]+)"/);
  if (b64m) {
    var arr = b64decode(b64m[1]);
    if (Array.isArray(arr) && arr.length) {
      log('__embeds_b64: ' + arr.length + ' embed');
      return arr.filter(Boolean);
    }
  }

  // B: window.__embeds = [...]
  var dm = html.match(/window\.__embeds\s*=\s*(\[[^\]]{10,}\])/);
  if (dm) {
    try {
      var arr2 = JSON.parse(dm[1]);
      if (Array.isArray(arr2) && arr2.length) {
        log('__embeds: ' + arr2.length + ' embed');
        return arr2.filter(Boolean);
      }
    } catch(e) {}
  }

  // C: Script içinden embed URL'leri
  var urls = [], seen = {};
  var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    var urlRe = /["'`]((?:https?:)?\/\/(?:video\.sibnet\.ru\/shell\.php[^"'`\s<>]+|my\.mail\.ru\/video\/embed\/[^"'`\s<>]+|www\.mp4upload\.com\/embed-[^"'`\s<>]+|vidmoly\.to\/e\/[^"'`\s<>]+|ok\.ru\/videoembed\/[^"'`\s<>]+|vk\.com\/video_ext[^"'`\s<>]+))/gi;
    var um;
    while ((um = urlRe.exec(sm[1])) !== null) {
      var u = um[1];
      if (!seen[u]) { seen[u] = true; urls.push(u); }
    }
  }
  if (urls.length) log('Script parse: ' + urls.length + ' embed');
  return urls;
}

function parseSourceNames(html) {
  var names = [], re = /data-kaynak="(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) names[parseInt(m[1])] = m[2].trim();
  return names;
}

// ── 5. Embed → Stream ─────────────────────────────────────────

function toAbs(url) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  return null;
}

function isVideoUrl(url) {
  var p = (url || '').toLowerCase().split('?')[0];
  var bad = ['.css','.js','.woff','.woff2','.ttf','.eot','.png','.jpg','.gif','.svg','.ico','.map','.json'];
  for (var i = 0; i < bad.length; i++) if (p.slice(-bad[i].length) === bad[i]) return false;
  return p.indexOf('.m3u8') !== -1 || p.indexOf('.mp4') !== -1;
}

function extractSibnet(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': 'https://video.sibnet.ru/' })
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+\.mp4)["']/i)
           || html.match(/["']((?:https?:\/\/video\.sibnet\.ru)?\/v\/[^"']+\.mp4)["']/i);
      if (!m) return null;
      var mp4 = m[1].indexOf('http') === 0 ? m[1] : SIBNET_HOST + m[1];
      return { url: mp4, type: 'direct', headers: { 'Referer': full } };
    }).catch(function() { return null; });
}

function extractVidmoly(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractMp4upload(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i)
           || html.match(/[,\{]\s*file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i);
      if (m && isVideoUrl(m[1]))
        return { url: m[1], type: m[1].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
      var all = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (var i = 0; i < all.length; i++) {
        if (isVideoUrl(all[i]) && all[i].indexOf('mp4upload') !== -1)
          return { url: all[i], type: all[i].indexOf('.m3u8') !== -1 ? 'hls' : 'direct', headers: { 'Referer': full } };
      }
      return null;
    }).catch(function() { return null; });
}

function extractMailRu(url) {
  var full = toAbs(url);
  return getHtml(full, { 'Referer': BASE_URL + '/' })
    .then(function(html) {
      var m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', headers: { 'Referer': full } } : null;
    }).catch(function() { return null; });
}

function extractStream(url) {
  var full = toAbs(url);
  if (!full) return Promise.resolve(null);
  var lo   = full.toLowerCase();
  if (lo.indexOf('sibnet')    !== -1) return extractSibnet(url);
  if (lo.indexOf('vidmoly')   !== -1) return extractVidmoly(url);
  if (lo.indexOf('mp4upload') !== -1) return extractMp4upload(url);
  if (lo.indexOf('mail.ru')   !== -1) return extractMailRu(url);
  log('Desteklenmeyen embed: ' + full.slice(0, 60));
  return Promise.resolve(null);
}

// ── Ana Akış ─────────────────────────────────────────────────

function buildEpUrl(item, mediaType, epGlobalNo) {
  if (mediaType === 'movie')
    return BASE_URL + '/film/' + encPath(item.id) + '/' + encPath(item.slug);
  return BASE_URL + '/dizi/' + encPath(item.id) + '/' + encPath(item.slug)
       + '/' + epGlobalNo + '/-';
}

function getStreams(tmdbId, mediaType, season, episode) {
  log('START tmdbId=' + tmdbId + ' type=' + mediaType +
      (mediaType === 'tv' ? ' S' + season + 'E' + episode : ''));

  var infoP = fetchTmdbInfo(tmdbId, mediaType);
  var epNoP = mediaType === 'tv'
    ? fetchGlobalEpNo(tmdbId, season, episode)
    : Promise.resolve(null);

  return Promise.all([infoP, epNoP])
    .then(function(res) {
      var info     = res[0];
      var epGlobal = res[1];

      return findContent(info, mediaType).then(function(item) {
        if (!item) {
          log('İçerik bulunamadı');
          return [];
        }
        log('Eşleşti: "' + item.name + '" id=' + item.id + ' slug=' + item.slug);

        var epUrl = buildEpUrl(item, mediaType, epGlobal);
        log('Bölüm URL: ' + epUrl);

        return getHtml(epUrl).then(function(html) {
          var embeds   = parseEmbeds(html);
          var srcNames = parseSourceNames(html);

          if (!embeds.length) {
            log('Embed bulunamadı');
            return [];
          }
          log(embeds.length + ' embed: ' + embeds.slice(0,2).join(', '));

          return Promise.all(
            embeds.map(function(embedUrl, idx) {
              return extractStream(embedUrl).then(function(stream) {
                if (!stream) return null;
                var srcName = srcNames[idx] || ('Kaynak ' + idx);
                return {
                  name:    info.title,
                  title:   '⌜ ÇİZGİVEDİZİ ⌟ | ' + srcName + ' | Auto',
                  url:     stream.url,
                  quality: 'Auto',
                  type:    stream.type,
                  headers: stream.headers || {}
                };
              });
            })
          ).then(function(all) {
            var filtered = all.filter(Boolean);
            log('Stream sayısı: ' + filtered.length);
            return filtered;
          });
        });
      });
    })
    .catch(function(e) {
      log('HATA: ' + e.message);
      return [];
    });
}

// ── Export ───────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
