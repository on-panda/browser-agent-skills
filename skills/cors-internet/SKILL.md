---
name: cors-internet
description: "Browser JS agent patterns for web search and information retrieval under CORS: direct JSON APIs first, Jina/Codetabs proxy scraping, RSS, timeouts, fallbacks, and tested source notes."
---

# Browser JS Environment — Web Search & Info Retrieval Patterns

## Source Selection Ladder
1. **Direct CORS-free JSON API** — fastest, structured, LLM-native. Prefer source-specific APIs over generic search.
2. **Direct public/demo-key API** — OK for demos; never expose private keys in browser JS.
3. **RSS/Atom via Jina Reader** — often cleaner than scraping news pages.
4. **Reader/proxy scrape** — `r.jina.ai` for markdown, Codetabs for raw HTML.
5. **Own tiny proxy** — required for private keys, auth, cookies, custom headers/POSTs, high reliability, or production.

## Core Search
- **Search path**: `r.jina.ai` + `https://html.duckduckgo.com/html/?q=TERM`.
- DuckDuckGo HTML is server-rendered, no JS, low anti-bot; Jina converts it cleanly to markdown.
- Search has **no reliable CORS-free direct alternative** found; proxy is unavoidable.
- Avoid: Google via Jina (429/CAPTCHA), Google News (451), Bing via Jina (sometimes visual-search redirect), `s.jina.ai` (401/auth required in tests).

## CORS Proxy Tools
- **`r.jina.ai`** 🏆: `fetch('https://r.jina.ai/' + targetUrl, {headers:{Accept:'text/markdown'}})` → clean markdown. Free tier/rate-limited; do not loop.
- **Codetabs**: `https://api.codetabs.com/v1/proxy?quest=ENCODED_URL` → raw HTML. Use when Jina cannot render or when raw DOM matters; GET-only, ~5 MB limit.
- **`api.rss2json.com`** 🏆: `https://api.rss2json.com/v1/api.json?rss_url=ENCODED_RSS_URL` → JSON. CORS-free, no API key. Converts any RSS/Atom feed to clean JSON; pair with news RSS feeds for structured news retrieval.
- **Own proxy**: use allowlist, timeout, max byte limit, cache, and no credential forwarding by default.
- Avoid public proxy dead ends already tested: AllOrigins (down/timeout), `corsproxy.io` (localhost-only), ThingProxy (unreachable), cloudflare-cors (manual activation), Wayback Machine (CORS-blocked).

## Vertical APIs — CORS-Friendly First

### News / Current Events
- **Reddit `.json`** 🏆: `https://www.reddit.com/r/worldnews/hot.json?limit=5`; also `/r/news`, `/r/technology`, `/r/science`, `/r/politics`, `/r/business`. Filter sticky “Live Thread” / “Discussion Thread”.
- **Hacker News**: `https://hacker-news.firebaseio.com/v0/topstories.json` → item JSON by ID. Best for tech/startup signals.
- **GDELT DOC 2.0**: `https://api.gdeltproject.org/api/v2/doc/doc?query=TERM&mode=ArtList&format=json`; CORS-free but slow, use 12–15s timeout. Use DOC, not GEO.
- **Federal Register**: `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=TERM`; fast US regulations/executive documents.
- **Library of Congress**: `https://www.loc.gov/search/?fo=json&query=TERM`; CORS-free but slow, use ~12s timeout.
- **Authoritative headlines**: BBC/Guardian/NPR/TechCrunch/AlJazeera feeds via Jina, RSS via rss2json.

### Weather / Air / Time
- **Open-Meteo** 🏆: forecast/current weather JSON worldwide.
  `https://api.open-meteo.com/v1/forecast?latitude=LAT&longitude=LON&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=TZ`
- **Open-Meteo Air Quality**: `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=LAT&longitude=LON&current=us_aqi,pm2_5,pm10`.
- **Open-Meteo Geocoding**: `https://geocoding-api.open-meteo.com/v1/search?name=CITY`.
- **wttr.in**: `https://wttr.in/CITY?format=j1` backup.
- **Weather.gov**: `https://api.weather.gov/points/LAT,LON` → follow `properties.forecast`; US-only.
- **Local time context**: prefer `new Date()`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.languages`; World Time API was blocked in tests.

### Stocks / Finance / Crypto / FX
- **Google Finance via Codetabs** 🏆: proxy `https://www.google.com/finance/quote/SYMBOL:EXCHANGE`; extract `data-last-price`, `.P2Luy` dollar change, nearby percent span. Works for international exchanges (`0700:HKG`).
- **Twelve Data**: `https://api.twelvedata.com/price?symbol=AAPL&apikey=demo`; CORS-free backup, price-only, rate-limited demo key.
- **Yahoo Finance**: not viable; CORS-blocked and blocks Codetabs.
- **CoinGecko** 🏆: `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true`; use markets endpoint for top coins/market cap. Binance was blocked in tests.
- **Open ER API** 🏆: `https://open.er-api.com/v6/latest/USD`; all FX rates against base. Frankfurter was blocked in tests.

### Knowledge / Definitions / Q&A
- **Wikipedia search**: `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=TERM&format=json&origin=*`.
- **Wikipedia REST summary**: `https://en.wikipedia.org/api/rest_v1/page/summary/TITLE`; simpler page summaries.
- **Wikidata SPARQL** 🏆: `https://query.wikidata.org/sparql?query=ENCODED_SPARQL&format=json`; exact structured facts/entities.
- **DuckDuckGo Instant Answer**: `https://api.duckduckgo.com/?q=TERM&format=json`; useful for definitions/disambiguation, often empty for live factual queries.
- **Stack Exchange API** 🏆: `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=TERM&site=stackoverflow&filter=withbody`; switch `site=` for serverfault/superuser/etc.

### Code / Packages / Security
- **GitHub**: `https://api.github.com/search/repositories?q=TERM&sort=stars&per_page=5`.
- **GitHub raw content**: `https://raw.githubusercontent.com/USER/REPO/BRANCH/PATH` — CORS-friendly, fetches raw file content directly.
- **PyPI**: `https://pypi.org/pypi/PACKAGE/json`.
- **npm**: `https://registry.npmjs.org/-/v1/search?text=TERM`.
- **Dev.to**: `https://dev.to/api/articles?tag=javascript&top=1` or `?q=TERM`.
- **CDNJS**: `https://api.cdnjs.com/libraries?search=PACKAGE` for library existence/version/CDN URLs.
- **OSV.dev**: `POST https://api.osv.dev/v1/query`; CORS-free vulnerability lookup.
- **RubyGems single package**: `https://rubygems.org/api/v1/gems/NAME.json`; search/latest are CORS-blocked, use Jina if needed.

### Scholarly / Papers
- **OpenAlex** 🏆: `https://api.openalex.org/works?search=TERM`; fast broad scholarly search.
- **Crossref**: `https://api.crossref.org/works?query=TERM`; DOI/bibliographic metadata.
- **Europe PMC**: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TERM&format=json`; biomedical/life science.
- **NCBI E-utilities**: use `esearch` then `esummary`/`efetch`; CORS-free in tests.
- **arXiv**: direct API is CORS-blocked; use Jina on `https://export.arxiv.org/api/query?...`.
- **Semantic Scholar**: direct CORS-blocked; Jina often hits 429, avoid unless necessary.

### Maps / Geo / Places
- **Nominatim**: `https://nominatim.openstreetmap.org/search?q=PLACE&format=json`; forward/reverse OSM geocoding. Respect usage policy.
- **Overpass API**: `https://overpass-api.de/api/interpreter?data=[out:json];...`; GET/POST work, large queries may 504.
- **GeoNames**: `https://secure.geonames.org/searchJSON?q=PLACE&maxRows=5&username=demo`; CORS-free, demo has daily quota.
- **ipapi**: `https://ipapi.co/json/`; rough self-geolocation.

### Government / Economics / Data
- **World Bank Indicators**: `https://api.worldbank.org/v2/country/US/indicator/SP.POP.TOTL?format=json`.
- **Data.gov CKAN / Data USA / US Census Geocoder**: CORS-blocked in tests; use an own proxy if needed.

### Books / Environment / Science / Space / Media
- **Open Library**: `https://openlibrary.org/search.json?q=TERM`.
- **USGS Earthquakes**: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson`.
- **REST Countries**: `https://restcountries.com/v3.1/alpha/CN` or `/name/France`.
- **Launch Library 2**: `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5`.
- **Sunrise-Sunset**: `https://api.sunrise-sunset.org/json?lat=LAT&lng=LON&formatted=0`.
- **TVMaze**: `https://api.tvmaze.com/search/shows?q=TERM`.

## Deep Read — Any URL to Markdown/HTML
- **Jina Reader**: use for articles, docs, blogs, GitHub Trending, arXiv Atom, and RSS feeds. Works well on BBC, Guardian, NPR (`text.npr.org`), CNBC, most docs/blogs.
- **RSS via Jina**: `feeds.bbci.co.uk/news/world/rss.xml`, `feeds.npr.org/1001/rss.xml`, `theguardian.com/world/rss`, `techcrunch.com/feed/`, `sciencedaily.com/rss/top/science.xml`, CNBC RSS. Often cleaner than HTML pages.
- **RSS via rss2json**: `api.rss2json.com` converts RSS→JSON CORS-free; Works with BBC, Guardian, Al Jazeera, NPR, TechCrunch feeds.
- **Known failures**: CNN/AP/Reuters often return empty/451; Xinhua heavy JS; Google News 451.
- **Additional failures tested**: Bing Search API (requires key), `bing.com/search` (CORS `Failed to fetch`), Reuters direct (401).
- **Codetabs + DOMParser**: use raw HTML when stable DOM/data attributes matter.
  ```js
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const price = doc.querySelector('[data-last-price]')?.getAttribute('data-last-price');
  const text = doc.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 15000);
  ```
- **Readability.js**: if Jina fails but Codetabs works, optionally `await import('https://cdn.skypack.dev/@mozilla/readability')` and run `new Readability(doc).parse()`.

## Async / Fetch Rules
- Always use **top-level `await`**. Do not use bare `(async () => {...})()`; the environment may not wait.
- Prefer GET/no custom headers for direct browser calls; custom headers often trigger CORS preflight.
- Apply byte/char limits before handing text to the LLM: many RSS/pages return 50k–80k chars.
- Standardize failures: network/DNS, timeout, HTTP status, CORS-looking `TypeError`, parse error, empty content, anti-bot/CAPTCHA.

```js
async function fetchText(url, { timeoutMs = 30000, headers = {}, maxChars = 300000 } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

async function firstWorking(candidates) {
  const errors = [];
  for (const c of candidates) {
    try { return { source: c.name, url: c.url, body: await fetchText(c.url, c.options) }; }
    catch (err) { errors.push(`${c.name}: ${err.message}`); }
  }
  throw new Error('All sources failed:\n' + errors.join('\n'));
}
```

## Multi-Source Strategy
- **News**: Reddit/HN for live signals ⊕ GDELT DOC for global search ⊕ BBC/Guardian/NPR RSS via Jina/rss2json for authority.
- **Weather**: Open-Meteo ⊕ wttr.in ⊕ weather.gov for US detail.
- **Stocks**: Google Finance via Codetabs ⊕ Twelve Data price-only.
- **Crypto/FX**: CoinGecko ⊕ Open ER API.
- **Papers**: OpenAlex ⊕ Crossref ⊕ Europe PMC/NCBI; arXiv through Jina.
- **Code/packages**: GitHub/PyPI/npm/CDNJS/OSV before generic search.
- **Search**: DuckDuckGo HTML via Jina remains the only reliable broad web search path.

## Mindset
- You are not “searching the web” directly; you are either hitting CORS-friendly JSON APIs or scraping server-rendered content through a proxy.
- Prefer structured JSON fields, RSS elements, `data-*`, or schema.org JSON-LD over brittle CSS classes or JS blobs.
- JSONP executes remote JavaScript; skip unless the endpoint is trusted and explicitly supports it. No useful tested JSONP endpoint was found.
- Use browser-native context when useful: timezone/language/local date from `Intl`, `navigator.languages`, and `new Date()`.
- When querying time-sensitive information (e.g., current events, weather, stock prices), always obtain the current date/time first via `new Date()`.

