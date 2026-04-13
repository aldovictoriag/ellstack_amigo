@echo off
cd /d cd /d %ELLSTACK_DIR%\bin

chcp 65001

%ELLSTACK_DIR%\bin\llama-server.exe --model %ELLSTACK_DIR%\bin\models\ellstack_aimodel.gguf --ctx-size 4096 --threads 8 --threads-batch 8 --parallel 1 --batch-size 512 --ubatch-size 64 --no-mmap --mlock --host 127.0.0.1 --port 10064 --chat-template chatml 