@echo off
chcp 65001 >nul
echo 正在扫描图片路径...

:: 生成缩略图数组
(echo window.CARD_THUMBS = [) > preload-list.js
for %%f in (卡牌\缩略卡\*) do (
    echo   "卡牌/缩略卡/%%~nxf", >> preload-list.js
)
(echo ];) >> preload-list.js

:: 生成高清图数组
(echo window.CARD_HD = [) >> preload-list.js
for %%f in (卡牌\高清卡\*) do (
    echo   "卡牌/高清卡/%%~nxf", >> preload-list.js
)
(echo ];) >> preload-list.js

echo 生成完毕！请查看根目录下的 preload-list.js
pause