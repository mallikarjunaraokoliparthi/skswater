@echo off
title SKS Water Meters
cd /d "%~dp0"
echo ============================================
echo   SKS Apartment - Water Meters Server
echo ============================================
echo.
echo Server starting... browser will open now.
echo Close this window to STOP the server.
echo.
start "" http://localhost:3000
node server.js
pause
