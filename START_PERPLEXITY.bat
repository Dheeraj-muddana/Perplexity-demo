@echo off
title Perplexity Clone Launcher
echo Starting Unified Perplexity Clone...
echo.

:: Try common python commands
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using 'python' to start server...
    python app.py
    goto end
)

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using 'py' to start server...
    py app.py
    goto end
)

where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using 'python3' to start server...
    python3 app.py
    goto end
)

echo ERROR: Python was not found in your system path.
echo Please make sure Python is installed and added to PATH.
pause

:end
pause
