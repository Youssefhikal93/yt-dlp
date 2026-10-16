@echo off
title YT Downloader
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  YT Downloader needs Node.js, a free program. Opening the download page...
  echo  Install the "LTS" version, then double-click this file again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause
