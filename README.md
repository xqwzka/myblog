# 分类文章发布演示项目

这是一个可本地运行的前后端项目，保留了你原先页面的 UI 风格，并做了以下改造：

- 分类改为后端管理（后台输入分类名）
- 后台可发布文章（标题、简介、正文、分类）
- 后台可单独进入编辑页修改已发布文章
- 后台可配置网站名称、首页主标题、首页主标题下简介
- 支持外部教程直链导入：自动抓取标题、简介、正文并填充到编辑器
- 正文支持 `富文本 / Markdown / HTML 源码 / 纯文本` 四种模式
- 支持常用格式：代码块、行内代码、引用、分割线、标题、列表、表格、链接、图片
- 图片上传保存到站内 `public/uploads`
- 前台支持两种视图：模块视图 / 列表视图（右下角图标切换）
- 模块视图按分类展示文章标题
- 列表视图为每行一篇文章
- 点击文章标题可进入详情页
- 后台支持删除分类（分类下有文章时会阻止删除）

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 启动服务

```bash
npm start
```

3. 打开页面

- 前台展示：`http://localhost:3000/`
- 后台管理：`http://localhost:3000/admin`
- 文章编辑：`http://localhost:3000/admin/article/<文章ID>/edit`
- 文章详情：`http://localhost:3000/article/<文章ID>`

## 目录结构

- `server.js`：后端 API + 静态资源服务
- `data/db.json`：本地数据文件
- `public/index.html`：前台页面
- `public/admin.html`：后台页面
- `public/admin-article-edit.html`：文章独立编辑页面
- `public/article.html`：文章详情页

## API 简述

- `GET /api/bootstrap`：获取分类和文章
- `GET /api/settings`：获取站点设置
- `PUT /api/settings`：更新站点设置
- `POST /api/import-url`：根据外部链接抓取标题与正文
- `POST /api/categories`：新增分类
- `DELETE /api/categories/:id`：删除分类
- `POST /api/articles`：发布文章
- `PUT /api/articles/:id`：更新文章
- `GET /api/articles/:id`：获取单篇文章详情
- `POST /api/uploads/image`：上传正文图片

你在后台创建分类或发布文章后，数据会写入 `data/db.json`，刷新前台即可看到更新。
