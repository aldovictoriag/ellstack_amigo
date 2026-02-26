@echo off

python -m venv venv

venv\Scripts\python.exe -m pip install --upgrade pip
venv\Scripts\python.exe -m pip install langchain chromadb fastapi uvicorn sentence-transformers faiss-cpu redis pywin32
venv\Scripts\python.exe -m pywin32_postinstall -install

