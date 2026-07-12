// Regression test for gallery image extraction in rebrand-scrape.js.
//
// Run manually with:  node test-image-extraction.js
// (Needs real network access, so it won't run inside a sandboxed CI
// environment without egress — run it from a machine/CI job that has
// normal internet access, e.g. locally or as a Netlify build step.)
//
// This test exists because is-realestate.com/estate_property/ref-391239/
// specifically broke image extraction: the page's gallery only loads 4
// photos into simple <img src> tags up front, with the remaining ~42 of
// its 46 total photos only reachable via lazy-load attributes, gallery
// anchor hrefs, or srcset variants. If this test starts failing again, the
// extraction logic has regressed for this class of gallery.

const TEST_CASES = [
  {
    name: 'is-realestate.com gallery (46 photos, only 4 load eagerly)',
    url: 'https://is-realestate.com/estate_property/ref-391239/',
    minImages: 10
  },
  {
    name: 'el-moncayo.com gallery (returns 403 to plain requests)',
    url: 'https://www.el-moncayo.com/es/property/29626660/',
    minImages: 10
  },
  {
    name: 'el-moncayo.com gallery via Next.js image optimizer + Inmovilla (25 photos)',
    url: 'https://www.el-moncayo.com/es/property/29542667/',
    minImages: 10
  }
];

async function run() {
  const handler = require('./rebrand-scrape.js').handler;
  let failures = 0;

  for (const test of TEST_CASES) {
    process.stdout.write('Testing: ' + test.name + ' ... ');
    try {
      const event = { queryStringParameters: { url: test.url } };
      const res = await handler(event);
      const body = JSON.parse(res.body);

      if (body.error) {
        console.log('FAIL (error: ' + body.error + ')');
        failures++;
        continue;
      }

      const count = body.imageCount || 0;
      if (count < test.minImages) {
        console.log('FAIL (found ' + count + ' images, expected at least ' + test.minImages + ')');
        failures++;
      } else {
        console.log('PASS (found ' + count + ' images)');
      }
    } catch (e) {
      console.log('FAIL (threw: ' + e.message + ')');
      failures++;
    }
  }

  if (failures > 0) {
    console.log('\n' + failures + ' test(s) failed.');
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
    process.exit(0);
  }
}

run();
