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
