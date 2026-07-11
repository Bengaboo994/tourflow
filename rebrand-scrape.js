// Netlify function: /.netlify/functions/rebrand-scrape
// Step 1 of the Rebrand pilot: scrape a listing URL for everything we can
// find — the same field extraction og.js already does (title, price, rooms,
// bathrooms, sqm, area, address, highlights), PLUS a full image gallery and
// a raw description blob, since Rebrand needs more source material than the
// quick auto-fill flow does. No AI is called here — this is purely the
// scrape/extract step so it can be verified on its own first.

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const rawUrl = event.queryStringParameters && event.queryStringParameters.url;
  console.log('[rebrand-scrape] incoming url:', rawUrl);

  if (!rawUrl) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  // Validate before doing anything else — a malformed URL passed to
  // fetch() can throw synchronously, and we'd rather return a clear,
  // friendly validation error than let a raw parser exception escape.
  let url;
  try {
    const normalized = new URL(rawUrl);
    if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
      throw new Error('Not an http(s) URL');
    }
    url = normalized.href;
    console.log('[rebrand-scrape] normalized url:', url);
  } catch (e) {
    console.error('[rebrand-scrape] URL validation failed for', rawUrl, '-', e && e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Unable to parse listing URL.' }) };
  }

  try {
    console.log('[rebrand-scrape] fetching:', url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9',
        'Accept-Charset': 'utf-8'
      },
      redirect: 'follow'
    });
    console.log('[rebrand-scrape] response status:', res.status, res.ok ? 'ok' : 'not-ok');
    const buffer = await res.arrayBuffer();
    let html = new TextDecoder('utf-8').decode(buffer);
    console.log('[rebrand-scrape] html length:', html.length);

    // A 403/blocked response or a suspiciously short page used to be
    // treated as a hard failure here — but that meant sites which reject
    // plain fetch() requests (common anti-bot behaviour) never got a
    // chance at the browser-rendered fallback below. Instead, just note
    // it and let extraction proceed: extractAll() will naturally come back
    // near-empty on a block page, which correctly triggers the fallback
    // further down. We only give up early if the body is empty outright.
    const wasBlockedOrThin = !res.ok || html.length < 500;
    if (!html) html = '';

    function decodeHtmlEntities(s) {
      if (!s) return s;
      return s
        .replace(/&raquo;/gi, '\u00BB').replace(/&laquo;/gi, '\u00AB')
        .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
        .replace(/&#039;/gi, "'").replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    function cleanPrice(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num || num < 10000) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
    function cleanNum(s) {
      if (!s) return null;
      const m = s.match(/\d+/);
      return m ? m[0] : null;
    }
    function cleanCost(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
    // Runs the full field + image extraction against whatever HTML is
    // currently in `html` — called once against the plain fetch, and again
    // against a JS-rendered version if the first pass came back empty.
    function extractAll() {
      function og(prop) {
        const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
               || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + prop + '["\']', 'i'));
        return m ? decodeHtmlEntities(m[1].trim()) : null;
      }
      function meta(name) {
        const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'));
        return m ? decodeHtmlEntities(m[1].trim()) : null;
      }
      function firstMatch(patterns) {
        for (const p of patterns) {
          const m = html.match(p);
          if (m && m[1]) return m[1].trim();
        }
        return null;
      }

      const ogTitle = og('title') || '';
      const rawPrice = firstMatch([
        /"price"\s*:\s*"?([\d\.]+)"?/, /"Price"\s*:\s*"?([\d\.]+)"?/,
        /itemprop="price"[^>]+content="([\d\.]+)"/i,
        /\u20AC\s*([\d\s\.,\']+)(?:\s|<)/, /(\d[\d\s\.]{4,})\s*EUR/i, /EUR\s*([\d\s\.,\']+)/i,
      ]);
      const price = cleanPrice(rawPrice);
      const rooms = cleanNum(firstMatch([/"bedrooms"\s*:\s*(\d+)/i, /(\d+)\s*(?:sovrum|bedroom|dormitorio|hab\.)/i]));
      const bathrooms = cleanNum(firstMatch([/"bathrooms"\s*:\s*(\d+)/i, /(\d+)\s*(?:[Bb]adrum|bathroom|ba[ñn]o)/i]));

      let sqm = null;
      const sqmMatches = [];
      for (const p of [/"buildingArea"\s*:\s*(\d+)/gi, /(\d{2,4})\s*m[²2](?!\d)/gi, /(\d{2,4})\s*kvm(?!\d)/gi]) {
        let m; while ((m = p.exec(html)) !== null) { const n = parseInt(m[1], 10); if (n >= 50 && n <= 2000) sqmMatches.push(n); }
      }
      if (sqmMatches.length > 0) sqm = String(Math.max(...sqmMatches));

      let plotSize = null;
      const plotMatch = firstMatch([
        /"plotArea"\s*:\s*(\d+)/i,
        /(?:plot|parcela|solar|grundstück|tomt)[^0-9]{0,20}(\d{2,5})\s*m[²2]/i,
        /(\d{2,5})\s*m[²2][^0-9]{0,20}(?:plot|parcela|solar)/i
      ]);
      if (plotMatch) { const n = parseInt(plotMatch, 10); if (n >= 30 && n <= 100000) plotSize = String(n); }

      const communityFee = cleanCost(firstMatch([
        /(?:cuota\s*comunitaria|community\s*fee|gastos?\s*de\s*comunidad|hoa\s*fee)[^0-9]{0,20}([\d\.,]+)/i
      ]));
      const ibi = cleanCost(firstMatch([
        /\bibi\b[^0-9]{0,20}([\d\.,]+)/i,
        /(?:property\s*tax|council\s*tax)[^0-9]{0,20}([\d\.,]+)/i
      ]));
      const garbageFee = cleanCost(firstMatch([
        /(?:basura|tasa\s*de\s*basuras?|garbage\s*(?:tax|fee))[^0-9]{0,20}([\d\.,]+)/i
      ]));

      let area = null;
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const skip = /^(till-salu|for-sale|en-venta|resale|new-build|inmueble|property|properties|hitta-hem|lagenhet|radhus|apartment|townhouse|penthouse|bungalow|finca|house|r\d+|en|es|sv|de|nl|spain|spanien|costa-blanca|costa-calida|costa-del-sol|\d+)$/i;
        const locationParts = pathParts.filter(p => !skip.test(p) && p.length > 2);
        const areaPart = locationParts[locationParts.length - 1];
        if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      } catch (e) {}

      let address = null;
      const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan'];
      const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Paseo)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
      for (const m of addrMatches) {
        const candidate = m[0].trim().slice(0, 60);
        if (!officeAddresses.some(o => candidate.toLowerCase().includes(o))) { address = candidate; break; }
      }

      let description = og('description') || meta('description') || null;
      if (description) description = description.slice(0, 4000);

      // ── IMAGE GALLERY ──────────────────────────────────────────────────
      // Exclude icons, logos, flags, staff headshots, and content that
      // belongs to OTHER listings on the page (nearby/similar/related
      // property carousels) — none of these are photos of THIS property.
      const NON_PROPERTY_IMAGE_RE = /(logo|icon|sprite|favicon|pixel|spacer|avatar|placeholder|flag|flagcdn|\/flags\/|agent[-_]|staff|headshot|team[-_]?photo|author|profile[-_]?pic|employee|broker[-_]?photo|nearby|similar|related|recommend|map[-_]?icon|location[-_]?icon|badge|watermark)/i;
      const IMG_LIMIT = 30;

      // Ordered dedup: key by a normalized "base" URL (size/resize hints
      // stripped) so different resolutions of the same photo collapse into
      // one entry, keeping whichever variant looks highest-resolution,
      // while preserving the order photos were first encountered in.
      const imageMap = new Map();
      const imageOrder = [];
      function normalizeImageKey(u) {
        try {
          const p = new URL(u);
          let path = p.pathname.toLowerCase();
          path = path.replace(/[-_](thumb|thumbnail|small|medium|large|xl|xs|sm|md|lg|preview|full|fullsize|original|orig|hires|hi-res|big|\d{2,4}x\d{2,4})(?=\.\w+$)/i, '');
          path = path.replace(/[-_]\d{2,4}(?=\.\w+$)/, '');
          return p.hostname + path;
        } catch (e) { return u; }
      }
      function resolutionScore(u) {
        const lower = u.toLowerCase();
        const m = u.match(/(\d{3,5})x(\d{3,5})/);
        let score = m ? parseInt(m[1], 10) * parseInt(m[2], 10) : 0;
        const m2 = u.match(/[-_=](\d{3,5})(?=[.\-_&]|$)/);
        if (!score && m2) score = parseInt(m2[1], 10);
        if (/(full|fullsize|original|orig|hires|hi-res|big|xl|large)(?=[.\-_]|$)/i.test(lower)) score += 100000;
        if (/(thumb|thumbnail|small|preview|xs|sm)(?=[.\-_]|$)/i.test(lower)) score -= 1000;
        return score;
      }
      function addImageCandidate(rawSrc) {
        if (!rawSrc || rawSrc.startsWith('data:')) return;
        let src;
        try { src = new URL(rawSrc, url).href; } catch (e) { return; }
        const lower = src.toLowerCase();
        if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower)) return;
        if (NON_PROPERTY_IMAGE_RE.test(lower)) return;
        const key = normalizeImageKey(src);
        const existing = imageMap.get(key);
        const score = resolutionScore(src);
        if (!existing) {
          imageMap.set(key, { url: src, score });
          imageOrder.push(key);
        } else if (score > existing.score) {
          imageMap.set(key, { url: src, score });
        }
      }

      const primaryImage = og('image') || meta('twitter:image') || null;
      if (primaryImage) addImageCandidate(primaryImage);

      function scanForImages(sourceHtml) {
        // <img src>, plus lazy-load attributes — the real photo often sits
        // in data-src/data-lazy-src/data-original while src holds a blank
        // placeholder until the slide is viewed.
        for (const m of sourceHtml.matchAll(/<img[^>]+>/gi)) {
          const tag = m[0];
          const lazyMatch = tag.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i);
          const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
          addImageCandidate((lazyMatch && lazyMatch[1]) || (srcMatch && srcMatch[1]));
          if (imageMap.size >= IMG_LIMIT) return;
        }
        // srcset / data-srcset — every candidate, not just the first
        for (const m of sourceHtml.matchAll(/(?:data-)?srcset=["']([^"']+)["']/gi)) {
          m[1].split(',').map(s => s.trim().split(' ')[0]).forEach(addImageCandidate);
          if (imageMap.size >= IMG_LIMIT) return;
        }
        // Gallery/lightbox anchors: <a href="full-res.jpg"> wrapping a
        // thumbnail — a very common pattern (PhotoSwipe, Fancybox,
        // Magnific Popup, etc.) that plain <img> scanning misses entirely,
        // and it usually points at the full, un-cropped image.
        for (const m of sourceHtml.matchAll(/<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi)) {
          addImageCandidate(m[1]);
          if (imageMap.size >= IMG_LIMIT) return;
        }
        // CSS background-image: url(...)
        for (const m of sourceHtml.matchAll(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
          addImageCandidate(m[1]);
          if (imageMap.size >= IMG_LIMIT) return;
        }
      }

      // Try to scope the first pass to a likely gallery container so
      // "nearby properties" / "similar listings" carousels elsewhere on
      // the page don't get swept in as if they belonged to this listing.
      // HTML isn't a regular language so this is best-effort — if it looks
      // too short to be a real gallery, we ignore it and fall through.
      const galleryContainerMatch = html.match(/<(?:div|section|ul)[^>]+(?:id|class)=["'][^"']*(?:gallery|slider|carousel|lightbox|photo-viewer|property-images)[^"']*["'][^>]*>([\s\S]{0,60000}?)<\/(?:div|section|ul)>/i);
      if (galleryContainerMatch && galleryContainerMatch[1].length > 200) {
        scanForImages(galleryContainerMatch[1]);
      }
      // Always also scan the whole page if the scoped pass came up short —
      // e.g. only placeholders loaded, or no gallery container was found
      // at all. This is still filtered by NON_PROPERTY_IMAGE_RE and
      // deduplicated, so re-scanning is cheap and safe.
      if (imageMap.size < 10) {
        scanForImages(html);
      }
      // Last resort: some galleries hydrate entirely from an embedded
      // JS/JSON blob (React/Vue props, gallery.init({images:[...]})) with
      // no matching markup at all. Scan <script> bodies that look
      // gallery-related for image-shaped string literals.
      if (imageMap.size < 10) {
        for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
          const body = m[1];
          if (!/gallery|photos|images|slides|carousel/i.test(body)) continue;
          for (const um of body.matchAll(/["'](https?:\/\/[^"'\\]+\.(?:jpg|jpeg|png|webp))(?:\?[^"'\\]*)?["']/gi)) {
            addImageCandidate(um[1]);
            if (imageMap.size >= IMG_LIMIT) break;
          }
          if (imageMap.size >= IMG_LIMIT) break;
        }
      }

      const images = imageOrder.map(k => imageMap.get(k).url);

      return {
        title: ogTitle || null, price, rooms, bathrooms, sqm, plotSize, area, address,
        communityFee, ibi, garbageFee, description,
        images: images, imageCount: images.length
      };
    }

    let result = extractAll();
    let usedRenderedFallback = false;
    let renderedFallbackError = null;

    // Trigger the JS-rendered fallback if either: nothing useful came back
    // at all, OR only the single og:image meta tag was found — many sites
    // render that server-side for social previews even when the rest of
    // the gallery is loaded client-side, so "1 image" is still a strong
    // signal the real gallery didn't come through.
    const looksEmpty = !result.title && !result.price;
    const imagesThin = result.imageCount <= 1;

    if ((looksEmpty || imagesThin || wasBlockedOrThin) && process.env.SCREENSHOTONE_API_KEY) {
      try {
        // Best-effort: many galleries hide behind a "view all photos" /
        // "see gallery" opener button, and single-image-at-a-time
        // carousels only load each photo into the DOM as you click
        // "next". Try the opener first (if present), then click through
        // next-arrows repeatedly so as many slides as possible have
        // actually loaded before we capture the page. This won't work on
        // every site (some galleries fetch images via an API call we
        // can't easily trigger), but it's a reasonable attempt with
        // negligible cost for the fallback path.
        const carouselScript =
          '(async function(){' +
          'var openSels=[\'[class*="view-gallery"]\',\'[class*="see-all-photos"]\',\'[class*="show-all-photos"]\',\'[class*="gallery-trigger"]\',\'[aria-label*="photo" i]\',\'[aria-label*="gallery" i]\'];' +
          'for(var k=0;k<openSels.length;k++){try{var o=document.querySelector(openSels[k]);if(o){o.click();await new Promise(function(r){setTimeout(r,400);});break;}}catch(e){}}' +
          'var sels=[".next",".slick-next",".swiper-button-next",\'[aria-label*="next" i]\',\'[class*="carousel-next"]\',\'[class*="arrow-right"]\',\'[class*="nav-next"]\'];' +
          'var btn=null;' +
          'for(var i=0;i<sels.length;i++){try{var el=document.querySelector(sels[i]);if(el){btn=el;break;}}catch(e){}}' +
          'if(btn){for(var j=0;j<28;j++){try{btn.click();}catch(e){}await new Promise(function(r){setTimeout(r,180);});}}' +
          '})();';

        const renderUrl = 'https://api.screenshotone.com/take'
          + '?access_key=' + encodeURIComponent(process.env.SCREENSHOTONE_API_KEY)
          + '&url=' + encodeURIComponent(url)
          + '&response_type=json'
          + '&metadata_content=true'
          + '&metadata_content_format=html'
          + '&full_page=true'
          + '&scripts=' + encodeURIComponent(carouselScript)
          + '&block_ads=true'
          + '&block_cookie_banners=true'
          + '&delay=3'
          + '&timeout=35';
        const renderRes = await fetch(renderUrl);
        const renderJson = await renderRes.json();
        // metadata_content doesn't return the HTML inline — it returns a
        // { url, expires } pointer to where the rendered content is
        // hosted, so a second fetch is needed to actually get it.
        const contentUrl = renderJson && renderJson.content && renderJson.content.url;
        if (contentUrl) {
          const contentRes = await fetch(contentUrl);
          html = await contentRes.text();
          const renderedResult = extractAll();
          // Prefer the rendered pass's images whenever it found more of
          // them (the common case — the plain fetch only had og:image).
          if (renderedResult.imageCount > result.imageCount) {
            result.images = renderedResult.images;
            result.imageCount = renderedResult.imageCount;
          }
          // Fill in any text fields the first pass missed, without
          // clobbering ones it already got right.
          Object.keys(renderedResult).forEach(function(k) {
            if (k === 'images' || k === 'imageCount') return;
            if ((result[k] == null || result[k] === '') && renderedResult[k] != null && renderedResult[k] !== '') {
              result[k] = renderedResult[k];
            }
          });
          usedRenderedFallback = true;
        }
      } catch (e) {
        renderedFallbackError = e && e.message ? e.message : String(e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(Object.assign({ sourceUrl: url }, result, {
        _debug: { htmlLength: html.length, usedRenderedFallback, renderedFallbackError }
      }))
    };

  } catch (err) {
    console.error('[rebrand-scrape] unexpected error for', url, ':', err && err.stack ? err.stack : err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'The website rejected the request.', _source: 'error' })
    };
  }
};
