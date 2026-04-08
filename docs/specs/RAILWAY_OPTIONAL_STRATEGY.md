# Railway Optional Strategy

Purpose: define the only sane way GhostLink should use Railway without turning Finn's personal Railway account into a hidden single point of failure, a privacy leak, or a reverse-engineering gift.

## Bottom Line

Railway can help GhostLink.

Railway must **not** become:
- a required dependency for normal GhostLink use
- the canonical home of private souls, memories, or personalized config
- a public multi-tenant hub tied to Finn's personal account
- a place where another user's install depends on Finn's infrastructure to work

Local-first stays the default.

Railway, if used, is an **optional companion deployment**.

## Security Reality Check

"100% secure" is not a real engineering promise.

The real target is:
- minimize blast radius
- keep private state local by default
- make hosted features optional
- isolate environments
- keep secrets out of the repo
- make hosted compromise non-fatal for local GhostLink use

That is a defensible architecture. "Perfect security" is marketing.

## What Railway Is Good For

Railway is most useful for optional infrastructure that benefits from:
- private service-to-service networking
- managed environment variables
- isolated environments
- hosted Postgres / Redis / volumes
- quick deploy and rollback

That points to three valid GhostLink uses.

### 1. Optional control-plane services

Good candidates:
- eval runner service
- benchmark dashboard backend
- notification/webhook relay
- remote status API for your own operator dashboards

Why this is safe:
- these are support services, not the core local runtime
- if Railway is down, local GhostLink still works
- users without Railway lose optional cloud features, not the product

### 2. Optional shared infra for Finn's own installs

Good candidates:
- hosted Postgres for eval history
- hosted Redis for job queue / rate-limit cache
- internal-only services behind Railway private networking

Why this is safe:
- this helps your own fleet or demo setup
- it does not become a requirement for everyone else
- you can keep internal services off the public internet

### 3. Optional collaboration rendezvous

Good candidate:
- a minimal relay/coordinator for cross-device notifications or remote operator actions

Why this can work:
- use signed short-lived tokens
- make it stateless or near-stateless
- keep sensitive memory/identity local and send only the minimum necessary metadata

## What Railway Should NOT Be Used For

Do not use Railway as:

### 1. The canonical memory store

Do not put:
- `SOUL.md`
- agent memory store
- private notes
- local workspace artifacts
- personalized instruction overlays

into a Finn-hosted shared cloud by default.

That is the fastest route to privacy, trust, and product portability problems.

### 2. The canonical identity registry for all GhostLink installs

Do not make every GhostLink install call back to Finn's Railway project for:
- agent registration
- identity issuance
- profile resolution
- task routing

That would make the project feel proprietary, fragile, and creepy.

### 3. A hidden required backend

If a feature silently requires Finn's Railway project, GhostLink stops being a real product and becomes "software that only fully works on the founder's infra."

Bad trade.

## Safe Architecture Rule

GhostLink should support three runtime modes:

1. **Pure local**
   - no Railway
   - full local functionality
   - the baseline every install must support

2. **Self-hosted optional cloud**
   - same optional cloud services, but deployed anywhere
   - Railway is one deployment target, not the only deployment target

3. **Finn's Railway deployment**
   - only for Finn's own use, demos, benchmarks, or hosted add-ons
   - never assumed by default in the product contract

## Recommended Railway Use For GhostLink

The best Railway strategy is:

### A. Ship an optional "GhostLink Control Plane" deploy target

Contents:
- API service
- Postgres
- Redis

Responsibilities:
- eval history
- benchmark runs
- notification delivery
- optional remote operator dashboard state

Not responsible for:
- local agent memory
- local workspace files
- local souls
- local personal prompts

### B. Keep sensitive state local by default

Hosted services should receive only:
- trace/event metadata
- benchmark results
- notification payloads
- signed job descriptors

Hosted services should not receive raw private workspace data unless the operator explicitly opts in.

### C. Make hosted features explicit feature flags

Examples:
- `GHOSTLINK_CLOUD_ENABLED=0/1`
- `GHOSTLINK_CLOUD_URL=...`
- `GHOSTLINK_CLOUD_SIGNING_KEY=...`

If unset:
- local GhostLink works normally
- cloud-only features disappear cleanly

### D. Treat Railway as one deployment target, not the architecture

Design the control-plane service so it can run:
- locally
- on Railway
- on another host later

That preserves portability and avoids founder lock-in.

## Minimum Security Rules If Railway Is Used

1. No secrets in repo. Ever.
2. No Finn-personal values baked into defaults.
3. Separate Railway environments for dev / staging / prod.
4. Internal services use private networking where possible.
5. Public endpoints expose only the minimum necessary surface.
6. All remote actions require signed auth, expiry, and audit logs.
7. Cloud compromise must not expose local GhostLink memory by default.
8. Hosted outage must not break pure-local GhostLink.

## Competitive Advantage Railway Can Actually Add

If done right, Railway gives GhostLink:
- an optional hosted control plane faster than building bespoke infra
- easy demo/staging environments
- optional remote dashboards and notifications
- hosted eval/benchmark infrastructure
- a better collaboration story without forcing cloud dependence

If done wrong, Railway gives GhostLink:
- hidden SaaS dependence
- privacy risk
- founder-account fragility
- a reverse-engineering and trust problem

## Recommendation

Use Railway only for an optional GhostLink control plane.

Do **not** use it as the product's canonical brain.

That gives you the upside:
- speed
- hosted evals
- hosted notifications
- remote visibility

without the stupid downside:
- forced cloud dependence
- leaking your personal setup
- breaking the local-first contract

## Source Notes

This strategy is consistent with current Railway docs on:
- private networking: https://docs.railway.com/private-networking
- environments: https://docs.railway.com/reference/environments
- variables / references: https://docs.railway.com/develop/variables
- managed variable workflows: https://docs.railway.com/guides/manage-variables
- data storage / volumes / backups:
  - https://docs.railway.com/data-storage
  - https://docs.railway.com/volumes/backups
- access controls: https://docs.railway.com/access
