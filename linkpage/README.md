# GigBuddy Link Page

A small, standalone app that gives every GigBuddy band a public **link page** —
a Linktree-style stack of widgets (music links, upcoming gigs, merch, social
links) at `link.<your-domain>/<band-slug>` — plus an editor for arranging the
widgets and privacy-first visit statistics.

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
- **Editing**: in GigBuddy, a band member clicks "Edit link page" (Profile
  page). GigBuddy mints a 10-minute HMAC handoff token and opens
  `/edit#gbtoken=…` here; the app exchanges it for a 12-hour editor session.
  There are no accounts in this app — GigBuddy is the identity provider.
- **Preview**: the editor's preview tab renders the draft through the exact
  same resolution + React components as the public page.
- **Statistics** land in this app's own database (`page_views`) — device
  class, traffic source, country, per day. See [PRIVACY.md](./PRIVACY.md) for
  the hard privacy rules (no cookies, no IPs, no fingerprints, retention).

### Widget types

| Type | Content | Notes |
|---|---|---|
| `song` | a song + its streaming links | first link is the card target, extra links render as pills |
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
