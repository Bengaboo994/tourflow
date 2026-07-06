// Netlify function: /.netlify/functions/rebrand-vision
// Hybrid approach for the Rebrand pilot: instead of relying on fragile
// per-site HTML parsing for text fields, take a full-page screenshot of the
// listing (via ScreenshotOne) and ask Claude to read it like a human would.
// Images are NOT handled here — the existing rebrand-scrape.js already
// extracts the real image gallery well, so this function only returns text
// fields (title, price, rooms, bathrooms, sqm, area, address, description).
//
// Requires two environment variables set in Netlify:
//   SCREENSHOTONE_API_KEY  — from screenshotone.com
//   ANTHROPIC_API_KEY      — from console.anthropic.com

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  const SCREENSHOTONE_KEY = process.env.SCREENSHOTONE_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SCREENSHOTONE_KEY || !ANTHROPIC_KEY) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ error: 'Missing API key(s) on the server. Add SCREENSHOTONE_API_KEY and ANTHROPIC_API_KEY in Netlify → Site settings → Environment variables, then redeploy.' })
    };
  }

  try {
    // ── 1. Take a full-page screenshot ──────────────────────────────────
    // Try to auto-expand any collapsed "Read more / Ver más / Visa mer"
    // description before the screenshot is taken — otherwise Claude only
    // ever sees the short, truncated preview text.
    const expandScript =
      'var re=/ver\\s*m[aá]s|leer\\s*m[aá]s|mostrar\\s*m[aá]s|read\\s*more|show\\s*more|see\\s*more|mehr\\s*anzeigen|lire\\s*la\\s*suite|visa\\s*mer|l[aä]s\\s*mer/i;' +
      'var els=document.querySelectorAll("button,a,span,div");' +
      'for(var i=0;i<els.length;i++){var t=(els[i].textContent||"").trim();' +
      'if(t.length>0&&t.length<40&&re.test(t)){els[i].click();break;}}';

    const shotUrl = 'https://api.screenshotone.com/take'
      + '?access_key=' + encodeURIComponent(SCREENSHOTONE_KEY)
      + '&url=' + encodeURIComponent(url)
      + '&full_page=true'
      + '&format=jpg'
      + '&image_quality=80'
      + '&block_ads=true'
      + '&block_cookie_banners=true'
      + '&block_banners_by_heuristics=true'
      + '&scripts=' + encodeURIComponent(expandScript)
      + '&delay=2'
      + '&viewport_width=1400'
      + '&viewport_height=1000'
      + '&timeout=25';

    const shotRes = await fetch(shotUrl);
    if (!shotRes.ok) {
      const t = await shotRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Screenshot failed: ' + t.slice(0, 300) }) };
    }
    const shotBuffer = await shotRes.arrayBuffer();
    const base64Image = Buffer.from(shotBuffer).toString('base64');

    // ── 2. Ask Claude to read the listing off the screenshot ────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
            {
              type: 'text',
              text: 'This is a screenshot of a real estate listing page. Read it like a person would and return ONLY a raw JSON object — no markdown fences, no explanation, nothing before or after — with exactly these fields: '
                + '{"title": string or null (never include any internal reference/listing ID number, even if visible on the page), "price": string or null (include the currency symbol), "rooms": string or null (bedrooms, just the number), "bathrooms": string or null (just the number), "sqm": string or null (built size, just the number), "plotSize": string or null (plot/land size if shown, just the number), "area": string or null (neighbourhood/town), "address": string or null, "description": string or null (the actual property description written by the agent, NOT generic agency marketing copy about the agency itself — if you cannot find a real per-property description, use null instead of guessing. Include the FULL description, do not summarize or shorten it — up to 3000 characters, in the same language as the page)}.'
            }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'AI read failed: ' + t.slice(0, 300) }) };
    }

    const claudeData = await claudeRes.json();
    const rawText = (claudeData.content && claudeData.content[0] && claudeData.content[0].text) || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse the AI response as JSON.', raw: rawText.slice(0, 400), screenshotPreview: 'data:image/jpeg;base64,' + base64Image }) };
    }

    // Include the screenshot itself so the UI can show what Claude actually
    // saw — invaluable for debugging cookie banners, unloaded content, etc.
    parsed.screenshotPreview = 'data:image/jpeg;base64,' + base64Image;

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ error: 'Failed: ' + (err && err.message ? err.message : String(err)) })
    };
  }
};
