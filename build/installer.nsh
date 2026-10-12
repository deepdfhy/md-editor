; ============================================================================
;  MD 编辑器 —— 自定义 NSIS 脚本
;  electron-builder 会把本文件插到生成的安装脚本最前面（build/installer.nsh）
;
;  实现三件事：
;   1) 初次安装：显示「选择安装目录」页面，用户可以自己挑目录
;   2) 覆盖安装：自动读取上一次的安装目录（注册表 InstallLocation），
;      跳过安装模式页和目录页，原地覆盖安装，避免装出多个目录多个版本
;   3) 覆盖安装时若程序正在运行：弹窗提示，可选「强制关闭并继续安装」
;
;  注意：本文件必须是 UTF-8 无 BOM（electron-builder 用 -INPUTCHARSET UTF8 编译）
; ============================================================================

; 本文件被插在最前面，LogicLib / nsProcess / StrContains 都还没被引入，先自己引一遍
!include "LogicLib.nsh"
!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

; 安装目录的子文件夹名（PRODUCT_FILENAME = "MD 编辑器"）
!define MD_DIR_NAME "${PRODUCT_FILENAME}"
; multiUser.nsh 里也有这个定义，用 /ifndef 避免重复定义
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"

; ---------------------------------------------------------------------------
; 1) 安装模式页（为所有用户 / 仅为我）
;    只要没有「为所有用户」的旧安装，就固定走「仅当前用户」并跳过该页，
;    这样升级时不会弹出多余的选择页，也不会去申请管理员权限。
; ---------------------------------------------------------------------------
!macro customInstallMode
  ${If} $hasPerMachineInstallation == "0"
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; 1.5) 兜底默认目录
;     setInstallModePerUser 给的默认是 %LOCALAPPDATA%\Programs\md-editor
;     （APP_FILENAME 用的是 sanitizedName），这里在「全新安装且没指定 /D」
;     时换成 %LOCALAPPDATA%\Programs\MD 编辑器。
;     走 customInit 而不是目录页回调，是因为静默安装(/S)不显示页面。
; ---------------------------------------------------------------------------
!macro customInit
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R1 == ""
    ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${StdUtils.GetParameter} $R2 "D" ""
  ${If} $R1 == ""
  ${AndIf} $R2 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${MD_DIR_NAME}"
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; 2) 目录选择页：只在「全新安装」时出现
;    这里不直接用 multiUser.nsh 的 $hasPerUserInstallation（本文件被插在最前面，
;    那时变量还没声明，会被 -WX 当成错误处理），改为自己读一次注册表。
; ---------------------------------------------------------------------------
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE mdDirPagePre
  !insertmacro MUI_PAGE_DIRECTORY
  ; MUI 用完就会 !undef 掉 PRE，这里再设一个给紧接着的「安装进度页」用
  !define MUI_PAGE_CUSTOMFUNCTION_PRE mdInstFilesPre
!macroend

; 卸载器里不会有目录页，这两个函数不会被引用；
; 而 -WX 把「未被引用」当错误，所以只在安装器里定义它们
!ifndef BUILD_UNINSTALLER

!ifndef StrContains
  !include "StrContains.nsh"
!endif

Function mdDirPagePre
  ; 已装过（当前用户 / 本机）→ 沿用注册表里记的原目录，跳过目录页
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $R0 != ""
    Abort
  ${EndIf}
FunctionEnd

; 目录页的 leave 回调拿不到最终 $INSTDIR，所以放到安装页之前做规范化：
; 用户选了 D:\Soft 就装到 D:\Soft\MD 编辑器，避免文件散在目录根上
Function mdInstFilesPre
  ${StrContains} $0 "${MD_DIR_NAME}" $INSTDIR
  ${If} $0 == ""
    StrCpy $INSTDIR "$INSTDIR\${MD_DIR_NAME}"
  ${EndIf}
FunctionEnd

!endif

; ---------------------------------------------------------------------------
; 3) 正在运行检测（安装 / 卸载都会走这里）
;    覆盖安装默认行为是「静默杀掉」，这里改成先弹窗让用户选择。
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  mdAppRunning_again:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      Goto mdAppRunning_done
    ${EndIf}

    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1|MB_TOPMOST \
      "检测到 ${PRODUCT_NAME} 正在运行。$\r$\n$\r$\n点击「确定」：自动关闭它并继续安装（请先确认笔记已保存）。$\r$\n点击「取消」：退出安装程序。" \
      /SD IDOK IDOK mdAppRunning_close
    Quit

    mdAppRunning_close:
      DetailPrint "正在关闭 ${PRODUCT_NAME} ..."

      ; 先发 WM_CLOSE，给程序一个体面退出的机会
      ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 1500

      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 == 0
        ; 还没退，直接强杀
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1000
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${EndIf}

      ${If} $R0 == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_TOPMOST \
          "没能关闭 ${PRODUCT_NAME}。$\r$\n请手动关闭它，再点「重试」继续安装；点「取消」退出安装程序。" \
          /SD IDCANCEL IDRETRY mdAppRunning_again
        Quit
      ${EndIf}

  mdAppRunning_done:
    ${nsProcess::Unload}
!macroend
