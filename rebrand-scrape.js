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

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9',
        'Accept-Charset': 'utf-8'
      },
      redirect: 'follow'
    });
    const buffer = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buffer);

    if (html.length < 500) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ error: 'Site blocked the request or returned an empty page', _source: 'blocked', htmlLength: html.length })
      };
    }

    // ── HELPERS (same as og.js) ─────────────────────────────────────────
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

    // ── FIELD EXTRACTION (same rules as og.js's generic parser) ─────────
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

    // Extra costs — best-effort, these vary a lot in how sites label them
    function cleanCost(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
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

    // ── DESCRIPTION (new for Rebrand — og.js doesn't need this) ─────────
    // Prefer a real description meta tag; these are usually the fullest
    // human-written summary a page exposes without needing per-site rules.
    let description = og('description') || meta('description') || null;
    if (description) description = description.slice(0, 4000);

    // ── IMAGE GALLERY (new for Rebrand) ──────────────────────────────────
    // og:image is usually just the cover photo — pull every <img> src too,
    // then filter out obvious non-property images (icons, logos, tracking
    // pixels, tiny sprites) with basic heuristics. The agent reviews and
    // picks from these manually in the next step, so this can be generous.
    const primaryImage = og('image') || meta('twitter:image') || null;
    const imageSet = new Set();
    if (primaryImage) imageSet.add(primaryImage);

    // Exclude icons, logos, flags (country flag icons on language switchers),
    // and staff/agent headshots — none of these are photos of the property.
    const NON_PROPERTY_IMAGE_RE = /(logo|icon|sprite|favicon|pixel|spacer|avatar|placeholder|flag|flagcdn|\/flags\/|agent[-_]|staff|headshot|team[-_]photo|author|profile[-_]pic|employee|broker[-_]photo)/i;

    const imgTagMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    for (const m of imgTagMatches) {
      let src = m[1];
      if (!src || src.startsWith('data:')) continue;
      // Resolve relative URLs against the source page
      try { src = new URL(src, url).href; } catch (e) { continue; }
      const lower = src.toLowerCase();
      const looksLikeIcon = NON_PROPERTY_IMAGE_RE.test(lower);
      const looksLikePhoto = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower);
      if (looksLikePhoto && !looksLikeIcon) imageSet.add(src);
      if (imageSet.size >= 30) break; // generous cap — agent narrows down later
    }

    // Also check srcset attributes for higher-resolution gallery variants
    const srcsetMatches = html.matchAll(/srcset=["']([^"']+)["']/gi);
    for (const m of srcsetMatches) {
      const candidates = m[1].split(',').map(s => s.trim().split(' ')[0]);
      for (let src of candidates) {
        if (!src || src.startsWith('data:')) continue;
        try { src = new URL(src, url).href; } catch (e) { continue; }
        const lower = src.toLowerCase();
        if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower) && !NON_PROPERTY_IMAGE_RE.test(lower)) {
          imageSet.add(src);
        }
        if (imageSet.size >= 30) break;
      }
      if (imageSet.size >= 30) break;
    }

    // Fallback: some sites load their photo gallery via JavaScript after
    // page load, so a plain fetch() of the raw HTML finds zero <img> tags
    // even though the page clearly has photos. If that happened, ask
    // ScreenshotOne to render the page in a real browser and hand back the
    // post-JavaScript HTML instead, then re-run the same image extraction
    // against that.
    let usedRenderedFallback = false;
    if (imageSet.size === 0 && process.env.SCREENSHOTONE_API_KEY) {
      try {
        const renderUrl = 'https://api.screenshotone.com/take'
          + '?access_key=' + encodeURIComponent(process.env.SCREENSHOTONE_API_KEY)
          + '&url=' + encodeURIComponent(url)
          + '&response_type=json'
          + '&metadata_content=true'
          + '&metadata_content_format=html'
          + '&block_ads=true'
          + '&block_cookie_banners=true'
          + '&delay=3'
          + '&timeout=25';
        const renderRes = await fetch(renderUrl);
        const renderJson = await renderRes.json();
        const renderedHtml = renderJson && renderJson.content;
        if (renderedHtml) {
          const renderedImgMatches = renderedHtml.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
          for (const m of renderedImgMatches) {
            let src = m[1];
            if (!src || src.startsWith('data:')) continue;
            try { src = new URL(src, url).href; } catch (e) { continue; }
            const lower = src.toLowerCase();
            const looksLikePhoto = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower);
            if (looksLikePhoto && !NON_PROPERTY_IMAGE_RE.test(lower)) imageSet.add(src);
            if (imageSet.size >= 30) break;
          }
          usedRenderedFallback = true;
        }
      } catch (e) {
        // Silently fall through — the person still gets everything else
        // the plain scrape found; they can add images manually if needed.
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sourceUrl: url,
        title: ogTitle || null,
        price, rooms, bathrooms, sqm, plotSize, area, address,
        communityFee, ibi, garbageFee,
        description,
        images: Array.from(imageSet),
        imageCount: imageSet.size,
        _debug: { htmlLength: html.length, usedRenderedFallback }
      })
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Fetch failed: ' + (err && err.message ? err.message : String(err)), _source: 'error' })
    };
  }
};
