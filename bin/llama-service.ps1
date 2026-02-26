$exe = "C:\llama\lama-server.exe"
$args = @(
    "--model C:\llama\bin\models\Llama-3.2-3B-Instruct.Q4_K_M.gguf",
    "--ctx-size 1024",
    "--threads 8",
    "--threads-batch 8",
    "--parallel 1",
    "--batch-size 512",
    "--ubatch-size 64",
    "--host 127.0.0.1",
    "--port 11434",
    "--chat-template chatml"
)

while ($true) {
    Write-Output "Starting llama-server..."
    $process = Start-Process -FilePath $exe -ArgumentList $args -NoNewWindow -PassThru -Wait
    Write-Output "llama-server stopped. Restarting in 5 seconds..."
    Start-Sleep -Seconds 5
}