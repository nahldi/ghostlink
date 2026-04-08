# GhostLink v6.0.1 Introspection Test Plan

**Owner:** kurt  
**Status:** Draft for spec input  
**Last updated:** 2026-04-08

---

## Scope

Patch scope is limited to operator introspection commands and backing routes:

- `GET /api/introspect/memory`
- `GET /api/introspect/tools`
- `GET /api/introspect/stats`
- frontend slash-command wiring for those routes

Out of scope:

- sandbox default changes
- new execution permissions
- raw secret export
- new agent-control behavior

---

## Route Intent

These routes are operator observability surfaces, not data-dump endpoints.

- `/api/introspect/memory`: summary of memory state, drift, counts, and safe metadata
- `/api/introspect/tools`: summary of tool inventory, policy posture, and recent usage aggregates
- `/api/introspect/stats`: system-level aggregate stats exposed safely to operators

If a route needs raw payload export to be useful, it is mis-scoped for `v6.0.1`.

---

## Security Filter Criteria

### `/api/introspect/memory`

Allowed:

- agent name / id
- memory layer
- key
- tags
- size or token count
- created / updated / last_accessed timestamps
- access counters
- drift / conflict counts
- aggregate counts by layer / agent

Blocked or redacted:

- full memory content by default
- prompts, notes, or freeform memory bodies
- API keys, bearer tokens, passwords, cookies, session ids, auth headers
- absolute local paths outside operator-safe metadata needs
- secrets copied from files, env vars, tool outputs, or chat history

If preview text is shipped at all:

- hard cap to short snippets only
- redact known secret patterns before response serialization
- never return full multiline memory bodies

### `/api/introspect/tools`

Allowed:

- tool name
- category
- enabled / disabled state
- approval or policy mode
- risk tier
- aggregate invocation counts
- success / failure counts
- last-used timestamp

Blocked or redacted:

- raw tool arguments
- raw tool results
- fetched page contents
- shell commands with sensitive inline data
- file contents
- auth tokens, cookies, headers, connection strings, signed URLs

### `/api/introspect/stats`

Allowed:

- uptime
- task counts
- agent counts
- route counts
- tool counts
- message counts
- error-rate aggregates
- latency aggregates

Blocked:

- per-user secrets
- raw request payloads
- stack traces in normal success responses
- filesystem dumps

---

## Validation Gates

### API Contract

- [ ] Each route returns stable JSON with documented fields only
- [ ] Empty-state responses are truthful and non-error where appropriate
- [ ] Invalid query params fail cleanly with 4xx, not 500
- [ ] Large datasets are bounded or summarized

### Secret Safety

- [ ] Seed fake secrets into memory content and verify they do not appear in `/api/introspect/memory`
- [ ] Seed fake secrets into tool args/results and verify they do not appear in `/api/introspect/tools`
- [ ] Verify auth headers, bearer tokens, cookies, API keys, and connection strings are redacted or omitted
- [ ] Verify no route echoes server env vars or serialized backend config blobs

### Memory Safety

- [ ] `/api/introspect/memory` returns counts and metadata without dumping raw stored memory bodies
- [ ] If preview text exists, preview length is capped and redaction is applied before output
- [ ] Cross-agent aggregation does not leak unrelated sensitive content while summarizing counts

### Tool Safety

- [ ] `/api/introspect/tools` exposes inventory and aggregates only
- [ ] Tool policy posture matches backend truth
- [ ] Recent usage summaries do not include raw fetched content, prompts, or shell output bodies

### Frontend Wiring

- [ ] New slash commands do not collide with existing local `/stats`
- [ ] Command names and help text match backend route intent
- [ ] UI handles 404/500/timeout cleanly
- [ ] Empty-state messaging stays truthful

### Regression

- [ ] Existing local `/stats` behavior is unchanged unless explicitly renamed in spec
- [ ] Existing memory inspector surfaces still work
- [ ] Existing skills / audit / security routes still behave unchanged

---

## Recommended Test Data

Seed the following before validation:

- a fake API key in agent memory
- a fake bearer token in a recent tool result
- a fake cookie string in a tool-log fixture
- a normal non-sensitive memory entry
- at least one agent with no memory data
- at least one tool with zero invocations

---

## Ship Gate

I will certify `v6.0.1` introspection only if all are true:

- the three routes are summary-first
- secret-bearing fields are omitted or redacted
- frontend command naming avoids `/stats` ambiguity
- Tyson provides passing backend tests for redaction and empty-state handling
- frontend verification proves command wiring and error handling
