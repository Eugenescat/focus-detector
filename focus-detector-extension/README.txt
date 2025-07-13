# Focus Detector Extension 依赖说明

请将以下 JS 依赖下载到本扩展目录下（与 manifest.json 同级）：

1. Chart.js
   - 下载地址：https://cdn.jsdelivr.net/npm/chart.js/dist/chart.min.js
   - 保存为：chart.min.js

2. chartjs-adapter-date-fns
   - 下载地址：https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js
   - 保存为：chartjs-adapter-date-fns.bundle.min.js

3. face-api.js
   - 下载地址：https://unpkg.com/face-api.js/dist/face-api.min.js
   - 保存为：face-api.min.js

下载后，确保 popup.html 中的 <script> 标签引用的就是这些本地文件。

如遇到 CSP 报错，务必检查文件是否已下载并命名正确。 