"""Provider registry — multi-provider support with auto-detection and failover.

Detects which API keys the user has, selects the best available provider
for each capability, and falls back to free alternatives when possible.
"""

import json
import os
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# ── Provider definitions ─────────────────────────────────────────────

PROVIDERS = {
    # LLM providers
    "anthropic": {
        "name": "Anthropic",
        "env_keys": ["ANTHROPIC_API_KEY"],
        "capabilities": ["chat", "code"],
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
        "models": {
            "grok-3": {"label": "Grok 3", "tier": "premium"},
            "grok-3-mini": {"label": "Grok 3 Mini", "tier": "fast"},
        },
    },
    "groq": {
        "name": "Groq (Free tier)",
        "env_keys": ["GROQ_API_KEY"],
        "capabilities": ["chat", "stt"],
        "free_tier": True,
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
        "free_tier": True,
        "models": {
            "meta-llama/Llama-3.3-70B-Instruct-Turbo": {"label": "Llama 3.3 70B", "tier": "standard"},
            "black-forest-labs/FLUX.1-schnell-Free": {"label": "FLUX.1 Schnell (Free)", "tier": "image-free"},
        },
    },
    "huggingface": {
        "name": "Hugging Face (Free tier)",
        "env_keys": ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
        "capabilities": ["chat", "image", "stt"],
        "free_tier": True,
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
        "free_tier": True,
        "local": True,
        "models": {
            "qwen2.5-coder": {"label": "Qwen 2.5 Coder", "tier": "standard"},
            "llama3.2": {"label": "Llama 3.2", "tier": "standard"},
            "deepseek-coder-v2": {"label": "DeepSeek Coder v2", "tier": "code"},
        },
    },
}

# Capability → provider preference order (best first)
CAPABILITY_PRIORITY = {
    "chat": ["anthropic", "openai", "google", "xai", "groq", "together", "huggingface", "ollama"],
    "code": ["anthropic", "openai", "google", "ollama"],
    "image": ["google", "openai", "together", "huggingface"],
    "video": ["google"],
    "tts": ["google", "openai"],
    "stt": ["google", "openai", "groq", "huggingface"],
    "code_exec": ["google"],
    "embedding": ["google", "openai", "ollama"],
}


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

    def save_config(self, config: dict):
        self._user_config.update(config)
        if self._config_path:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            self._config_path.write_text(json.dumps(self._user_config, indent=2))

    def detect_available(self) -> list[dict]:
        """Detect which providers are available based on env vars and config."""
        available = []
        for pid, pdef in PROVIDERS.items():
            has_key = any(os.environ.get(k) for k in pdef["env_keys"])
            user_key = self._user_config.get(f"{pid}_api_key", "")
            is_local = pdef.get("local", False)
            is_available = has_key or bool(user_key) or is_local

            available.append({
                "id": pid,
                "name": pdef["name"],
                "available": is_available,
                "free_tier": pdef.get("free_tier", False),
                "local": is_local,
                "capabilities": pdef["capabilities"],
                "models": pdef["models"],
                "configured": has_key or bool(user_key),
            })
        return available

    def get_api_key(self, provider_id: str) -> str | None:
        """Get API key for a provider (user config > env var)."""
        user_key = self._user_config.get(f"{provider_id}_api_key")
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
            if self.get_api_key(preferred) or PROVIDERS[preferred].get("local"):
                pdef = PROVIDERS[preferred]
                models = {k: v for k, v in pdef["models"].items()
                         if capability in v.get("tier", "") or v["tier"] in ("standard", "premium", "fast")}
                return {"provider": preferred, "name": pdef["name"], "models": models or pdef["models"]}

        # Auto-detect best available
        for pid in CAPABILITY_PRIORITY.get(capability, []):
            if pid not in PROVIDERS:
                continue
            pdef = PROVIDERS[pid]
            if capability not in pdef["capabilities"]:
                continue
            if self.get_api_key(pid) or pdef.get("local"):
                return {"provider": pid, "name": pdef["name"], "models": pdef["models"]}

        return None

    def get_provider_status(self) -> dict:
        """Full status: what's available, what's configured, recommendations."""
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

        return {
            "providers": available,
            "capabilities": capabilities,
            "free_options": free_options,
            "total_configured": sum(1 for p in available if p["configured"]),
            "user_preferences": {k: v for k, v in self._user_config.items() if k.startswith("preferred_")},
        }
