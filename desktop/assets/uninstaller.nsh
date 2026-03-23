; GhostLink uninstaller — removes setupComplete flag so the wizard
; re-runs on reinstall, but preserves other user settings (agents, theme, etc.).
!macro customUnInstall
  ; Delete settings.json so the setup wizard shows on next install.
  ; Other user data in ~/.ghostlink/ (agent memories, etc.) is preserved.
  Delete "$PROFILE\.ghostlink\settings.json"
!macroend
