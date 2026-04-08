# Productization Guardrails

Purpose: define the non-negotiable rules for turning GhostLink into a real product without coupling it to Finn's personal infra, secrets, or account state.

## Product Standard

GhostLink should be:
- local-first
- self-hostable
- secure by default
- customizable per install
- provider-agnostic
- founder-decoupled

GhostLink should **not** be:
- secretly dependent on Finn's Railway, tokens, domains, or accounts
- hardwired to Finn's personal preferences, prompts, or infra
- only usable "the right way" on the original developer setup

## Core Rule

If another user installs GhostLink on their own machine, their system should:
- work without Finn's infra
- use their own secrets, not Finn's
- generate their own identity and config state
- be customizable without touching the core product contract

## Non-Negotiables

### 1. No founder-coupled defaults

Never ship:
- Finn-owned API keys
- Finn-owned domains as required endpoints
- Finn-owned Railway URLs as required services
- Finn-specific instructions, souls, or policy baked into runtime defaults

Founder-specific setup may exist only as:
- local overrides
- optional deploy configs
- example values

### 2. Local-first is the baseline contract

Every install must support:
- local agent runtime
- local memory
- local identity
- local configuration
- local validation

Optional cloud features are allowed.
Required cloud dependence is not.

### 3. Hosted services must be optional companions

Any hosted control plane, dashboard, eval runner, or notification relay must be:
- off by default
- replaceable
- self-hostable
- non-blocking for local use

### 4. Private state stays private by default

Do not exfiltrate by default:
- souls
- local memory
- notes
- workspace files
- private prompts
- local model/provider secrets

Sharing must be explicit opt-in, not implied by installation.

### 5. Every install owns its own secrets

Secrets must be per-install and loaded from that install's environment/config.

No shipped secret may be usable outside the original dev environment.

### 6. Customization belongs in overlays, not forks

Per-user variation should live in:
- config
- profiles
- local instruction overlays
- optional cloud settings

Not in:
- hardcoded product logic
- repo-committed personal values

### 7. Product features must degrade cleanly

If an optional component is missing:
- Railway
- cloud dashboard
- hosted notifications
- external provider

GhostLink should degrade gracefully, not partially break in weird ways.

## Secure-By-Default Product Shape

The safest product shape is:

### Tier 1: Pure local

Always supported.

Includes:
- local backend
- local frontend
- local memory/state
- local providers where available
- optional external provider keys owned by the installer

### Tier 2: Optional cloud companion

Includes:
- hosted evals
- hosted notifications
- hosted dashboard/control plane
- collaboration relay

But:
- never required
- never canonical for local identity/memory

### Tier 3: Self-hosted or managed deployment

GhostLink may provide official deploy targets:
- local
- Railway
- other self-hosted targets later

But the product contract must remain portable across them.

## Reverse-Engineering / Privacy Boundary

What we can and cannot promise:

- We can design GhostLink so another user's install contains nothing about Finn by default.
- We can design GhostLink so founder-specific infra is optional and removable.
- We can design GhostLink so secrets are not stored in repo or defaults.
- We cannot honestly promise "impossible to reverse engineer" for software running on someone else's machine.

The real goal is:
- no embedded founder secrets
- no embedded founder dependence
- no automatic data path back to founder infrastructure

That is the defensible version of the requirement.

## Competitive Advantage From These Rules

These guardrails are not just defensive.
They are product advantages.

If GhostLink gets this right, it becomes:
- more trustworthy than founder-coupled agent tools
- easier to adopt in teams
- easier to self-host
- easier to sell as a serious product
- harder to dismiss as "cool but tied to one person's stack"

## Implementation Pressure On The Roadmap

These rules should shape the roadmap like this:

1. Identity stays server-owned per install, not globally founder-owned.
2. Memory stays local-first, with optional sync/export rather than silent cloud dependence.
3. Cloud control plane features stay optional and replaceable.
4. Profiles, policies, and souls must support per-install overlays.
5. Packaging/onboarding must detect missing optional services and degrade cleanly.
6. Security docs and threat models must explicitly treat founder-coupling as a risk.

## Recommendation

Build GhostLink like a real product:
- official
- polished
- opinionated
- customizable
- secure by default

But never let "official" drift into "secretly tied to Finn's personal account and infra."

That is the line.
