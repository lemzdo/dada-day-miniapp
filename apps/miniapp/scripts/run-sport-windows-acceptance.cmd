@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-sport-windows-acceptance.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo SPORT WINDOWS ACCEPTANCE: PASS
) else (
  echo SPORT WINDOWS ACCEPTANCE: FAIL ^(exit %EXIT_CODE%^)
)
echo Evidence path is printed above by the PowerShell runner.
pause
exit /b %EXIT_CODE%
