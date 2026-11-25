# AZIZ school registration: support, recovery and release guide

This guide is for the platform owner. It covers what happens when something goes wrong while registering a school, and how to release or roll back the registration feature safely.

## How a registration works (short)

1. Draft: the admin fills the wizard at `/admin` > Schools > Register a school. Everything is saved on the server as a draft (`onboardingDrafts`). Uploaded files are kept privately under `onboarding/<draft>/`.
2. Register: the server checks every field again, then in one transaction creates the school, its billing record, the registration record, the owner invitation and an audit entry.
3. Setup steps (after the transaction): move files, create classes, sections and subjects, send the welcome email (only if the invitation method is Email). Each step is written to `provisioningJobs/<draft>`.
4. Owner: signs in at `/app` with the invited, verified email, accepts the invitation, then accepts the terms and privacy agreement.
5. Activation: the admin marks the school Verified, then presses Activate registration. The server refuses until the owner has accepted. Activation is a recorded status; it does not lock the school.

Provisioning (steps 2 and 3) and activation (step 5) are separate on purpose.

## If something fails

| What you see | What it means | What to do |
|---|---|---|
| "Setup needs retry" on the school page | A setup step failed (files or classes). The school itself exists. | Open the school, press **Retry setup**. It only finishes what is missing and is safe to repeat. |
| Welcome email "not-configured" | Email is not set up (no Resend key, no From address). | Set it up in Platform settings > Email, then press **Send welcome email**. Until then the owner can still sign in at `/app` with the invited email. |
| Welcome email "failed" | Resend refused (see the note shown). | Fix the cause (usually the From domain is not verified), then **Send welcome email**. |
| Owner says the invitation does not work | It expired (14 days), was revoked, or the owner used a different email. | Press **Resend invitation** (gives 14 more days). Ask the owner to sign in with exactly the invited email and verify it. |
| Register button says "switched off" | New registrations were switched off. | On the Register a school page press **Switch on**. |
| "The subdomain is no longer held" | Someone else took it or the hold was released. | Open the Domain step, press Check and hold, choose another name if refused. |
| Duplicate request / pressed Register twice | Safe. The same draft returns the same school. | Nothing to do. One school is created per draft. |

Nothing here ever deletes school data. A failed step leaves the school in place.

## Emergency switch

**Register a school > Switch off** stops new drafts and new registrations. Drafts stay saved and finished schools are not touched. This is the first thing to do if registration misbehaves. Switch on again when fixed.

## Checks to run after every release

1. Open `/admin`, hard-refresh, open Register a school. The wizard must load without an error toast.
2. Register a test school (use a clearly fake name). Check: school appears in the list, owner invitation shows pending, classes exist, registration card shows the plan and prices.
3. Press Download confirmation PDF. It must open and contain no password or link.
4. Sign in at `/app` as the test owner, accept the invitation, accept the terms. The card must show consent Accepted.
5. Set verification to Verified, press Activate registration. It must work only now.
6. Sign in as an existing school's owner (for example ABCD School). Their dashboard must be unchanged and show no consent banner.
7. Check the public site: `https://azizschoolmanagement.plateria.in/` loads over HTTPS.

## Release order

1. `tests\run-tests.cmd` must pass.
2. `firebase deploy --only functions`
3. `node publish-rules.mjs` only if `firestore.rules` changed (registration changes do not need it). The rules file is close to its size limit, so avoid adding rules; new data should go through server functions.
4. `git push origin main` (this updates the Hostinger site).
5. Hard-refresh `/admin` and `/app`. The `?v=` tags in the page files force a new copy.

## Rollback

* Switch off new registrations first.
* Functions: redeploy the previous commit with `git checkout <old commit> -- functions` then `firebase deploy --only functions`.
* Website: revert the commit and push. The old files return on the next refresh.
* Never roll back by deleting schools, drafts or registration records. They are customer data.

## What is not automatic yet

* Two-factor policy and enabled login roles are recorded but not enforced at sign-in.
* A custom domain is only checked for ownership by a DNS record. Connecting it and HTTPS are done by hand.
* Website content and images from registration are stored privately and are not published automatically.
* Activation does not suspend or unlock the school.

## Where things are stored (server only)

`onboardingDrafts`, `schoolReservations`, `subdomainReservations`, `provisioningJobs`, `emailOutbox`, `schools/<id>/registration/main` and `.../consent`, and private files under `onboarding/` and `schools/<id>/onboarding/`. Browsers cannot read any of these; only the server functions can.
