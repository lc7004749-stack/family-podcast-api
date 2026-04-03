import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

// 辅助函数：WAV 音频头封装（保持不变）
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
    const { url } = await c.req.json()
    if (!url) return c.json({ error: '请输入链接' }, 400)

    // 优先检查 API KEY 是否配置
    if (!c.env.GEMINI_API_KEY || !c.env.OPENROUTER_API_KEY) {
        throw new Error("云端 API 密钥未配置，请检查 Cloudflare 环境变量设置");
    }

    let podcastScript = "";

    // 1. 调用 Gemini 解析内容（这里增加错误捕获，防止因为链接打不开导致整个 500）
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;
        const geminiRes = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `请提取并总结以下内容的主要科技知识点：${url}。如果这是一个链接且你无法访问，请直接根据链接中的文字描述进行创作。` }]
                }]
            })
        });
        const geminiData = await geminiRes.json();
        
        if (geminiData.candidates && geminiData.candidates[0].content.parts[0].text) {
            podcastScript = geminiData.candidates[0].content.parts[0].text;
        } else {
            throw new Error("Gemini 未能生成有效文本");
        }
    } catch (e) {
        // 如果 Gemini 失败，将输入直接视为文案交给下一步，防止 500
        podcastScript = url;
    }

    // 2. 调用 OpenRouter 生成音频和最终文稿
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
        audio: { voice: "nova", format: "pcm16" },
        stream: true,
        messages: [
          {
            role: "system",
            content: `你是一个专为儿童科普的播客。姐姐(六年级)高智商，弟弟(四年级)爱物理。请将内容改写为飞飞老师和小安的对话。
            格式红线：严禁美元符号。角度直接写 30°。分数强制用 HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>`
          },
          { role: "user", content: `根据这些信息创作：\n${podcastScript}` }
        ]
      })
    });

    if (!openRouterRes.ok) {
       const err = await openRouterRes.text();
       throw new Error(`OpenRouter 响应失败: ${openRouterRes.status} - ${err}`);
    }

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
                        finalScript += delta.audio.transcript || "";
                    }
                    if (delta.content) finalScript += delta.content;
                } catch (e) {}
            }
        }
    }

    let finalAudio = "";
    if (base64Audio) {
        const pcmBinaryStr = atob(base64Audio);
        const wavHeaderStr = createWavHeader(pcmBinaryStr.length, 24000);
        finalAudio = btoa(wavHeaderStr + pcmBinaryStr);
    }

    return c.json({
        script: finalScript,
        audioBase64: finalAudio ? `data:audio/wav;base64,${finalAudio}` : ""
    })

  } catch (error) {
    // 这里的报错会显示在 000.html 的状态栏里，方便我们排查
    return c.json({ error: `大脑内部报错: ${error.message}` }, 500)
  }
})

export default app
