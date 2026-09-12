@echo off
rem ---------------------------------------------------------------------------
rem  The thing a Windows user double-clicks.
rem
rem  It is a .cmd and not a .ps1 on purpose: PowerShell's execution policy blocks
rem  an unsigned script on a default installation, so a .ps1 launcher fails on
rem  exactly the clean machine this is meant to work on. All the real work is in
rem  launcher.mjs; this file only starts it with the runtime that ships beside
rem  it, and says something a person can act on when that runtime is missing.
rem
rem  THE BUNDLED RUNTIME IS THE ONLY RUNTIME.
rem
rem  This used to fall back to whatever `where node` turned up, and then tell the
rem  user to go and install Node.js 20+ from nodejs.org. That is the thing a
rem  delivered product is supposed to make unnecessary, and it was worse than it
rem  looked: nothing in the build pipeline ever created node\node.exe, so the
rem  fallback was not a safety net but the normal path. build-installer.ts now
rem  stages a pinned Node into every distribution and refuses to produce one
rem  without it, so a missing runtime here means a damaged copy - not a machine
rem  that needs setting up.
rem
rem  ASCII only, everywhere in this file. An em dash here (U+2014, three UTF-8
rem  bytes) broke the whole script on a machine whose console codepage is not
rem  UTF-8: cmd.exe mis-decoded it and then executed the surrounding comment
rem  text as commands. The clean-room acceptance caught it; stage-runtime.ts
rem  now refuses to package a .cmd containing any byte above 0x7F.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "MARKET_OS_NODE=%~dp0node\node.exe"
if not exist "%MARKET_OS_NODE%" (
  echo.
  echo Market OS cannot start: its bundled runtime is missing.
  echo.
  echo Expected: %MARKET_OS_NODE%
  echo.
  echo This copy of Market OS is incomplete. Unpack the distribution again,
  echo keeping the whole folder together. You do not need to install anything.
  echo.
  pause
  exit /b 9
)

"%MARKET_OS_NODE%" "%~dp0launcher.mjs" --stay
set "MARKET_OS_EXIT=%ERRORLEVEL%"

rem  Hold the window open on failure. Without this a double-clicked launcher
rem  that refuses - a port already in use, a database that belongs to something
rem  else - closes instantly and the user sees nothing at all.
if not "%MARKET_OS_EXIT%"=="0" (
  echo.
  echo Market OS stopped with code %MARKET_OS_EXIT%. The messages above say why.
  pause
)
exit /b %MARKET_OS_EXIT%
