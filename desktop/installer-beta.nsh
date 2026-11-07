!define LWORKSTATION_PARALLEL_BETA
!include "${PROJECT_DIR}\installer.nsh"

!ifndef BUILD_UNINSTALLER
; The old public Betas share the stable GUID. Guard both directions of a
; directory overlap so a later uninstall cannot remove the other edition.
!macro canonicalBetaDirectory INPUT BUFFER OUTPUT
  ; GetFullPathNameW also handles an installation directory that does not exist yet.
  System::Call 'kernel32::GetFullPathNameW(w "${INPUT}", i ${NSIS_MAX_STRLEN}, w .${BUFFER}, p 0) i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    Goto betaTargetConflict
  ${EndIf}
  StrCpy $2 ${OUTPUT} 1 -1
  ${If} $2 != "\"
    StrCpy ${OUTPUT} "${OUTPUT}\"
  ${EndIf}
!macroend

!macro rejectStableOverlap HIVE
  ReadRegStr $0 ${HIVE} "Software\b871a797-4186-59e7-b82d-5dde992706b7" "InstallLocation"
  ${If} $0 != ""
    !insertmacro canonicalBetaDirectory "$0" r0 $0
    StrLen $2 $0
    StrCpy $3 $1 $2
    StrCmp $3 $0 betaTargetConflict
    StrLen $2 $1
    StrCpy $3 $0 $2
    StrCmp $3 $1 betaTargetConflict
  ${EndIf}
!macroend

Function verifyBetaInstallTarget
  Push $0
  Push $1
  Push $2
  Push $3
  !insertmacro canonicalBetaDirectory "$INSTDIR" r1 $1
  IfFileExists "$1\Lworkstation.exe" betaTargetConflict
  !insertmacro rejectStableOverlap HKCU
  !insertmacro rejectStableOverlap HKLM
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Return
  betaTargetConflict:
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "此目录与正式版安装目录重叠。请使用 Lworkstation Beta 的独立目录。"
    SetErrorLevel 87
    Quit
FunctionEnd
!endif
