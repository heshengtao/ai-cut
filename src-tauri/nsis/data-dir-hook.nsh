; 安装时选择「数据目录」。
;
; 由 tauri.conf.json 的 bundle.windows.nsis.installerHooks 引入，挂在正式复制文件之前。
; 选择结果写进 HKCU\Software\AI Cut\DataDir，应用启动时由 src-tauri/src/paths.rs 读取
; （优先级低于设置页写的指针文件 data-dir.json）。
;
; 这里**只在首次安装**时弹窗：/S 静默安装、自动更新、以及已经选过目录的机器都不该被
; 一个人机交互卡住。用户取消则什么都不写，应用回落到系统默认的
; %APPDATA%\com.aicut.editor。
;
; 注意：MSI 安装包不支持 NSIS 钩子。用 MSI 装的用户可以在「设置 → 存储」里选择目录并
; 一键迁移——这条路径对老用户同样适用。
;
; 文件必须以 UTF-8 BOM 保存，否则 NSIS 会按系统代码页解释中文。

!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${Silent}
    ReadRegStr $R9 HKCU "Software\AI Cut" "DataDir"
    ; 已选过就沿用，别拿弹窗打断自动更新 / 重复安装。
    ${If} $R9 == ""
      nsDialogs::SelectFolderDialog "选择 AI Cut 数据目录（模型 / 运行时 / OFX 插件 / 工程历史）。建议新建一个专用空文件夹，放到空间充足的磁盘；点取消则使用系统默认位置（用户目录，在 C 盘）。" "$LOCALAPPDATA"
      Pop $R9

      ${If} $R9 != "error"
        ${If} $R9 != ""
          CreateDirectory "$R9"
          WriteRegStr HKCU "Software\AI Cut" "DataDir" "$R9"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; 卸载时保留用户数据：模型与工程历史可能还有用，删不删交给用户（设置页里也能看到位置）。
!macro NSIS_HOOK_PREUNINSTALL
!macroend
