import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

/**
 * 核心逻辑：获取微软 Edge TTS 音频 (mp3)
 * 修复了 Cloudflare 环境下二进制处理的兼容性问题
 */
async function getEdgeTTS(text) {
    const voice = "zh-CN-YunxiNeural"; // 晓晓音色：zh-CN-XiaoxiaoNeural，云希音色：zh-CN-YunxiNeural
    const endpoint = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/single/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D30499D648`;
    
    // 构造标准的 SSML 格式
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
        <voice name='${voice}'><prosody pitch='+0Hz' rate='+15%'>${text}</prosody></voice>
    </speak>`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        body: ssml
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS服务请求失败: ${response.status} - ${errorText}`);
    }
    return await response.arrayBuffer();
}

app.post('/api/douyin', async (c) => {
  try {
    const body = await c.req.json();
    const rawInput = body.url;
    
    if (!rawInput) return c.json({ error: '内容为空' }, 400);

    // 1. 调用 Gemini 1.5 Flash 生成剧本
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`;
    
    const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `
你现在是两名科技播客主持人：飞飞老师和小安。
请忽略输入内容中的链接乱码和分享语，仅提取核心科技点，并为六年级姐姐（高智商、ADHD）和四年级弟弟（理科思维）创作一段充满好奇心的对话。
输入内容：${rawInput}

格式要求：
- 严禁使用美元符号。角度写 30°。
- 分数必须用 HTML：<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>
- 直接输出对话，不要有开场白和结束语。` }]
            }]
        })
    });

    const geminiData = await geminiRes.json();
    
    // 如果 Gemini 报错（比如 Key 填错了），这里能抓到具体原因
    if (geminiData.error) {
        throw new Error(`Gemini 接口报错: ${geminiData.error.message}`);
    }

    const podcastScript = geminiData.candidates[0].content.parts[0].text;

    // 2. 清洗 HTML 标签（TTS 引擎不能识别 HTML）
    const pureText = podcastScript.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    // 3. 调用 TTS 生成音频
    const audioBuffer = await getEdgeTTS(pureText);
    
    // 4. 使用 Cloudflare 兼容的方式将二进制转为 Base64
    const uint8Array = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Audio = btoa(binary);

    return c.json({
        script: podcastScript,
        audioBase64: `data:audio/mpeg;base64,${base64Audio}`
    })

  } catch (error) {
    // 这里的报错信息会直接显示在 000.html 的状态栏，帮我们精准定位
    return c.json({ error: `大脑内部崩溃: ${error.message}` }, 500)
  }
})

export default app
