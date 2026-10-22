# NudgeSo — Frozen Shared UI Layer (for the next agent)

This note is for the agent who will build the independent pages:
`upload.html`, `manual.html`, `chat.html`, `onboarding.html`, `queue.html`,
`insights.html`, `insight.html`. **Do not change the tokens, fonts or component
class names documented here** — they are frozen so every page stays on-brand.

---

## 1. Brand facts (verbatim)

- Brand name: **NudgeSo** (always "NudgeSo", never "Nudgeso"/"NUDGESO").
- Slogan: **Calm Customer Support**
- Domain: **www.nudgeso.com**
- Audience: small-shop owners, limited formal education, older users, global
  languages. Rule of copy: short sentences, everyday words, no jargon.

## 2. Design tokens (CSS variables)

Defined in `public/styles.css :root` and mirrored in `public/ui.css :root`.

| Token | Value | Meaning |
|---|---|---|
| `--primary` | `#EE6E3A` | warm orange — **the only primary action colour** |
| `--primary-dark` | `#C8541F` | hover / pressed orange |
| `--primary-light` | `#F59E5E` | soft orange borders |
| `--primary-soft` | `#FDEBDD` | orange tint background |
| `--oat` | `#F3EAD8` | app background |
| `--cream` | `#F7F4EC` | page / panel background |
| `--ink` | `#262B33` | body text |
| `--muted` | `#5b6470` | secondary text (**never lighter than #999**) |
| `--green` | `#18A874` | success |
| `--green-soft` | `#E2F5EC` | success tint |
| `--red` | `#D95C68` | danger |
| `--red-soft` | `#FBE7E9` | danger tint |
| `--amber` | `#E8923A` | "needs attention" |
| `--amber-soft` | `#FDF0DC` | attention tint |
| `--line` | `#E7DFCF` | hairline borders |
| `--radius-card` | `24px` | cards |
| `--radius-control` | `16px` | buttons / inputs |

Legacy aliases kept so old code keeps working: `--bg`, `--panel`, `--teal`,
`--orange`, `--shadow`.

## 3. Typography (Google Fonts — already loaded in the SPA head)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Asap:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- **Baloo 2** (600/700) → page titles, brand wordmark, big numbers.
- **Asap** (400/500/600/700) → body, UI, buttons.
- Sizes: body **18px** (min 16px); customer messages **19–20px**;
  H1 34–40px; H2 26–28px; H3 20–22px. Line-height 1.6–1.8.

Add the same `<link>` block to every independent page `<head>`.

## 4. Favicon

Copy/use from `public/favicon/`: `favicon.ico`, `apple-touch-icon.png`,
`android-chrome-192.png`, `android-chrome-512.png`. Head snippet:

```html
<link rel="icon" href="/favicon/favicon.ico">
<link rel="apple-touch-icon" href="/favicon/apple-touch-icon.png">
```

## 5. Icons — `public/icons.js` (shared, linear round, 1.5 stroke)

Load before your page script: `<script src="/icons.js"></script>`.

- `window.NS_ICON(name, size)` → inline SVG string, `viewBox 0 0 24 24`,
  `stroke="currentColor"`, stroke-width 2, round caps/joins. Default size 20.
- `window.NS_LOGO(size, className)` → the smile-hug brand mark, colour = `currentColor`.
- Available names: `home, messages, inbox, shop, help, assistant, spark,
  glossary, channels, languages, analytics, tests, growth, settings, send,
  upload, download, check, close, alert, clock, search, paperclip, smile, user,
  plus, chevron-down, chevron-right, refresh, edit, file-icon, info, shield,
  globe, chat, dots`.

**Never reintroduce text symbols** (◫▤✳⌘ⓘ etc.). Use `NS_ICON` everywhere.

## 6. Component class names (frozen)

From `styles.css` (SPA) and `ui.css` (shared independent pages):

- Buttons: `.btn` (neutral), `.btn.primary` (the **one orange CTA per page**),
  `.btn.small`, `.btn.danger`.
- Cards: `.card`, `.card-pad`, `.card-head`.
- Badges (3-channel: icon + text + colour): `.badge`, `.badge.green`,
  `.badge.orange`, `.badge.red`, `.badge.purple`, `.badge.blue`.
- Forms: `.field` (label + input), `.search`, `.toggle-row` + `.toggle`,
  `.form-row`.
- Notice: `.notice` + `.notice-icon`.
- Toast: `#toast` (big icon + one line, auto-hides ~3s in `app.js`).
- Chat bubbles (independent pages): `.message[data-role="user"]` = orange,
  `.message[data-role="agent"]` = white card.
- Status pills / steps / queue rows already branded in `ui.css`.

## 7. Hard UX rules (verbatim from the brief)

- Every tappable element ≥ **48×48px** (mobile 52–56px); spacing ≥ 12px.
- **Exactly one orange primary button per page**; everything else outline/neutral.
- State is always **icon + text + colour** (e.g. "Waiting · orange dot",
  "Sent · green check") — never colour alone.
- Deletes / resets / sends open a big confirm dialog whose button says the
  consequence ("Send to customer", not "OK").
- Background = oat/cream; cards = white; soft shadows only; content max-width 1200.
- Mobile (≤860px): sidebar becomes a slide-in drawer with a hamburger; multi-column
  grids collapse to one column; bottom CTA goes full-width.

## 8. Plain-language glossary (UI copy)

| Say | Don't say |
|---|---|
| Customer messages | Inbox |
| My store info | Knowledge base / distill |
| Waiting for you / In use | draft / confirmed |
| Replies left this month | Credits |
| The AI reads it automatically | upload & distill |
| Ask me when unsure | confidence threshold |
| Send tricky questions to a person | human handoff |
| Which store info it used | evidence |
| How sure it is | confidence score |

## 9. SPA contract you must NOT break

- 11 SPA pages are rendered by `public/app.js` into `#page`. Their `data-page`
  values: `overview, inbox, assistant, knowledge, glossary, channels, languages,
  analytics, tests, growth, settings`.
- Required ids/data-action/name list is unchanged (see `ui-redesign-brief.md`).
- Fetch paths stay under `/api/...` and `/api/v1/...`; do not change them.
- Token in `localStorage` key `relaydesk_token`; locale key `relaydesk_locale`.
