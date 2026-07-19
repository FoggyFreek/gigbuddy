# GigBuddy Link Page

A small, standalone app that gives every GigBuddy band a public **link page** —
a Linktree-style stack of widgets (music links, upcoming gigs, merch, social
links) at `link.<your-domain>/<band-slug>` — plus **release landing pages**
(smart-link style, one per song/album launch at `/<band-slug>-<release>`,
with one button per streaming platform), an editor for arranging the widgets,
and privacy-first visit + conversion statistics.

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
| `platforms` | one button per streaming link of a song | platform (Spotify, Apple Music, YouTube (Music), Deezer, TIDAL, Amazon, SoundCloud, Bandcamp) detected from the URL; the core of a release page |
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
