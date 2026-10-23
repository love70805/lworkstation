; Assisted NSIS normally appends APP_FILENAME on entering the install page.
; An existing custom directory is already an application directory: preserve it,
; including older /D installations whose folder name differs from APP_FILENAME.
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var updatePipe
Var updateParent
Var updateResult
Var updateParentHandle

; Only an existing local named pipe is accepted: never write an arbitrary path
; from a command line while elevated. The random suffix belongs to the caller.
Function reportUpdateStatus
  Push $0
  Push $1
  Push $2
  StrLen $0 "\\.\pipe\Lworkstation.Update."
  StrCpy $1 $updatePipe $0
  ${If} $1 == "\\.\pipe\Lworkstation.Update."
    StrLen $1 $updatePipe
    IntOp $0 $0 + 32
    ${If} $1 == $0
      System::Call 'kernel32::CreateFileW(w "$updatePipe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
      ${If} $0 != -1
        StrLen $1 $updateResult
        System::Call 'kernel32::WriteFile(p r0, m "$updateResult", i r1, *i .r2, p 0) i'
        System::Call 'kernel32::CloseHandle(p r0)'
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

!macro customInit
  ${If} ${isUpdated}
    ${GetParameters} $R0
    ${GetOptions} $R0 "--lworkstation-pipe=" $updatePipe
    ${GetOptions} $R0 "--lworkstation-parent=" $updateParent
    ; Unlike feed metadata, initMultiUser describes this installed machine.
    ${If} $hasPerMachineInstallation == "1"
    ${AndIf} $hasPerUserInstallation != "1"
      ${IfNot} ${UAC_IsAdmin}
        !insertmacro UAC_RunElevated
        ${If} $0 == 0
        ${AndIf} $1 == 1
          ; A launched elevation child can itself fail (for example NSIS's
          ; 0x666666 non-admin result). Do not silently treat that as success.
          ${If} $2 == 0
            Quit
          ${EndIf}
          StrCpy $0 $2
        ${EndIf}
        ${If} $0 == 0
          StrCpy $0 5
        ${EndIf}
        StrCpy $updateResult "error:$0$\n"
        Call reportUpdateStatus
        ${If} $updatePipe == ""
          ${If} $0 == 1223
            MessageBox MB_OK|MB_ICONINFORMATION "已取消管理员授权，尚未安装更新。原版本仍可使用，请重新打开 Lworkstation 后重试。"
          ${Else}
            MessageBox MB_OK|MB_ICONSTOP "更新未完成（错误 $0）。请重新打开 Lworkstation，或以管理员身份运行已下载的安装包后重试。"
          ${EndIf}
        ${EndIf}
        SetErrorLevel $0
        Quit
      ${EndIf}
    ${EndIf}
    ${If} $updatePipe != ""
      ; Installer readiness is acknowledged before the client exits. Wait only
      ; for that exact process, rather than killing another Lworkstation task.
      ${If} $updateParent == ""
        StrCpy $updateResult "error:PARENT$\n"
        Call reportUpdateStatus
        SetErrorLevel 87
        Quit
      ${EndIf}
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $updateParent) p.r0'
      StrCpy $updateParentHandle $0
      ${If} $updateParentHandle == 0
        StrCpy $updateResult "error:PARENT$\n"
        Call reportUpdateStatus
        SetErrorLevel 87
        Quit
      ${EndIf}
      StrCpy $updateResult "ready$\n"
      Call reportUpdateStatus
      System::Call 'kernel32::WaitForSingleObject(p $updateParentHandle, i 45000) i.r0'
      System::Call 'kernel32::CloseHandle(p $updateParentHandle)'
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Lworkstation 尚未正常退出，更新未开始。请关闭原程序后重试安装。"
        SetErrorLevel 1460
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

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

; Preserve the normal manual-install Finish page, but honor the updater's
; --force-run request after a successful assisted update. Stock NSIS only
; honors that request for silent installs, leaving an update at Finish.
!macro customFinishPage
  Function LworkstationStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function completeRequestedUpdate
    ${If} ${isUpdated}
    ${AndIf} ${isForceRun}
      HideWindow
      Call LworkstationStartApp
      !insertmacro quitSuccess
    ${EndIf}
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "LworkstationStartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE completeRequestedUpdate
  !insertmacro MUI_PAGE_FINISH
!macroend
