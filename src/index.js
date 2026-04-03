import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

// 辅助函数：WAV 音频头封装（保持不变，用于最后的语音输出）
function createWavHeader(dataLength, sampleRate = 24000) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + dataLength, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint16(20, 1, true);
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

    // 1. 调用 Gemini 1.5 Flash 直接理解视频内容
    // 注意：Gemini 免费版支持通过 file_uri 或直接上传理解视频
    // 这里我们构建一个请求，让 Gemini 充当解析器 + 改写者
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `你现在是一个短视频内容提取器。请先观看并理解这个视频的内容：${url}。
            然后，请基于视频内容，为我的孩子创作一段播客：
            - 角色：飞飞老师和小安。
            - 听众：六年级高智商姐姐（需鼓励）、四年级理科弟弟（爱手工、物理逻辑）。
            - 格式红线：严禁美元符号。角度写30°。分数强制用HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>
            - 请直接输出最终对话。` }
          ]
        }]
      })
    });

    const geminiData = await geminiRes.json();
    const podcastScript = geminiData.candidates[0].content.parts[0].text;

    // 2. 将文稿送入语音生成 (维持您之前的 GPT-4o-audio 或 TTS 逻辑)
    // 这里为了演示，我们直接复用您成功的 GPT-4o-audio 逻辑来生成声音
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
        messages: [{ role: "user", content: `请朗读以下文稿：\n${podcastScript}` }]
      })
    });

    // 3. 流式组装语音 (逻辑同前)
    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
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
                    if (data.choices[0].delta.audio) {
                        base64Audio += data.choices[0].delta.audio.data || "";
                    }
                } catch (e) {}
            }
        }
    }

    let finalBase64Audio = "";
    if (base64Audio) {
        const pcmBinaryStr = atob(base64Audio);
        const wavHeaderStr = createWavHeader(pcmBinaryStr.length, 24000);
        finalBase64Audio = btoa(wavHeaderStr + pcmBinaryStr);
    }

    return c.json({
        script: podcastScript,
        audioBase64: finalBase64Audio ? `data:audio/wav;base64,${finalBase64Audio}` : ""
    })

  } catch (error) {
    return c.json({ error: `处理出错: ${error.message}` }, 500)
  }
})

export default app
