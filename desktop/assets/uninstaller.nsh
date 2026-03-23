; GhostLink uninstaller — removes settings.json ONLY during explicit
; user-initiated uninstall (not during silent auto-update upgrades).
; When electron-updater runs an auto-update, it silently uninstalls the
; old version first (/S flag) — we must preserve settings in that case.
!macro customUnInstall
  ${IfNot} ${Silent}
    ; Explicit uninstall — user chose to remove the app.
    ; Delete settings so the wizard re-runs on fresh reinstall.
    Delete "$PROFILE\.ghostlink\settings.json"
  ${EndIf}
!macroend
