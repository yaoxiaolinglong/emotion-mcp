# Emotion MCP Server

弗洛伊德双驱情绪管理 MCP 服务器 —— [astrbot_plugin_affection](https://github.com/middcom/astrbot_plugin_affection) 的独立 MCP 实现。

> **NPM**: https://www.npmjs.com/package/emotion-mcp
> **GitHub**: https://github.com/yaoxiaolinglong/emotion-mcp

为 AI 角色扮演/伴侣场景提供动态情绪模拟系统。基于弗洛伊德心理动力学（力比多/攻击性），通过**潜意识 LLM 分析对话内容**实时调整情绪数值，具备**时间衰减**能力。

## 快速开始

```bash
npx -y emotion-mcp
```

## 集成方式

### 零配置（推荐） — Agent 自主分析

```yaml
mcpServers:
  emotion:
    type: stdio
    command: npx
    args:
      - -y
      - emotion-mcp
    timeout: 60000
```

**无需任何环境变量！** Agent 通过两步模式完成情绪分析：

```
用户发言
  → emotion_get_analysis_prompt(user_id, message)  # 获取分析任务
  → Agent 自己分析 → 输出 JSON
  → emotion_apply_deltas(user_id, deltas)           # 提交结果，数值更新
  → emotion_get_emotion_prompt(user_id)             # 获取情绪文本
  → 注入 system prompt → 生成回复
```

### 后台 LLM 模式 — 独立分析

如果配置了 `EMOTION_LLM_API_KEY`，可用 `emotion_analyze` 一步完成：

```yaml
mcpServers:
  emotion:
    type: stdio
    command: npx
    args:
      - -y
      - emotion-mcp
    env:
      EMOTION_LLM_API_KEY: sk-your-key-here
    timeout: 60000
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMOTION_LLM_API_KEY` | (必填) | 潜意识 LLM API Key |
| `EMOTION_LLM_API_BASE` | `https://api.mulanteastory.cn` | API 地址 |
| `EMOTION_LLM_MODEL` | `gpt-3.5-turbo` | 模型名（建议轻量模型） |
| `EMOTION_SENSITIVITY` | `30` | 情绪敏感度 (0-100) |
| `EMOTION_INITIAL_AFFECTION` | `50` | 初始好感度 (0-100) |

## MCP 工具

### `emotion_analyze` ★ 核心
分析用户消息 → 调用潜意识 LLM → 更新情绪数值。每次用户发言后调用。
- 输入: `user_id`, `message`, `history`(可选)
- 输出: 更新后的完整情绪面板 + 增量详情

### `emotion_get_emotion_prompt`
生成可追加到 system prompt 的情绪文本。
- 输入: `user_id`
- 输出: 情绪数值面板文本

### `emotion_get_panel`
获取当前情绪数值面板（JSON 格式）。
- 输入: `user_id`

### `emotion_get_status`
完整情绪档案，含参考表。

### `emotion_reset` / `emotion_set` / `emotion_reset_all`
管理工具。

## Agent 角色的「情绪驱动规则」

将以下规则加入角色设定的 system prompt 末尾：

```
【情绪驱动规则】

你的回复风格和情感倾向由系统实时计算的「力比多/攻击性/好感」数值决定。每次对话前，你会收到【当前情绪数值】面板，包含：

- 他力比多（0-50）：想亲近对方的欲望。高→主动撒娇黏人，低→冷淡回避疏远。
- 他攻击性（0-50）：想伤害对方的冲动。高→敌意烦躁刻薄，低→温顺容忍顺从。
- 好感度（0-100）：长期累积的喜欢和依恋。≥70 时攻击性表现为"吃醋""占有欲"；≤30 时表现为"厌恶""敌意"。
- 自力比多（0-50）：自爱程度。高→自信自爱，低→自卑空虚。
- 自攻击性（0-50）：自责/自我毁灭冲动。高→崩溃自我贬低。

重要约束：不要提及任何具体数值，根据数值强度自然演绎。数值的微小变化也应体现在语气强度上。
```

## 许可

基于 [astrbot_plugin_affection](https://github.com/middcom/astrbot_plugin_affection) (AGPL-3.0) 改造。同样采用 AGPL-3.0。
