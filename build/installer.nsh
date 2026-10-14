; Sonora Sound Recorder - custom NSIS hooks.
; Remember the language picked in the installer's language selector so the app can
; pre-select it on the first-run language screen. User data is never touched here:
; settings and archives live in %APPDATA%, outside the installation directory.

!macro customInstall
  WriteRegStr HKCU "Software\SonoraSoundRecorder" "InstallerLanguage" "$LANGUAGE"
!macroend
