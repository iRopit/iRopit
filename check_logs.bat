@echo off
setlocal

set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
if not exist "%ADB%" set ADB=adb

for /f "tokens=1" %%A in ('"%ADB%" devices ^| findstr /R /C:"[a-zA-Z0-9].*device$"') do (
	set HAS_DEVICE=1
	goto :device_ok
)

echo No connected Android device found. Connect phone and enable USB debugging.
exit /b 1

:device_ok
set TS=%DATE:~-4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set TS=%TS: =0%
set OUT=%~dp0crash_logcat_%TS%.txt

"%ADB%" logcat -c
echo Log buffer cleared. Reproduce crash, then press Enter...
pause >nul

"%ADB%" logcat -d -v time | findstr /I /C:"FATAL EXCEPTION" /C:"AndroidRuntime" /C:"ANR in" /C:"SIGSEGV" /C:"ReactNativeJS" /C:"com.IRopit" /C:"Process: com.IRopit" /C:"Caused by:" > "%OUT%"

echo Done. Crash log saved to: %OUT%
endlocal
