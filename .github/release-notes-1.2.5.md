## ProChat 1.2.5

- 语音输入默认改为接口转写，不再依赖谷歌语音服务
- 支持硅基流动 SenseVoice、OpenAI Whisper 等 OpenAI 兼容 `/audio/transcriptions` 接口
- 设置 → 语音输入可单独配置转写模型、Base URL 和 Key
- 屏幕左右边缘向内滑动可返回上一页，同时兼容系统手势返回
- 保留 1.2.4 的更新公告、打赏和图片上传

### 语音转写怎么配

- 硅基流动：Base URL `https://api.siliconflow.cn/v1`，模型 `FunAudioLLM/SenseVoiceSmall`
- OpenAI：Base URL `https://api.openai.com/v1`，模型 `whisper-1`
- 转写 Key 留空时使用当前模型服务的 Key

**APK SHA-256**

```text
952e209e9e58d046821903f7c96d779de6256749a753ee3d9256e8362a36f36b
```

下载后请核对哈希。这个版本使用与 1.2.4 相同的签名，可直接覆盖安装，数据保留。
