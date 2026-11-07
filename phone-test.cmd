@echo off
rem Double-click this file to test the app on your phone over Wi-Fi.
rem It builds the app and serves it at https://<this PC's address>:4173
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\nodejs-portable\node-v26.13.0-win-x64;%PATH%"
echo.
echo  Building MO Hunt Map...
echo  When it says "Network:", type that https:// address into Safari on your iPhone.
echo  (Your phone must be on the same Wi-Fi as this computer.)
echo  Close this window to stop.
echo.
call npm run phone
pause
