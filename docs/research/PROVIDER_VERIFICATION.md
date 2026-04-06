# Provider Capability Verification

**Date:** 2026-04-06
**Verified by:** Claude (independent code audit of providers.py + mcp_bridge.py)

## Summary
**13 providers in committed code. All have real definitions. Provider registry resolves capabilities and supports failover.**

## Important Distinction
The provider registry (providers.py) is primarily a **discovery and UI system** — it tells the Settings UI which providers exist, what they support, and which are configured. The actual API calls happen in:
- `mcp_bridge.py` — MCP tools check env vars directly for media/AI operations
- Agent CLIs themselves handle their own provider connections (Claude uses Anthropic, Codex uses OpenAI, etc.)

So the provider registry is NOT a centralized API gateway. It's a metadata + detection layer.

## Provider Truth Table

| Provider | Env Key | Claimed Capabilities | Actually Used By MCP Tools | Free Tier |
|----------|---------|---------------------|---------------------------|-----------|
| Anthropic | ANTHROPIC_API_KEY | chat, code | NO (agents connect directly via their CLIs) | No |
| OpenAI | OPENAI_API_KEY | chat, code, image, tts, stt, embedding | YES — image_generate uses DALL-E 3 | No |
| Google | GEMINI_API_KEY | chat, code, image, video, tts, stt, code_exec, embedding | YES — 6 MCP tools (gemini_image, gemini_video, text_to_speech, speech_to_text, code_execute, image_generate) | No |
| xAI | XAI_API_KEY | chat | NO (Grok CLI connects directly) | No |
| Groq | GROQ_API_KEY | chat, stt | NO (not used by any MCP tool directly) | Yes |
| Together | TOGETHER_API_KEY | chat, image | YES — image_generate fallback | Yes |
| HuggingFace | HF_TOKEN | chat, image, stt | YES — image_generate fallback | Yes |
| Ollama | (none) | chat, code, embedding | NO (Ollama CLI connects directly, local) | Yes |
| Mistral | MISTRAL_API_KEY | chat, code, vision | NO (not used by any MCP tool) | No |
| OpenRouter | OPENROUTER_API_KEY | chat, code, vision, image | NO (not used by any MCP tool) | No |
| DeepSeek | DEEPSEEK_API_KEY | chat, code, reasoning | NO (not used by any MCP tool) | No |
| Perplexity | PERPLEXITY_API_KEY | chat, search | NO (web_search uses DuckDuckGo, not Perplexity) | No |
| Cohere | COHERE_API_KEY | chat, embedding | NO (not used by any MCP tool) | No |

## Key Findings

### What the Provider Registry Actually Does
1. **Detection** — Checks if API keys are present in env vars or secrets vault
2. **Capability resolution** — "What's the best provider for image generation?" → returns Google if GEMINI_API_KEY exists
3. **UI display** — Shows which providers are configured in Settings > AI
4. **Failover** — If primary provider is down, find the next one

### What It Does NOT Do
1. Does NOT proxy API calls through a central gateway
2. Does NOT enforce provider selection on agent CLIs (agents use their own provider directly)
3. Most MCP tools check env vars directly, not through the registry

### Honest Capability Assessment
- **Google is the most versatile provider** — 6 of our MCP tools use its API directly
- **OpenAI, Together, HuggingFace** are used as image_generate fallbacks
- **Anthropic, xAI, Groq, Mistral, OpenRouter, DeepSeek, Perplexity, Cohere** — their API keys are detected and displayed, but NO MCP tools actually call their APIs
- These providers are used by the AGENT CLIS (Claude uses Anthropic, Grok uses xAI, etc.), not by GhostLink's MCP bridge

### What This Means for the Roadmap
- "13 providers" is accurate as a detection/display count
- But GhostLink's own MCP tools only actually USE 4 providers: Google, OpenAI, Together, HuggingFace
- The other 9 are passthrough — the agent CLIs handle their own provider connections
- This is fine architecturally, but docs shouldn't imply GhostLink centrally routes through all 13
