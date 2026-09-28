# GitHub 上传说明

1. 新建仓库时使用名称 `CBCS-chengbencesuan`。
2. 打开本文件所在的终版文件夹，选中里面的全部文件和文件夹上传到仓库根目录。不要把外层“CBCS-chengbencesuan-终版”文件夹整体套进仓库。
3. 上传完成后进入仓库的 `Settings → Pages`。
4. 在 `Build and deployment` 的 `Source` 中选择 `GitHub Actions`。
5. 打开仓库的 `Actions` 页面，等待 `Deploy GitHub Pages` 显示绿色成功标记。
6. 发布完成后访问 `https://你的用户名.github.io/CBCS-chengbencesuan/`。后续推送到 `main` 分支时会自动重新构建和发布。

`docs` 是已构建的网页成品；`src`、`server` 和 `tests` 是完整源代码。GitHub Pages 只能展示前端页面，登录、保存、导入和导出仍需部署 Node.js 后端。
