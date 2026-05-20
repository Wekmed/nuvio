/** DiziPal Orijinal — Nuvio Provider | v1.1.1 */
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/dizipal/constants.js
var DOMAIN_LIST_URL = "https://raw.githubusercontent.com/Kraptor123/domainListesi/refs/heads/main/eklenti_domainleri.txt";
var FALLBACK_DOMAIN = "https://dizipal1553.com";
var TMDB_API_KEY = "c4ffcab48dfaa7b41625ac13d61aec31";
var TMDB_BASE = "https://api.themoviedb.org/3";
var BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Connection": "keep-alive"
};
var BEplayer_KEY_PREFIX = "Kekik_";

// src/dizipal/utils.js
var _cachedDomain = null;
function getActiveDomain() {
  return __async(this, null, function* () {
    if (typeof global !== "undefined" && global.__dizipalDomain) {
      _cachedDomain = global.__dizipalDomain;
      return _cachedDomain;
    }
    if (_cachedDomain) return _cachedDomain;
    try {
      const resp = yield fetch(DOMAIN_LIST_URL, { headers: BASE_HEADERS });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = yield resp.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.toLowerCase().includes("dizipal")) continue;
        const urlMatch = line.match(/https?:\/\/[^\s|,]+/);
        if (urlMatch) {
          _cachedDomain = urlMatch[0].replace(/\/$/, "");
          console.log(`[DiziPal] Domain bulundu: ${_cachedDomain}`);
          return _cachedDomain;
        }
      }
    } catch (e) {
      console.warn(`[DiziPal] Domain listesi al\u0131namad\u0131: ${e.message}`);
    }
    _cachedDomain = FALLBACK_DOMAIN;
    console.log(`[DiziPal] Fallback domain: ${_cachedDomain}`);
    return _cachedDomain;
  });
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, extraHeaders = {}) {
    const headers = __spreadValues(__spreadValues({}, BASE_HEADERS), extraHeaders);
    let resp = yield fetch(url, { headers });
    if ((resp.status === 403 || resp.status === 503) && typeof Cloudflare !== "undefined") {
      try {
        console.log(`[DiziPal] Cloudflare engeli, bypass deneniyor: ${url}`);
        const solved = yield Cloudflare.solve(url);
        if (solved) {
          if (solved["Cookie"]) headers["Cookie"] = solved["Cookie"];
          if (solved["User-Agent"]) headers["User-Agent"] = solved["User-Agent"];
          resp = yield fetch(url, { headers });
        }
      } catch (cfErr) {
        console.warn(`[DiziPal] CF bypass ba\u015Far\u0131s\u0131z: ${cfErr.message}`);
      }
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status} \u2014 ${url}`);
    return resp.text();
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, extraHeaders = {}) {
    const text = yield fetchText(url, __spreadValues({ Accept: "application/json" }, extraHeaders));
    return JSON.parse(text);
  });
}
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const type = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=tr-TR`;
    const data = yield fetchJson(url);
    return {
      title: data.name || data.title || "",
      originalTitle: data.original_name || data.original_title || "",
      year: (data.first_air_date || data.release_date || "").split("-")[0] || null
    };
  });
}
function decryptBePlayer(encryptedData, password) {
  try {
    if (typeof CryptoJS === "undefined") {
      console.warn("[DiziPal] CryptoJS bulunamad\u0131");
      return encryptedData;
    }
    const saltMatch = encryptedData.match(/salt\s*=\s*([0-9a-fA-F]+)/);
    const ivMatch = encryptedData.match(/iv\s*=\s*([0-9a-fA-F]+)/);
    const bodyPart = encryptedData.split("\n").pop().trim();
    if (saltMatch && ivMatch) {
      const salt = CryptoJS.enc.Hex.parse(saltMatch[1]);
      const iv = CryptoJS.enc.Hex.parse(ivMatch[1]);
      const key = CryptoJS.PBKDF2(password, salt, {
        keySize: 256 / 32,
        iterations: 1e3,
        hasher: CryptoJS.algo.SHA1
      });
      const decrypted = CryptoJS.AES.decrypt(bodyPart, key, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      return decrypted.toString(CryptoJS.enc.Utf8);
    }
    return atob(encryptedData);
  } catch (e) {
    console.warn(`[DiziPal] \u015Eifre \xE7\xF6zme hatas\u0131: ${e.message}`);
    return null;
  }
}
function extractQuality(url = "") {
  const m = url.match(/(\d{3,4})[pP]/);
  if (m) return `${m[1]}p`;
  if (url.includes(".m3u8")) return "Auto";
  if (url.includes("4k") || url.includes("2160")) return "4K";
  if (url.includes("1080")) return "1080p";
  if (url.includes("720")) return "720p";
  if (url.includes("480")) return "480p";
  return "Auto";
}
function deduplicateStreams(streams) {
  const seen = /* @__PURE__ */ new Set();
  return streams.filter((s) => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
function normTitle(s) {
  return (s || "").toLowerCase().replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim();
}

// src/dizipal/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    console.log(`[DiziPal] Ba\u015Fl\u0131yor \u2014 ${mediaType} ${tmdbId} S${season}E${episode}`);
    const streams = [];
    try {
      const domain = yield getActiveDomain();
      const info = yield getTmdbInfo(tmdbId, mediaType);
      if (!info.title) {
        console.warn("[DiziPal] TMDB ba\u015Fl\u0131\u011F\u0131 al\u0131namad\u0131.");
        return [];
      }
      console.log(`[DiziPal] Ba\u015Fl\u0131k: "${info.title}" (${info.year})`);
      const searchResult = yield searchMedia(domain, info, mediaType);
      if (!searchResult) {
        console.warn(`[DiziPal] "${info.title}" bulunamad\u0131.`);
        return [];
      }
      console.log(`[DiziPal] Bulundu: ${searchResult.title} \u2014 ${searchResult.url}`);
      let episodeUrl;
      if (mediaType === "movie") {
        episodeUrl = searchResult.url;
      } else {
        episodeUrl = yield findEpisodeUrl(domain, searchResult.url, season, episode);
        if (!episodeUrl) {
          console.warn(`[DiziPal] S${season}E${episode} b\xF6l\xFCm\xFC bulunamad\u0131.`);
          return [];
        }
        console.log(`[DiziPal] B\xF6l\xFCm: ${episodeUrl}`);
      }
      const found = yield extractStreams(episodeUrl, info.title);
      streams.push(...found);
    } catch (err) {
      console.error(`[DiziPal] Genel hata: ${err.message}`);
    }
    const result = deduplicateStreams(streams);
    console.log(`[DiziPal] ${result.length} stream bulundu.`);
    return result;
  });
}
function searchMedia(domain, info, mediaType) {
  return __async(this, null, function* () {
    const endpoint = mediaType === "tv" ? "/bg/findseries" : "/bg/findmovies";
    const queries = [info.title];
    if (info.originalTitle && normTitle(info.originalTitle) !== normTitle(info.title)) {
      queries.push(info.originalTitle);
    }
    for (const query of queries) {
      const url = `${domain}${endpoint}?searchterm=${encodeURIComponent(query)}`;
      console.log(`[DiziPal] Arama: ${url}`);
      try {
        const text = yield fetchText(url, {
          "X-Requested-With": "XMLHttpRequest",
          "Referer": domain + "/"
        });
        let items = [];
        try {
          const json = JSON.parse(text);
          items = Array.isArray(json) ? json : json.data || json.results || [];
        } catch (_) {
          const match = text.match(/href="([^"]+)"/g) || [];
          return match.length > 0 ? { title: query, url: domain + match[0].replace(/href="|"/g, "") } : null;
        }
        for (const item of items) {
          const itemTitle = item.title || item.name || item.baslik || "";
          const itemSlug = item.slug || item.url || item.href || "";
          if (!itemSlug) continue;
          if (isTitleMatch(itemTitle, info.title, info.originalTitle)) {
            const itemUrl = itemSlug.startsWith("http") ? itemSlug : `${domain}/${itemSlug.replace(/^\//, "")}`;
            return { title: itemTitle, url: itemUrl };
          }
        }
        if (items.length > 0) {
          const first = items[0];
          const slug = first.slug || first.url || first.href || "";
          if (slug) {
            const itemUrl = slug.startsWith("http") ? slug : `${domain}/${slug.replace(/^\//, "")}`;
            console.log(`[DiziPal] Gev\u015Fek e\u015Fle\u015Fme: ${first.title || slug}`);
            return { title: first.title || query, url: itemUrl };
          }
        }
      } catch (e) {
        console.warn(`[DiziPal] Arama hatas\u0131 (${query}): ${e.message}`);
      }
    }
    return null;
  });
}
function isTitleMatch(found, title, originalTitle) {
  const nFound = normTitle(found);
  const nTitle = normTitle(title);
  const nOrig = normTitle(originalTitle || "");
  if (!nFound) return false;
  if (nFound === nTitle || nFound === nOrig) return true;
  if (nFound.includes(nTitle) || nTitle.includes(nFound)) return true;
  if (nOrig && (nFound.includes(nOrig) || nOrig.includes(nFound))) return true;
  return false;
}
function findEpisodeUrl(domain, seriesUrl, season, episode) {
  return __async(this, null, function* () {
    const html = yield fetchText(seriesUrl, { Referer: domain + "/" });
    const s = String(season);
    const e = String(episode);
    const attrRe = /href="([^"]+)"\s[^>]*data-season="(\d+)"\s[^>]*data-episode="(\d+)"/gi;
    let m;
    while ((m = attrRe.exec(html)) !== null) {
      if (m[2] === s && m[3] === e) {
        return m[1].startsWith("http") ? m[1] : `${domain}${m[1]}`;
      }
    }
    const bolumRe = /href="([^"]*\/bolum\/[^"]+)"/gi;
    const candidates = [];
    while ((m = bolumRe.exec(html)) !== null) {
      candidates.push(m[1]);
    }
    for (const href of candidates) {
      const nums = [...href.matchAll(/(\d+)/g)].map((x) => x[1]);
      if (nums.length >= 2 && nums[nums.length - 2] === s && nums[nums.length - 1] === e) {
        return href.startsWith("http") ? href : `${domain}${href}`;
      }
    }
    const sezonRe = /href="([^"]*sezon[^"]*\d[^"]*)"/gi;
    while ((m = sezonRe.exec(html)) !== null) {
      const href = m[1];
      const sNums = [...href.matchAll(/(\d+)/g)].map((x) => x[1]);
      if (sNums.includes(s)) {
        const sezonUrl = href.startsWith("http") ? href : `${domain}${href}`;
        try {
          const sezonHtml = yield fetchText(sezonUrl, { Referer: seriesUrl });
          const ep = findEpisodeInHtml(sezonHtml, domain, s, e);
          if (ep) return ep;
        } catch (_) {
        }
        break;
      }
    }
    console.warn(`[DiziPal] B\xF6l\xFCm bulunamad\u0131: S${season}E${episode}`);
    return null;
  });
}
function findEpisodeInHtml(html, domain, s, e) {
  const bolumRe = /href="([^"]*\/bolum\/[^"]+)"/gi;
  let m;
  while ((m = bolumRe.exec(html)) !== null) {
    const href = m[1];
    const nums = [...href.matchAll(/(\d+)/g)].map((x) => x[1]);
    if (nums.length >= 2 && nums[nums.length - 2] === s && nums[nums.length - 1] === e) {
      return href.startsWith("http") ? href : `${domain}${href}`;
    }
  }
  return null;
}
function extractStreams(pageUrl, title) {
  return __async(this, null, function* () {
    var _a;
    const streams = [];
    let html;
    try {
      html = yield fetchText(pageUrl, { Referer: pageUrl });
    } catch (e) {
      console.error(`[DiziPal] Sayfa y\xFCklenemedi: ${e.message}`);
      return [];
    }
    const bePlayerRe = /bePlayer\s*\(\s*'([^']+)'\s*,\s*'(\{[^}]+\})'\s*\)/;
    const beMatch = html.match(bePlayerRe);
    if (beMatch) {
      console.log("[DiziPal] bePlayer (JSON pass) bulundu");
      try {
        const passObj = JSON.parse(beMatch[2]);
        const password = BEplayer_KEY_PREFIX + (passObj.key || passObj.pass || passObj.p || "");
        const decrypted = decryptBePlayer(beMatch[1], password);
        if (decrypted) streams.push(...parsePlayerData(decrypted, title, pageUrl));
      } catch (e) {
        console.warn(`[DiziPal] bePlayer JSON parse: ${e.message}`);
      }
    }
    if (streams.length === 0) {
      const beSimple = html.match(/bePlayer\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
      if (beSimple) {
        console.log("[DiziPal] bePlayer (simple pass) bulundu");
        const password = BEplayer_KEY_PREFIX + beSimple[2];
        const decrypted = decryptBePlayer(beSimple[1], password);
        if (decrypted) streams.push(...parsePlayerData(decrypted, title, pageUrl));
      }
    }
    const openMatch = html.match(
      /window\.openPlayer\s*\(.*?(\[\s*\{[\s\S]*?"file"\s*:\s*"[^"]*"[\s\S]*?\}[\s\S]*?\])\s*\)/
    );
    if (openMatch) {
      console.log("[DiziPal] window.openPlayer bulundu");
      try {
        const arr = JSON.parse(openMatch[1]);
        for (const item of arr) {
          if ((_a = item.file) == null ? void 0 : _a.startsWith("http")) {
            streams.push(buildStream(item.file, `DiziPal ${item.label || ""}`.trim(), title, pageUrl));
          }
        }
      } catch (_) {
      }
    }
    if (streams.length === 0) {
      const embedDomains = [
        "kralplayoynat.com",
        "filemoon",
        "doodstream",
        "dood.",
        "vidmoly",
        "rapidvid",
        "abyssplayer",
        "gdplayer",
        "contentx",
        "hotlinger",
        "turbo.imgz",
        "ok.ru",
        "sibnet"
      ];
      const iframeRe = /<iframe[^>]+src="([^"]+)"/gi;
      let im;
      while ((im = iframeRe.exec(html)) !== null) {
        const src = im[1];
        if (embedDomains.some((d) => src.includes(d))) {
          console.log(`[DiziPal] Embed iframe: ${src}`);
          const embedStreams = yield resolveEmbed(src, pageUrl, title);
          streams.push(...embedStreams);
        }
      }
    }
    if (streams.length === 0) {
      const fileRe = /"file"\s*:\s*"(https?:[^"]+\.(?:m3u8|mp4)[^"]*)"/gi;
      let fm;
      while ((fm = fileRe.exec(html)) !== null) {
        streams.push(buildStream(fm[1], "DiziPal", title, pageUrl));
      }
    }
    return streams;
  });
}
function resolveEmbed(embedUrl, referer, title) {
  return __async(this, null, function* () {
    var _a;
    const streams = [];
    try {
      const absUrl = embedUrl.startsWith("http") ? embedUrl : new URL(embedUrl, referer).href;
      const html = yield fetchText(absUrl, { Referer: referer });
      const fileRe = /(?:file|src)\s*:\s*["']?(https?[^"'\s,)]+\.(?:m3u8|mp4)[^"'\s,)]*)/gi;
      let m;
      while ((m = fileRe.exec(html)) !== null) {
        streams.push(buildStream(m[1], "DiziPal Embed", title, absUrl));
      }
      const videosMatch = html.match(/"videos"\s*:\s*(\[[^\]]+\])/);
      if (videosMatch) {
        try {
          const videos = JSON.parse(videosMatch[1]);
          for (const v of videos) {
            if ((_a = v.file) == null ? void 0 : _a.startsWith("http")) {
              streams.push(buildStream(v.file, `DiziPal ${v.label || ""}`.trim(), title, absUrl));
            }
          }
        } catch (_) {
        }
      }
    } catch (e) {
      console.warn(`[DiziPal] Embed \xE7\xF6z\xFClemedi (${embedUrl}): ${e.message}`);
    }
    return streams;
  });
}
function parsePlayerData(decrypted, title, referer) {
  const streams = [];
  try {
    let data;
    try {
      data = JSON.parse(decrypted);
    } catch (_) {
      if (decrypted.startsWith("http")) {
        streams.push(buildStream(decrypted, "DiziPal bePlayer", title, referer));
      }
      return streams;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const url = item.file || item.url || item.src || "";
      const label = item.label || item.quality || "";
      if (url == null ? void 0 : url.startsWith("http")) {
        streams.push(buildStream(url, `DiziPal ${label}`.trim(), title, referer));
      }
    }
  } catch (e) {
    console.warn(`[DiziPal] parsePlayerData: ${e.message}`);
  }
  return streams;
}
function buildStream(url, name, title, referer) {
  const quality = extractQuality(url);
  const isHls = url.includes(".m3u8");
  const origin = (() => {
    try {
      return new URL(referer).origin;
    } catch (_) {
      return "";
    }
  })();
  return {
    name: name || "DiziPal",
    title: `${title} \u2014 ${quality}`,
    url,
    quality,
    type: isHls ? "m3u8" : null,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Referer": referer || "",
      "Origin": origin
    },
    provider: "dizipal"
  };
}
module.exports = { getStreams };
