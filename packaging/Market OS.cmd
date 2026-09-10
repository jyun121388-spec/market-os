@echo off
rem ---------------------------------------------------------------------------
rem  The thing a Windows user double-clicks.
rem
rem  It is a .cmd and not a .ps1 on purpose: PowerShell's execution policy blocks
rem  an unsigned script on a default installation, so a .ps1 launcher fails on
rem  exactly the clean machine this is meant to work on. All the real work is in
rem  launcher.mjs; this file only finds a Node to run it with, and says something
rem  a person can act on when it cannot.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

rem  A Node bundled beside the application wins over whatever is on PATH, so an
rem  installation is not at the mercy of a system Node someone upgrades later.
set "MARKET_OS_NODE=%~dp0node\node.exe"
if not exist "%MARKET_OS_NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Market OS could not find Node.js.
    echo.
    echo Install Node.js 20 or newer from https://nodejs.org and run this again,
    echo or reinstall Market OS with the bundled runtime.
    echo.
    pause
    exit /b 9
  )
  set "MARKET_OS_NODE=node"
)

"%MARKET_OS_NODE%" "%~dp0launcher.mjs" --stay
set "MARKET_OS_EXIT=%ERRORLEVEL%"

rem  Hold the window open on failure. Without this a double-clicked launcher that
rem  refuses — a port already in use, a database that belongs to something else —
rem  closes instantly and the user sees nothing at all.
if not "%MARKET_OS_EXIT%"=="0" (
  echo.
  echo Market OS stopped with code %MARKET_OS_EXIT%. The messages above say why.
  pause
)
exit /b %MARKET_OS_EXIT%
