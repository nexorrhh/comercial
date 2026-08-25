@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo No existe el archivo .env todavia.
  copy ".env.example" ".env" >nul
  echo Se creo .env a partir de .env.example.
  echo Complet lo con las claves de Supabase antes de continuar ^(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL^).
  notepad ".env"
)

if not exist "node_modules" (
  echo Instalando dependencias ^(primera vez, puede tardar unos minutos^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo Fallo "npm install". Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
)

echo Iniciando el sistema de cotizaciones en http://localhost:3000 ...
start "" "http://localhost:3000"
call npm start

pause
