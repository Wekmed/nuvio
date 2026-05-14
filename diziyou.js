/**
 * DiziYou Provider for Nuvio
 * 
 * Kaynak: DiziYou CloudStream eklentisinden uyarlanmıştır.
 * Yazar: Nuvio uyarlaması
 * 
 * Nasıl çalışır:
 *  1. Domain listesi GitHub'dan dinamik olarak çekilir
 *  2. Ana sayfa / arama / detay sayfası HTML parse edilir (jsoup → regex/string)
 *  3. Her bölüm için /{slug}/play.m3u8 ve /{slug}_tr/play.m3u8 doğrudan döner
 *  4. /subtitles/ altından TR ve EN altyazı (.vtt) sunulur
 * 
 * Şifreleme: YOK  |  Cloudflare: YOK  |  Hermes uyumlu: EVET
 */

// ─── Sabitler ───────────────────────────────────────────────────────────────

var DOMAIN_LIST_URL =
  'https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt';

var CACHE_DURATION_MS = 60 * 60 * 1000; // 1 saat

var PROVIDER_NAME = 'DiziYou';

var USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

// ─── Domain Yönetimi ────────────────────────────────────────────────────────

var _cachedDomain = null;
var _lastDomainUpdate = 0;

/**
 * GitHub'daki domain listesinden DiziYou domaini bulur.
 * Liste formatı (her satırda): PluginAdı=https://domain.com
 */
function getDomain() {
  var now = Date.now();

  // Cache geçerliyse direkt dön
  if (_cachedDomain && (now - _lastDomainUpdate) < CACHE_DURATION_MS) {
    return Promise.resolve(_cachedDomain);
  }

  return fetch(DOMAIN_LIST_URL)
    .then(function (res) {
      if (!res.ok) throw new Error('Domain listesi alınamadı: ' + res.status);
      return res.text();
    })
    .then(function (text) {
      var lines = text.split('\n');
      var domain = null;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        // "DiziYou=https://..." formatını ara
        if (line.toLowerCase().startsWith('|DiziYou:')) {
          domain = line.split('=').slice(1).join('=').trim();
          break;
        }
      }

      if (!domain) {
        // Fallback: listedeki ilk geçerli URL'yi dene
        console.error('[DiziYou] Domain listesinde DiziYou bulunamadı, fallback deneniyor');
        domain = 'https://www.diziyou.one'; // son bilinen domain
      }

      // Trailing slash temizle
      domain = domain.replace(/\/$/, '');
      _cachedDomain = domain;
      _lastDomainUpdate = Date.now();
      console.log('[DiziYou] Aktif domain: ' + domain);
      return domain;
    })
    .catch(function (err) {
      console.error('[DiziYou] getDomain hatası: ' + err.message);
      // Cache varsa eski değeri kullan
      if (_cachedDomain) return _cachedDomain;
      return 'https://diziyou.co';
    });
}

// ─── HTTP Yardımcıları ───────────────────────────────────────────────────────

function httpGet(url, extraHeaders) {
  var headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  };

  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (k) {
      headers[k] = extraHeaders[k];
    });
  }

  return fetch(url, { headers: headers })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
      return res.text();
    });
}

// ─── HTML Parse Yardımcıları ─────────────────────────────────────────────────

/** Basit regex tabanlı attribute çıkarımı */
function attr(html, selector, attrName) {
  // data-src veya href gibi attribute'ları çeker
  // Not: tam jsoup değil, DiziYou'nun kullandığı selector'ları karşılayacak kadar yeterli
  var re = new RegExp(
    '<[^>]+' + attrName + '=["\']([^"\']+)["\'][^>]*>',
    'i'
  );
  var m = html.match(re);
  return m ? m[1].trim() : null;
}

/** Etiket içindeki text'i çeker */
function innerText(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

/** Tüm eşleşmeleri dizi olarak döner */
function matchAll(str, re) {
  var results = [];
  var m;
  var globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = globalRe.exec(str)) !== null) {
    results.push(m);
  }
  return results;
}

// ─── Türkçe tarih parse ───────────────────────────────────────────────────────

var MONTHS = {
  'Ocak': '01', 'Şubat': '02', 'Mart': '03', 'Nisan': '04',
  'Mayıs': '05', 'Haziran': '06', 'Temmuz': '07', 'Ağustos': '08',
  'Eylül': '09', 'Ekim': '10', 'Kasım': '11', 'Aralık': '12',
};

function parseTurkishDate(dateStr) {
  if (!dateStr) return null;
  var parts = dateStr.trim().split(' ');
  if (parts.length < 3) return null;
  var day = parts[0].replace('.', '').padStart(2, '0');
  var month = MONTHS[parts[1]] || '01';
  var year = parts[2];
  return year + '-' + month + '-' + day;
}

// ─── Ana Sayfa Scraping ──────────────────────────────────────────────────────

/**
 * Ana sayfadan dizi listesini parse eder.
 * CSS selectors (CloudStream orijinalinden):
 *   - Liste container:  div#list-series-main, div.single-item
 *   - Poster:           div.cat-img-main img, div.cat-img img  [data-src veya src]
 *   - Başlık+Link:      div.cat-title-main a, div#categorytitle a
 */
function parseHomePage(html, baseUrl) {
  var results = [];

  // div.single-item bloklarını bul
  var blockRe = /<div[^>]+class="[^"]*single-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  var blocks = matchAll(html, blockRe);

  if (blocks.length === 0) {
    // Alternatif: div#list-series-main içindeki a etiketleri
    var linkRe = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"[^>]*>[\s\S]*?<\/a>/g;
    blocks = matchAll(html, linkRe).map(function (m) {
      return { href: m[1], img: m[2], title: '' };
    });
  }

  // Her bloğu işle
  var itemRe = /href="([^"]+)"/;
  var imgRe = /(?:data-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i;
  var titleRe = /<a[^>]*>([^<]+)<\/a>/;

  // Daha güvenli: Tüm HTML'den dizi kartlarını çek
  // DiziYou formatı: <div class="single-item"> içinde <a href>, <img data-src>, <div class="cat-title-main">
  var cardPattern = /<div[^>]+class="[^"]*(?:single-item|cat-item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>)?/g;
  var cards = matchAll(html, cardPattern);

  cards.forEach(function (card) {
    var content = card[1] || card[0];

    var hrefMatch = content.match(/href="([^"]+)"/);
    var imgMatch = content.match(/(?:data-src|src)="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
    var titleMatch = content.match(/<(?:a|div)[^>]*>([^<]{2,60})<\/(?:a|div)>/);

    if (!hrefMatch) return;

    var href = hrefMatch[1];
    if (!href.startsWith('http')) {
      href = baseUrl + (href.startsWith('/') ? '' : '/') + href;
    }

    var poster = imgMatch ? imgMatch[1] : '';
    if (poster && !poster.startsWith('http')) {
      poster = baseUrl + (poster.startsWith('/') ? '' : '/') + poster;
    }

    var title = titleMatch ? innerText(titleMatch[0]) : '';
    if (!title || title.length < 2) return;

    results.push({
      id: href,
      title: title.trim(),
      poster: poster,
      type: 'tv',
    });
  });

  return results;
}

// ─── Arama Scraping ──────────────────────────────────────────────────────────

/**
 * Arama sonuçlarını parse eder.
 * CloudStream'de: /?s={query}
 * Selector: div#list-series-main içindeki kartlar
 */
function parseSearch(html, baseUrl) {
  return parseHomePage(html, baseUrl); // Aynı kart yapısını kullanır
}

// ─── Dizi Detay Scraping ─────────────────────────────────────────────────────

/**
 * Dizi sayfasını parse eder.
 * CloudStream'den çıkarılan selectors:
 *   - Açıklama:    div.diziyou_desc
 *   - IMDB:        span.dizimeta:contains(IMDB)  → kardeş node
 *   - Yapım yılı:  span.dizimeta:contains(Yapım) → kardeş node
 *   - Oyuncular:   span.dizimeta:contains(Oyuncular) → kardeş node
 *   - Türler:      div.genres a
 *   - Poster:      div.category_image img
 *   - Bölümler:    div.bolumust içinde div.bolumismi a
 *   - Sezon:       (\\d+)\\. Sezon regex
 *   - Bölüm no:    (\\d+)\\. Bölüm regex (ya da B\\d+)
 */
function parseDetail(html, baseUrl) {
  var detail = {
    title: '',
    description: '',
    poster: '',
    year: null,
    rating: null,
    genres: [],
    actors: [],
    episodes: [],
  };

  // Başlık
  var titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) detail.title = innerText(titleMatch[0]);

  // Poster
  var posterMatch = html.match(/<div[^>]+class="[^"]*category.?image[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/i);
  if (posterMatch) {
    detail.poster = posterMatch[1];
    if (!detail.poster.startsWith('http')) detail.poster = baseUrl + detail.poster;
  }

  // Açıklama
  var descMatch = html.match(/<div[^>]+class="[^"]*diziyou.desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) detail.description = innerText(descMatch[1]).trim();

  // IMDB skoru
  var imdbMatch = html.match(/class="[^"]*cat-imdb[^"]*"[^>]*>\s*([0-9.]+)/i);
  if (imdbMatch) detail.rating = parseFloat(imdbMatch[1]);

  // Türler
  var genreRe = /<div[^>]+class="[^"]*genres[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  var genreBlock = html.match(genreRe);
  if (genreBlock) {
    var genreLinkRe = /<a[^>]*>([^<]+)<\/a>/g;
    var gm;
    while ((gm = genreLinkRe.exec(genreBlock[1])) !== null) {
      detail.genres.push(innerText(gm[0]));
    }
  }

  // Yıl — "2024 Yapım" gibi metinden
  var yearMatch = html.match(/(\d{4})\s*Yap[ıi]m/i);
  if (yearMatch) detail.year = parseInt(yearMatch[1]);

  // Bölümler — div.bolumust blokları
  var episodeBlocks = matchAll(html, /<div[^>]+class="[^"]*bolumust[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g);

  episodeBlocks.forEach(function (block) {
    var content = block[1] || block[0];

    // Bölüm linki
    var epHrefMatch = content.match(/href="([^"]+)"/);
    if (!epHrefMatch) return;

    var epHref = epHrefMatch[1];
    if (!epHref.startsWith('http')) epHref = baseUrl + epHref;

    // Bölüm adı
    var epNameMatch = content.match(/<div[^>]+class="[^"]*bolumismi[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    var epName = epNameMatch ? innerText(epNameMatch[1]) : '';

    // Sezon numarası — "1. Sezon" formatından
    var seasonMatch = epName.match(/(\d+)\.\s*Sezon/i);
    var season = seasonMatch ? parseInt(seasonMatch[1]) : 1;

    // Bölüm numarası — "1. Bölüm" veya "B01" formatından
    var epNumMatch = epName.match(/(\d+)\.\s*B[oö]l[uü]m/i) || epName.match(/B(\d+)/i);
    var episode = epNumMatch ? parseInt(epNumMatch[1]) : null;

    // Tarih
    var dateMatch = content.match(/<div[^>]+class="[^"]*tarih[^"]*"[^>]*>([^<]+)<\/div>/i);
    var date = dateMatch ? parseTurkishDate(dateMatch[1]) : null;

    detail.episodes.push({
      id: epHref,
      title: epName.trim(),
      season: season,
      episode: episode,
      date: date,
      url: epHref,
    });
  });

  // Tersine çevir (genellikle ters sırada gelir)
  detail.episodes.reverse();

  return detail;
}

// ─── Stream Çekme ────────────────────────────────────────────────────────────

/**
 * Bölüm sayfasından stream URL'lerini çeker.
 * 
 * DiziYou'nun mekanizması (DEX'ten tersine mühendislik):
 *   1. Bölüm sayfasını çek (epUrl)
 *   2. iframe#diziyouPlayer src'sini bul
 *   3. Player sayfasından slug çek → /play.m3u8 ve /_tr/play.m3u8 döner
 *   4. /subtitles/ altından /tr.vtt ve /en.vtt altyazı
 * 
 * Stream nesnesi formatı (Nuvio):
 *   { name, title, url, quality, headers, subtitles }
 */
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DiziYou] getStreams çağrıldı — tmdbId:' + tmdbId +
    ' type:' + mediaType + ' S' + season + 'E' + episode);

  // DiziYou TMDB ID üzerinden doğrudan çalışmaz,
  // önce arama yapıp URL bulmamız gerekiyor.
  // Bu provider search-first yaklaşımı kullanır.

  // Nuvio title bilgisi olmadan çalışmak için
  // tmdbId'yi TMDB API'sinden title'a çeviriyoruz
  var TMDB_KEY = 'c4ffcab48dfaa7b41625ac13d61aec31'; // DiziYou'nun kendi key'i (DEX'ten)

  return getDomain()
    .then(function (baseUrl) {
      // TMDB'den Türkçe başlık al
      var tmdbUrl = mediaType === 'movie'
        ? 'https://api.themoviedb.org/3/movie/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=tr-TR'
        : 'https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=tr-TR';

      return fetch(tmdbUrl)
        .then(function (r) { return r.json(); })
        .then(function (tmdbData) {
          var title = tmdbData.name || tmdbData.title || tmdbData.original_name || tmdbData.original_title;
          if (!title) throw new Error('TMDB başlık bulunamadı');
          console.log('[DiziYou] TMDB başlık: ' + title);
          return searchAndGetStreams(baseUrl, title, mediaType, season, episode);
        });
    })
    .catch(function (err) {
      console.error('[DiziYou] getStreams hatası: ' + err.message);
      return [];
    });
}

function searchAndGetStreams(baseUrl, title, mediaType, season, episode) {
  var searchUrl = baseUrl + '/?s=' + encodeURIComponent(title);
  console.log('[DiziYou] Arama URL: ' + searchUrl);

  return httpGet(searchUrl, { Referer: baseUrl + '/' })
    .then(function (html) {
      var results = parseSearch(html, baseUrl);
      console.log('[DiziYou] Arama sonuçları: ' + results.length);

      if (results.length === 0) return [];

      // En iyi eşleşmeyi bul (başlık benzerliği)
      var best = findBestMatch(results, title);
      if (!best) return [];

      console.log('[DiziYou] Seçilen: ' + best.title + ' → ' + best.id);

      if (mediaType === 'movie') {
        return getMovieStreams(baseUrl, best.id);
      } else {
        return getEpisodeStreams(baseUrl, best.id, season, episode);
      }
    });
}

function findBestMatch(results, query) {
  var q = query.toLowerCase().trim();
  var best = null;
  var bestScore = -1;

  results.forEach(function (r) {
    var t = r.title.toLowerCase().trim();
    var score = 0;

    if (t === q) score = 100;
    else if (t.includes(q) || q.includes(t)) score = 50;
    else {
      // Kelime bazlı benzerlik
      var qWords = q.split(/\s+/);
      var tWords = t.split(/\s+/);
      var common = qWords.filter(function (w) { return tWords.includes(w); }).length;
      score = (common / Math.max(qWords.length, tWords.length)) * 40;
    }

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  });

  return bestScore > 10 ? best : null;
}

function getMovieStreams(baseUrl, showUrl) {
  return httpGet(showUrl, { Referer: baseUrl + '/' })
    .then(function (html) {
      return extractStreamsFromPage(html, showUrl, baseUrl);
    });
}

function getEpisodeStreams(baseUrl, showUrl, season, episode) {
  console.log('[DiziYou] Dizi sayfası çekiliyor: ' + showUrl);

  return httpGet(showUrl, { Referer: baseUrl + '/' })
    .then(function (html) {
      var detail = parseDetail(html, baseUrl);
      console.log('[DiziYou] Toplam bölüm: ' + detail.episodes.length);

      // Doğru bölümü bul
      var targetEp = null;
      for (var i = 0; i < detail.episodes.length; i++) {
        var ep = detail.episodes[i];
        if (ep.season === season && ep.episode === episode) {
          targetEp = ep;
          break;
        }
      }

      // Bulunamazsa sezon/bölüm sırasına göre dene
      if (!targetEp && detail.episodes.length > 0) {
        // Sezon 1 ve bölüm numarasına göre index
        var idx = episode ? episode - 1 : 0;
        // Önce bu sezona ait bölümleri filtrele
        var seasonEps = detail.episodes.filter(function (e) { return e.season === season; });
        targetEp = seasonEps[idx] || detail.episodes[idx] || null;
      }

      if (!targetEp) {
        console.error('[DiziYou] Bölüm bulunamadı S' + season + 'E' + episode);
        return [];
      }

      console.log('[DiziYou] Bölüm URL: ' + targetEp.url);
      return httpGet(targetEp.url, { Referer: showUrl })
        .then(function (epHtml) {
          return extractStreamsFromPage(epHtml, targetEp.url, baseUrl);
        });
    });
}

/**
 * Bölüm/film sayfasından stream URL'lerini çıkarır.
 * 
 * DiziYou mekanizması:
 *   iframe#diziyouPlayer → player URL → slug → /play.m3u8
 */
function extractStreamsFromPage(html, pageUrl, baseUrl) {
  var streams = [];

  // 1. iframe#diziyouPlayer src'sini bul
  var iframeMatch = html.match(/id="diziyouPlayer"[^>]+src="([^"]+)"/i)
    || html.match(/iframe[^>]+src="([^"]+)"[^>]*id="diziyouPlayer"/i)
    || html.match(/<iframe[^>]+id="diziyouPlayer"[^>]*src="([^"]+)"/i);

  if (!iframeMatch) {
    // Genel iframe ara
    iframeMatch = html.match(/<iframe[^>]+src="([^"]+(?:player|embed|watch)[^"]+)"/i);
  }

  if (!iframeMatch) {
    console.error('[DiziYou] iframe bulunamadı');
    return [];
  }

  var playerUrl = iframeMatch[1];
  if (!playerUrl.startsWith('http')) {
    playerUrl = baseUrl + (playerUrl.startsWith('/') ? '' : '/') + playerUrl;
  }

  console.log('[DiziYou] Player URL: ' + playerUrl);

  return httpGet(playerUrl, { Referer: pageUrl })
    .then(function (playerHtml) {
      // Player HTML'inden slug veya doğrudan m3u8 bul

      // Doğrudan .m3u8 URL varsa
      var m3u8Direct = playerHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i);
      if (m3u8Direct) {
        streams.push({
          name: PROVIDER_NAME,
          title: 'DiziYou — TR Altyazılı',
          url: m3u8Direct[1],
          quality: '1080p',
          headers: { Referer: playerUrl, 'User-Agent': USER_AGENT },
        });
        return addSubtitles(streams, playerUrl, baseUrl);
      }

      // /play.m3u8 path'ini slug'dan oluştur
      // Player URL'si genellikle: https://domain.com/episodes/slug-sXeX/
      var slugMatch = playerUrl.match(/\/([^\/]+)\/?$/)
        || playerUrl.match(/\/episodes\/([^\/]+)/);

      if (slugMatch) {
        var slug = slugMatch[1].replace(/\/$/, '');
        var playerBase = playerUrl.replace(/\/[^\/]+\/?$/, '');

        // Türkçe altyazılı stream
        var m3u8Tr = playerBase + '/' + slug + '/play.m3u8';
        // Türkçe dublaj stream
        var m3u8TrDub = playerBase + '/' + slug + '_tr/play.m3u8';

        streams.push({
          name: PROVIDER_NAME,
          title: 'DiziYou — Türkçe Altyazı',
          url: m3u8Tr,
          quality: '1080p',
          headers: { Referer: playerUrl, 'User-Agent': USER_AGENT },
        });

        streams.push({
          name: PROVIDER_NAME,
          title: 'DiziYou — Türkçe Dublaj',
          url: m3u8TrDub,
          quality: '1080p',
          headers: { Referer: playerUrl, 'User-Agent': USER_AGENT },
        });
      }

      // streamUrls veya sources JSON'dan çek
      var sourcesMatch = playerHtml.match(/(?:streamUrls|sources|files)\s*[:=]\s*(\[[\s\S]*?\])/i);
      if (sourcesMatch) {
        try {
          var sources = JSON.parse(sourcesMatch[1]);
          sources.forEach(function (s) {
            var url = s.file || s.url || s.src;
            var label = s.label || s.quality || s.name || '';
            if (url && url.includes('m3u8')) {
              streams.push({
                name: PROVIDER_NAME,
                title: 'DiziYou — ' + label,
                url: url,
                quality: label || '1080p',
                headers: { Referer: playerUrl, 'User-Agent': USER_AGENT },
              });
            }
          });
        } catch (e) {
          console.error('[DiziYou] sources JSON parse hatası: ' + e.message);
        }
      }

      return addSubtitles(streams, playerUrl, baseUrl);
    });
}

/**
 * Altyazıları stream listesine ekler.
 * DiziYou altyazı pathleri: /subtitles/tr.vtt ve /subtitles/en.vtt
 */
function addSubtitles(streams, playerUrl, baseUrl) {
  if (streams.length === 0) return streams;

  // Player URL'sinden base path çıkar
  var playerBase = playerUrl.replace(/\/[^\/]+\/?$/, '');
  var trVtt = playerBase + '/subtitles/tr.vtt';
  var enVtt = playerBase + '/subtitles/en.vtt';

  // Her stream'e altyazı ekle
  streams.forEach(function (s) {
    s.subtitles = [
      { language: 'tr', url: trVtt, label: 'Türkçe' },
      { language: 'en', url: enVtt, label: 'İngilizce' },
    ];
  });

  return streams;
}

// ─── Export ──────────────────────────────────────────────────────────────────

module.exports = { getStreams: getStreams };
