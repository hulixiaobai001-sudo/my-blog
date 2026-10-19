@echo off
chcp 65001 >nul
echo === D1 数据库备份 ===
set /p name=备份文件名(默认 backup):
if "%name%"=="" set name=backup
set filename=%name%_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%.sql
set filename=%filename: =0%
echo 正在导出到 %filename% ...
npx wrangler d1 export blog-db --remote --output=./backups/%filename%
echo 完成！文件在 backups 目录下。
pause
