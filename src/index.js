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
    if (!rawInput) return c.json({ error: '请输入内容' }, 400)

    // 修改目标 1：精准提取链接。支持您贴的那种带文字的乱码
    const urlRegex = /(https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/)/;
    const match = rawInput.match(urlRegex);
    const cleanUrl = match ? match[1] : rawInput;

    let videoText = "";

    // 修改目标 2：如果提取到了链接，先尝试追踪它的真实文案
    if (cleanUrl.includes('douyin.com')) {
        try {
            // 尝试通过 Gemini 1.5 Pro (能力更强) 来分析，并给它更明确的指令
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;
            const geminiRes = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: `请根据这个抖音视频的描述文字进行创作。如果无法访问，请根据链接前后的上下文文字进行改写。内容：${rawInput}` }]
                    }]
                })
            });
            const geminiData = await geminiRes.json();
            videoText = geminiData.candidates[0].content.parts[0].text;
        } catch (e) {
            videoText = rawInput; // 兜底：解析失败就直接用原始文案
        }
    } else {
        videoText = rawInput;
    }

    // 调用 GPT-4o-audio
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
            content: `你是一个播客。姐姐六年级，弟弟四年级。请改写内容为飞飞老师和小安的对话。
            角度写30°。分数用HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>`
          },
          { role: "user", content: `文案如下：\n${videoText}` }
        ]
      })
    });

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
                    if (data.choices[0].delta.audio) {
                        base64Audio += data.choices[0].delta.audio.data || "";
                        finalScript += data.choices[0].delta.audio.transcript || "";
                    }
                    if (data.choices[0].delta.content) finalScript += data.choices[0].delta.content;
                } catch (e) {}
            }
        }
    }

    // 修改目标 3：修正音频 Base64 拼接
    let finalAudioUrl = "";
    if (base64Audio) {
        const pcmBinaryStr = atob(base64Audio);
        const wavHeaderStr = createWavHeader(pcmBinaryStr.length, 24000);
        finalAudioUrl = `data:audio/wav;base64,${btoa(wavHeaderStr + pcmBinaryStr)}`;
    }

    return c.json({
        script: finalScript,
        audioBase64: finalAudioUrl
    })

  } catch (error) {
    return c.json({ error: `处理出错: ${error.message}` }, 500)
  }
})

export default app
