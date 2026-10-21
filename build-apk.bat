@echo off
echo ========================================================
echo   MotoGauge - 1-Click Sync ^& Build APK
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Syncing Web Assets to Android...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Capacitor sync failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Compiling Android Release APK with Gradle...
cd android
call gradlew.bat assembleRelease
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Gradle build failed!
    pause
    exit /b %ERRORLEVEL%
)

cd ..
echo.
echo [3/3] Copying APK to releases folder...
if not exist "releases" mkdir "releases"
copy /y "android\app\build\outputs\apk\release\app-release-unsigned.apk" "releases\MotoGauge.apk"
copy /y "releases\MotoGauge.apk" "..\MotoGauge.apk"

echo.
echo ========================================================
echo   BUILD SUCCESSFUL!
echo   APK saved at:
echo     - motogauge-app\releases\MotoGauge.apk
echo     - MotoGauge.apk (root shortcut)
echo ========================================================
pause
