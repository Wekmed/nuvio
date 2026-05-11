/**
 * FullHDFilmizlesene Nuvio Scraper - v30.1
 * async/await YOK — saf ES5 Promise zinciri
 * Eşleştirme: token tabanlı, yanlış film sorunu çözüldü.
 */

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.fullhdfilmizlesene.live";
var API_BASE  = "https://www.fullhdfilmizlesene.live/player/api.php";

var WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Origin':  BASE_URL
};

// ── Normalize ────────────────────────────────────────────────
function normalize(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
        .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
        .replace(/[^a-z0-9\s]/g,' ')
        .replace(/\s+/g,' ')
        .trim();
}

// ── Token tabanlı eşleştirme skoru ──────────────────────────
function matchScore(siteTitle, candidateTitles) {
    var normSite   = normalize(siteTitle);
    var siteTokens = normSite.split(' ');
    var best = 0;

    for (var i = 0; i < candidateTitles.length; i++) {
        var normCand   = normalize(candidateTitles[i]);
        var candTokens = normCand.split(' ');

        // Birebir tam eşleşme
        if (normSite === normCand) return 1000;

        // Token sayısı eşit + tüm tokenlar eşleşiyor
        if (siteTokens.length === candTokens.length) {
            var allMatch = true;
            for (var j = 0; j < siteTokens.length; j++) {
                if (siteTokens[j] !== candTokens[j]) { allMatch = false; break; }
            }
            if (allMatch) { best = Math.max(best, 900); continue; }
        }

        // Ortak token oranı
        var common = 0;
        for (var k = 0; k < siteTokens.length; k++) {
            if (candTokens.indexOf(siteTokens[k]) !== -1) common++;
        }
        var ratio = common / Math.max(siteTokens.length, candTokens.length);

        // Token sayısı FARKLI → maks 200 puan (Cars ≠ Cars 3 koruması)
        if (siteTokens.length !== candTokens.length) {
            best = Math.max(best, Math.round(ratio * 200));
        } else if (ratio > 0.8) {
            best = Math.max(best, Math.round(ratio * 500));
        }
    }
    return best;
}

// ── Base64 / RapidVid decode ─────────────────────────────────
function universalAtob(str) {
    try {
        if (typeof atob === 'function') return atob(str);
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        var out = ''; str = String(str).replace(/[=]+$/, '');
        for (var bc = 0, bs, buffer, idx = 0;
             buffer = str.charAt(idx++);
             ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4)
                 ? out += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
            buffer = chars.indexOf(buffer);
        }
        return out;
    } catch (e) { return null; }
}

function decodeRapidVid(encodedData) {
    try {
        if (!encodedData) return null;
        var reversed     = encodedData.split('').reverse().join('');
        var decodedBin   = universalAtob(reversed.replace(/[^A-Za-z0-9+/=]/g, ''));
        var key          = 'K9L';
        var adjusted     = '';
        for (var i = 0; i < decodedBin.length; i++) {
            var shift = (key.charCodeAt(i % key.length) % 5) + 1;
            adjusted += String.fromCharCode(decodedBin.charCodeAt(i) - shift);
        }
        var finalUrl = universalAtob(adjusted);
        return (finalUrl && finalUrl.startsWith('http')) ? finalUrl.replace(/\\/g, '').trim() : null;
    } catch (e) { return null; }
}

// ── Atom stream ──────────────────────────────────────────────
function fetchAtom(vidid, movieTitle) {
    return fetch(API_BASE + '?id=' + vidid + '&type=t&name=atom&get=video&format=json', { headers: WORKING_HEADERS })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.html) return null;
            var playerUrl = data.html.replace(/\\/g, '');
            return fetch(playerUrl, { headers: WORKING_HEADERS })
                .then(function(r2) { return r2.text(); })
                .then(function(html) {
                    var m = html.match(/av\(['"]([^'"]+)['"]\)/);
                    if (!m) return null;
                    var url = decodeRapidVid(m[1]);
                    if (!url) return null;
                    return {
                        name:    movieTitle,
                        title:   '⌜ FULLHDFILM ⌟ | Atom | 🇹🇷 Dublaj',
                        url:     url,
                        quality: 'Auto',
                        headers: WORKING_HEADERS
                    };
                });
        })
        .catch(function() { return null; });
}

// ── Turbo stream ─────────────────────────────────────────────
function fetchTurbo(vidid, movieTitle) {
    return fetch(API_BASE + '?id=' + vidid + '&type=t&name=advid&get=video&pno=tr&format=json', { headers: WORKING_HEADERS })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.html || data.html.indexOf('/watch/') === -1) return null;
            var watchIdMatch = data.html.match(/\/watch\/(.*?)"/);
            if (!watchIdMatch) return null;
            var watchId  = watchIdMatch[1];
            var playUrl  = 'https://turbo.imgz.me/play/' + watchId + '?autoplay=true';
            var playHdrs = Object.assign({}, WORKING_HEADERS, { 'Referer': BASE_URL });
            return fetch(playUrl, { headers: playHdrs })
                .then(function(r2) { return r2.text(); })
                .then(function(html) {
                    var m = html.match(/file:\s*"(.*?\.m3u8.*?)"/i);
                    if (!m) return null;
                    return {
                        name:    movieTitle,
                        title:   '⌜ FULLHDFILM ⌟ | Turbo | 🇹🇷 Dublaj',
                        url:     m[1],
                        quality: 'Auto',
                        headers: Object.assign({}, WORKING_HEADERS, { 'Referer': 'https://turbo.imgz.me/' })
                    };
                });
        })
        .catch(function() { return null; });
}

function getStreamsFromAPI(vidid, movieTitle) {
    return Promise.all([fetchAtom(vidid, movieTitle), fetchTurbo(vidid, movieTitle)])
        .then(function(results) {
            return results.filter(function(r) { return r !== null; });
        });
}

// ── Arama + güvenli eşleştirme ───────────────────────────────
function searchAndMatch(query, allTitles, targetYear) {
    var searchUrl = BASE_URL + '/arama/' + encodeURIComponent(query);
    console.error('[FULLHDFILM] Aranıyor: ' + searchUrl + ' | Hedef yıl: ' + targetYear);

    return fetch(searchUrl, { headers: WORKING_HEADERS })
        .then(function(r) { return r.text(); })
        .then(function(html) {
            var $ = cheerio.load(html);
            var candidates = [];

            $('ul.list li.film').each(function(i, el) {
                var link      = $(el).find('a.tt').attr('href');
                var siteTitle = $(el).find('.film-title').text().trim();
                var siteYear  = $(el).find('.film-yil').text().trim();

                if (!link || !siteTitle) return;

                // Yıl kesin eşleşmeli (yılsız fallback geçişinde targetYear='')
                if (targetYear && siteYear !== targetYear) {
                    console.error('[FULLHDFILM] Yıl uyuşmadı → ' + siteTitle + ' (' + siteYear + ')');
                    return;
                }

                var score = matchScore(siteTitle, allTitles);
                console.error('[FULLHDFILM] Aday: ' + siteTitle + ' (' + siteYear + ') → ' + score + ' puan');

                if (score >= 500) {
                    candidates.push({ link: link, score: score, title: siteTitle, year: siteYear });
                }
            });

            if (candidates.length === 0) return null;

            candidates.sort(function(a, b) { return b.score - a.score; });
            var best = candidates[0];
            console.error('[FULLHDFILM] SEÇİLEN: ' + best.title + ' (' + best.year + ') → ' + best.score + ' puan');
            return best.link;
        })
        .catch(function(e) {
            console.error('[FULLHDFILM] Arama hatası: ' + e.message);
            return null;
        });
}

// ── Film sayfasından stream al ────────────────────────────────
function fetchFilmStreams(filmUrl, movieTitle) {
    var fullUrl = filmUrl.startsWith('http') ? filmUrl : BASE_URL + filmUrl;
    return fetch(fullUrl, { headers: WORKING_HEADERS })
        .then(function(r) { return r.text(); })
        .then(function(html) {
            var m = html.match(/vidid\s*=\s*['"](\d+)['"]/);
            if (!m) {
                console.error('[FULLHDFILM] vidid bulunamadı.');
                return [];
            }
            return getStreamsFromAPI(m[1], movieTitle);
        });
}

// ── Ana zincir ────────────────────────────────────────────────
function getStreams(tmdbId, mediaType) {
    if (mediaType !== 'movie') return Promise.resolve([]);

    return fetch('https://api.themoviedb.org/3/movie/' + tmdbId
            + '?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96&append_to_response=alternative_titles')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var targetYear = data.release_date ? data.release_date.split('-')[0] : '';
            var titleTr    = data.title || '';
            var titleEn    = data.original_title || '';

            var allTitles = [titleTr, titleEn];
            if (data.alternative_titles && data.alternative_titles.titles) {
                data.alternative_titles.titles.forEach(function(t) {
                    if (t.title) allTitles.push(t.title);
                });
            }
            allTitles = allTitles.filter(function(t, idx, arr) {
                return t && arr.indexOf(t) === idx;
            });

            console.error('[FULLHDFILM] === Başlıyor: ' + titleTr + ' / ' + titleEn + ' (' + targetYear + ') ===');

            var movieTitle = titleTr || titleEn;

            // 1. TR başlıkla ara
            return searchAndMatch(titleTr || titleEn, allTitles, targetYear)
                .then(function(filmUrl) {
                    if (filmUrl) return fetchFilmStreams(filmUrl, movieTitle);

                    // 2. EN başlıkla dene
                    if (titleEn && titleEn !== titleTr) {
                        console.error('[FULLHDFILM] TR ile bulunamadı, EN deneniyor...');
                        return searchAndMatch(titleEn, allTitles, targetYear)
                            .then(function(url2) {
                                if (url2) return fetchFilmStreams(url2, movieTitle);

                                // 3. Yılsız fallback
                                console.error('[FULLHDFILM] Yılsız fallback deneniyor...');
                                return searchAndMatch(titleTr || titleEn, allTitles, '')
                                    .then(function(url3) {
                                        if (url3) return fetchFilmStreams(url3, movieTitle);
                                        console.error('[FULLHDFILM] Film bulunamadı.');
                                        return [];
                                    });
                            });
                    }

                    // 3. Yılsız fallback (EN yoksa)
                    console.error('[FULLHDFILM] Yılsız fallback deneniyor...');
                    return searchAndMatch(titleTr, allTitles, '')
                        .then(function(url3) {
                            if (url3) return fetchFilmStreams(url3, movieTitle);
                            console.error('[FULLHDFILM] Film bulunamadı.');
                            return [];
                        });
                });
        })
        .catch(function(e) {
            console.error('[FULLHDFILM] Genel hata: ' + e.message);
            return [];
        });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    globalThis.getStreams = getStreams;
                                         }
              
