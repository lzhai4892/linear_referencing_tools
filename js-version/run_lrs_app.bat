@echo off
cd /d "%~dp0"
echo Starting Internal LRS Toolkit on http://127.0.0.1:8765
echo Open that URL if the browser does not launch.
echo.

where py >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:8765/"
  py -m http.server 8765
  goto :eof
)

where python >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:8765/"
  python -m http.server 8765
  goto :eof
)

echo Python was not found. Opening index.html directly.
start "" "index.html"
pause
