import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// 全局设置：解决跨域
app.use('/*', cors())

// ==========================================
// 模块 1：处理抖音链接的专属通道（多模态单次调用流）
// ==========================================
app.post('/api/douyin', async (c) => {
  try {
    const body = await c.req.json()
    const douyinUrl = body.url

    if (!douyinUrl) {
      return c.json({ error: '请提供有效的输入内容' }, 400)
    }

    let videoText = douyinUrl
    
    // 修改目标 1：直接向 OpenRouter 请求同时返回“文字+声音”
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://voice.niuba.xin", 
        "X-Title": "Family Podcast" 
      },
      body: JSON.stringify({
        // 启用支持音频的多模态模型
        model: "openai/gpt-4o-audio-preview", 
        // 强制要求模型同时输出文本和声音
        modalities: ["text", "audio"],
        audio: {
            voice: "nova", // nova 是一款极具活力且知性的女声，非常适合科普
            format: "wav"
        },
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
    
    // 修改目标 2：直接从返回结果中剥离出文字和 Base64 音频，删除之前所有导致报错的 TTS 代码
    const message = openRouterData.choices[0].message;
    
    let podcastScript = "未生成文字";
    let base64Audio = "";

    // 多模态模型会将包含 HTML 排版的文本和录音打包放在 message.audio 里
    if (message.audio) {
        podcastScript = message.audio.transcript || message.content || podcastScript;
        base64Audio = `data:audio/wav;base64,${message.audio.data}`;
    } else {
        podcastScript = message.content || podcastScript;
    }

    return c.json({
        script: podcastScript,
        audioBase64: base64Audio
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
