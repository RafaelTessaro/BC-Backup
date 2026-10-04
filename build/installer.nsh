; build/installer.nsh - included by the electron-builder NSIS installer (nsis.include).
; (ASCII only on purpose: NSIS reads includes in the system code page unless they carry a BOM.)
;
; On a real UNINSTALL (not during an update) remove the "start with Windows" entry.
; Electron's app.setLoginItemSettings writes it to HKCU\...\Run using the app's AppUserModelId as the
; value name (com.bcbackup.app, same as appId in electron-builder.yml). We also delete the friendly
; name, in case the main process passes `name: 'BC Backup'`, and the enabled/disabled state that Task
; Manager keeps in StartupApproved\Run. Missing values are ignored by NSIS.
; Routines and history (userData) are kept: deleteAppDataOnUninstall is false.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.bcbackup.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BC Backup"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.bcbackup.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "BC Backup"
  ${endIf}
!macroend
