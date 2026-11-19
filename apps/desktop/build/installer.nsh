!macro OpenFilmDefineInstallCheck PREFIX
  Function ${PREFIX}OpenFilmCheckInstallPath
    Exch $0
    Push $1
    ${If} $0 != ""
      InitPluginsDir
      # Use NSIS path syntax. The macOS compiler translates this separator for its host.
      File "/oname=$PLUGINSDIR\openfilm-protect-install.ps1" "${BUILD_RESOURCES_DIR}\protect-install.ps1"
      System::Call 'kernel32::SetEnvironmentVariableW(w "OPENFILM_INSTALL_CHECK_PATH", w r0) i.r1'
      ${If} $1 != 0
        nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\openfilm-protect-install.ps1" -AppFile "${APP_EXECUTABLE_FILENAME}" -UninstallFile "${UNINSTALL_FILENAME}"'
        Pop $1
        System::Call 'kernel32::SetEnvironmentVariableW(w "OPENFILM_INSTALL_CHECK_PATH", p 0)'
      ${Else}
        StrCpy $1 "error"
      ${EndIf}
      ${If} $1 != "0"
        ${If} $1 == "10"
          ${If} $LANGUAGE == 2052
            StrCpy $1 "为保护你的工程和素材，OpenFilm 已停止安装或卸载。请把下方目录里的工程、素材库和其他个人文件移到安装目录之外，并更新「设置 → 通用 → 存储」里的项目位置，再重试。$\r$\n$\r$\n$0"
          ${Else}
            StrCpy $1 "OpenFilm stopped to protect your projects and media. Move your personal files outside the installation folder below and update the project location in Settings before trying again.$\r$\n$\r$\n$0"
          ${EndIf}
        ${Else}
          ${If} $LANGUAGE == 2052
            StrCpy $1 "OpenFilm 无法确认下方目录可以安全清理，安装或卸载已停止。请确认目录可访问后重试。$\r$\n$\r$\n$0"
          ${Else}
            StrCpy $1 "OpenFilm could not verify that the folder below was safe to clean up. Check that the folder is accessible before trying again.$\r$\n$\r$\n$0"
          ${EndIf}
        ${EndIf}
        DetailPrint "$1"
        ${If} ${Silent}
          ${If} ${isUpdated}
            System::Call 'user32::MessageBoxW(p 0, w r1, w "OpenFilm", i 0x11010)'
          ${EndIf}
        ${Else}
          MessageBox MB_OK|MB_ICONSTOP "$1" /SD IDOK
        ${EndIf}
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!macro OpenFilmCheckPreviousInstallation ROOT
  ReadRegStr $0 ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ${If} $0 == ""
        ReadRegStr $0 ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      ${EndIf}
    !endif
    ${If} $0 != ""
      Push $0
      Call GetInQuotes
      Pop $0
      ${If} $0 != ""
        Push $0
        Call GetFileParent
        Pop $0
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $0 != $INSTDIR
    Push $0
    Call OpenFilmCheckInstallPath
  ${EndIf}
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro OpenFilmDefineInstallCheck "un."
  !else
    !insertmacro OpenFilmDefineInstallCheck ""
    # This section runs before electron-builder calls the old, already installed uninstaller.
    Section "-Protect OpenFilm projects"
      SectionIn RO
      Push $INSTDIR
      Call OpenFilmCheckInstallPath
      !insertmacro OpenFilmCheckPreviousInstallation HKCU
      # A silent update can elevate to the existing all-users installation later in the install section.
      ${If} $installMode == "all"
        !insertmacro OpenFilmCheckPreviousInstallation HKLM
      ${ElseIf} ${Silent}
        ${If} $hasPerMachineInstallation == "1"
          !insertmacro OpenFilmCheckPreviousInstallation HKLM
        ${EndIf}
      ${EndIf}
      ClearErrors
    SectionEnd
  !endif
!macroend

!macro customUnInstall
  Push $INSTDIR
  Call un.OpenFilmCheckInstallPath
!macroend
