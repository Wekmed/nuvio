// ============================================================
//  M3U Provider — birlesik.m3u
//  TMDB ID ile m3u dosyasından stream eşleştirme
// ============================================================

var M3U_URL      = 'https://raw.githubusercontent.com/mooncrown04/m3u/refs/heads/main/birlesik.m3u';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

// Cache — her getStreams çağrısında tekrar indirmemek için
var _m3uCache     = null;
var _m3uFetchedAt = 0;
var CACHE_TTL     = 3600 * 1000; // 1 saat

// ── M3U indir ve parse et ─────────────────────────────────────
function fetchM3u() {
  var now = Date.now();
  if (_m3uCache && (now - _m3uFetchedAt) < CACHE_TTL) {
    return Promise.resolve(_m3uCache);
  }
  console.log('[M3U] Dosya indiriliyor...');
  return fetch(M3U_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  })
  .then(function(r) {
    if (!r.ok) throw new Error('M3U indirme hata: ' + r.status);
    return r.text();
  })
  .then(function(text) {
    var entries = parseM3u(text);
    console.log('[M3U] Toplam entry: ' + entries.length);
    _m3uCache     = entries;
    _m3uFetchedAt = Date.now();
    return entries;
  });
}

// ── M3U parse ────────────────────────────────────────────────
function parseM3u(text) {
  var lines   = text.split('\n');
  var entries = [];
  var i = 0;

  while (i < lines.length) {
    var line = lines[i].trim();
    if (line.indexOf('#EXTINF') === 0) {
      var meta = line;
      // Sonraki satır URL
      var url = '';
      var j = i + 1;
      while (j < lines.length) {
        var next = lines[j].trim();
        if (next && next.indexOf('#') !== 0) { url = next; break; }
        j++;
      }
      if (url) {
        var entry = parseExtInf(meta, url);
        if (entry) entries.push(entry);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return entries;
}

function parseExtInf(meta, url) {
  // tvg-logo
  var logoM = meta.match(/tvg-logo="([^"]+)"/);
  var logo  = logoM ? logoM[1] : '';

  // group-title
  var groupM = meta.match(/group-title="([^"]+)"/);
  var group  = groupM ? groupM[1] : '';

  // Başlık: EXTINF satırının son virgülden sonrası
  var titleRaw = meta.replace(/#EXTINF[^,]*,/, '').trim();
  // Yıl: (2024) formatı
  var yearM  = titleRaw.match(/\((\d{4})\)/);
  var year   = yearM ? yearM[1] : '';
  // Tarih tag'ı temizle: [28.01.2026]
  var title  = titleRaw.replace(/\[\d{2}\.\d{2}\.\d{4}[^\]]*\]/g, '').replace(/\(\d{4}\)/g, '').trim();
  // -- ile başlayan oyuncu/tür bilgilerini sil
  title = title.replace(/\s*[-–]{2,}[\s\S]*/, '').trim();
  // Sona yapışmış genre kelimelerini sil (Komedi, Dram vs)
  title = title.replace(/\s*(Komedi|Dram|Aksiyon|Animasyon|Aile|Korku|Gerilim|Bilim|Romantik|Belgesel|Western|Müzikal|Fantezi|Macera|Suç|Tarih|Savaş|Spor|Biyografi)\s*$/gi, '').trim();

  // TMDB poster URL'sinden poster path çıkar
  // https://image.tmdb.org/t/p/w500/xYqeUheNCep7ll9AotOcclGhP0X.jpg
  var tmdbPosterPath = null;
  if (logo && logo.indexOf('image.tmdb.org') !== -1) {
    var pathM = logo.match(/\/t\/p\/w\d+\/(.+)$/);
    if (pathM) tmdbPosterPath = pathM[1];
  }

  // IMDb ID: URL içinde tt\d+ varsa
  var imdbM = url.match(/\b(tt\d+)\b/);
  var imdbId = imdbM ? imdbM[1] : null;

  // URL türü
  var urlType = detectUrlType(url);

  if (!title || !url) return null;

  return {
    title:           title,
    year:            year,
    url:             url,
    urlType:         urlType,
    logo:            logo,
    group:           group,
    tmdbPosterPath:  tmdbPosterPath,
    imdbId:          imdbId
  };
}

function detectUrlType(url) {
  if (url.indexOf('vidmody.com') !== -1)    return 'vidmody';
  if (url.match(/\.m3u8/))                  return 'm3u8';
  if (url.indexOf('pixtures.art') !== -1)   return 'pixtures';
  if (url.indexOf('photomag.biz') !== -1)   return 'm3u8';
  return 'direct';
}

// ── TMDB bilgisi çek ─────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var type = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch(
    'https://api.themoviedb.org/3/' + type + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=tr-TR'
  )
  .then(function(r) { return r.json(); })
  .then(function(d) {
    return {
      titleTr:     d.title || d.name || '',
      titleEn:     d.original_title || d.original_name || '',
      year:        (d.release_date || d.first_air_date || '').slice(0, 4),
      posterPath:  d.poster_path || ''  // "/xYqeUheNCep7ll9AotOcclGhP0X.jpg"
    };
  });
}

// IMDb ID -> TMDB ID
function imdbToTmdb(imdbId) {
  return fetch(
    'https://api.themoviedb.org/3/find/' + imdbId +
    '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id'
  )
  .then(function(r) { return r.json(); })
  .then(function(d) {
    var results = (d.movie_results || []).concat(d.tv_results || []);
    return results.length > 0 ? results[0].id : null;
  })
  .catch(function() { return null; });
}

// ── Normalize başlık (karşılaştırma için) ────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[\u0130]/g, 'i').replace(/[\u0131]/g, 'i')
    .replace(/[\u011f]/g, 'g').replace(/[\u00fc]/g, 'u')
    .replace(/[\u015f]/g, 's').replace(/[\u00f6]/g, 'o')
    .replace(/[\u00e7]/g, 'c')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function titleScore(entryTitle, queryTr, queryEn) {
  var et  = normalize(entryTitle);
  var qtr = normalize(queryTr);
  var qen = normalize(queryEn);
  if (et === qtr || et === qen) return 3;          // tam eşleşme
  if (et.indexOf(qtr) !== -1 || et.indexOf(qen) !== -1) return 2; // içeriyor
  // kelime bazlı overlap
  var etWords  = et.split(' ');
  var qWords   = qtr.split(' ');
  var overlap  = 0;
  qWords.forEach(function(w) { if (w.length > 2 && etWords.indexOf(w) !== -1) overlap++; });
  if (overlap > 0) return overlap;
  return 0;
}

// ── Entry'den stream oluştur ──────────────────────────────────
function entryToStream(entry) {
  // Vidmody: direkt URL — Nuvio embed olarak oynatır
  if (entry.urlType === 'vidmody') {
    return Promise.resolve({
      url:     entry.url,
      name:    entry.group || 'M3U',
      title:   entry.title,
      quality: 'Auto',
      type:    'direct',
      headers: { 'Referer': 'https://vidmody.com/' }
    });
  }

  // Direkt m3u8 veya pixtures
  if (entry.urlType === 'm3u8' || entry.urlType === 'pixtures' || entry.urlType === 'direct') {
    return Promise.resolve({
      url:     entry.url,
      name:    entry.group || 'M3U',
      title:   entry.title,
      quality: 'Auto',
      type:    'hls',
      headers: {}
    });
  }

  return Promise.resolve(null);
}

// ── Eşleştirme ────────────────────────────────────────────────
function findMatches(entries, tmdbInfo, tmdbId, posterPath) {
  var matches = [];

  entries.forEach(function(e) {
    var score = 0;

    // 1. TMDB poster path eşleşmesi — en güvenilir
    if (posterPath && e.tmdbPosterPath) {
      var ep = e.tmdbPosterPath.replace(/^\//, '');
      var tp = posterPath.replace(/^\//, '');
      if (ep === tp) { score += 10; }
    }

    // 2. IMDb ID eşleşmesi
    // (IMDb ID -> TMDB dönüşümü async olduğu için bu sync adımda atlıyoruz,
    //  imdbId'li entry'ler ayrı ele alınıyor)

    // 3. Başlık + yıl eşleşmesi
    var titleSc = titleScore(e.title, tmdbInfo.titleTr, tmdbInfo.titleEn);
    score += titleSc;

    if (e.year && tmdbInfo.year && e.year === tmdbInfo.year) score += 2;

    if (score > 0) matches.push({ entry: e, score: score });
  });

  // Skor'a göre sırala
  matches.sort(function(a, b) { return b.score - a.score; });
  console.log('[M3U] Eslesen entry: ' + matches.length +
    (matches.length > 0 ? ' (en yüksek skor: ' + matches[0].score + ')' : ''));

  // Minimum skor eşiği
  return matches.filter(function(m) { return m.score >= 2; });
}

// ── getStreams ────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[M3U] getStreams -> tmdbId=' + tmdbId + ' type=' + mediaType);

  var tmdbInfo;

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      tmdbInfo = info;
      console.log('[M3U] TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ') poster=' + info.posterPath);
      return fetchM3u();
    })
    .then(function(entries) {
      var posterPath = tmdbInfo.posterPath ? tmdbInfo.posterPath.replace(/^\//, '') : '';
      var matches = findMatches(entries, tmdbInfo, tmdbId, posterPath);

      if (matches.length === 0) {
        console.log('[M3U] Eşleşme bulunamadı');
        return [];
      }

      // İlk 5 eşleşmeden stream üret (duplicate URL'leri filtrele)
      var top     = matches.slice(0, 5);
      var seenUrl = {};
      var streamPromises = [];

      top.forEach(function(m) {
        var key = m.entry.url;
        if (seenUrl[key]) return;
        seenUrl[key] = true;
        streamPromises.push(entryToStream(m.entry));
      });

      return Promise.all(streamPromises).then(function(streams) {
        return streams.filter(Boolean);
      });
    })
    .then(function(streams) {
      console.log('[M3U] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[M3U] Hata: ' + err.message);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
