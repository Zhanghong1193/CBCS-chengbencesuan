# GitHub 上传说明

1. 新建仓库时使用名称 `CBCS-chengbencesuan`。
2. 打开本文件所在的终版文件夹，选中里面的全部文件和文件夹上传到仓库根目录。不要把外层“CBCS-chengbencesuan-终版”文件夹整体套进仓库。
3. 上传完成后进入仓库的 `Settings → Pages`。
4. 在 `Build and deployment` 中选择 `Deploy from a branch`。
5. 分支选择 `main`，目录选择 `/docs`，然后保存。
6. 等待 GitHub Pages 发布完成后，访问 `https://你的用户名.github.io/CBCS-chengbencesuan/`。

`docs` 是已构建的网页成品；`src`、`server` 和 `tests` 是完整源代码。GitHub Pages 只能展示前端页面，登录、保存、导入和导出仍需部署 Node.js 后端。
