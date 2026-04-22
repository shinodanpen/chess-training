@echo off
echo Avvio Chess Training...

start "Chess Training - Backend" cmd /k "cd /d "%~dp0backend" && call "..\venv\Scripts\activate.bat" && uvicorn main:app --reload"

set FRONTEND_URL=http://localhost:5500/?v=%RANDOM%%RANDOM%

start "Chess Training - Frontend" cmd /k "cd /d "%~dp0frontend" && python serve.py"

timeout /t 2 /nobreak > nul

start "" "%FRONTEND_URL%"
