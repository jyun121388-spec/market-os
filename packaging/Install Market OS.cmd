@echo off
rem ---------------------------------------------------------------------------
rem  Run this once, before "Market OS.cmd".
rem
rem  It creates a PostgreSQL cluster this application owns, a database inside it,
rem  and the market-os.json that tells the launcher how to reach them. It refuses
rem  to touch a directory that already contains anything, and refuses an existing
rem  Market OS database whose configuration has gone missing, because the fix
rem  that looks obvious there would destroy the data.
rem
rem  Running it twice is safe: the second run reports ALREADY_INSTALLED and
rem  changes nothing.
rem
rem  Like the launcher, this uses the runtime bundled beside it and nothing else.
rem  An installer that asks the user to install Node.js first has not installed
rem  anything.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "MARKET_OS_NODE=%~dp0node\node.exe"
if not exist "%MARKET_OS_NODE%" (
  echo.
  echo Market OS cannot install: its bundled runtime is missing.
  echo.
  echo Expected: %MARKET_OS_NODE%
  echo.
  echo This copy of Market OS is incomplete. Unpack the distribution again,
  echo keeping the whole folder together. You do not need to install anything.
  echo.
  pause
  exit /b 9
)

"%MARKET_OS_NODE%" "%~dp0install.mjs" %*
set "MARKET_OS_EXIT=%ERRORLEVEL%"

rem  Always pause. Unlike the launcher, this window is the ONLY place the result
rem  of an installation is reported, and a double-clicked installer that closes
rem  instantly is indistinguishable from one that never ran.
echo.
if "%MARKET_OS_EXIT%"=="0" (
  echo Installation finished. Start Market OS with "Market OS.cmd".
) else (
  echo Installation did not complete ^(code %MARKET_OS_EXIT%^). The messages above say why.
)
pause
exit /b %MARKET_OS_EXIT%
