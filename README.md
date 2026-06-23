# Subconverter One-Click

一个包含前端网页和 [tindy2013/subconverter](https://github.com/tindy2013/subconverter) 后端的订阅转换项目。前端参考 `tools.huanghaiwan.com/tools/sub-converter.html` 的工具页交互，支持把 V2Ray 订阅链接转换为 Clash 等格式。

## 目录结构

```text
subconverter-oneclick/
├── public/                 # 前端页面
├── server.js               # Node.js 静态服务 + subconverter 代理
├── docker-compose.yml      # Ubuntu 一键部署
├── Dockerfile              # 前端服务镜像
├── dev-subconverter.ps1    # Windows 本地启动 subconverter 后端
├── dev-subconverter.sh     # Linux/macOS 本地启动 subconverter 后端
└── test/smoke.js           # 基础冒烟测试
```

## Ubuntu 服务器部署

服务器需要安装 Docker Engine 和 Docker Compose 插件。

上传项目后进入目录：

```bash
cd /opt/subconverter-oneclick
```

复制端口配置：

```bash
cp .env.example .env
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://服务器IP:3000
```

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

更新代码后重新部署：

```bash
docker compose up -d --build
```

## 修改网页端口

编辑 `.env`：

```env
WEB_PORT=8080
```

重启：

```bash
docker compose up -d
```

访问地址变为：

```text
http://服务器IP:8080
```

## Windows 本地开发调试

安装 Node.js 18 或更高版本，并确保 Docker Desktop 可用。

安装依赖：

```powershell
npm install
```

启动 subconverter 后端：

```powershell
.\dev-subconverter.ps1
```

新开一个 PowerShell 窗口启动前端：

```powershell
$env:SUBCONVERTER_URL="http://127.0.0.1:25500"
npm run dev
```

访问：

```text
http://127.0.0.1:3000
```

## 本地 Docker Compose 联调

Windows、Linux、macOS 都可以直接运行：

```bash
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:3000
```

## Nginx 反向代理

绑定域名时，可以让 Nginx 反代到 `WEB_PORT`：

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 接口

- `GET /health`：前端服务健康检查。
- `GET /api/convert/status`：检查 subconverter 后端状态。
- `GET /api/convert?target=clash&url=...`：输出转换后的订阅内容。

常用参数：

- `url`：原始订阅链接。
- `target`：目标格式，默认 `clash`。
- `config`：远程配置文件地址。
- `emoji`：是否启用 Emoji。
- `udp`：是否启用 UDP。
- `sort`：是否排序。
- `prefix`：目标为 Clash 时，给节点名称增加前缀，并同步更新代理组引用。

## 验证

```bash
npm test
```

如果本机安装了 Docker，可以检查 Compose 配置：

```bash
docker compose config
```
