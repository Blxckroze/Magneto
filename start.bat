@echo off
cd /d "%~dp0"
title Magneto v2 — AI Digital Product Machine

echo.
echo  ==========================================
echo   magneto v2  ^|  Sin Studio
echo  ==========================================
echo.

REM ── Create .env from example if missing ──
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul 2>&1
    echo  [SETUP] .env created from .env.example
  ) else (
    echo  [SETUP] Creating blank .env...
    echo # Add your API keys below> .env
    echo GROQ_API_KEY=>> .env
    echo DEEPSEEK_API_KEY=>> .env
    echo FAL_API_KEY=>> .env
    echo GUMROAD_ACCESS_TOKEN=>> .env
  )
  echo.
  echo  ┌─────────────────────────────────────────────┐
  echo  │  FIRST-TIME SETUP — Add Your API Keys       │
  echo  │                                             │
  echo  │  Notepad is opening your .env file.         │
  echo  │                                             │
  echo  │  Fill in at least one AI key:               │
  echo  │    GROQ_API_KEY   — free at groq.com        │
  echo  │    DEEPSEEK_API_KEY — cheap at deepseek.com │
  echo  │                                             │
  echo  │  Optional:                                  │
  echo  │    FAL_API_KEY   — Flux images (fal.ai)     │
  echo  │    GUMROAD_ACCESS_TOKEN — publish to store  │
  echo  │                                             │
  echo  │  Save the file, CLOSE Notepad, then press   │
  echo  │  any key here to start Magneto.             │
  echo  └─────────────────────────────────────────────┘
  echo.
  notepad ".env"
  echo  Waiting for you to close Notepad...
  echo  Press any key when ready to start...
  pause >nul
  echo.
)

REM ── Install Node deps if needed ──
if not exist "node_modules" (
  echo  [SETUP] Installing Node.js dependencies (one time only)...
  call npm install
  if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed.
    echo  Make sure Node.js is installed: https://nodejs.org/
    pause
    exit /b 1
  )
  echo.
)

REM ── Check Python + ReportLab for PDF export ──
python --version >nul 2>&1
if errorlevel 1 (
  echo  [INFO] Python not found — PDF export will be disabled.
  echo         Get Python at https://python.org if you want PDFs.
  echo.
) else (
  python -c "import reportlab" >nul 2>&1
  if errorlevel 1 (
    echo  [SETUP] Installing PDF library (reportlab)...
    pip install reportlab pillow >nul 2>&1 || python -m pip install reportlab pillow >nul 2>&1
  )
)

REM ── Find local network IP for phone/sharing access ──
set NET_IP=
for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress" 2^>nul') do set NET_IP=%%i

echo  ==========================================
echo   Magneto is running!
echo  ==========================================
echo.
echo  On THIS computer:
echo    http://localhost:3002
echo.
if not "%NET_IP%"=="" (
  echo  On your PHONE or other devices (same WiFi):
  echo    http://%NET_IP%:3002
  echo.
  echo  Share that link with anyone on your network.
  echo  They just open it in their phone browser — no install needed.
  echo.
)
echo  Press Ctrl+C to stop the server.
echo  ==========================================
echo.
start "" "http://localhost:3002"
node magneto_server.js

echo.
echo  Server stopped.
pause
