---
name: google-calendar
description: Browse, search and prepare Google Calendar events for the correct signed-in account.
---

# Google Calendar

Load `google-accounts` first and select the correct `uid`.

## Canonical URLs

- Events: `https://calendar.google.com/calendar/u/{uid}/r/{view}`
- Date view: `https://calendar.google.com/calendar/u/{uid}/r/{view}/YYYY/MM/DD`
- Search: `https://calendar.google.com/calendar/u/{uid}/r/search?q={encoded-query}`
- Create: `https://calendar.google.com/calendar/u/{uid}/r/eventedit?{params}`

Use `agenda` as the default view for upcoming events. Use `day`, `week` or `month` only when the requested layout matters.

## Event-edit parameters

- `text`: event title
- `dates`: start and end joined by `/`
- Timed local values: `YYYYMMDDTHHmmSS/YYYYMMDDTHHmmSS`
- UTC values: add `Z` to each timestamp
- All-day values: `YYYYMMDD/YYYYMMDD`; the end is exclusive
- `ctz`: IANA timezone such as `America/New_York`
- `details`: description
- `location`: location
- `add`: comma-separated attendee email addresses
- `recur`: RFC 5545 rule such as `RRULE:FREQ=WEEKLY`
- `vcon`: conference URL or `meet`

URL-encode every parameter value. Open the event-edit URL, then use `browser_snapshot` to verify title, date, timezone, guests and calendar before saving.

## Working rules

Prefer direct search and event-edit URLs over menu hunting. Re-snapshot after opening an event or changing a side pane because Calendar often replaces content in place.

Reading the calendar needs no confirmation. Ask before saving a new event, changing an event, inviting guests or deleting anything. If timezones or all-day boundaries are ambiguous, resolve them before opening the final editor.

Use `browser_click` for controls and `browser_type` for visible fields. `browser_press` may use `t` for today, but only when the calendar page has focus. For complex inspection, a `browser-harness-js` snippet may read the attached page; do not use hidden calendar APIs.
