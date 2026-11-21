# What OpenFilm adds to electron-builder's Windows installer and uninstaller (nsis.include in scripts/release.mjs).
#
# The folder OpenFilm is installed in can hold more than OpenFilm: people pick it themselves, and some keep projects,
# media or other files in it. So installing, updating and uninstalling remove OpenFilm's own program files and nothing
# else. They never ask anyone to move a file first and never stop because of what else is in the folder.
#
# - The uninstaller deletes the program files named below (customRemoveFiles), where electron-builder's own deletes
#   the whole folder.
# - The installer puts this uninstaller in place of the one a previous version registered, before electron-builder
#   runs it for the update: OpenFilm 0.4.0 and earlier registered one that deletes the whole folder, and 0.4.1 one
#   that stops when the folder holds anything else.

# OpenFilm's program files, by their path in the installation folder. A name stays here after a version stops shipping
# it: this uninstaller removes the versions before it too. scripts/release.mjs fails when a package has a file that
# neither list covers.
!macro OpenFilmProgramFiles DO
  !insertmacro ${DO} "${APP_EXECUTABLE_FILENAME}"
  !insertmacro ${DO} "chrome_100_percent.pak"
  !insertmacro ${DO} "chrome_200_percent.pak"
  !insertmacro ${DO} "d3dcompiler_47.dll"
  !insertmacro ${DO} "dxcompiler.dll"
  !insertmacro ${DO} "dxil.dll"
  !insertmacro ${DO} "ffmpeg.dll"
  !insertmacro ${DO} "icudtl.dat"
  !insertmacro ${DO} "libEGL.dll"
  !insertmacro ${DO} "libGLESv2.dll"
  !insertmacro ${DO} "LICENSE.electron.txt"
  !insertmacro ${DO} "LICENSES.chromium.html"
  !insertmacro ${DO} "resources.pak"
  !insertmacro ${DO} "snapshot_blob.bin"
  !insertmacro ${DO} "v8_context_snapshot.bin"
  !insertmacro ${DO} "vk_swiftshader.dll"
  !insertmacro ${DO} "vk_swiftshader_icd.json"
  !insertmacro ${DO} "vulkan-1.dll"
  !insertmacro ${DO} "resources\app.asar"
  !insertmacro ${DO} "resources\app-update.yml"
  !insertmacro ${DO} "resources\elevate.exe"
!macroend

# Folders that hold program files only: removed with everything in them. Every other folder (the installation folder,
# resources, resources\runtime) is removed only once it is empty.
!macro OpenFilmProgramFolders DO
  !insertmacro ${DO} "locales"
  !insertmacro ${DO} "resources\app.asar.unpacked"
  !insertmacro ${DO} "resources\runtime\ffmpeg"
  !insertmacro ${DO} "resources\runtime\ms-playwright"
!macroend

!ifdef BUILD_UNINSTALLER
  # Moves a program file out of the way, as electron-builder does for a whole folder before an update: a file that
  # is still in use stops the update here ($R0 names it), before anything is deleted.
  !macro OpenFilmSetAsideFile NAME
    ${If} $R0 == 0
    ${AndIf} ${FileExists} "$INSTDIR\${NAME}"
      ClearErrors
      Rename "$INSTDIR\${NAME}" "$PLUGINSDIR\old-install\${NAME}"
      ${If} ${Errors}
        StrCpy $R0 "$INSTDIR\${NAME}"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro OpenFilmSetAsideFolder NAME
    ${If} $R0 == 0
      Push "$INSTDIR\${NAME}"
      Call un.OpenFilmIsOwnFolder
      Pop $R1
      ${If} $R1 == 1
        CreateDirectory "$PLUGINSDIR\old-install\${NAME}"
        Push "\${NAME}"
        Call un.atomicRMDir
        Pop $R0
      ${EndIf}
    ${EndIf}
  !macroend

  !macro OpenFilmDeleteFile NAME
    Delete "$INSTDIR\${NAME}"
  !macroend

  !macro OpenFilmDeleteFolder NAME
    Push "$INSTDIR\${NAME}"
    Call un.OpenFilmIsOwnFolder
    Pop $R1
    ${If} $R1 == 1
      RMDir /r "$INSTDIR\${NAME}"
    ${EndIf}
  !macroend

  # Removes a folder OpenFilm shares with whatever else was put in it, once nothing is left there.
  !macro OpenFilmDeleteFolderIfEmpty PATH
    Push "${PATH}"
    Call un.OpenFilmIsOwnFolder
    Pop $R1
    ${If} $R1 == 1
      RMDir "${PATH}"
    ${EndIf}
  !macroend

  # In place of electron-builder's `RMDir /r $INSTDIR`.
  !macro customRemoveFiles
    InitPluginsDir
    ${If} ${isUpdated}
      StrCpy $R0 0
      CreateDirectory "$PLUGINSDIR\old-install\resources"
      !insertmacro OpenFilmProgramFiles OpenFilmSetAsideFile
      !insertmacro OpenFilmProgramFolders OpenFilmSetAsideFolder
      ${If} $R0 != 0
        DetailPrint "File is busy, aborting: $R0"
        Push ""
        Call un.restoreFiles
        Pop $R0
        Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
      ${EndIf}
    ${EndIf}

    # $INSTDIR is the current folder until here, and Windows keeps the current folder.
    SetOutPath $TEMP
    !insertmacro OpenFilmProgramFiles OpenFilmDeleteFile
    !insertmacro OpenFilmProgramFolders OpenFilmDeleteFolder
    Delete "$INSTDIR\uninstallerIcon.ico"
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    !insertmacro OpenFilmDeleteFolderIfEmpty "$INSTDIR\resources\runtime"
    !insertmacro OpenFilmDeleteFolderIfEmpty "$INSTDIR\resources"
    # An update installs into the same folder next: it stays as it is, a link to another disk included.
    ${IfNot} ${isUpdated}
      !insertmacro OpenFilmDeleteFolderIfEmpty "$INSTDIR"
    ${EndIf}
    ClearErrors
  !macroend
!endif

!ifndef BUILD_UNINSTALLER
  !macro OpenFilmUseThisUninstaller ROOT
    ReadRegStr $0 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ${If} $0 == ""
        ReadRegStr $0 ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      ${EndIf}
    !endif
    Push $0
    Call OpenFilmReplaceUninstaller
    Pop $0
    # A previous uninstaller that could not be replaced must not run: without its UninstallString electron-builder
    # installs over the previous version's files. Without the rights to replace it (an installation for all users,
    # before this installer is elevated) the registry cannot be written either, and nothing changes.
    ${If} $0 == 0
      DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegValue ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      !endif
    ${EndIf}
  !macroend
!endif

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    # "1" for a folder of its own, "0" for anything else: no folder there, a file, or a link to a folder kept
    # somewhere else (a junction), whose contents are not this installation's to delete.
    Function un.OpenFilmIsOwnFolder
      Exch $0
      System::Call 'kernel32::GetFileAttributesW(w r0) i .r0'
      # FILE_ATTRIBUTE_DIRECTORY without FILE_ATTRIBUTE_REPARSE_POINT; no file at all reads as every bit set
      IntOp $0 $0 & 0x410
      ${If} $0 = 0x10
        StrCpy $0 1
      ${Else}
        StrCpy $0 0
      ${EndIf}
      Exch $0
    FunctionEnd
  !else
    # Puts this version's uninstaller where the registered UninstallString (on the stack) says the previous one is.
    # Leaves "1" on the stack when electron-builder will find this uninstaller there or none at all, and "0" when what
    # was registered is still there.
    SetOverwrite try
    Function OpenFilmReplaceUninstaller
      Exch $0
      Push $1
      Push $2
      Push $0
      Call GetInQuotes
      Pop $0
      StrCpy $1 1
      ${If} $0 != ""
      ${AndIf} ${FileExists} "$0"
        StrCpy $1 0
        # only a file with the uninstaller's own name is ever deleted or written
        StrLen $2 "\${UNINSTALL_FILENAME}"
        StrCpy $2 $0 "" -$2
        ${If} $2 == "\${UNINSTALL_FILENAME}"
          StrCpy $2 0
          ${Do}
            Delete "$0"
            ${IfNot} ${FileExists} "$0"
              File "/oname=$0" "${UNINSTALLER_OUT_FILE}"
              StrCpy $1 1
              ${ExitDo}
            ${EndIf}
            IntOp $2 $2 + 1
            ${If} $2 > 2
              ${ExitDo}
            ${EndIf}
            # a virus scanner reading the file lets go of it within moments
            Sleep 300
          ${Loop}
        ${EndIf}
      ${EndIf}
      ClearErrors
      StrCpy $0 $1
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd
    SetOverwrite lastused

    # Runs before the install section, where electron-builder runs the registered uninstaller of the version it
    # replaces, for this person and (elevated) for an installation for all users.
    Section "-Keep what is beside OpenFilm"
      SectionIn RO
      Push $0
      !insertmacro OpenFilmUseThisUninstaller HKCU
      !insertmacro OpenFilmUseThisUninstaller HKLM
      Pop $0
      ClearErrors
    SectionEnd
  !endif
!macroend
