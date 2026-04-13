@echo off
cd /d %ELLSTACK_DIR%

chcp 65001

REM Check if virtual environment exists
IF NOT EXIST "%ELLSTACK_DIR%\venv\" (
    echo Virtual environment not found. Creating...
    call conf_py_env.bat
) ELSE (
    echo Virtual environment already exists.
)


%ELLSTACK_DIR%\venv\Scripts\python.exe ellStackAsyncWSSend.py