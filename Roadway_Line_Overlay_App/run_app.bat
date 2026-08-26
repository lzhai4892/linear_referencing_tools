@echo off
title Roadway Line-to-Line Overlay Tool
cd /d "%~dp0"
echo ======================================================================
echo Launching Generalized Roadway Line-to-Line Overlay Web Application...
echo ======================================================================
echo Starting server at http://127.0.0.1:5000 ...
start "" http://127.0.0.1:5000
python app.py
pause
