@echo off
title Sistem Manajemen Invoice & Piutang
echo ==========================================================
echo   Menjalankan Sistem Manajemen Invoice & Piutang...
echo ==========================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
