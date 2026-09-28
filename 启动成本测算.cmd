@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\ goto missing
if not exist dist\server.js call node_modules\.bin\vite.cmd build
if not exist dist\server.js call node_modules\.bin\esbuild.cmd server\index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist\server.js
node dist\server.js
pause
exit /b
:missing
echo 尚未安装依赖，请先在本目录运行 pnpm install。
pause
