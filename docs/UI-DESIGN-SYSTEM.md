# UI design system — 5 directions / 11 implemented screens

The running MVP uses Direction A as the default. Five visual direction sheets are in `designs/`.

## Five design directions
1. **Calm Commerce** — soft slate canvas, white cards, indigo primary, teal success. Best general-purpose fit for micro sellers; this is the implemented default.
2. **Compact Operator** — denser rows and higher information density for sellers handling high ticket volume.
3. **Friendly Guided Setup** — progressive disclosure, setup checklist and explicit safe defaults for non-technical shop owners.
4. **Evidence-first Support** — prominent source evidence, confidence and escalation controls; best for accuracy-sensitive support teams.
5. **Free + Pro Transparent Growth** — useful seller briefings, clearly labeled Sponsored placements, usage metering and visible ad-free upgrade option.

## Implemented screen inventory
1. Overview / dashboard
2. Inbox / conversation detail / reply composer
3. AI assistant answer sandbox / evidence preview
4. Knowledge base / article create / text-file import
5. Terminology glossary / preferred translations
6. Channel setup / integration readiness
7. Language coverage selector
8. Analytics / answer quality scorecard
9. Quality & regression test history
10. Seller briefings / sponsored content disclosure
11. Settings / local model / safety / free-plan settings

## Interaction conventions
- Left sidebar for primary navigation; topbar for workspace context and status.
- Search and filters sit near the list they control.
- Primary action is visually singular; destructive actions are neutral/red and confirmed.
- AI responses are drafts, not auto-sent; evidence and handoff state are visible.
- Unsupported answers abstain; human review is recommended below threshold.
- Sponsored content is explicitly labeled and never blended into the assistant answer or disguised as system UI.
- Every form has a clear save/cancel path; responsive breakpoints collapse sidebar and columns on narrow screens.

## P3-07 Tailwind modernization (chat / onboarding / queue)

### Tailwind delivery

The npm registry mirror returned HTTP 403 for `tailwindcss`, so the CLI could not be installed in this environment. The official **Tailwind Play CDN 3.4.17** bundle is vendored locally:

```
public/tailwind.vendor.js   (407 KB, same-origin)
```

It loads before `ui.css` and the page stylesheet. No third-party request is made at runtime, so AC-05 remains green. For production, replace the Play CDN runtime with a compiled Tailwind CLI stylesheet when the registry is available:

```bash
npm install -D tailwindcss@3.4.17
npx tailwindcss -i public/tailwind.input.css -o public/tailwind.build.css --minify
```

### Tokens and interaction

| Token | Value |
|---|---|
| Brand | `#4f46e5` indigo |
| Ink | `#0f172a` |
| Muted | `#64748b` |
| Canvas | `#f1f5f9` |
| Card radius | 24–28px |
| Control radius | 12–16px |
| Easing | `cubic-bezier(.23, 1, .32, 1)` |
| Press feedback | `scale(.97)` |

- Tailwind utilities own layout, spacing, typography, color and breakpoints.
- `ui.css` owns dynamic components: message bubbles, onboarding steps, template selected state, badges and queue rows.
- Motion stays under 300ms; `prefers-reduced-motion` removes transform motion.
- Hover styles are not required for function; controls have visible focus rings and active press feedback.

### Screens

- **chat.html** — mobile-first shell (`100dvh`), brand header, online pill, privacy consent panel, welcome bubble, agent/user bubbles, composer hint. At 390px the voice/upload controls become a 2-column row, the input becomes full-width and the send button becomes full-width.
- **onboarding.html** — two-column SaaS onboarding at `lg`, stacked on mobile; four progress steps with active/done states; template cards; knowledge draft and dark embed code block. All original IDs/roles preserved.
- **queue.html** — admin queue with risk/status badges and hover rows; table wrapper scrolls, not the document. Original `#escalationRows [data-escalation-id]` contract preserved.

### Verification

| Check | Result |
|---|---|
| Node tests | 27/27 |
| Playwright AC + P2 live | 6/6 |
| 390px UI | 1/1 (chat + onboarding + queue, no document overflow) |
| AC-05 foreign requests | 0 |

Runs:

- `RUN-20261020-002114-P3-07-FINAL-AC` — 19 AC screenshots
- `RUN-20261020-002126-P3-07-FINAL-UI390` — 4 mobile screenshots

### Production note

The Play CDN runtime compiles utilities in the browser and is intended for prototypes. The vendored local copy removes third-party requests and satisfies the current CSP, but a compiled Tailwind build is preferable for production cacheability and first-paint performance. No test assertion was weakened to adopt it.

