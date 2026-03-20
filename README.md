# reshunter

## 测试网页

仓库内提供了一个本地测试站点，用来验证扩展的完整流程：

- 当前页扫描 `SelectClick(...)`
- 进入子页面后扫描 `opwin(...)` 附件
- 识别静态链接中的 PDF / Word / Excel / 图片 / 压缩包
- 选择资源并下载到本地目录

### 启动方式

在仓库根目录执行：

```bash
python3 -m http.server 8000
```

然后在浏览器里访问：

- `http://127.0.0.1:8000/test-site/index.html`

### 页面说明

- `test-site/index.html`：根页面，包含 `SelectClick(...)` 入口、静态资源和 `opwin(...)` 附件。
- `test-site/child-a.html`：子页面 A，包含 `opwin(...)` 附件和静态图片链接。
- `test-site/child-b.html`：子页面 B，包含 `opwin(...)` 附件、压缩包和 Excel 链接。

测试资源文件都使用文本占位内容，仅通过文件扩展名模拟 PDF / Word / Excel / 图片 / 压缩包，避免引入二进制文件。
