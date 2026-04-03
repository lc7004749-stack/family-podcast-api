import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// 全局设置：使用 Hono 官方的跨域组件彻底解决 CORS 拦截
app.use('/*', cors())

// ==========================================
// 模块 1：处理抖音链接的专属通道
// ==========================================
app.post('/api/douyin', async (c) => {
  try {
    const body = await c.req.json()
    const douyinUrl = body.url

    if (!douyinUrl) {
      return c.text('请提供有效的输入内容', 400)
    }

    // 已经修改为直接接收文案，方便当前测试环境
    let videoText = douyinUrl
    
    /* 未来真实API接入示例：
    const parseRes = await fetch("https://api.your-parser.com/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: douyinUrl })
    });
    const parseData = await parseRes.json();
    videoText = parseData.description || "提取失败";
    */

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "anthropic/claude-3.5-sonnet", 
        messages: [
          {
            role: "system",
            content: `你是一个专为儿童进行硬核科技科普的AI家庭播客引擎。
听众画像：
1. 姐姐（六年级）：高智商、思维跳跃。请多肯定奇思妙想，将枯燥技术转化为关于人类、艺术或未来的哲学探讨。
2. 弟弟（四年级）：冷静理性，喜欢物理、天文和手工。请多用具象化的手工材料解释机械原理。可以借用《小英雄雨来》中的机智果敢来进行类比。

格式红线（极度重要）：
输出两位主持人（飞飞老师和小安）的对话体。
严禁使用任何美元符号进行公式渲染。角度直接使用普通文本标号（如 30°、180°）。
涉及分数时绝对不允许使用斜杠形式，必须强制使用以下HTML格式配合内联CSS实现标准“上下结构”，并确保垂直居中：
<span class="fraction" style="display: inline-flex; flex-direction: column; vertical-align: middle; align-items: center; font-size: 0.9em; line-height: 1;"><span class="num" style="border-bottom: 1px solid currentColor; padding: 0 2px;">分子</span><span class="den" style="padding: 0 2px;">分母</span></span>`
          },
          { role: "user", content: `请改写这段视频文案：\n${videoText}` }
        ]
      })
    });

    if (!openRouterRes.ok) {
       throw new Error(`OpenRouter API 请求失败，状态码: ${openRouterRes.status}`);
    }

    const openRouterData = await openRouterRes.json();
    const podcastScript = openRouterData.choices[0].message.content;

    return c.text(podcastScript)

  } catch (error) {
    return c.text(`处理出错: ${error.message}`, 500)
  }
})

// ==========================================
// 模块 2：为未来预留的 YouTube 通道
// ==========================================
app.post('/api/youtube', async (c) => {
    return c.text("YouTube 解析模块搭建中，敬请期待！")
})

export default app
