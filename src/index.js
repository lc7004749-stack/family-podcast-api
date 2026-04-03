import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// 全局设置：解决跨域
app.use('/*', cors())

// 辅助函数：为原始 PCM 数据生成标准的 WAV 文件头
function createWavHeader(dataLength, sampleRate = 24000) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true);
    
    let headerStr = '';
    const headerBytes = new Uint8Array(buffer);
    for (let i = 0; i < headerBytes.length; i++) {
        headerStr += String.fromCharCode(headerBytes[i]);
    }
    return headerStr;
}

// ==========================================
// 模块 1：处理抖音链接的专属通道
// ==========================================
app.post('/api/douyin', async (c) => {
  try {
    const body = await c.req.json()
    const douyinUrl = body.url

    if (!douyinUrl) {
      return c.json({ error: '请提供有效的输入内容' }, 400)
    }

    let videoText = douyinUrl
    
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://voice.niuba.xin", 
        "X-Title": "Family Podcast" 
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-audio-preview", 
        modalities: ["text", "audio"],
        audio: {
            voice: "nova", 
            format: "pcm16" // 修改目标 1：顺应 OpenAI 强制要求，改为原始裸数据
        },
        stream: true, 
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

    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let podcastScript = "";
    let base64Audio = "";
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
                try {
                    const data = JSON.parse(trimmedLine.slice(6));
                    const delta = data.choices[0].delta;
                    
                    if (delta.audio) {
                        base64Audio += delta.audio.data || "";
                        podcastScript += delta.audio.transcript || "";
                    }
                    if (delta.content) {
                        podcastScript += delta.content;
                    }
                } catch (e) {}
            }
        }
    }

    // 修改目标 2：将拼接好的裸 PCM16 数据装入 WAV 外壳
    let finalBase64Audio = "";
    if (base64Audio) {
        const pcmBinaryStr = atob(base64Audio); // 解码 Base64 为二进制字符串
        const wavHeaderStr = createWavHeader(pcmBinaryStr.length, 24000); // 戴上音频头
        finalBase64Audio = btoa(wavHeaderStr + pcmBinaryStr); // 重新打包成带头的完整音频发送
    }

    return c.json({
        script: podcastScript || "未生成文字",
        audioBase64: finalBase64Audio ? `data:audio/wav;base64,${finalBase64Audio}` : ""
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
