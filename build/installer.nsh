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
!macroend
