# marketplace-firebase-patterns

[![CI](https://github.com/horacioparisotto/marketplace-firebase-patterns/actions/workflows/ci.yml/badge.svg)](https://github.com/horacioparisotto/marketplace-firebase-patterns/actions/workflows/ci.yml)

Patterns from **Lit**, a curated influencer marketplace [featured by Forbes](https://forbes.com.mx/conoce-lit-app-la-startup-que-quiere-reinventar-el-marketing-de-influencers-en-latinoamerica/). Think Airbnb, but brands list events instead of apartments: creators apply, brands approve them, check them in at the door with a QR code and approve the content posted afterwards. As lead engineer I took an unfinished draft from an outside team and built the product end to end, through launch on Google Play and the App Store.

> **Rewritten from scratch to protect client code.** This is not the production source, and parts are written the way they should be rather than exactly as they shipped. The business rules live in plain functions that take the database as a parameter; the Cloud Functions in [`src/functions.ts`](src/functions.ts) compile against the real Firebase SDKs, and the tests run against an in-memory database with Firestore's transaction semantics.

Full case study: [horacioparisotto.com](https://www.horacioparisotto.com/)

```bash
npm ci && npm test
```

## Patterns

### 1. A collaboration as an explicit state machine · [`src/stateMachine.ts`](src/stateMachine.ts)

Every application moves through explicit states (requested, scheduled, checked in, submitted, changes requested, completed) instead of a loose set of flags, so brands and creators always know whose turn it is. Invalid moves fail loudly instead of leaving a collaboration in a state nobody planned for.

### 2. QR check-in that works exactly once · [`src/checkIn.ts`](src/checkIn.ts)

A code only works for its own brand and only once. The check and the update run in one transaction, so two phones scanning the same code at the same moment can't both succeed: the test runs that race. The brand comes from the signed-in session, never from the request.

### 3. Plan limits enforced on the server · [`src/plans.ts`](src/plans.ts)

Brands pay for plans (through Mercado Pago) that set how many creators they can work with and for how long. A limit enforced on the phone is a limit anyone can skip, so approval goes through a callable function that checks the allowance and counts the approval in one transaction. Two approvals racing for the last slot: only one gets it.

### 4. Gift keys that work once · [`src/giftKeys.ts`](src/giftKeys.ts)

For partnerships, gift keys unlock collaborations without a payment, so the business could onboard key brands for free without bypassing the limits. Marking the key and adding the allowance are one transaction, and invalid and used keys get the same answer, so the endpoint can't be used to probe which keys exist.

### 5. One-tap ratings from an email · [`src/ratings.ts`](src/ratings.ts) · [`app/api/rate/route.ts`](app/api/rate/route.ts)

Asking people to open an app to rate an event doesn't work well, so ratings arrive by email. The link hits a route in the admin panel that stores the rating and updates the creator's running average and count. Mail scanners open links on their own, so GET only renders a page and the vote is a POST; a second tap on the same link counts once, and the average is stored unrounded so it never drifts.

### 6. One door for every write · [`src/functions.ts`](src/functions.ts) · [`src/db.ts`](src/db.ts)

Collaborations, plans and gift keys change only through callable Cloud Functions, and domain errors map to proper HTTPS error codes. The domain code depends on a small `Db` port; [`src/firebase.ts`](src/firebase.ts) adapts firebase-admin to it, and [`test/memoryDb.ts`](test/memoryDb.ts) implements it in memory with optimistic transactions, so the concurrency tests above fail if the transactions are removed.

---

Horacio Parisotto · Senior Full-Stack & AI Engineer · [Portfolio](https://www.horacioparisotto.com/) · [LinkedIn](https://www.linkedin.com/in/horacioparisotto/)
