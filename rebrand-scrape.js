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
    let html = new TextDecoder('utf-8').decode(buffer);

    if (html.length < 500) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ error: 'Site blocked the request or returned an empty page', _source: 'blocked', htmlLength: html.length })
      };
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
    function cleanCost(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
    // Exclude icons, logos, flags (country flag icons on language switchers),
    // and staff/agent headshots — none of these are photos of the property.
    const NON_PROPERTY_IMAGE_RE = /(logo|icon|sprite|favicon|pixel|spacer|avatar|placeholder|flag|flagcdn|\/flags\/|agent[-_]|staff|headshot|team[-_]photo|author|profile[-_]pic|employee|broker[-_]photo)/i;

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

      const primaryImage = og('image') || meta('twitter:image') || null;
      const imageSet = new Set();
      if (primaryImage) imageSet.add(primaryImage);

      // Many galleries lazy-load: the real photo URL sits in data-src /
      // data-lazy-src / data-original until the image scrolls into view,
      // while src holds a blank placeholder — check both, preferring the
      // lazy-load attribute when present.
      const imgTagMatches = html.matchAll(/<img[^>]+>/gi);
      for (const m of imgTagMatches) {
        const tag = m[0];
        const lazyMatch = tag.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i);
        const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
        let src = (lazyMatch && lazyMatch[1]) || (srcMatch && srcMatch[1]);
        if (!src || src.startsWith('data:')) continue;
        try { src = new URL(src, url).href; } catch (e) { continue; }
        const lower = src.toLowerCase();
        const looksLikePhoto = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower);
        if (looksLikePhoto && !NON_PROPERTY_IMAGE_RE.test(lower)) imageSet.add(src);
        if (imageSet.size >= 30) break;
      }

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

      return {
        title: ogTitle || null, price, rooms, bathrooms, sqm, plotSize, area, address,
        communityFee, ibi, garbageFee, description,
        images: Array.from(imageSet), imageCount: imageSet.size
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

    if ((looksEmpty || imagesThin) && process.env.SCREENSHOTONE_API_KEY) {
      try {
        const renderUrl = 'https://api.screenshotone.com/take'
          + '?access_key=' + encodeURIComponent(process.env.SCREENSHOTONE_API_KEY)
          + '&url=' + encodeURIComponent(url)
          + '&response_type=json'
          + '&metadata_content=true'
          + '&metadata_content_format=html'
          + '&full_page=true'
          + '&block_ads=true'
          + '&block_cookie_banners=true'
          + '&delay=3'
          + '&timeout=25';
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
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Fetch failed: ' + (err && err.message ? err.message : String(err)), _source: 'error' })
    };
  }
};
