# GhostLink — Feature Roadmap (New Ideas)

> Features and upgrades to make GhostLink the #1 multi-agent AI platform people actually want to use.

---

## QUICK WINS (Small effort, big impact)

### 1. Auto-Route Toggle
**What:** Setting to toggle whether agents automatically receive ALL messages or only @mentioned ones.
**Why:** Sometimes you want agents passively listening and jumping in when relevant. Other times you only want them when called.
**How:** Toggle in Settings → syncs `default_routing` to router.py (backend already supports "all" vs "none"). Maybe a third mode: "smart" — agents get the message but decide themselves whether to respond.
**Effort:** Tiny — 1 toggle + 2 lines backend.

### 2. Agent Response Modes
**What:** Per-agent setting: "Always respond", "Only when mentioned", "Listen & decide", "Silent observer"
**Why:** Different agents serve different roles. Your code reviewer should only speak when asked. Your project manager might want to see everything.
**How:** Store per-agent in settings, pass to router.py filtering.

### 3. Message Templates / Quick Replies
**What:** Save frequently used prompts as templates. Click to insert.
**Why:** Users repeat the same instructions constantly ("review this PR", "write tests for X", "refactor Y").
**How:** Template library in settings, keyboard shortcut to open (Ctrl+T), searchable list.

### 4. Conversation Starters
**What:** When a channel is empty, show suggested prompts like "Ask Claude to review your code" or "Start a brainstorm with @all".
**Why:** New users don't know what to do. Reduces friction.
**How:** Clickable suggestion chips in empty channel state.

### 5. Agent Presets / Profiles
**What:** One-click agent configurations: "Code Reviewer", "Creative Writer", "DevOps Engineer", "Project Manager"
**Why:** Users shouldn't have to manually set SOUL, skills, model, temperature every time.
**How:** Preset library with SOUL template, skill set, model selection, temperature. Apply with one click.

---

## COLLABORATION FEATURES (Make teams want this)

### 6. Shared Workspaces
**What:** Multiple users can connect to the same GhostLink server and chat together with agents.
**Why:** Teams want to collaborate with AI agents together, not just solo.
**How:** User authentication (simple token or password), user avatars/colors, presence indicators ("Finn is typing..."), user list in sidebar.

### 7. Agent-to-Agent Direct Messages
**What:** Agents can have private conversations in a dedicated DM channel that the user can observe.
**Why:** When Claude delegates to Codex, their back-and-forth shouldn't clutter the main channel.
**How:** Auto-create DM channels like `#claude-codex`, show in sidebar under "Agent DMs" section.

### 8. Project Boards / Kanban
**What:** Visual kanban board for jobs. Drag cards between columns: Backlog → In Progress → Review → Done.
**Why:** The jobs system exists but is just a list. Visual boards are way more useful for project management.
**How:** New `ProjectBoard.tsx` component, drag-and-drop, auto-assign agents to cards.

### 9. Code Review Mode
**What:** Paste a PR URL or diff, agents review it with inline comments.
**Why:** Code review is the #1 use case for AI in development teams.
**How:** Diff viewer component, agents add comments at specific lines, approval/rejection workflow.

### 10. Meeting Mode
**What:** Structured meeting with agenda, timer, speaking order, action items, and auto-generated summary.
**Why:** Brainstorming sessions with multiple agents need structure.
**How:** `/meeting` command starts a structured session. Timer per topic. Auto-summarize at end. Export meeting notes.

---

## INTELLIGENCE FEATURES (Make agents smarter)

### 11. Agent Context Memory (Long-term)
**What:** Agents remember past conversations across sessions. "Last time we discussed the auth module, you said..."
**Why:** Currently agents lose all context when restarted. Long-term memory makes them dramatically more useful.
**How:** agent_memory.py already exists. Auto-save key decisions, summaries, and user preferences. Inject relevant memories into system prompt on spawn.

### 12. Smart Context Compression
**What:** Instead of sending full chat history, compress old messages into summaries.
**Why:** Token efficiency. A 500-message conversation costs $$$. A 10-line summary + last 20 messages is 95% cheaper.
**How:** Every 50 messages, generate a summary. Replace old messages with summary in MCP read context. User sees full history, agents see compressed.

### 13. Agent Learning / Feedback Loop
**What:** 👍/👎 on agent responses teaches them what you like. Over time they adapt.
**Why:** Every user has different preferences. Agents should learn yours.
**How:** Store feedback in agent memory. Include recent feedback patterns in system prompt: "User prefers concise responses" or "User likes code comments".

### 14. Multi-Model Routing
**What:** Same agent can use different models for different tasks. Quick questions → Haiku. Complex code → Opus.
**Why:** Cost optimization + speed. Not every message needs the most expensive model.
**How:** Keyword/complexity classifier picks model. Or user prefixes: `!fast @claude` uses Haiku, `!deep @claude` uses Opus.

### 15. Agent Specialization Training
**What:** Fine-tune agent behavior with examples. Show it 10 perfect responses, it learns the pattern.
**Why:** Generic agents give generic answers. Specialized agents are 10x more useful.
**How:** Training examples stored per-agent. Included as few-shot examples in system prompt.

---

## POWER USER FEATURES (Make it indispensable)

### 16. Workflow Automation / Pipelines
**What:** Chain agent actions: "When a PR is merged → @claude review → @codex write tests → post results to #releases"
**Why:** Repetitive multi-step workflows should be automated.
**How:** Visual pipeline builder or YAML config. Trigger → Action → Action chain. Webhook triggers from GitHub/CI.

### 17. Dashboard / Analytics
**What:** Visual dashboard showing: messages per day, tokens used, cost breakdown, agent performance, response times.
**Why:** Users need to understand their AI usage and costs.
**How:** Chart.js or recharts. Aggregate from existing usage/activity APIs.

### 18. Voice Input / Output
**What:** Talk to agents, hear their responses. Push-to-talk or always-on.
**Why:** Hands-free interaction while coding. Accessibility.
**How:** Web Speech API for input, TTS for output. Voice activity detection.

### 19. Screen Sharing with Agents
**What:** Share your screen/IDE with an agent. It sees what you see and can suggest actions.
**Why:** "Look at what I'm working on and help me" is the most natural interaction.
**How:** Screen capture API → send screenshots to vision-capable models periodically.

### 20. IDE Extensions
**What:** VSCode/Cursor/JetBrains extensions that connect to GhostLink. Chat with agents from your editor.
**Why:** Developers don't want to leave their IDE. Bring GhostLink to them.
**How:** Extension that opens GhostLink panel inside the editor. WebSocket connection to the same server.

### 21. Mobile App
**What:** iOS/Android app for monitoring and quick commands.
**Why:** Check on agents, respond to approvals, get notifications on your phone.
**How:** React Native or PWA. Connect to Cloudflare tunnel for remote access.

### 22. Plugin Marketplace
**What:** Community-driven plugins. Browse, install, rate. One-click.
**Why:** Users build for users. Exponential growth.
**How:** Plugin registry, npm-style package manager, curated categories.

---

## VIRAL / GROWTH FEATURES (Make people share it)

### 23. Share Conversations
**What:** Generate a shareable link to a conversation. Like sharing a ChatGPT chat but with multiple agents.
**Why:** "Look at Claude and Codex arguing about monorepos" is content people share.
**How:** Export as styled HTML page with a unique URL. Optional: host on ghostlink.dev.

### 24. Agent Personalities / Characters
**What:** Give agents fun personalities. "Pirate Claude", "Shakespearean Codex", "Drill Sergeant Gemini".
**Why:** Fun factor. People share screenshots of funny agent interactions.
**How:** SOUL templates with personality presets. Community-contributed personalities.

### 25. Leaderboards / Benchmarks
**What:** Track which agents perform best at different tasks. "Claude wins at code review, Codex wins at debugging."
**Why:** Users are curious about model comparisons. Creates engagement.
**How:** Auto-benchmark on common tasks. Display results in dashboard.

### 26. GhostLink Cloud (SaaS)
**What:** Hosted version. Sign up, connect your API keys, start chatting. No install needed.
**Why:** Not everyone wants to run a local server. Cloud version removes all friction.
**How:** Docker deployment, multi-tenant, Stripe billing, per-seat pricing.

### 27. Replay & Demo Mode
**What:** Record agent conversations and replay them as demos. Like a screen recording but interactive.
**Why:** Product demos, tutorials, showcasing agent capabilities.
**How:** Record all events with timestamps. Replay with variable speed. Export as video or interactive page.

---

## SECURITY & ENTERPRISE (Make it trustworthy)

### 28. Audit Log
**What:** Immutable log of every action: who sent what, which agent responded, what files were changed.
**Why:** Enterprise compliance. Know exactly what AI agents did.
**How:** Append-only log file + API endpoint. Exportable.

### 29. Approval Workflows
**What:** Agent actions require human approval before execution. "Codex wants to modify auth.py — Approve?"
**Why:** Safety. You don't want agents making changes without your OK.
**How:** Approval gates already exist (chat_propose_job). Extend to file writes, shell commands, deployments.

### 30. Role-Based Access Control
**What:** Different users have different permissions. Admin can spawn agents. Viewer can only read.
**Why:** Team environments need access control.
**How:** User roles (admin, editor, viewer). Permission checks on API endpoints.

### 31. Data Encryption
**What:** Encrypt chat history, agent memories, and settings at rest.
**Why:** Sensitive code and conversations need protection.
**How:** SQLite encryption extension (SQLCipher) or application-level encryption.

### 32. Self-Hosted Registry
**What:** Companies can run their own plugin/skill registry internally.
**Why:** Enterprise security — don't want to pull from public registries.
**How:** Docker image for registry server. Private npm-style hosting.

---

## INTEGRATIONS (Connect to everything)

### 33. GitHub Deep Integration
**What:** PR reviews, issue tracking, commit comments, CI status — all in GhostLink.
**Why:** GitHub is where developers live. Deep integration makes GhostLink essential.
**How:** GitHub App or OAuth. Webhooks for events. Agent tools for GitHub API.

### 34. Slack/Discord Bridge
**What:** Bridge GhostLink channels to Slack/Discord channels. Messages flow both ways.
**Why:** Teams already use Slack/Discord. Meet them where they are.
**How:** Bot integration for Slack/Discord. Message relay via webhooks.

### 35. Jira/Linear Integration
**What:** Create tickets, update status, link to conversations.
**Why:** Project management integration makes agents actually useful for PM.
**How:** OAuth + API integration. Agent tools for ticket CRUD.

### 36. CI/CD Integration
**What:** GitHub Actions, Jenkins, CircleCI status in GhostLink. Agents can diagnose failures.
**Why:** "Why did the build fail?" → agent investigates automatically.
**How:** Webhook receiver + agent auto-trigger on failure events.

### 37. Notion/Docs Integration
**What:** Agents can read/write to Notion, Google Docs, Confluence.
**Why:** Documentation is a huge AI use case. Integrate where docs live.
**How:** API integration per platform. Agent tools for doc CRUD.

---

## AGENT SKILLS — Tools Every Agent Should Have

> These are MCP tools and integrations that agents can use autonomously. When enabled, any agent (Claude, Codex, Gemini, etc.) gets these capabilities.

---

### WEB & BROWSER SKILLS

#### 41. Firecrawl — Web Scraping & Crawling
**What:** [Firecrawl](https://www.firecrawl.dev/) turns any website into clean, LLM-ready markdown or structured data. Handles JS-rendered content, anti-bot measures, and entire site crawls.
**Tools:** `firecrawl_scrape(url)`, `firecrawl_crawl(url)`, `firecrawl_search(query)`, `firecrawl_map(url)`, `firecrawl_extract(url, schema)`
**Why it's essential:** Agents need to read the web. Research competitors, read docs, scrape product data, monitor changes. Firecrawl does all of it with a free tier (10 scrapes/min).
**Install:** `npx -y firecrawl-mcp` — official MCP server, works with Claude Code, Codex, Cursor
**Source:** [GitHub](https://github.com/firecrawl/firecrawl-mcp-server) (12K+ stars)

#### 42. Apify — 3,000+ Web Scrapers
**What:** [Apify](https://apify.com/) provides 3,000+ pre-built scraping "Actors" — Google Maps, LinkedIn, Amazon, Instagram, YouTube, TikTok, and more.
**Tools:** `apify_run_actor(actor_id, input)`, `apify_get_results(run_id)`
**Why:** When you need structured data from specific platforms (LinkedIn profiles, Amazon products, Google reviews), Apify already has a scraper built and maintained.
**MCP:** Official Apify MCP server available

#### 43. Bright Data — Anti-Bot Web Access
**What:** [Bright Data](https://brightdata.com/) provides residential proxies, CAPTCHA solving, and anti-detection for scraping sites protected by Cloudflare, DataDome, etc.
**Why:** Some sites block regular scrapers. Bright Data gets through when others can't.
**MCP:** Official MCP server available

---

## BROWSER AUTOMATION SKILLS

### 38. Browser Use CLI Integration
**What:** Integrate [Browser Use](https://browser-use.com/) as a skill — agents can browse the web, fill forms, extract data, click buttons, take screenshots, all via natural language commands.
**Why:** Browser automation is the #1 missing capability for AI agents. Agents that can use the web autonomously are 10x more useful — research, form filling, data extraction, testing, monitoring.
**How:**
- Install: `pip install browser-use` (MIT license, 78K+ GitHub stars)
- CLI keeps browser running between commands for fast iteration
- Commands: `browser-use open <url>`, `browser-use click <element>`, `browser-use type <text>`, `browser-use screenshot`, `browser-use state`
- MCP tools to add: `browser_open(url)`, `browser_click(selector)`, `browser_type(selector, text)`, `browser_screenshot()`, `browser_extract(prompt)`, `browser_state()`
- Supports anti-detect, CAPTCHA solving, 195+ country proxies
- Works with any LLM provider (OpenAI, Google, Anthropic, local via Ollama)
- 89.1% success rate on WebVoyager benchmark (586 web tasks)
**Use cases:**
- "Research competitors and summarize their pricing pages"
- "Fill out this job application form with my info"
- "Monitor this dashboard and alert me if metrics drop"
- "Scrape product listings from this site into a spreadsheet"
- "Test our signup flow end-to-end"
**Effort:** Medium — pip install + 6 MCP tool wrappers + skill registry entry

### 39. Vercel Agent Browser (Alternative)
**What:** [Agent Browser](https://github.com/vercel-labs/agent-browser) — Rust-powered headless browser CLI designed specifically for AI agents. 93% less context usage than Playwright MCP.
**Why:** Token efficiency. Agent Browser uses semantic locators instead of DOM trees — massively reduces token cost per browser interaction.
**How:**
- Rust CLI boots in <50ms, ref-based snapshots
- 108+ commands (navigation, forms, screenshots, video recording)
- Authentication Vault — stores creds locally encrypted, LLM never sees passwords
- Already works with Claude Code, Codex, Cursor, Gemini CLI, Copilot, Goose
- MCP server mode available for direct integration
**Effort:** Small — already has MCP server, just register as a skill

### 40. Browser MCP Bridge
**What:** [Browser MCP](https://browsermcp.io/) — connect AI agents to a real browser running on the user's machine.
**Why:** Automation happens locally, no network latency, agents can interact with authenticated sessions (logged-in sites).
**How:** MCP server that bridges to a Chrome extension. Agents send commands, browser executes them.
**Effort:** Small — existing MCP server, just configure

---

---

### DATABASE & STORAGE SKILLS

#### 44. PostgreSQL / Supabase MCP
**What:** Give agents direct access to query, read, and write to PostgreSQL/Supabase databases.
**Tools:** `db_query(sql)`, `db_schema()`, `db_insert(table, data)`, `db_update(table, where, data)`
**Why:** Agents that can read/write databases are infinitely more useful for business apps — analytics, data entry, report generation.
**MCP:** [Official Supabase MCP](https://supabase.com/docs/guides/ai/mcp), [DBHub](https://github.com/bytebase/dbhub) (universal DB MCP — Postgres, MySQL, SQLite, DuckDB)
**Source:** [Supabase MCP](https://github.com/supabase-community/supabase-mcp)

#### 45. Knowledge Graph Memory
**What:** Persistent knowledge graph that agents build over time. Entities, relationships, observations — agents remember connections between concepts.
**Tools:** `kg_add_entity(name, type, observations)`, `kg_add_relation(from, to, type)`, `kg_search(query)`, `kg_get_entity(name)`
**Why:** Regular memory is key-value. Knowledge graphs let agents understand *relationships* — "Project X uses React, was started by Alice, depends on Service Y". Way more powerful for complex projects.
**MCP:** [Official Knowledge Graph Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) by Anthropic
**Also:** [RAG Memory PG MCP](https://github.com/kshidenko/rag-memory-pg-mcp) — combines knowledge graph + semantic search + Supabase

#### 46. Redis Cache & Session
**What:** Fast key-value cache for agents to store temporary data, session state, rate limit tracking.
**Tools:** `cache_set(key, value, ttl)`, `cache_get(key)`, `cache_delete(key)`, `cache_list(pattern)`
**Why:** Agents need fast scratch storage that doesn't persist forever. Redis is perfect for temporary computation results, API response caching, and coordination between agents.
**MCP:** [Official Redis MCP Server](https://github.com/redis/redis-mcp)

---

### DEVELOPMENT SKILLS

#### 47. GitHub Deep Integration
**What:** Full GitHub API access — PRs, issues, commits, branches, code search, actions, releases.
**Tools:** `gh_create_pr(title, body, branch)`, `gh_list_issues(repo, state)`, `gh_review_pr(pr_number)`, `gh_create_issue(title, body)`, `gh_get_actions(repo)`, `gh_search_code(query)`
**Why:** GitHub is where code lives. Agents that can create PRs, review code, manage issues, and check CI status are 10x more useful than ones that just write code locally.
**MCP:** [Official GitHub MCP Server](https://github.com/github/github-mcp-server) — 22K+ stars

#### 48. Docker & Container Management
**What:** List, start, stop, inspect, and manage Docker containers and images.
**Tools:** `docker_list()`, `docker_start(container)`, `docker_stop(container)`, `docker_logs(container, lines)`, `docker_exec(container, command)`, `docker_build(path, tag)`
**Why:** DevOps agents need container access. Debug a failing service, restart a crashed container, check logs, deploy updates.
**MCP:** [Docker MCP Server](https://github.com/docker/docker-mcp)

#### 49. Test Runner Integration
**What:** Run test suites (pytest, jest, go test, cargo test) and parse results.
**Tools:** `test_run(framework, path)`, `test_results()`, `test_coverage()`
**Why:** Agents should run tests after making changes. Auto-run, parse failures, fix them, re-run. Autonomous TDD.
**How:** Wrapper around common test CLIs with output parsing.

#### 50. Linting & Code Quality
**What:** Run linters (ESLint, Ruff, Prettier, Black) and auto-fix issues.
**Tools:** `lint_run(path)`, `lint_fix(path)`, `lint_config()`
**Why:** Code quality enforcement. Agents should produce clean code automatically.

---

### NOTIFICATION & COMMUNICATION SKILLS

#### 51. Apprise — 90+ Notification Channels
**What:** [Apprise](https://github.com/caronc/apprise) sends notifications to 90+ services with one command — Slack, Discord, Telegram, Email, Pushover, ntfy, Teams, Matrix, Rocket.Chat, IFTTT, webhooks, and more.
**Tools:** `notify_send(message, channels)`, `notify_alert(title, body, severity, channels)`
**Why:** Agents should be able to alert you anywhere — phone notification when a deploy fails, Slack message when a task is done, email summary of overnight work.
**Install:** `pip install apprise`
**Source:** [GitHub](https://github.com/caronc/apprise) (12K+ stars)

#### 52. Slack Integration
**What:** Read/post messages, search history, manage channels, react to messages.
**Tools:** `slack_post(channel, message)`, `slack_search(query)`, `slack_thread_reply(channel, ts, message)`
**Why:** Most teams live in Slack. Agents that can post updates, answer questions, and search history are essential.
**MCP:** [Official Slack MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/slack) — 47 tools

#### 53. Discord Bot Bridge
**What:** Connect GhostLink channels to Discord channels. Messages flow both ways.
**Why:** Gaming/dev communities use Discord. Bridge lets agents participate in Discord conversations.
**How:** Discord bot + webhook relay. Messages in GhostLink → Discord and vice versa.

#### 54. Telegram Bot
**What:** Send/receive messages via Telegram bot. Control agents from your phone.
**Why:** Quick commands and alerts on mobile without opening the app.
**How:** Telegram Bot API + webhook to GhostLink.

---

### PRODUCTIVITY & KNOWLEDGE SKILLS

#### 55. Notion Integration
**What:** Read/write Notion pages, databases, and tasks. Create docs, update project boards.
**Tools:** `notion_search(query)`, `notion_create_page(parent, title, content)`, `notion_update_page(id, content)`, `notion_query_db(db_id, filter)`
**Why:** Notion is the knowledge base for many teams. Agents that can reference and update docs are way more useful.
**MCP:** [Official Notion MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/notion)

#### 56. Google Workspace (Drive, Docs, Sheets, Calendar)
**What:** Access Google Drive files, create/edit Docs and Sheets, manage Calendar events.
**Tools:** `gdrive_search(query)`, `gdocs_create(title, content)`, `gsheets_read(id, range)`, `gcal_create_event(title, time)`
**Why:** Google Workspace is ubiquitous. Agents that can read spreadsheets, write reports, and schedule meetings are incredibly valuable.
**MCP:** [Google Drive MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/google-drive)

#### 57. Zapier — Connect 7,000+ Apps
**What:** [Zapier MCP](https://zapier.com/) lets agents trigger any of 7,000+ app integrations — Google Sheets, CRMs, email, project management, social media.
**Tools:** `zapier_trigger(action_id, data)`, `zapier_list_actions()`
**Why:** Instead of building individual integrations, connect to everything through Zapier. Agent says "add this to the spreadsheet" → Zapier handles it.
**MCP:** Official Zapier MCP server

---

### MONITORING & OBSERVABILITY SKILLS

#### 58. Langfuse — Open Source LLM Analytics
**What:** [Langfuse](https://langfuse.com/) provides trace viewing, prompt versioning, cost tracking, and evaluation across all LLM calls.
**Why:** See exactly what agents are doing, how much they cost, and which prompts work best. Self-hostable.
**How:** Integrate into MCP bridge to auto-log all tool calls and responses.
**Source:** [GitHub](https://github.com/langfuse/langfuse) (Open source, free self-hosted)

#### 59. System Health Monitor
**What:** Real-time CPU, memory, disk, network monitoring with alerts.
**Tools:** `system_cpu()`, `system_memory()`, `system_disk()`, `system_processes()`, `system_network()`
**Why:** Agents managing servers need to know when resources are running low.
**Already built:** `system_info` MCP tool exists, needs expansion.

#### 60. Uptime Monitor
**What:** Continuously check if services are up. Alert on downtime.
**Tools:** `uptime_check(url)`, `uptime_add(url, interval)`, `uptime_history(url)`
**Why:** "Is the API still up?" shouldn't require a human to check.

---

### AI & RESEARCH SKILLS

#### 61. Multi-Model Access
**What:** Agents can call other AI models directly — ask GPT-5, Gemini, DeepSeek, or local models for second opinions.
**Tools:** `ai_ask(model, prompt)`, `ai_compare(prompt, models[])`
**Why:** Different models excel at different tasks. Let agents pick the best model for each sub-task.
**How:** API wrappers for OpenAI, Google, Anthropic, plus Ollama for local models.

#### 62. RAG — Retrieval Augmented Generation
**What:** Index documents (PDFs, code, docs) and let agents search them semantically.
**Tools:** `rag_index(path)`, `rag_search(query, top_k)`, `rag_add_document(content, metadata)`
**Why:** Agents need to reference large codebases, documentation, and knowledge bases without stuffing everything into context.
**How:** pgvector + Supabase, or local ChromaDB/Qdrant.

#### 63. Perplexity / Tavily — AI-Powered Search
**What:** AI-enhanced web search that returns synthesized answers, not just links.
**Tools:** `ai_search(query)` — returns a synthesized answer with citations.
**Why:** Better than raw DuckDuckGo search for research tasks. Agents get answers, not just URLs.
**MCP:** [Tavily MCP Server](https://github.com/tavily-ai/tavily-mcp) (free tier available)

---

## APP-WIDE EXPERIENCE UPGRADES

### 64. Onboarding Tour
**What:** Interactive guided tour for new users. Highlights key features with tooltips and step-by-step walkthrough.
**Why:** New users are overwhelmed. A tour shows them the 5 most important things in 60 seconds.
**How:** [Shepherd.js](https://github.com/shepherd-pro/shepherd) or custom React component.

### 65. Command History & Recall
**What:** Press Up arrow in the input to recall previous messages. Searchable command history.
**Why:** Every good CLI has this. Users repeat commands constantly.
**How:** Store last 100 sent messages in localStorage, navigate with Up/Down arrows.

### 66. Rich Previews
**What:** URLs in messages auto-expand with preview cards (title, description, image, favicon).
**Why:** Links are opaque. Preview cards make chat more informative.
**How:** Backend fetches OpenGraph metadata, frontend renders preview card.

### 67. Drag & Drop File Sharing
**What:** Drag files into the chat to share with agents. Images, PDFs, code files.
**Why:** "Read this PDF" should be as easy as drag-and-drop.
**How:** Frontend drag handler → upload API → agent gets file path.

### 68. Agent Avatars & Customization
**What:** Custom avatars for agents. Upload your own or pick from a library.
**Why:** Personality. Makes agents feel unique and recognizable.
**How:** Avatar upload in agent config, stored per-agent.

### 69. Pinned Messages View
**What:** Dedicated view showing all pinned messages across channels.
**Why:** Pinned messages are important decisions/info. Easy access is essential.
**How:** Filter view + keyboard shortcut.

### 70. Message Reactions Analytics
**What:** See which messages got the most reactions, which agents are most helpful.
**Why:** Implicit feedback on agent quality. Most-reacted = most useful.
**How:** Aggregate reaction data in StatsPanel.

### 71. Smart Notifications
**What:** AI-powered notification filtering. Only alert for truly important messages, not everything.
**Why:** Too many notifications = user ignores all of them. Smart filtering preserves attention.
**How:** Classify message importance (urgent/info/noise) based on content and context.

### 72. Session Snapshots
**What:** Save/restore the entire state of a session — agents, channels, messages, settings.
**Why:** "Save this project setup and restore it later" for switching between projects.
**How:** Export/import session state as JSON.

### 73. Multi-Project Support
**What:** Switch between different project workspaces without restarting. Each project has its own agents, channels, and settings.
**Why:** Developers work on multiple projects. GhostLink should support that natively.
**How:** Project selector in sidebar, workspace switching in settings.

### 74. Generative UI Cards
**What:** Agents can render interactive UI components in chat — forms, charts, tables, buttons, progress bars — not just text.
**Why:** A chart is worth a thousand tokens. Interactive cards make agents dramatically more useful.
**How:** Agent sends structured metadata, frontend renders the appropriate component.

### 75. Voice Chat
**What:** Push-to-talk voice input to agents. TTS voice output for responses.
**Why:** Hands-free interaction while coding. Accessibility.
**How:** Web Speech API for STT, browser TTS or ElevenLabs for natural voice output.

---

## PRIORITY ORDER (What to build next)

### Skills Priority (add to agents first)

| # | Skill | Impact | Effort | Category |
|---|-------|--------|--------|----------|
| 1 | Firecrawl Web Scraping (#41) | **Critical** | Small | Web |
| 2 | Browser Use CLI (#38) | **Game-changer** | Medium | Browser |
| 3 | GitHub Deep Integration (#47) | **Critical** | Small | Dev |
| 4 | Apprise Notifications (#51) | Very High | Small | Comms |
| 5 | Knowledge Graph Memory (#45) | Very High | Medium | Memory |
| 6 | PostgreSQL/Supabase (#44) | Very High | Small | Data |
| 7 | Vercel Agent Browser (#39) | Very High | Small | Browser |
| 8 | Docker Management (#48) | High | Small | Dev |
| 9 | Slack Integration (#52) | High | Small | Comms |
| 10 | Tavily AI Search (#63) | High | Small | Research |
| 11 | Multi-Model Access (#61) | High | Medium | AI |
| 12 | Zapier 7K Apps (#57) | High | Small | Productivity |
| 13 | RAG Search (#62) | Very High | Medium | Research |
| 14 | Langfuse Analytics (#58) | High | Medium | Monitoring |

### Feature Priority (app improvements)

| # | Feature | Impact | Effort | Category |
|---|---------|--------|--------|----------|
| 1 | Auto-Route Toggle (#1) | High | Tiny | Core |
| 2 | Generative UI Cards (#74) | **Game-changer** | Medium | UX |
| 3 | Agent Response Modes (#2) | High | Small | Core |
| 4 | Conversation Starters (#4) | High | Small | UX |
| 5 | Command History (#65) | High | Tiny | UX |
| 6 | Agent Presets (#5) | High | Medium | Core |
| 7 | Rich Previews (#66) | High | Medium | UX |
| 8 | Smart Context Compression (#12) | Very High | Medium | Intelligence |
| 9 | Workflow Automation (#16) | Very High | Large | Power |
| 10 | Dashboard/Analytics (#17) | High | Medium | Monitoring |
| 11 | Multi-Project Support (#73) | Very High | Medium | Core |
| 12 | Voice Chat (#75) | High | Medium | UX |
| 13 | Share Conversations (#23) | High (viral) | Medium | Growth |
| 14 | IDE Extensions (#20) | Very High | Large | Integration |
| 15 | GhostLink Cloud (#26) | **Game-changer** | Very Large | Growth |
| 16 | Mobile App (#21) | High | Large | Platform |
