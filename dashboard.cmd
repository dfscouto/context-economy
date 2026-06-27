@echo off
REM context-economy dashboard launcher.
REM Double-click this file: it starts the local server and opens the dashboard in your
REM browser at http://127.0.0.1:3847 — that's the mode where the skill on/off buttons work.
REM Keep this window open while you use the dashboard. Close it (or Ctrl+C) to stop.
cd /d "%~dp0"
node scripts\dashboard-serve.cjs
echo.
echo Dashboard server stopped. Press any key to close this window.
pause >nul
