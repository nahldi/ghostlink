"""Plugin loader — discovers, loads, and manages plugins.

Each plugin is a Python file in plugins/ with a setup() function.
Plugins can register FastAPI routes, MCP tools, and event handlers.

Enhanced with manifest support for install/uninstall/update lifecycle.
"""

import importlib
import json
import logging
import re
import sys
import time as _time
from pathlib import Path

log = logging.getLogger(__name__)

PLUGINS_DIR = Path(__file__).parent / "plugins"
MANIFEST_FILE = PLUGINS_DIR / "manifest.json"
_PLUGIN_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _load_manifest() -> dict:
    if MANIFEST_FILE.exists():
        try:
            return json.loads(MANIFEST_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"plugins": {}, "disabled": []}


def get_plugin_allowed_tools(plugin_name: str) -> list[str] | None:
    """Return the allowed_tools list for a plugin, or None if unrestricted (builtin)."""
    manifest = _load_manifest()
    meta = manifest.get("plugins", {}).get(plugin_name, {})
    if meta.get("builtin"):
        return None  # Builtin plugins are trusted — no restriction
    return meta.get("allowed_tools", [])


def set_plugin_allowed_tools(plugin_name: str, tools: list[str]) -> bool:
    """Set the allowed_tools list for a plugin."""
    manifest = _load_manifest()
    plugins = manifest.get("plugins", {})
    if plugin_name not in plugins:
        return False
    plugins[plugin_name]["allowed_tools"] = tools
    _save_manifest(manifest)
    return True


def _save_manifest(manifest: dict):
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2))


def _plugin_path(name: str) -> Path:
    if not _PLUGIN_NAME_RE.fullmatch(name):
        raise ValueError("Invalid plugin name")
    plugin_file = (PLUGINS_DIR / f"{name}.py").resolve()
    plugins_root = PLUGINS_DIR.resolve()
    if plugin_file.parent != plugins_root:
        raise ValueError("Plugin path escapes plugins directory")
    return plugin_file


def discover_plugins() -> list[str]:
    """Find all .py plugin files (excluding __init__.py)."""
    if not PLUGINS_DIR.exists():
        return []
    return [
        f.stem
        for f in sorted(PLUGINS_DIR.glob("*.py"))
        if f.stem != "__init__" and not f.stem.startswith("_")
    ]


def load_plugins(app, store=None, registry=None, mcp_bridge_module=None):
    """Load and initialize all discovered plugins."""
    plugins_str = str(PLUGINS_DIR)
    if plugins_str not in sys.path:
        sys.path.insert(0, str(PLUGINS_DIR.parent))

    manifest = _load_manifest()
    disabled = set(manifest.get("disabled", []))

    loaded = []
    for name in discover_plugins():
        if name in disabled:
            log.info("Plugin '%s' is disabled — skipping", name)
            continue
        try:
            module = importlib.import_module(f"plugins.{name}")
            setup_fn = getattr(module, "setup", None)
            if setup_fn is None:
                log.warning("Plugin '%s' has no setup() function — skipping", name)
                continue
            setup_fn(app=app, store=store, registry=registry, mcp_bridge=mcp_bridge_module)
            loaded.append(name)
            if name not in manifest["plugins"]:
                doc = getattr(module, "__doc__", "") or ""
                version = getattr(module, "__version__", "1.0.0")
                manifest["plugins"][name] = {
                    "version": version,
                    "description": doc.strip().split("\n")[0] if doc.strip() else "",
                    "enabled": True,
                    "builtin": True,
                }
            log.info("Plugin loaded: %s", name)
        except Exception as e:
            log.error("Failed to load plugin '%s': %s", name, e)

    _save_manifest(manifest)
    if loaded:
        print(f"  Plugins loaded: {', '.join(loaded)}")
    return loaded


def list_plugins() -> list[dict]:
    """List all discovered plugins with metadata."""
    manifest = _load_manifest()
    disabled = set(manifest.get("disabled", []))
    plugins = []
    for name in discover_plugins():
        plugin_file = PLUGINS_DIR / f"{name}.py"
        meta = manifest.get("plugins", {}).get(name, {})
        try:
            mod_key = f"plugins.{name}"
            module = sys.modules.get(mod_key) or importlib.import_module(mod_key)
            doc = getattr(module, "__doc__", "") or ""
            version = getattr(module, "__version__", meta.get("version", "1.0.0"))
            has_setup = hasattr(module, "setup")
            plugins.append({
                "name": name,
                "version": version,
                "description": doc.strip().split("\n")[0] if doc.strip() else meta.get("description", ""),
                "has_setup": has_setup,
                "enabled": name not in disabled,
                "builtin": meta.get("builtin", True),
                "file": str(plugin_file),
                "size": plugin_file.stat().st_size,
            })
        except Exception as e:
            plugins.append({
                "name": name,
                "version": meta.get("version", "?"),
                "description": f"Error: {e}",
                "has_setup": False,
                "enabled": name not in disabled,
                "builtin": meta.get("builtin", False),
                "file": str(plugin_file),
                "size": plugin_file.stat().st_size if plugin_file.exists() else 0,
            })
    return plugins


def enable_plugin(name: str) -> bool:
    """Enable a disabled plugin."""
    manifest = _load_manifest()
    disabled = manifest.get("disabled", [])
    if name in disabled:
        disabled.remove(name)
        manifest["disabled"] = disabled
        _save_manifest(manifest)
        return True
    return False


def disable_plugin(name: str) -> bool:
    """Disable a plugin (won't load on next restart)."""
    manifest = _load_manifest()
    disabled = manifest.get("disabled", [])
    if name not in disabled:
        disabled.append(name)
        manifest["disabled"] = disabled
        _save_manifest(manifest)
        return True
    return False


def install_plugin(name: str, code: str, description: str = "", version: str = "1.0.0") -> dict:
    """Install a new plugin from source code."""
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)

    # Safety scan
    try:
        from plugin_sdk import SafetyScanner
        scanner = SafetyScanner()
        issues = scanner.scan(code)
        if issues:
            return {"ok": False, "error": f"Safety scan failed: {issues}"}
    except (ImportError, Exception) as e:
        log.warning("SafetyScanner unavailable (%s), using fallback string check", e)
        dangerous = ["__import__(", "eval(", "exec(", "compile(", "getattr(__builtins__", "subprocess", "os.system", "os.popen"]
        for pattern in dangerous:
            if pattern in code:
                return {"ok": False, "error": f"Blocked dangerous pattern: {pattern}"}

    try:
        plugin_file = _plugin_path(name)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    plugin_file.write_text(code)

    manifest = _load_manifest()
    manifest["plugins"][name] = {
        "version": version,
        "description": description,
        "enabled": True,
        "builtin": False,
        "installed_at": _time.time(),
    }
    if name in manifest.get("disabled", []):
        manifest["disabled"].remove(name)
    _save_manifest(manifest)

    return {"ok": True, "name": name, "version": version}


def uninstall_plugin(name: str) -> bool:
    """Remove a non-builtin plugin."""
    manifest = _load_manifest()
    meta = manifest.get("plugins", {}).get(name, {})
    if meta.get("builtin"):
        return False

    try:
        plugin_file = _plugin_path(name)
    except ValueError:
        return False
    if plugin_file.exists():
        plugin_file.unlink()
    manifest["plugins"].pop(name, None)
    if name in manifest.get("disabled", []):
        manifest["disabled"].remove(name)
    _save_manifest(manifest)
    return True
