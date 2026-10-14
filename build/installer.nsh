; Свои вставки в установщик Windows (electron-builder подключает build/installer.nsh сам).

; Проверка «программа запущена» перед установкой и удалением.
;
; Стандартная проверка electron-builder 26 считает программу запущенной, если
; работает ЛЮБОЙ процесс, чей путь начинается с папки установки. Папку у нас
; можно выбрать, и при общей папке (C:\Program Files, D:\, папка с другими
; программами) установщик находил чужие процессы и требовал закрыть FinUchet,
; хотя он не открыт. Здесь ищем ровно процесс FinUchet.exe — по имени файла.
;
; Без меток: макрос вставляется в установщик дважды, одинаковые метки не
; собрались бы. Переходы — относительные (+N инструкций).
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
    Quit
    DetailPrint "$(appClosing)"
    ; Сначала просим закрыться, потом — принудительно
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 1500
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 500
  ${endIf}
  ${nsProcess::Unload}

  ; Обновление — поверх прежней версии, без запуска её деинсталлятора.
  ;
  ; При обновлении electron-builder сначала запускает деинсталлятор ПРЕЖНЕЙ
  ; версии, а он проверяет «программа запущена» своим, старым кодом. У версий до
  ; 03.10.2026 эта проверка находила чужие процессы в общей папке установки —
  ; пять неудачных попыток, и человек получал «Не удалось закрыть FinUchet»,
  ; хотя программа закрыта; исправленная проверка выше до старого
  ; деинсталлятора не доходит. Без UninstallString установщик просто кладёт
  ; файлы поверх (папка установки берётся из InstallLocation, данные не
  ; трогаются), а запись в реестре и деинсталлятор пишет новые.
  ;
  ; Здесь, а не в customInit: этот макрос вызывается уже в разделе установки,
  ; после подтверждения — отмена установщика раньше не оставит прежнюю версию
  ; без записи для удаления. В деинсталляторе (BUILD_UNINSTALLER) не выполняется.
  !ifndef BUILD_UNINSTALLER
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !endif
!macroend

; Установка «для всех пользователей» идёт во втором, повышенном экземпляре
; установщика, а проверка запуска выше в нём не вызывается — там прежнюю запись
; убираем здесь. Повышенный экземпляр запускается, когда установку уже
; подтвердили, поэтому отмена раньше прежнюю версию не затронет.
!macro customInit
  ${if} ${UAC_IsInnerInstance}
    DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${endif}
!macroend
