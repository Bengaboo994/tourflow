const https = require("https");
const http = require("http");
const { URL } = require("url");

exports.handler = async function(event) {
  const url = event.queryStringParameters && event.queryStringParameters.url;

  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: "No URL provided" }) };
  }

  // Only allow http/https
  let parsed;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid URL" }) };
  }

  try {
    const html = await fetchHead(url);
    const image = extractOgImage(html);
    const title = extractOgTitle(html) || extractTitle(html);
    const description = extractOgDescription(html);
    const price = extractPrice(html);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600"
      },
      body: JSON.stringify({ image, title, description, price })
    };
  } catch(e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ image: null, title: null, description: null, price: null, error: e.message })
    };
  }
};

function fetchHead(url) {
  return new Promise(function(resolve, reject) {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TourFlow/1.0; +https://tourflow.app)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9,sv;q=0.8,es;q=0.7"
      },
      timeout: 8000
    }, function(res) {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchHead(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", function(chunk) {
        data += chunk;
        // Stop after we have enough for the <head>
        if (data.length > 80000) res.destroy();
      });
      res.on("end", function() { resolve(data); });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("Timeout")); });
  });
}

function extractOgImage(html) {
  // og:image
  var m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m) return m[1];
  // reversed attribute order
  m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m) return m[1];
  // twitter:image
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (m) return m[1];
  m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m) return m[1];
  return null;
}

function extractOgTitle(html) {
  var m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (m) return decode(m[1]);
  m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (m) return decode(m[1]);
  return null;
}

function extractTitle(html) {
  var m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decode(m[1].trim()) : null;
}

function extractOgDescription(html) {
  var m = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (m) return decode(m[1]);
  m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (m) return decode(m[1]);
  return null;
}

function extractPrice(html) {
  // Look for common price patterns in meta or structured data
  var patterns = [
    /["']price["']\s*:\s*["']?([0-9][0-9\s,.]+)["']?/i,
    /class=["'][^"']*price[^"']*["'][^>]*>([^<]{3,30})</i,
    /(\d[\d\s]{2,}(?:EUR|€|SEK|kr|GBP|£|USD|\$))/i,
    /((?:EUR|€|SEK|kr|GBP|£|USD|\$)\s*\d[\d\s,\.]{2,})/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1].trim().replace(/\s+/g, " ");
  }
  return null;
}

function decode(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
