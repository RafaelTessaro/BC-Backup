; build/installer.nsh: remove the login item on real uninstall (not on update)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.bcbackup.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.bcbackup.app"
  ${endIf}
!macroend
