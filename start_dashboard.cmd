@echo off
setlocal
cd /d "%~dp0"
if exist "python\.venv\Scripts\python.exe" (
  "python\.venv\Scripts\python.exe" "start_dashboard.py" %*
) else (
  python "start_dashboard.py" %*
)
set "DASHBOARD_EXIT=%ERRORLEVEL%"
if not "%DASHBOARD_EXIT%"=="0" (
  echo.
  echo Launcher exited with code %DASHBOARD_EXIT%. Read the error above and .ua\servers logs.
  pause
)
exit /b %DASHBOARD_EXIT%
