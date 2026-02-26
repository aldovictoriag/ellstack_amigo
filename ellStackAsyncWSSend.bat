@echo off
cd /d %ELLSTACK_DIR%

chcp 65001

%ELLSTACK_DIR%\venv\Scripts\python.exe ellStackAsyncWSSend.py