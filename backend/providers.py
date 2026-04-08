"""Provider registry — multi-provider support with auto-detection and failover.

Detects which API keys the user has, selects the best available provider
for each capability, and falls back to free alternatives when possible.
"""

import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

from transport import ApiTransport, CapabilityFlag, TransportConfig, TransportMode

# ── Provider definitions ─────────────────────────────────────────────

PROVIDERS = {
    # LLM providers
    "anthropic": {
        "name": "Anthropic",
        "env_keys": ["ANTHROPIC_API_KEY"],
        "capabilities": ["chat", "code"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["content_filtered"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://console.anthropic.com/settings/keys",
        "setup_instructions": "1. Sign up at console.anthropic.com\n2. Go to Settings > API Keys\n3. Create a new key\n4. Paste it here",
        "models": {
            "claude-opus-4-6": {"label": "Claude Opus 4.6", "tier": "premium"},
            "claude-sonnet-4-6": {"label": "Claude Sonnet 4.6", "tier": "standard"},
            "claude-haiku-4-5": {"label": "Claude Haiku 4.5", "tier": "fast"},
        },
    },
    "openai": {
        "name": "OpenAI",
        "env_keys": ["OPENAI_API_KEY"],
        "capabilities": ["chat", "code", "image", "tts", "stt", "embedding"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://platform.openai.com/api-keys",
        "setup_instructions": "1. Sign up at platform.openai.com\n2. Go to API Keys\n3. Create a new secret key\n4. Paste it here",
        "models": {
            "gpt-5.4": {"label": "GPT-5.4", "tier": "premium"},
            "gpt-5.4-mini": {"label": "GPT-5.4 Mini", "tier": "fast"},
            "o3": {"label": "o3", "tier": "reasoning"},
            "o4-mini": {"label": "o4 Mini", "tier": "reasoning-fast"},
            "dall-e-3": {"label": "DALL-E 3", "tier": "image"},
            "tts-1": {"label": "TTS-1", "tier": "tts"},
            "whisper-1": {"label": "Whisper", "tier": "stt"},
        },
    },
    "google": {
        "name": "Google AI",
        "env_keys": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "capabilities": ["chat", "code", "image", "video", "tts", "stt", "code_exec", "embedding"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited", "content_filtered"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://aistudio.google.com/app/apikey",
        "setup_instructions": "1. Go to aistudio.google.com\n2. Click 'Get API Key'\n3. Create a key for your project\n4. Paste it here\n\nGoogle AI Ultra users get Imagen 4, Veo 3.1, and premium models",
        "models": {
            "gemini-3.1-pro-preview": {"label": "Gemini 3.1 Pro", "tier": "premium"},
            "gemini-2.5-pro": {"label": "Gemini 2.5 Pro", "tier": "standard"},
            "gemini-2.5-flash": {"label": "Gemini 2.5 Flash", "tier": "fast"},
            "imagen-4.0-generate-001": {"label": "Imagen 4", "tier": "image"},
            "imagen-4.0-ultra-generate-001": {"label": "Imagen 4 Ultra", "tier": "image-premium"},
            "veo-3.1-generate-preview": {"label": "Veo 3.1", "tier": "video"},
            "gemini-2.5-flash-preview-tts": {"label": "Gemini TTS", "tier": "tts"},
        },
    },
    "xai": {
        "name": "xAI",
        "env_keys": ["XAI_API_KEY"],
        "capabilities": ["chat"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://console.x.ai",
        "setup_instructions": "1. Go to console.x.ai\n2. Create an API key\n3. Paste it here",
        "models": {
            "grok-3": {"label": "Grok 3", "tier": "premium"},
            "grok-3-mini": {"label": "Grok 3 Mini", "tier": "fast"},
        },
    },
    "groq": {
        "name": "Groq (Free tier)",
        "env_keys": ["GROQ_API_KEY"],
        "capabilities": ["chat", "stt"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "free_tier": True,
        "setup_url": "https://console.groq.com/keys",
        "setup_instructions": "1. Sign up at console.groq.com (free)\n2. Go to API Keys\n3. Create a key\n4. Paste it here\n\nFree tier: fast inference on Llama 3.3 70B + Whisper STT",
        "models": {
            "llama-3.3-70b-versatile": {"label": "Llama 3.3 70B", "tier": "standard"},
            "llama-3.1-8b-instant": {"label": "Llama 3.1 8B", "tier": "fast"},
            "whisper-large-v3-turbo": {"label": "Whisper Large v3", "tier": "stt"},
        },
    },
    "together": {
        "name": "Together AI (Free tier)",
        "env_keys": ["TOGETHER_API_KEY"],
        "capabilities": ["chat", "image"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "free_tier": True,
        "setup_url": "https://api.together.xyz/settings/api-keys",
        "setup_instructions": "1. Sign up at together.ai (free)\n2. Go to Settings > API Keys\n3. Create a key\n4. Paste it here\n\nFree tier: FLUX.1 Schnell image gen + Llama 3.3 70B chat",
        "models": {
            "meta-llama/Llama-3.3-70B-Instruct-Turbo": {"label": "Llama 3.3 70B", "tier": "standard"},
            "black-forest-labs/FLUX.1-schnell-Free": {"label": "FLUX.1 Schnell (Free)", "tier": "image-free"},
        },
    },
    "huggingface": {
        "name": "Hugging Face (Free tier)",
        "env_keys": ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
        "capabilities": ["chat", "image", "stt"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "free_tier": True,
        "setup_url": "https://huggingface.co/settings/tokens",
        "setup_instructions": "1. Sign up at huggingface.co (free)\n2. Go to Settings > Access Tokens\n3. Create a new token\n4. Paste it here\n\nFree tier: FLUX.1 Dev image gen + Llama 3.3 chat + Whisper STT",
        "models": {
            "meta-llama/Llama-3.3-70B-Instruct": {"label": "Llama 3.3 70B", "tier": "standard"},
            "black-forest-labs/FLUX.1-dev": {"label": "FLUX.1 Dev", "tier": "image-free"},
            "openai/whisper-large-v3": {"label": "Whisper Large v3", "tier": "stt"},
        },
    },
    "ollama": {
        "name": "Ollama (Local/Free)",
        "env_keys": [],
        "capabilities": ["chat", "code", "embedding"],
        "transport_mode": "local",
        "auth_method": "local",
        "usage_policy_flags": [],
        "degraded_mode_behavior": "fail",
        "free_tier": True,
        "local": True,
        "setup_url": "https://ollama.com/download",
        "setup_instructions": "1. Download from ollama.com\n2. Install and run Ollama\n3. Pull a model: ollama pull qwen2.5-coder\n4. No API key needed — runs locally",
        "models": {
            "qwen2.5-coder": {"label": "Qwen 2.5 Coder", "tier": "standard"},
            "llama3.2": {"label": "Llama 3.2", "tier": "standard"},
            "deepseek-coder-v2": {"label": "DeepSeek Coder v2", "tier": "code"},
        },
    },
    # v2.4.0: New providers
    "mistral": {
        "name": "Mistral AI",
        "env_keys": ["MISTRAL_API_KEY"],
        "capabilities": ["chat", "code", "vision"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://console.mistral.ai/",
        "setup_instructions": "1. Sign up at console.mistral.ai\n2. Go to API Keys\n3. Create a new key\n4. Paste it here",
        "models": {
            "mistral-large-latest": {"label": "Mistral Large", "tier": "premium"},
            "codestral-latest": {"label": "Codestral", "tier": "code"},
            "pixtral-large-latest": {"label": "Pixtral Large", "tier": "vision"},
        },
    },
    "openrouter": {
        "name": "OpenRouter",
        "env_keys": ["OPENROUTER_API_KEY"],
        "capabilities": ["chat", "code", "vision", "image"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited", "data_retention"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://openrouter.ai/keys",
        "setup_instructions": "1. Sign up at openrouter.ai\n2. Go to Keys\n3. Create a new key\n4. Paste it here\n\nAccess 200+ models with a single API key",
        "models": {
            "auto": {"label": "Auto (best available)", "tier": "standard"},
        },
    },
    "deepseek": {
        "name": "DeepSeek",
        "env_keys": ["DEEPSEEK_API_KEY"],
        "capabilities": ["chat", "code", "reasoning"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://platform.deepseek.com/",
        "setup_instructions": "1. Sign up at platform.deepseek.com\n2. Go to API Keys\n3. Create a new key\n4. Paste it here",
        "models": {
            "deepseek-chat": {"label": "DeepSeek Chat", "tier": "standard"},
            "deepseek-reasoner": {"label": "DeepSeek Reasoner", "tier": "reasoning"},
        },
    },
    "perplexity": {
        "name": "Perplexity",
        "env_keys": ["PERPLEXITY_API_KEY"],
        "capabilities": ["chat", "search"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited", "data_retention"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://www.perplexity.ai/settings/api",
        "setup_instructions": "1. Sign up at perplexity.ai\n2. Go to Settings > API\n3. Create a new key\n4. Paste it here\n\nSearch-augmented generation with real-time web access",
        "models": {
            "sonar-pro": {"label": "Sonar Pro", "tier": "premium"},
            "sonar": {"label": "Sonar", "tier": "standard"},
        },
    },
    "cohere": {
        "name": "Cohere",
        "env_keys": ["COHERE_API_KEY"],
        "capabilities": ["chat", "embedding"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://dashboard.cohere.com/api-keys",
        "setup_instructions": "1. Sign up at cohere.com\n2. Go to Dashboard > API Keys\n3. Create a new key\n4. Paste it here\n\nEnterprise RAG with Command R+ and embeddings",
        "models": {
            "command-r-plus": {"label": "Command R+", "tier": "premium"},
            "command-r": {"label": "Command R", "tier": "standard"},
            "embed-english-v3.0": {"label": "Embed v3", "tier": "embedding"},
        },
    },
    "bedrock": {
        "name": "Amazon Bedrock",
        "env_keys": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
        "capabilities": ["chat", "code", "embedding"],
        "transport_mode": "api",
        "auth_method": "aws_sigv4",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://console.aws.amazon.com/bedrock/",
        "setup_instructions": "1. Enable Bedrock in AWS\n2. Create credentials\n3. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
        "models": {
            "anthropic.claude-3-7-sonnet": {"label": "Claude 3.7 Sonnet via Bedrock", "tier": "standard"},
            "amazon.titan-embed-text-v2": {"label": "Titan Embed v2", "tier": "embedding"},
        },
    },
    "moonshot": {
        "name": "Kimi / Moonshot",
        "env_keys": ["MOONSHOT_API_KEY"],
        "capabilities": ["chat", "code", "reasoning"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://platform.moonshot.ai/",
        "setup_instructions": "1. Create a Moonshot API key\n2. Set MOONSHOT_API_KEY",
        "models": {
            "moonshot-v1-128k": {"label": "Moonshot v1 128k", "tier": "reasoning"},
        },
    },
    "zai": {
        "name": "Z.AI / GLM",
        "env_keys": ["ZHIPU_API_KEY"],
        "capabilities": ["chat", "code", "vision"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://open.bigmodel.cn/",
        "setup_instructions": "1. Create a Zhipu key\n2. Set ZHIPU_API_KEY",
        "models": {
            "glm-4-plus": {"label": "GLM-4 Plus", "tier": "standard"},
            "glm-4v-plus": {"label": "GLM-4V Plus", "tier": "vision"},
        },
    },
    "byteplus": {
        "name": "BytePlus / Volcengine",
        "env_keys": ["VOLCENGINE_API_KEY"],
        "capabilities": ["chat", "code"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "https://console.byteplus.com/",
        "setup_instructions": "1. Create a Volcengine key\n2. Set VOLCENGINE_API_KEY",
        "models": {
            "doubao-pro-32k": {"label": "Doubao Pro 32k", "tier": "standard"},
        },
    },
    "qwen": {
        "name": "Qwen (stashed)",
        "env_keys": ["QWEN_API_KEY"],
        "capabilities": ["chat", "code"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "",
        "setup_instructions": "",
        "models": {"qwen-max": {"label": "Qwen Max", "tier": "standard"}},
    },
    "fireworks": {
        "name": "Fireworks (stashed)",
        "env_keys": ["FIREWORKS_API_KEY"],
        "capabilities": ["chat", "code"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["rate_limited"],
        "degraded_mode_behavior": "failover",
        "setup_url": "",
        "setup_instructions": "",
        "models": {"accounts/fireworks/models/llama-v3p1-70b-instruct": {"label": "Llama v3.1 70B", "tier": "standard"}},
    },
    "stepfun": {
        "name": "StepFun (stashed)",
        "env_keys": ["STEPFUN_API_KEY"],
        "capabilities": ["chat", "code"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "",
        "setup_instructions": "",
        "models": {"step-2-16k": {"label": "Step 2 16k", "tier": "standard"}},
    },
    "minimax": {
        "name": "MiniMax (stashed)",
        "env_keys": ["MINIMAX_API_KEY"],
        "capabilities": ["chat", "music"],
        "transport_mode": "api",
        "auth_method": "api_key",
        "usage_policy_flags": ["geographic_restriction"],
        "degraded_mode_behavior": "failover",
        "setup_url": "",
        "setup_instructions": "",
        "models": {
            "abab7-chat": {"label": "ABAB 7 Chat", "tier": "standard"},
            "music-2.5+": {"label": "MiniMax Music 2.5+", "tier": "music"},
        },
    },
}

# Capability → provider preference order (best first)
CAPABILITY_PRIORITY = {
    "chat": ["anthropic", "openai", "google", "xai", "mistral", "deepseek", "perplexity", "cohere", "groq", "together", "huggingface", "openrouter", "ollama"],
    "code": ["anthropic", "openai", "google", "mistral", "deepseek", "openrouter", "ollama"],
    "image": ["google", "openai", "together", "huggingface", "openrouter"],
    "video": ["google"],
    "music": ["minimax"],
    "tts": ["google", "openai"],
    "stt": ["google", "openai", "groq", "huggingface"],
    "code_exec": ["google"],
    "embedding": ["google", "openai", "cohere", "ollama"],
    "vision": ["google", "openai", "mistral", "openrouter"],
    "search": ["perplexity"],
    "reasoning": ["openai", "deepseek", "moonshot"],
}

CAPABILITY_FLAGS = {
    "chat": {CapabilityFlag.STREAMING, CapabilityFlag.CACHING},
    "code": {CapabilityFlag.STREAMING, CapabilityFlag.TOOL_USE, CapabilityFlag.CACHING},
    "image": {CapabilityFlag.IMAGE_GEN},
    "video": {CapabilityFlag.VIDEO_GEN},
    "tts": {CapabilityFlag.TTS},
    "stt": {CapabilityFlag.STT},
    "code_exec": {CapabilityFlag.CODE_EXEC},
    "embedding": {CapabilityFlag.EMBEDDING},
    "vision": {CapabilityFlag.VISION},
    "reasoning": {CapabilityFlag.REASONING, CapabilityFlag.CACHING},
    "search": {CapabilityFlag.SEARCH},
}

# ── v2.4.0: Model catalog cache ──────────────────────────────────────
_model_cache: dict = {}
_model_cache_ts: float = 0
MODEL_CACHE_TTL = 300  # 5 minutes

def get_cached_models() -> dict:
    """Return cached provider listing (refreshes every 5 min)."""
    global _model_cache, _model_cache_ts
    if time.time() - _model_cache_ts < MODEL_CACHE_TTL and _model_cache:
        return _model_cache
    _model_cache = {name: p for name, p in PROVIDERS.items()}
    _model_cache_ts = time.time()
    return _model_cache


class ProviderRegistry:
    """Detects available providers and resolves capabilities to best provider."""

    def __init__(self, data_dir: Path | None = None):
        self._data_dir = data_dir
        self._config_path = (data_dir / "providers.json") if data_dir else None
        self._user_config: dict = {}
        self._load_config()

    def _load_config(self):
        if self._config_path and self._config_path.exists():
            try:
                self._user_config = json.loads(self._config_path.read_text())
            except (json.JSONDecodeError, OSError):
                pass

    def _save_user_config(self):
        if self._config_path:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            self._config_path.write_text(json.dumps(self._user_config, indent=2))

    def _migrate_plaintext_key(self, secret_key: str) -> str | None:
        plaintext = self._user_config.get(secret_key)
        if not plaintext:
            return None
        try:
            import deps
            secrets_manager = getattr(deps, "secrets_manager", None)
            if secrets_manager:
                secrets_manager.set(secret_key, plaintext)
                del self._user_config[secret_key]
                self._save_user_config()
                log.info("Migrated plaintext provider secret '%s' to encrypted storage", secret_key)
        except Exception as exc:
            log.warning("Failed to migrate provider secret '%s': %s", secret_key, exc)
        return plaintext

    def save_config(self, config: dict):
        try:
            import deps
            secrets_manager = getattr(deps, "secrets_manager", None)
        except Exception:
            secrets_manager = None

        for key, value in config.items():
            if key.endswith("_api_key"):
                secret_value = str(value or "").strip()
                if secrets_manager:
                    if secret_value:
                        secrets_manager.set(key, secret_value)
                    else:
                        secrets_manager.delete(key)
                elif secret_value:
                    self._user_config[key] = secret_value
                else:
                    self._user_config.pop(key, None)
                continue

            if key == "overrides":
                merged = dict(self._user_config.get("overrides", {}) or {})
                for provider_id, override_values in dict(value or {}).items():
                    merged[provider_id] = dict(merged.get(provider_id, {}) | dict(override_values or {}))
                self._user_config["overrides"] = merged
                continue

            self._user_config[key] = value

        self._save_user_config()

    def _is_local_provider_available(self, provider_id: str, pdef: dict) -> bool:
        """Return whether a local-only provider is actually reachable."""
        if not pdef.get("local", False):
            return False

        if provider_id == "ollama":
            try:
                import urllib.request
                urllib.request.urlopen("http://localhost:11434/api/version", timeout=2)
                return True
            except Exception:
                return False

        return True

    def is_provider_available(self, provider_id: str) -> bool:
        """Return whether a provider is currently usable."""
        pdef = PROVIDERS.get(provider_id)
        if not pdef:
            return False

        has_key = any(os.environ.get(k) for k in pdef["env_keys"])
        user_key = self.get_api_key(provider_id)
        return has_key or bool(user_key) or self._is_local_provider_available(provider_id, pdef)

    def detect_available(self) -> list[dict]:
        """Detect which providers are available based on env vars and config."""
        available = []
        for pid, pdef in PROVIDERS.items():
            has_key = any(os.environ.get(k) for k in pdef["env_keys"])
            user_key = self.get_api_key(pid)
            is_local = pdef.get("local", False)
            is_local_running = self._is_local_provider_available(pid, pdef)
            is_available = has_key or bool(user_key) or is_local_running

            available.append({
                "id": pid,
                "name": pdef["name"],
                "available": is_available,
                "free_tier": pdef.get("free_tier", False),
                "local": is_local,
                "capabilities": pdef["capabilities"],
                "models": pdef["models"],
                "configured": has_key or bool(user_key),
                "setup_url": pdef.get("setup_url", ""),
                "setup_instructions": pdef.get("setup_instructions", ""),
            })
        return available

    def get_api_key(self, provider_id: str) -> str | None:
        """Get API key for a provider (user config > env var)."""
        secret_key = f"{provider_id}_api_key"
        try:
            import deps
            secrets_manager = getattr(deps, "secrets_manager", None)
        except Exception:
            secrets_manager = None

        if secrets_manager:
            user_key = secrets_manager.get(secret_key)
            if user_key:
                return user_key

        user_key = self._migrate_plaintext_key(secret_key)
        if user_key:
            return user_key
        pdef = PROVIDERS.get(provider_id)
        if pdef:
            for env_key in pdef["env_keys"]:
                val = os.environ.get(env_key)
                if val:
                    return val
        return None

    def resolve_capability(self, capability: str) -> dict | None:
        """Find the best available provider for a given capability."""
        # Check user preference first
        preferred = self._user_config.get(f"preferred_{capability}")
        if preferred and preferred in PROVIDERS:
            if self.is_provider_available(preferred):
                pdef = PROVIDERS[preferred]
                models = {k: v for k, v in pdef["models"].items()
                         if capability in v.get("tier", "") or v["tier"] in ("standard", "premium", "fast")}
                return {
                    "provider": preferred,
                    "name": pdef["name"],
                    "models": models or pdef["models"],
                    "transport_mode": pdef.get("transport_mode", "api"),
                    "auth_method": pdef.get("auth_method", "api_key"),
                }

        # Auto-detect best available
        for pid in CAPABILITY_PRIORITY.get(capability, []):
            if pid not in PROVIDERS:
                continue
            pdef = PROVIDERS[pid]
            if capability not in pdef["capabilities"]:
                continue
            if self.is_provider_available(pid):
                return {
                    "provider": pid,
                    "name": pdef["name"],
                    "models": pdef["models"],
                    "transport_mode": pdef.get("transport_mode", "api"),
                    "auth_method": pdef.get("auth_method", "api_key"),
                }

        return None

    def get_provider_status(self) -> dict:
        """Full status: what's available, what's configured, recommendations."""
        try:
            import deps
            transport_health = deps.transport_manager.get_provider_health() if deps.transport_manager else {}
        except Exception:
            transport_health = {}
        available = self.detect_available()
        capabilities = {}
        for cap in CAPABILITY_PRIORITY:
            resolved = self.resolve_capability(cap)
            capabilities[cap] = {
                "available": resolved is not None,
                "provider": resolved["provider"] if resolved else None,
                "provider_name": resolved["name"] if resolved else None,
            }

        free_options = [p for p in available if p["free_tier"] and not p["configured"]]

        for provider in available:
            health = transport_health.get(provider["id"], {})
            provider["transport_mode"] = PROVIDERS[provider["id"]].get("transport_mode", "api")
            provider["auth_method"] = PROVIDERS[provider["id"]].get("auth_method", "api_key")
            provider["usage_policy_flags"] = PROVIDERS[provider["id"]].get("usage_policy_flags", [])
            provider["degraded_mode_behavior"] = PROVIDERS[provider["id"]].get("degraded_mode_behavior", "failover")
            provider["health"] = {
                "healthy": bool(health.get("healthy", True)),
                "last_error": health.get("last_error", ""),
                "last_error_at": health.get("last_error_at", 0),
                "active": bool(health.get("active", False)),
            }

        return {
            "providers": available,
            "capabilities": capabilities,
            "free_options": free_options,
            "total_configured": sum(1 for p in available if p["configured"]),
            "user_preferences": {k: v for k, v in self._user_config.items() if k.startswith("preferred_")},
            "overrides": self._user_config.get("overrides", {}),
        }

    def resolve_with_failover(self, capability: str, exclude: list[str] | None = None) -> dict | None:
        """v2.4.0: Try providers in priority order, skipping excluded ones.

        Use after a provider returns an error to automatically fail over to the next.
        """
        exclude = exclude or []
        for pid in CAPABILITY_PRIORITY.get(capability, []):
            if pid in exclude or pid not in PROVIDERS:
                continue
            pdef = PROVIDERS[pid]
            if capability not in pdef["capabilities"]:
                continue
            if self.is_provider_available(pid):
                return {"provider": pid, "name": pdef["name"], "models": pdef["models"]}
        return None

    def iter_providers_for_capability(self, capability: str, *, preferred_provider: str = "", exclude: list[str] | None = None) -> list[str]:
        exclude = set(exclude or [])
        ordered: list[str] = []
        preferred = preferred_provider or self._user_config.get(f"preferred_{capability}", "")
        if preferred and preferred not in exclude and preferred in PROVIDERS and self.is_provider_available(preferred):
            ordered.append(preferred)
        for pid in CAPABILITY_PRIORITY.get(capability, []):
            if pid in exclude or pid in ordered:
                continue
            if pid not in PROVIDERS:
                continue
            pdef = PROVIDERS[pid]
            if capability not in pdef["capabilities"]:
                continue
            if self.is_provider_available(pid):
                ordered.append(pid)
        return ordered

    def default_model_for(self, provider_id: str, capability: str = "") -> str:
        pdef = PROVIDERS.get(provider_id, {})
        models = dict(pdef.get("models", {}) or {})
        if not models:
            return ""
        if capability:
            for model_id, meta in models.items():
                tier = str(meta.get("tier", ""))
                if capability in tier or capability == "reasoning" and "reasoning" in tier:
                    return model_id
        return next(iter(models))

    def get_overrides(self, provider_id: str) -> dict:
        return dict((self._user_config.get("overrides", {}) or {}).get(provider_id, {}) or {})

    def build_transport_config(self, provider_id: str, *, capability: str = "") -> TransportConfig:
        pdef = PROVIDERS[provider_id]
        mode_name = str(pdef.get("transport_mode", "api"))
        try:
            mode = TransportMode(mode_name)
        except ValueError:
            mode = TransportMode.API
        overrides = self.get_overrides(provider_id)
        capabilities = set()
        for cap in pdef.get("capabilities", []):
            capabilities.update(CAPABILITY_FLAGS.get(cap, set()))
        base_urls = {
            "anthropic": "https://api.anthropic.com/v1/",
            "openai": "https://api.openai.com/v1/",
            "google": "https://generativelanguage.googleapis.com/v1beta/",
            "groq": "https://api.groq.com/openai/v1/",
            "together": "https://api.together.xyz/v1/",
            "huggingface": "https://api-inference.huggingface.co/",
            "mistral": "https://api.mistral.ai/v1/",
            "openrouter": "https://openrouter.ai/api/v1/",
            "deepseek": "https://api.deepseek.com/",
            "perplexity": "https://api.perplexity.ai/",
            "cohere": "https://api.cohere.com/v2/",
            "moonshot": "https://api.moonshot.ai/v1/",
            "zai": "https://open.bigmodel.cn/api/paas/v4/",
            "byteplus": "https://ark.cn-beijing.volces.com/api/v3/",
            "bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com/",
            "minimax": "https://api.minimax.io/v1/",
        }
        headers = dict(overrides.get("headers", {}) or {})
        api_key = self.get_api_key(provider_id)
        if api_key and pdef.get("auth_method") == "api_key":
            if provider_id == "google":
                pass
            elif provider_id == "anthropic":
                headers.setdefault("x-api-key", api_key)
                headers.setdefault("anthropic-version", "2023-06-01")
            else:
                headers.setdefault("Authorization", f"Bearer {api_key}")
        return TransportConfig(
            mode=mode,
            base_url=str(overrides.get("base_url") or base_urls.get(provider_id, "")),
            headers=headers,
            proxy=str(overrides.get("proxy") or ""),
            tls_cert_path=str(overrides.get("tls_cert_path") or ""),
            timeout=int(overrides.get("timeout") or 120),
            max_retries=int(overrides.get("max_retries") or 2),
            capabilities=capabilities,
        )

    def build_transport(self, provider_id: str, *, capability: str = ""):
        return ApiTransport(self.build_transport_config(provider_id, capability=capability))

    def extract_usage(self, provider_id: str, model: str, response) -> dict:
        usage = {}
        if isinstance(getattr(response, "json_body", None), dict):
            body = response.json_body
            raw = body.get("usage", {}) if isinstance(body, dict) else {}
            if isinstance(raw, dict):
                usage["input_tokens"] = int(raw.get("input_tokens", raw.get("prompt_tokens", 0)) or 0)
                usage["output_tokens"] = int(raw.get("output_tokens", raw.get("completion_tokens", 0)) or 0)
                usage["cache_read_tokens"] = int(raw.get("cache_read_input_tokens", 0) or 0)
                usage["cache_write_tokens"] = int(raw.get("cache_creation_input_tokens", 0) or 0)
                usage["accounting_mode"] = "direct"
        if not usage:
            usage = {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "accounting_mode": "partial" if PROVIDERS.get(provider_id, {}).get("transport_mode") in {"cli", "mcp"} else "unpriced",
            }
        return usage
