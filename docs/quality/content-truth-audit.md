# Content truth audit — landing claims vs implementation

Date: 2026-10-25  
Scope: current `c5bf9ba` code + local running app. This is a product-truth
review, not a translation review.

| Claim / surface | Current implementation evidence | Verdict | Required decision |
|---|---|---|---|
| "Email, chat and social threads merged and prioritized" | `public/app.js` channels view labels Email support, WhatsApp Business and Instagram as **Needs setup**; server has no SMTP/WhatsApp/Instagram integration | **Not yet true** | Implement integrations or change marketing copy to the currently available channel(s) |
| "One calm queue" | Inbox/queue code exists; website chat and test conversations work | **True for supported surfaces** | Clarify which channels are actually live |
| "AI drafts in your voice" | `/api/chat` draft path, human approval and fallback are implemented; tests AC-02/03 | **True** | Keep human-approval wording |
| "Set up in minutes" | Onboarding/register/site/knowledge/embed path is tested in AC-01 | **True for the tested path** | Verify with a real customer account before launch |
| Pricing Free / Pro / Business | Landing displays plan cards; no Stripe/payment/subscription provider exists in the repo | **Illustrative only** | Implement billing or label pricing as planned/illustrative |
| "Try Pro free" / "Start free trial" | Buttons route to onboarding; no paid subscription exists | **Potentially misleading** | Keep only if the free trial is genuinely available; otherwise relabel |
| Privacy notice | Chat has a consent gate and `/api/health` reports privacy configuration; no standalone privacy policy page exists in `public/` | **Partial** | Add Privacy Policy and Terms pages, or remove claims that imply them |
| 39-language support | 39 landing/demo/UI bundles exist and RTL checks pass | **Structural support true** | Native-speaker review remains NOT RUN |
| Arabic / RTL | Automated RTL and layout checks pass | **True for tested surfaces** | Human visual sign-off remains |
| Ad-supported insights | AdSense placeholders are disabled; no live ad client | **Placeholder** | Keep clearly labeled as placeholder or remove before claiming monetization |
| Custom domain `www.nudgeso.com` | CORS now allows the origin; DNS/SSL not verified | **CORS true; domain NOT RUN** | Configure DNS and verify HTTPS/redirects |
| Free monthly replies / credits | Server settings include reply limit/credit concepts; no payment enforcement provider | **Partial** | Verify real quota enforcement with a production-like account |

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
