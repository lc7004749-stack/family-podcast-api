import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

// ---------------------------------------------------------
// 核心逻辑：免费调用微软 Edge TTS 接口 (不需要 API Key)
// ---------------------------------------------------------
async function getEdgeTTS(text) {
    // 使用微软 Edge 的公共语音合成接口（云希音色：知性、稳重）
    const voice = "zh-CN-YunxiNeural"; 
    const pitch = "+0Hz";
    const rate = "+10%"; // 语速稍微快一点点，更有活力
    
    const endpoint = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/single/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D30499D648`;
    
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
        <voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}'>${text}</prosody></voice>
    </speak>`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
        },
        body: ssml
    });

    if (!response.ok) throw new Error("TTS语音合成失败");
    return await response.arrayBuffer();
}

app.post('/api/douyin', async (c) => {
  try {
    const { url: rawInput } = await c.req.json()
    if (!rawInput) return c.json({ error: '内容为空' }, 400)

    // 1. 提取链接和文案
    const urlMatch = rawInput.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\//);
    const cleanUrl = urlMatch ? urlMatch[0] : "";

    // 2. 调用 Gemini 1.5 Flash 生成剧本（完全免费）
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `
你现在是两名播客主持人：飞飞老师和小安。
请根据以下内容，为六年级高智商姐姐和四年级理科弟弟创作一段硬核科技对话。
内容：${rawInput}

格式要求：
- 严禁美元符号，角度用30°。
- 分数强制用HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>
- 请直接输出对话内容，不要有任何开场白。` }]
            }]
        })
    });

    const geminiData = await geminiRes.json();
    if (!geminiData.candidates) throw new Error("Gemini 思考罢工了，请检查 API Key");
    
    const podcastScript = geminiData.candidates[0].content.parts[0].text;

    // 3. 清洗 HTML 标签（TTS 引擎不能读出 span 标签）
    const pureText = podcastScript.replace(/<[^>]+>/g, '');

    // 4. 调用免费的 Edge TTS 生成音频
    const audioBuffer = await getEdgeTTS(pureText);
    
    // 5. 转换为 Base64 发给前端
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return c.json({
        script: podcastScript,
        audioBase64: `data:audio/mpeg;base64,${base64Audio}`
    })

  } catch (error) {
    return c.json({ error: `大脑报错: ${error.message}` }, 500)
  }
})

export default app
