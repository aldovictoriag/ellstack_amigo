@echo off
cd /d cd /d %ELLSTACK_DIR%\bin

chcp 65001

%ELLSTACK_DIR%\bin\llama-server.exe --model %ELLSTACK_DIR%\bin\models\Llama-3.2-3B-Instruct.Q4_K_M.gguf --ctx-size 1024 --threads 8 --threads-batch 8 --parallel 1 --batch-size 512 --ubatch-size 64 --host 127.0.0.1 --port 11434 --chat-template chatml