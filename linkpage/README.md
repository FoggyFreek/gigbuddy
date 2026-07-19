# GigBuddy Link Page

A small, standalone app that gives every GigBuddy band a public **link page** —
a Linktree-style stack of widgets (music links, upcoming gigs, merch, social
links) at `link.<your-domain>/<band-slug>` — plus **release landing pages**
(smart-link style, one per song/album launch at `/<band-slug>/<release>`,
with one button per streaming platform), an editor for arranging the widgets,
and privacy-first visit + conversion statistics.

**Slug namespaces.** A band's main page lives at `/<mainSlug>` and its release
pages one segment deeper at `/<mainSlug>/<tail>`. Because a main slug can never
contain `/`, the stored slugs `foo` (main) and `foo/bar` (release) occupy
separate namespaces and can never collide — a release page can't shadow, or be
mistaken for, another band's main page. `pages.slug` stays globally unique
(one public URL → one page); release creation is restricted to the caller's own
`<mainSlug>/` prefix.

This directory is deliberately **decoupled from the main repo**: it has its own
`package.json`, its own Postgres database, its own migrations, and imports
nothing from the parent project. To split it out, move the `linkpage/` folder
into its own repository — nothing else needs to change.

## How it works

```
┌──────────────┐   handoff token (URL fragment)   ┌───────────────┐
│   GigBuddy   │ ───────────────────────────────► │  linkpage app │
│              │                                   │               │
│  /api/public/linkpage/export/:slug  ◄─────────── │  content sync │
│  /api/public/linkpage/image?t=…     ◄─────────── │  <img> tags   │
└──────────────┘   shared-secret bearer / HMAC     └───────────────┘
```

- **Content** (band profile, socials, profile links, songs + streaming links,
  merch products, announced upcoming gigs) is pulled from GigBuddy's export
  endpoint and stored as a denormalized snapshot in this app's database. The
  snapshot refreshes on editor entry, on publish, and lazily (background) when
  a public view finds it older than `LINKPAGE_CONTENT_TTL_MINUTES` — so gig
  listings stay current without coupling page loads to GigBuddy uptime.
- **Layout** (sections and widgets, their order and settings) is owned by this
  app: a draft the editor works on, and a published copy visitors see.
- **Editing**: in GigBuddy, a **tenant admin** clicks "Edit link page"
  (Profile page). GigBuddy mints a 10-minute HMAC handoff token and opens
  `/edit#gbtoken=…` here; the app exchanges it for a 12-hour editor session.
  There are no accounts in this app — GigBuddy is the identity provider and
  gates the handoff on role (tenant admin) and plan.
- **Plan gating** (GigBuddy tiers are the source of truth; each export ships
  an `entitlements` block this app enforces): the link-page feature is
  **silver and gold** only. Silver allows up to **3** release pages with a
  **30-day** statistics window; gold allows **30** release pages and a
  **90-day** window. A lapsed plan takes the public pages offline (404) on
  the next content sync. Ownerless legacy bands skip enforcement.
- **Preview**: the editor's preview tab renders the draft through the exact
  same resolution + React components as the public page.
- **Release pages**: from the editor's "New release page" button a member
  picks a song (from GigBuddy, with its streaming links) and gets a landing
  page with big artwork, title/artist, and one platform button per link —
  extendable with any other widget. Slugs are always prefixed with the band's
  own slug, so bands cannot squat each other's names.
- **Statistics** land in this app's own database (`page_views` +
  `page_clicks`) — views by device class, traffic source, country and day,
  plus outbound clicks per platform/target and a conversion-by-source table
  (views → clicks → CTR) for campaign attribution (use `?utm_source=…` in
  campaign links). Statistics live in a **rolling window** — 30 days, or 90
  on the gold plan. See [PRIVACY.md](./PRIVACY.md) for the hard privacy rules
  (no cookies, no IPs, no fingerprints, retention).

### Widget types

| Type | Content | Notes |
|---|---|---|
| `song` | a song + its streaming links | first link is the card target, extra links render as pills |
| `platforms` | one button per streaming link of a song | platform (Spotify, Apple Music, YouTube (Music), Deezer, TIDAL, Amazon, SoundCloud, Bandcamp) detected from the URL; the core of a release page. Embeddable platforms get a ▶ preview button (Spotify inline player, YouTube overlay) |
| `embed` | any pasted URL | metadata (title/artwork/description) pulled via oEmbed (Spotify, YouTube, SoundCloud, Vimeo, TikTok) or Open Graph tags; renders as a click-to-play inline player (Spotify/SoundCloud), a lightbox video (YouTube, privacy-enhanced `youtube-nocookie.com`), or a rich link card |
| `gigs` | announced upcoming gigs | expandable card; only gigs with status `announced` are ever exported |
| `merch` | selected products | horizontal card carousel; optional per-item image URL + badge, optional shop URL (e.g. your Shopify store) the cards link to |
| `link` | free-form link | label, optional sublabel/thumbnail, icon |

## Running locally

```
cd linkpage
npm install
cp .env.example .env       # fill in GIGBUDDY_SYNC_SECRET (same value as gigbuddy's LINKPAGE_SECRET)
createdb gigbuddy_linkpage # its own database — never gigbuddy's
npm run migrate
npm run dev                # API on :3010 + Vite on :5174
```

On the GigBuddy side set in its environment:

```
LINKPAGE_SECRET=<same shared secret>
LINKPAGE_URL=http://localhost:5174
```

Then open GigBuddy → Profile → "Edit link page".

## Production

`npm run build` produces `dist/`; `npm run server` serves API + SPA on one
port (`LINKPAGE_PORT`). Host it on its own subdomain (e.g. `link.example.com`)
behind a CDN/proxy that sets a country header (`cf-ipcountry`,
`x-vercel-ip-country`, `fastly-country-code` or `x-country-code`) — without
one, the country dimension records `unknown` (no IP geolocation is done here,
by design). A `Dockerfile` is included.

Run `npm run migrate` on deploy. Statistics retention is enforced daily
in-process; deployments that prefer an external scheduler can run
`npm run stats:purge` instead.

### Link enrichment (oEmbed / Open Graph)

`POST /api/editor/unfurl` (editor session required) fetches a URL's metadata
server-side: oEmbed for the known platforms, Open Graph scraping otherwise
(5s timeout, 600KB cap). The editor uses it to fill titles, descriptions, and
artwork ("Fetch image & info from link") — visitors never trigger third-party
fetches, and embed players are strictly click-to-play (see PRIVACY.md).

Because this is the one place the server fetches a user-supplied URL, it is
SSRF-hardened (`server/safeFetch.js`): only http(s) on standard ports, no
embedded credentials, redirects followed manually and re-validated per hop,
and — the load-bearing control — a connection-time DNS lookup that validates
every resolved address (rejecting private, loopback, link-local, unique-local,
multicast, reserved, carrier-grade-NAT, 6to4/teredo and IPv4-mapped-IPv6
ranges via `ipaddr.js`) and pins the socket to the validated IP, so a hostname
that resolves to a private address — or a DNS-rebinding race — can never
connect. Operators may additionally route egress through a public-internet-only
proxy; these controls hold regardless.

Resource limits: each fetch has a 5s timeout and a 600 KiB body cap enforced
*before* buffering — a declared `Content-Length` over the cap is rejected up
front, and the body is read incrementally with the socket destroyed the instant
the running total exceeds the cap (so an undeclared/lying length or an
indefinitely-streamed response can neither exhaust memory nor hang). The
endpoint is also concurrency-limited (a few in flight globally, a couple per
tenant → 429 when saturated) so it can't fan out into memory/socket pressure.

## Integration contract (GigBuddy side)

- `GET /api/public/linkpage/export/:slug` — full content snapshot;
  `Authorization: Bearer <shared secret>`; 404 for unknown slugs.
- `GET /api/public/linkpage/image?t=<token>` — streams band logo / song cover;
  the token is HMAC-signed by GigBuddy with the same secret and embedded in
  the export payload's image URLs.
- Handoff token (GigBuddy → here, in the `/edit` URL fragment): payload
  `{ t: 'handoff', slug, tenantId, exp }`, HMAC-SHA256, 10 min TTL.

Tokens are compact `base64url(json) + '.' + base64url(hmac)` — see
`server/tokens.js` (mirrored in gigbuddy's `server/security/linkpageTokens.js`).

## Tests

```
npm test   # vitest: classifiers, layout validation, resolution, tokens
```
