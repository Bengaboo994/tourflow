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
  const lang = event.queryStringParameters && event.queryStringParameters.lang;
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
    const shotUrl = 'https://api.screenshotone.com/take'
      + '?access_key=' + encodeURIComponent(SCREENSHOTONE_KEY)
      + '&url=' + encodeURIComponent(url)
      + '&full_page=true'
      + '&format=jpg'
      + '&image_quality=80'
      + '&block_ads=true'
      + '&block_cookie_banners=true'
      + '&block_banners_by_heuristics=true'
      + '&delay=3'
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
    const langInstruction = lang
      ? ('Write the "title" and "description" fields in ' + lang + ', translating naturally as a native speaker would (not a literal word-for-word translation). Keep numbers, the currency symbol, and proper nouns like street names or neighbourhood names as-is — do not translate place names.')
      : 'Write "title" and "description" in the same language as the page.';

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
                + '{"title": string or null (never include any internal reference/listing ID number, even if visible on the page; NEVER use breadcrumb/navigation trail text like "Sale » Villa » Orihuela Costa » La Zenia" as the title — that\u2019s navigation, not a title; if no real headline title is shown, create a short natural one yourself from the description and other visible facts — e.g. property type + bedrooms + area, like "2-Bedroom Apartment in Sarrià-Sant Gervasi" — only use null if there truly isn\u2019t enough information to form any reasonable title), "price": string or null (include the currency symbol; look for a large, prominent number near the top of the page, often the single biggest number shown), "rooms": string or null (bedrooms — look carefully near a bed icon or a number followed by "bed"/"bedrooms"/"hab"/"dormitorio", just the number), "bathrooms": string or null (just the number, look near a bath icon), "sqm": string or null (built size — look near a house icon, "m\u00b2 built", "built size", or similar, just the number), "plotSize": string or null (plot/land size — often a separate, larger number near a different icon than built size, just the number), "area": string or null (neighbourhood/town), "address": string or null, "description": string or null (the actual property description written by the agent, NOT generic agency marketing copy about the agency itself and NOT breadcrumb navigation text — if you cannot find a real per-property description, use null instead of guessing. Include the FULL description, do not summarize or shorten it — up to 3000 characters)}. Take your time to look at the whole image carefully, including small icon+number rows near the top, before deciding a field is missing. '
                + langInstruction
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
