import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// 全局设置：解决跨域
app.use('/*', cors())

// ==========================================
// 模块 1：处理抖音链接的专属通道（双发流：文本+音频）
// ==========================================
app.post('/api/douyin', async (c) => {
  try {
    const body = await c.req.json()
    const douyinUrl = body.url

    if (!douyinUrl) {
      return c.json({ error: '请提供有效的输入内容' }, 400)
    }

    let videoText = douyinUrl
    
    // 第 1 步：调用大模型生成带有格式的文稿
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://voice.niuba.xin", 
        "X-Title": "Family Podcast" 
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini", // 使用您验证成功的模型
        messages: [
          {
            role: "system",
            content: `你是一个专为儿童进行硬核科技科普的AI家庭播客引擎。
听众画像：
1. 姐姐（六年级）：高智商、思维跳跃。请多肯定奇思妙想，将枯燥技术转化为关于人类、艺术或未来的哲学探讨，帮她克服自我怀疑。
2. 弟弟（四年级）：冷静理性，喜欢物理、天文和手工。请多用具体的物理逻辑解释机械原理（如力矩、重心）。

知识点参考：你可以提到李飞飞、吴恩达或马斯克的最新观点。
格式红线（绝对禁令）：
1. 严禁使用任何美元符号进行公式渲染。
2. 角度直接使用普通文本标号（如 30°、180°）。
3. 但凡涉及分数，绝对不允许使用斜杠形式，必须严格使用以下 HTML 配合内联 CSS 实现标准的“上下结构”，并确保与普通文本垂直居中对齐：
<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>

输出格式：飞飞老师和小安的对话体。`
          },
          { role: "user", content: `请改写这段视频文案：\n${videoText}` }
        ]
      })
    });

    if (!openRouterRes.ok) {
       const errorDetail = await openRouterRes.text();
       throw new Error(`OpenRouter 报错: ${openRouterRes.status} - ${errorDetail}`);
    }

    const openRouterData = await openRouterRes.json();
    const podcastScript = openRouterData.choices[0].message.content;

    // 第 2 步：清洗文本给 TTS 语音引擎（正则过滤掉 span 等排版 HTML 标签，避免被读出来）
    const pureTextForTTS = podcastScript.replace(/<[^>]+>/g, '');

    // 第 3 步：调用 TTS 高级语音接口 (如果您的代理地址不同，请替换为对应的 baseURL)
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        input: pureTextForTTS,
        voice: "nova" // nova 音色非常有活力且知性，极其适合家庭播客场景
      })
    });

    if (!ttsRes.ok) {
        const ttsError = await ttsRes.text();
        throw new Error(`TTS生成报错: ${ttsRes.status} - ${ttsError}`);
    }

    // 第 4 步：将二进制音频流转换为 Base64 字符串
    const audioArrayBuffer = await ttsRes.arrayBuffer();
    const base64Audio = btoa(
        new Uint8Array(audioArrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
        )
    );

    // 第 5 步：以 JSON 格式同时返回文稿和音频数据
    return c.json({
        script: podcastScript,
        audioBase64: `data:audio/mpeg;base64,${base64Audio}`
    })

  } catch (error) {
    return c.json({ error: `处理出错: ${error.message}` }, 500)
  }
})

// ==========================================
// 模块 2：为未来预留的 YouTube 通道
// ==========================================
app.post('/api/youtube', async (c) => {
    return c.text("YouTube 模块搭建中...")
})

export default app
