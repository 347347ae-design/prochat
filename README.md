# ProChat · 本地直连版

一个只做一件事的安卓 App：**填上你自己的 API Key，直接问你自己的模型**。
没有内置模型、没有中转服务器、没有账号系统——你说的话和模型的回复只在手机和你填的接口之间流动。

GitHub：<https://github.com/347347ae-design/prochat>
APK：[GitHub Releases v1.2.2](https://github.com/347347ae-design/prochat/releases/tag/v1.2.2)（约 526 KB），或本地构建输出 `dist/ProChat-1.2.2.apk`

> 1.2.2 更新：新增「打赏支持」，可在设置里查看微信收款码，并一键保存到相册；收款码完全本地显示，不上传任何内容。
>
> 1.2.1 更新：检查更新和留言板改用固定的 SakuraFrp 地址，不再依赖 Tailscale Funnel；旧默认地址会自动迁移。
>
> 1.2.0 更新：新增「检查更新」和「Bug 反馈 / 留言板」；App 内可直接看更新说明、下载新版，也能像留言板一样反馈问题并看开发者回复。
>
> 1.1.1 没有「检查更新」功能，所以从 1.1.1 升到 1.2.0 需要手动安装一次；从 1.2.0 开始可以在 App 内检查更新。
>
> 1.1.1 更新：内置离线 KaTeX，修复 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 数学公式不渲染的问题。

---

## 怎么装

1. 把 APK 传到手机（微信文件传输 / 数据线 / 网盘都行）。
2. 点开安装，系统会提示「未知来源」——允许一次即可。
3. 桌面出现 ProChat 图标（蓝色渐变 + 白色对话气泡）。

> 这是用本地密钥签名的 APK，不能上架应用商店，但可以正常安装使用。
> 首次安装如果被「安全中心」拦，选「仍然安装」。

## 怎么用

1. 打开 App → 点左上角 **☰ → 设置**（或首页的「添加模型服务」）。
2. **＋ 添加模型服务**：
   - 选一个服务商（DeepSeek / Kimi / 智谱 / 通义 / 硅基流动 / OpenRouter / Groq / OpenAI），
     会自动填好 Base URL、默认模型和一批**内置常用模型**；
   - 信息卡里直接有 **「获取 API Key ↗」** 和 **「充值 / 购买 ↗」** 两个官方入口；
   - 点模型名右边的 **选择** 可以看内置模型，点 **从账号拉取完整列表** 会读你账号下真实可用的模型；
   - 贴上你的 **API Key**，保存。以后可在设置里随时切换或添加多个服务。
3. 回首页直接发消息。支持流式输出、Markdown 表格、LaTeX 公式、代码块一键复制、思考过程折叠。

### 内置的服务商与模型

| 服务商 | 内置模型（示例） | 获取 Key / 充值 |
| --- | --- | --- |
| DeepSeek | `deepseek-flash`、`deepseek-v4-pro` | platform.deepseek.com |
| Kimi | `kimi-k3.1-pro`、`kimi-k3`、`kimi-k2.7-code` | platform.kimi.com |
| 智谱 GLM | `glm-5.3`、`glm-5.3-flash`、`glm-5.2` | bigmodel.cn |
| 通义千问 | `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` | bailian.console.aliyun.com |
| 硅基流动 | `deepseek-ai/DeepSeek-V4.1-Flash`、`DeepSeek-V4-Pro`、`zai-org/GLM-5.3` | cloud.siliconflow.cn |
| OpenRouter | `openai/gpt-6.1-sol`、`claude-sonnet-5.5`、`gemini-4-argon` 等 | openrouter.ai |
| Groq | `openai/gpt-oss-120b`、`qwen/qwen3.8-27b` | console.groq.com |
| OpenAI | `gpt-6.1-sol`、`gpt-6-astra`、`gpt-5.2` | platform.openai.com |

> 模型列表按 **2026 年 10 月** 各厂商公开信息整理，厂商改名/下线很快，实际可用名称以
> 「从账号拉取完整列表」的结果为准。内置入口只负责把网页打开，购买和 Key 都在厂商官网完成。

### 支持哪些服务

只要接口是 **OpenAI 兼容格式**（`POST {baseUrl}/chat/completions`）都行，包括：

- 官方：DeepSeek、月之暗面 Kimi、智谱 GLM、通义千问（compatible-mode）、OpenAI、Groq、OpenRouter、硅基流动
- 各类中转站 / 自建网关：Base URL 填到 `/v1` 那一层即可，`/chat/completions` 会自动补
- 局域网服务（Ollama / LM Studio / one-api 等）：`http://192.168.x.x:端口/v1`，没设 Key 也能用

如果服务商要求额外请求头（比如 OpenRouter 的 Referer），在配置页的
「高级：自定义请求头」里填 JSON，例如：

```json
{ "HTTP-Referer": "https://example.com" }
```

## 功能

- 流式输出，可随时点 ■ 停止
- 多会话列表、自动起标题、删除
- Markdown 渲染（标题 / 列表 / 引用 / 表格 / 行内代码）
- LaTeX 数学公式：`$...$`、`$$...$$`、`\(...\)`、`\[...\]`，也支持直接输出的 `\begin{aligned}` 等环境；KaTeX 已打包进 App，完全离线
- 代码块带语言标签 + 一键复制
- `reasoning_content`（DeepSeek R1 等推理模型）折叠显示「思考过程」
- 图片上传（多模态模型，最多 4 张，自动压缩到 1280px / JPEG）
- 语音输入（调用系统语音识别，边说边出字）
- 系统提示词、上下文条数、温度、最大 tokens 可调
- 深色 / 浅色 / 跟随系统
- 回复下方显示耗时、字数、token 用量，可复制 / 重新生成
- 对话记录存本机文件；API Key 用 Android Keystore AES-GCM 加密后再落盘
- 设置里可检查更新：读远程版本清单，自动比较 versionCode，显示更新说明并可打开新版下载
- Bug 反馈 / 留言板：公开留言、看开发者回复和「已解决」状态；昵称/联系方式选填，联系方式仅管理员可见
- 打赏支持：设置里显示微信收款码，可直接保存到相册；完全自愿，不影响任何功能
- 启动时每天自动检查一次更新，可在设置里关闭

## 隐私

- 没有统计、没有内置模型。
- 聊天内容只会发到你配置的模型接口，不会上传到 ProChat 后端。
- 「检查更新」会读取 `ai.h80b5c8fe.nyat.app:21398` 上的版本清单；「留言板」会把**你主动填写的留言内容、昵称/联系方式（选填）、App 版本和机型**发到同一个后端。不会发送聊天记录、API Key 或图片。
- 留言内容会公开显示；联系方式只有管理员能看到。请不要在留言里写 API Key、密码、聊天隐私等敏感信息。
- 打赏收款码是打包在 App 内的本地图片，只在「设置 → 支持开发」里显示；App 不读取、不保存、也不会上传你的支付信息。是否打赏完全自愿。
- 公开仓库里的 `assets/donate-wechat.jpg` 会随源码和 APK 一起公开；如果你不想公开收款码，替换或删除该图片后重新打包即可。
- 自动检查更新可以在「设置 → 更新与反馈」里关闭。
- 「设置 → 数据 → 清除全部数据」会删掉所有 Key、配置和对话。

## 项目结构 / 重新打包

```
prochat/
├─ AndroidManifest.xml
├─ assets/            界面（HTML/CSS/JS），运行在 WebView 里
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js
│  ├─ donate-wechat.jpg  微信打赏收款码（本地图片）
│  └─ katex/           离线公式渲染（KaTeX，MIT 协议）
├─ java/com/local/prochat/
│  ├─ MainActivity.java    WebView 宿主 + JS 桥（剪贴板/分享/选图/语音/状态栏）
│  ├─ ChatClient.java      OpenAI 兼容接口 + SSE 流式解析（原生网络，无 CORS）
│  ├─ NetClient.java       检查更新 / 留言板的轻量 HTTP 客户端
│  ├─ SecretStore.java     Android Keystore 加密存储 API Key
│  └─ Store.java           会话记录的本地文件存储
├─ server/                 更新清单 + 留言板后端（Node，无第三方依赖）
│  ├─ server.js
│  ├─ admin.html           管理后台（回复、隐藏、删除、发布更新）
│  ├─ board.html           网页版公开留言板
│  ├─ config.example.json  配置模板（真实 config.json 不提交）
│  └─ public/              update.json（发布物）
├─ res/                   图标、主题
├─ tools/
│  ├─ make-icons.ps1      生成启动图标
│  ├─ preview-server.js   桌面预览用静态服务器
│  └─ preview-frame.html  手机尺寸预览外壳
├─ build.local.example.ps1 本地签名配置模板（真实 build.local.ps1 不提交）
├─ build.ps1              打包脚本（aapt2 → javac → d8 → 规范化 assets → zipalign → apksigner）
└─ dist/                  本地构建产物（不提交；APK 见 GitHub Releases）
```

> 仓库不包含 `prochat.jks`、`server/config.json`、`server-admin.txt`、`build.local.ps1`、`build/`、`dist/` 和 APK 构建产物。

推送 `v*` 标签会触发 `.github/workflows/release.yml`：从固定地址下载 APK、校验 SHA-256，然后自动创建 GitHub Release。发布新版本前，先添加对应的 `.github/checksums/vX.Y.Z.sha256` 和 `.github/release-notes-X.Y.Z.md`。

打包（Windows，需要 JDK 17 + Android SDK build-tools 34）：

```powershell
Copy-Item .\build.local.example.ps1 .\build.local.ps1
# 编辑 build.local.ps1，填入你的签名库口令；或设置环境变量 PROCHAT_KS_PASS
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

不依赖 Gradle，所以整个构建几秒钟完成，APK 只有 520 KB 左右（其中约 250 KB 是离线公式字体，约 150 KB 是打赏收款码）。
`prochat.jks` 是本次使用的签名文件，**仓库不包含它**；以后升级必须用同一个文件签名，
否则不能覆盖安装。想换成自己的签名，生成新的 keystore 后重新打包即可。不要把 keystore、口令或 `build.local.ps1` 提交到仓库。

## 更新与留言板后端

当前后端部署在同一台 Debian 服务器上，公网入口使用固定的 SakuraFrp 隧道：

- 基础地址：<https://ai.h80b5c8fe.nyat.app:21398/prochat>
- 公开留言板：<https://ai.h80b5c8fe.nyat.app:21398/prochat/board>
- 管理后台：`/prochat/admin?token=...`（完整地址和口令只保存在本机 `server-admin.txt`，不提交）
- 更新清单：`/prochat/update.json`
- APK 目录：`/prochat/ProChat-<版本>.apk`

SakuraFrp 隧道名 `prochat`，本机服务 `prochat-sakura`，隧道 ID `29674631`，远程端口 `21398`，子域名 `ai.h80b5c8fe.nyat.app` 已绑定到该隧道。旧的 Tailscale Funnel 入口仍保留作备用。

服务端源码在 `server/`，无第三方依赖，数据存 `data/feedback.json`。系统服务名 `prochat-feedback`，目录 `/opt/prochat-feedback`，Nginx 片段 `/etc/nginx/snippets/prochat.conf`。

发布新版本：

1. 改 `AndroidManifest.xml` 的 `versionCode` / `versionName`，并把 `build.ps1` 里的 `apkName` 改掉。
2. 运行 `build.ps1`。
3. 把 APK 传到服务器：`scp dist/ProChat-x.y.z.apk root@<your-server>:/opt/prochat-feedback/public/`。
4. 在管理后台「发布更新」里填 versionCode、版本名、下载地址和更新说明，保存即可。

> 后端地址如果变了，普通用户可以在「设置 → 更新与反馈 → 高级：更新 / 留言服务地址」里改，不需要重新打包。

## 已知限制

- 只支持 OpenAI 兼容的 `/chat/completions`；Claude / Gemini 原生协议不在范围内（可以用它们各自的 OpenAI 兼容层或中转）。
- 图片上传要模型本身支持视觉，不然接口会报错。
- 语音识别依赖手机上的语音服务（Google 语音服务或厂商自带），没有的话按钮会提示不可用。
- 会话记录不加密（只有 API Key 加密），因为要存图片和长文本；敏感内容建议及时清理。
- 公式渲染使用本地 KaTeX：遇到不支持的 LaTeX 命令会按原文显示，不会让页面报错。
- 为避免把价格当成公式，`$...$` 会跳过纯数字、代码块和行内代码里的内容；复杂公式建议写在 `$$...$$` 里。
- 检查更新和留言板依赖 `ai.h80b5c8fe.nyat.app:21398` 这台服务器；服务器、SakuraFrp 隧道或网络不可用时，会显示请求失败。聊天功能直连模型接口，不受影响。
- 留言板没有账号系统，靠 IP 频率限制防刷；留言公开可见，不要填写敏感信息。
- 本版本在桌面浏览器预览和真实后端接口上验证过；真机上的原生 HTTP 桥、Keystore、语音、选图仍需安装后实际确认。
