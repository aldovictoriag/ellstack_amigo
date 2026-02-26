@echo off

ellStackAsyncWSSend.exe stop 
ellStackAsyncWSSend.exe uninstall
ellStackAIApi.exe stop
ellStackAIApi.exe uninstall
bin\service\ellStackAImodel.exe stop
bin\service\ellStackAImodel.exe uninstall
whatsapp_server\ellStackwhatsapp_server.exe stop
whatsapp_server\ellStackwhatsapp_server.exe uninstall
