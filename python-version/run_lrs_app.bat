@echo off
cd /d "%~dp0"

REM Double-clicked .bat files often miss PATH entries added after install.
set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"

where uv >nul 2>&1
if errorlevel 1 (
  echo uv was not found. Installing it now...
  powershell -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"
)

where uv >nul 2>&1
if errorlevel 1 (
  echo Still could not find uv. Close this window, open a new Command Prompt, and try again.
  pause
  exit /b 1
)

echo Using:
uv --version
echo.
echo Starting Internal LRS Toolkit on http://127.0.0.1:8765
echo First run may take a few minutes while Python 3.11 and packages install.
echo.

uv python install 3.11
if errorlevel 1 (
  echo Failed to install Python 3.11 with uv.
  pause
  exit /b 1
)

uv sync
if errorlevel 1 (
  echo Failed to sync the project environment.
  pause
  exit /b 1
)

uv run python -m lrs_app
echo.
pause
