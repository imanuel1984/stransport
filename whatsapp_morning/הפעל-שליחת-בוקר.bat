@echo off
chcp 65001 >nul
title שליחת בוקר טוב להורים - וואטסאפ
cd /d "%~dp0"

if not exist "node_modules" (
    echo מתקין חבילות בפעם הראשונה...
    call npm install
    if errorlevel 1 (
        echo.
        echo שגיאה: צריך להתקין Node.js מ- https://nodejs.org
        pause
        exit /b 1
    )
    echo.
)

echo מפעיל את שליחת הבוקר. סרוק QR אם מופיע.
echo לסגירה: סגור את החלון או לחץ Ctrl+C.
echo.
call npm start
pause
