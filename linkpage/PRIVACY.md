# Privacy requirements — link page statistics

The visitor-facing privacy notice lives at `/privacy` (`src/Privacy.jsx`);
keep the two in sync. This document states the **hard rules** the
implementation must uphold, and what an operator (data controller) needs to
know. The design goal: visit statistics that are useful to bands while never
processing more personal data than a plain web-server request already does —
and storing none of it.

## Hard rules (enforced in code — do not weaken)

1. **No cookies, no device storage** on the public page surface. Ever. This
   keeps the page out of consent-banner territory (ePrivacy): nothing is read
   from or written to the visitor's device. (The editor uses `sessionStorage`
   for its own session token — an authenticated band-member tool, not the
   public surface.)
2. **No IP addresses stored.** The IP is used in-memory for a single request
   to compute the daily visitor hash, then discarded. It never reaches the
   database or logs.
3. **No raw user agents stored** — only the derived class:
   `mobile | tablet | desktop | unknown` (bot traffic is dropped entirely).
4. **No referrer paths or query strings** — only the referrer *hostname* (or a
   sanitized `utm_source`), because URLs can carry personal data.
5. **Country only from trusted edge headers** (`cf-ipcountry` and friends).
   The app performs no IP geolocation of its own; without a CDN header the
   country is `unknown`.
6. **Unique-visitor estimation without identifiers**: a keyed hash of
   (day, IP, user agent), truncated to 16 chars, rotating every 24 h. It
   cannot be linked across days and cannot be reversed; it exists only to
   deduplicate same-day repeat views.
7. **Aggregate-only reads**: the editor API exposes counts per dimension,
   never individual view rows.
8. **Retention**: raw view rows are deleted after `STATS_RETENTION_DAYS`
   (default 396 days ≈ 13 months, aligned with common analytics guidance),
   enforced by a daily in-process purge and `npm run stats:purge`.
9. **Kill switch**: `STATS_DISABLED=1` stops all collection without affecting
   the page.

## Operator notes (GDPR)

- With the rules above, stored statistics contain no personal data. The
  transient in-memory handling of IP/user agent during a request is processing
  under GDPR; **legitimate interest** (audience measurement, Art. 6(1)(f)) is
  the intended lawful basis — document it in your records of processing.
- The public page must always link to the privacy notice (the footer does).
- If you add ANY new dimension, keep it coarse and non-identifying, update
  `/privacy` and this file, and re-check that no consent requirement is
  triggered.
- Data subject requests: there is nothing to look up per person — no stored
  identifier maps to an individual. State this in your privacy notice.
- The bands' content (names, bios, gig listings) is published deliberately by
  the band via the editor; the band remains responsible for what it publishes.
