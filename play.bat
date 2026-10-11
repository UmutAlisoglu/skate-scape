@echo off
rem Double-click to play Skate Scape. Close this window to stop the game.
title Skate Scape
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node tools\play.mjs
pause
