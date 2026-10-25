# Content truth audit — landing claims vs implementation

Date: 2026-10-25  
Scope: current `c5bf9ba` code + local running app. This is a product-truth
review, not a translation review.

| Claim / surface | Current implementation evidence | Verdict | Required decision |
|---|---|---|---|
| "Email, chat and social threads merged and prioritized" | Copy now says website chat + shared merchant inbox are live; email/social connectors are assisted setup and rolling out separately. No SMTP/WhatsApp/Instagram integration exists. | **Copy corrected; integrations not implemented** | Keep truthful copy until connectors are live |
| "One calm queue" | Inbox/queue code exists; website chat and test conversations work | **True for supported surfaces** | Clarify which channels are actually live |
| "AI drafts in your voice" | `/api/chat` draft path, human approval and fallback are implemented; tests AC-02/03 | **True** | Keep human-approval wording |
| "Set up in minutes" | Onboarding/register/site/knowledge/embed path is tested in AC-01 | **True for the tested path** | Verify with a real customer account before launch |
| Pricing Free / Pro / Business | Plan cards are now labeled "Preview plan" / "Preview price — no charge"; the note says no payment is collected. No payment provider exists. | **Resolved in copy** | Implement billing only when the commercial decision is ready |
| "Try Pro free" / "Start free trial" | Relabeled to "Preview Pro" and "Talk to us"; both route to onboarding. | **Resolved in copy** | No paid checkout is implied |
| Privacy notice | Chat has a consent gate; `/privacy.html` and `/terms.html` are now present as clearly marked draft templates with noindex. Final legal review is still required. | **Draft pages added** | Replace placeholders, translate, and obtain counsel approval before collecting real customer data |
| 39-language support | 39 landing/demo/UI bundles exist and RTL checks pass; legal pages are English-only drafts. | **Structural support true; native review NOT RUN** | Native-speaker review and legal translation remain NOT RUN |
| Arabic / RTL | Automated RTL and layout checks pass | **True for tested surfaces** | Human visual sign-off remains |
| Ad-supported insights | AdSense placeholders are disabled; no live ad client | **Placeholder** | Keep clearly labeled as placeholder or remove before claiming monetization |
| Custom domain `www.nudgeso.com` | CORS now allows the origin; DNS/SSL not verified | **CORS true; domain NOT RUN** | Configure DNS and verify HTTPS/redirects |
| Free monthly replies / credits | Server settings include reply limit/credit concepts; no payment enforcement provider. | **Partial** | Verify real quota enforcement with a production-like account |

## Recommended copy decisions

1. Until email/WhatsApp/Instagram are live, change the landing feature description
   to "website chat and shared inbox" or explicitly say channels are rolling out.
2. Do not present the Pro/Business prices as purchasable until a payment provider
   and subscription lifecycle exist. A "planned pricing" label is safer.
3. Add `/privacy.html` and `/terms.html` before collecting real customer data.
4. Keep the 39-locale selector but label translations as beta/draft until native
   review is complete.
5. Remove "ad-supported" implications while AdSense remains a disabled placeholder.

## What automation can prove

- The app renders the pages and handles the tested journeys.
- The 39-locale resources are structurally complete and RTL behaves.
- The health, CORS, deployment and backup paths work.
- The claims above map to code paths, with the discrepancies recorded.

## What only the owner can decide

- Which channels are actually sold at launch.
- Whether pricing is live, preview-only, or removed.
- Legal/privacy/terms wording and jurisdiction.
- Native-language publication approval.
- Final marketing claims and go/no-go.


## Phase 2 copy/legal changes

- Landing now states that only the website chat and shared merchant inbox are live today.
- Email and social connectors are described as assisted setup / rolling out, not as live.
- Paid plans are labeled as preview-only with no payment collected.
- Pro/Business CTAs are "Preview Pro" / "Talk to us", not purchase CTAs.
- Added `/privacy.html` and `/terms.html` as noindex, clearly marked draft templates.
- The legal drafts intentionally contain unresolved bracketed placeholders; they are not
  final legal documents and must not be presented as such.
- 39 landing translations were regenerated for the corrected copy.
