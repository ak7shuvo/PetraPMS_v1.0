; Custom NSIS steps for PetraPMS (included by electron-builder).
; DATA SAFETY RULE: nothing in this file may delete, move or overwrite $COMMONPROGRAMDATA\PetraPMS.
; (verified by scripts/verify-installer.mjs, which fails the build if a destructive command targets that folder)

!macro customInit
  ; UPGRADE step 1: stop the PetraPMS Windows Service (if Server mode is installed) so program files are not locked.
  ; The service folder lives in the data directory and is never modified here.
  IfFileExists "$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" 0 +2
    nsExec::ExecToLog '"$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" stop'
!macroend

!macro customInstall
  ; Create the shared data folder once. On upgrade it already exists and is left exactly as it is.
  CreateDirectory "$COMMONPROGRAMDATA\PetraPMS"
  ; Default ACL for single-computer installs: SYSTEM + Administrators full control, local Users can read/write (the app
  ; runs as the signed-in Windows user). Skipped when Server mode already tightened the ACL (service folder exists),
  ; so an upgrade never loosens permissions.
  IfFileExists "$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" skip_acl 0
    nsExec::ExecToLog 'icacls "$COMMONPROGRAMDATA\PetraPMS" /grant *S-1-5-32-545:(OI)(CI)M'
  skip_acl:
  ; UPGRADE step 2: point the service at the new program files and start it. The server migrates the database on start;
  ; SQLite databases are copied to backups/ by the migrator BEFORE any pending migration runs (packages/db migrate).
  IfFileExists "$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" 0 skip_refresh
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --service refresh'
  skip_refresh:
!macroend

!macro customUnInstall
  ; Stop and remove the Windows Service and firewall rule if Server mode was used. Data is preserved.
  nsExec::ExecToLog '"$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" stop'
  nsExec::ExecToLog '"$COMMONPROGRAMDATA\PetraPMS\service\PetraPMS.exe" uninstall'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PetraPMS Server"'
  MessageBox MB_OK "PetraPMS was removed. Your hotel data is kept in $COMMONPROGRAMDATA\PetraPMS. Delete that folder only if you are sure you no longer need it."
!macroend
