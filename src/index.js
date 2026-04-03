import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

function createWavHeader(dataLength, sampleRate = 24000) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + dataLength, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(40, dataLength, true);
    let headerStr = '';
    const headerBytes = new Uint8Array(buffer);
    for (let i = 0; i < headerBytes.length; i++) headerStr += String.fromCharCode(headerBytes[i]);
    return headerStr;
}

app.post('/api/douyin', async (c) => {
  try {
    const { url: rawInput } = await c.req.json()
    if (!rawInput) return c.json({ error: '内容为空' }, 400)

    // 1. 强力提取：把抖音链接和标题文字抠出来，扔掉“复制打开”等废话
    const urlMatch = rawInput.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\//);
    const cleanUrl = urlMatch ? urlMatch[0] : "";
    // 剔除乱码干扰，只保留有意义的文字部分
    const cleanText = rawInput.replace(/https?:\/\/\S+/g, '').replace(/[a-zA-Z0-9\/@:.]/g, '').trim();

    // 2. 第一步：让 Gemini 必须输出原始知识点（加固指令）
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `你是一个知识提取助手。请忽略视频链接中的垃圾干扰信息，只提取视频标题中的核心科技知识点。内容如下：${rawInput}` }]
            }]
        })
    });
    const geminiData = await geminiRes.json();
    const coreFact = geminiData.candidates[0].content.parts[0].text;

    // 3. 第二步：调用 GPT-4o-audio 强制执行剧本并生成音频
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-audio-preview", 
        modalities: ["text", "audio"],
        audio: { voice: "nova", format: "pcm16" },
        stream: true,
        messages: [
          {
            role: "system",
            content: `【绝对指令】
你现在是两名播客主持人：飞飞老师（百科全书式的老师）和小安（爱问为什么的四年级学生）。
请根据用户提供的知识点，即兴创作一段充满好奇心和硬核科学原理的对话。
针对姐姐（六年级ADHD）：多用发散思维，赞美奇思妙想。
针对弟弟（四年级）：多讲物理机械构造。

格式要求：
- 严禁美元符号，角度用30°。
- 分数强制用HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>`
          },
          { role: "user", content: `今天我们要聊的主题是：\n${coreFact}` }
        ]
      })
    });

    // 后续流式拼接音频逻辑保持不变
    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let finalScript = "";
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
                        if (delta.audio.transcript) finalScript += delta.audio.transcript;
                    }
                    if (delta.content) finalScript += delta.content;
                } catch (e) {}
            }
        }
    }

    let finalAudioUrl = "";
    if (base64Audio) {
        const pcmBinaryStr = atob(base64Audio);
        const wavHeaderStr = createWavHeader(pcmBinaryStr.length, 24000);
        finalAudioUrl = `data:audio/wav;base64,${btoa(wavHeaderStr + pcmBinaryStr)}`;
    }

    return c.json({
        script: finalScript || "音频生成失败，请检查提示词或模型余额",
        audioBase64: finalAudioUrl
    })

  } catch (error) {
    return c.json({ error: `处理出错: ${error.message}` }, 500)
  }
})

export default app
