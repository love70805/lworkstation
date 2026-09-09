; Assisted NSIS normally appends APP_FILENAME on entering the install page.
; An existing custom directory is already an application directory: preserve it,
; including older /D installations whose folder name differs from APP_FILENAME.
!macro customInstallMode
  ; An in-app update must keep the installed scope, not offer a second install.
  ${If} ${isUpdated}
    ${If} $hasPerUserInstallation == "1"
      StrCpy $isForceCurrentInstall "1"
    ${ElseIf} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE preserveExistingInstallDirectory
  Function preserveExistingInstallDirectory
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R0 != ""
    ${AndIf} $INSTDIR == $R0
      Return
    ${EndIf}
    Call instFilesPre
  FunctionEnd
!macroend
