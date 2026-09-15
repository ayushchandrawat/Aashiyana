
Set-Location "D:\Aashiyana"

docker compose up -d

Start-Sleep -Seconds 3

Start-Process "http://localhost:8091"

