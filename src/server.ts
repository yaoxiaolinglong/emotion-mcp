#!/usr/bin/env node
/**
 * Emotion MCP Server — Stdio transport 入口
 *
 * 用法：
 *   npx emotion-mcp
 *   npx -y emotion-mcp
 *
 * 环境变量：见 .env.example
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EmotionEngine } from "./engine.js";

const engine = new EmotionEngine();

const server = new Server(
  { name: "emotion-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ==================== List tools ====================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "emotion_get_panel",
      description: "获取用户当前情绪数值面板，返回所有情绪维度的当前值和基线值",
      inputSchema: {
        type: "object",
        properties: { user_id: { type: "string", description: "用户唯一标识" } },
        required: ["user_id"],
      },
    },
    {
      name: "emotion_get_emotion_prompt",
      description: "生成可注入 system prompt 的情绪数值文本，让 AI 根据当前情绪数值演绎角色",
      inputSchema: {
        type: "object",
        properties: { user_id: { type: "string", description: "用户唯一标识" } },
        required: ["user_id"],
      },
    },
    {
      name: "emotion_get_status",
      description: "获取用户完整情绪档案：好感度、力比多/攻击性、情感标签、对话轮次、完整参考表",
      inputSchema: {
        type: "object",
        properties: { user_id: { type: "string", description: "用户唯一标识" } },
        required: ["user_id"],
      },
    },
    {
      name: "emotion_get_analysis_prompt",
      description: "获取情绪分析任务 — 返回当前数值 + 分析指南 + 消息和对话历史。调用后你会得到一个分析任务，请根据指南判断情绪变化并输出 JSON，然后调用 emotion_apply_deltas 提交结果。这样就由你（主 LLM）来做潜意识分析，无需额外配置 API Key",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          message: { type: "string", description: "用户最新消息内容" },
          history: { type: "string", description: "最近对话历史（可选，最多2000字符）" },
        },
        required: ["user_id", "message"],
      },
    },
    {
      name: "emotion_apply_deltas",
      description: "提交情绪增量 JSON 以更新数值。配合 emotion_get_analysis_prompt 使用：分析完成后将 JSON 结果提交于此",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          deltas: {
            type: "object",
            description: "情绪增量 JSON，格式：{libido_other_delta, aggression_other_delta, libido_self_delta, aggression_self_delta, affection_delta, base_libido_other_delta, base_aggression_other_delta, base_libido_self_delta, base_aggression_self_delta, intensity}",
            properties: {
              libido_other_delta: { type: "number" },
              aggression_other_delta: { type: "number" },
              libido_self_delta: { type: "number" },
              aggression_self_delta: { type: "number" },
              affection_delta: { type: "number" },
              base_libido_other_delta: { type: "number" },
              base_aggression_other_delta: { type: "number" },
              base_libido_self_delta: { type: "number" },
              base_aggression_self_delta: { type: "number" },
              intensity: { type: "number", description: "场景强度：0.5=低/1.0=中/2.0=高" },
            },
            required: [],
          },
        },
        required: ["user_id", "deltas"],
      },
    },
    {
      name: "emotion_analyze",
      description: "【一键模式】分析用户消息 + 更新情绪。如果配置了 EMOTION_LLM_API_KEY 则由后台 LLM 分析，否则由调用方（Agent）分析。推荐使用 emotion_get_analysis_prompt + emotion_apply_deltas 两步模式以获得更好的控制",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          message: { type: "string", description: "用户最新消息内容" },
          history: { type: "string", description: "最近对话历史（可选，最多2000字符）" },
        },
        required: ["user_id", "message"],
      },
    },
    {
      name: "emotion_reset",
      description: "重置指定用户的情绪数值至初始状态",
      inputSchema: {
        type: "object",
        properties: { user_id: { type: "string", description: "要重置的用户 uid" } },
        required: ["user_id"],
      },
    },
    {
      name: "emotion_set",
      description: "手动设置用户情绪数值。未指定的字段保持不变",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          affection: { type: "number", description: "好感度 0-100" },
          libido_other: { type: "number", description: "他力比多 0-50" },
          aggression_other: { type: "number", description: "他攻击性 0-50" },
          libido_self: { type: "number", description: "自力比多 0-50" },
          aggression_self: { type: "number", description: "自攻击性 0-50" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "emotion_reset_all",
      description: "⚠️ 清除所有用户情绪档案，重置机器人自身情绪",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "emotion_apply_decay",
      description: "手动触发时间衰减（通常自动执行）",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ],
}));

// ==================== Call tool ====================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  engine.applyDecay();

  const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

  switch (name) {
    case "emotion_get_panel":
      return json(engine.buildPanel(String(args?.user_id ?? "")));

    case "emotion_get_emotion_prompt":
      return text(engine.buildEmotionPromptText(String(args?.user_id ?? "")));

    case "emotion_get_status": {
      const uid = String(args?.user_id ?? "");
      const panel = engine.buildPanel(uid);
      let s =
        `【情绪档案】\n用户ID：${uid}\n` +
        `好感度：${panel.affection.toFixed(1)}/100\n` +
        `对他：当前力比多 ${panel.libido_other.current.toFixed(1)} (基线 ${panel.libido_other.base.toFixed(1)}) | ` +
        `攻击性 ${panel.aggression_other.current.toFixed(1)} (基线 ${panel.aggression_other.base.toFixed(1)})\n` +
        `对己：当前力比多 ${panel.libido_self.current.toFixed(1)} (基线 ${panel.libido_self.base.toFixed(1)}) | ` +
        `攻击性 ${panel.aggression_self.current.toFixed(1)} (基线 ${panel.aggression_self.base.toFixed(1)})\n` +
        `对话轮次：${panel.turn_count}\n` +
        `对你情感：${panel.emotion_towards_user}\n自身状态：${panel.emotion_self_state}`;
      if (panel.special_mode) s += `\n特殊模式：${panel.special_mode}`;
      s += EmotionEngine.EMOTION_REFERENCE_TABLE;
      return text(s);
    }

    case "emotion_get_analysis_prompt": {
      const uid = String(args?.user_id ?? "");
      const message = String(args?.message ?? "");
      const history = String(args?.history ?? "");
      const { prompt, user, self, turn } = engine.buildAnalysisPrompt(uid, message, history);

      return text(
        `【情绪分析任务】
请根据以下指南分析用户消息对机器人情绪的影响，输出 JSON。

**规则**：
1. 他力比多/他攻击性的当前值增量必须非零（±0.1~±2.0）
2. 好感度变化范围 -0.5~+0.5
3. 基线值（原力比多/原攻击性）变化：前10轮可 -1.5~+1.5，10轮后仅 ±0.2
4. intensity: 高强度(2.0)=生死离别/表白/仇恨, 中(1.0)=日常互动, 低(0.5)=寒暄

**情绪指南**：
- 喜爱/关心/赞美 → 他力比多↑ 攻击性↓
- 批评/冷漠/拒绝 → 他力比多↓ 攻击性↑
- 悲伤/无助 → 他力比多↑（安慰欲）
- 调侃玩笑 → 他力比多微降 攻击性微升（傲娇）
- 正面反馈 → 自力比多↑，被否定 → 自攻击性↑

**当前数值**：
好感度：${user.affection.toFixed(1)}/100
他力比多：${user.current_libido_other.toFixed(1)}/50（基线 ${user.base_libido_other.toFixed(1)}）
他攻击性：${user.current_aggression_other.toFixed(1)}/50（基线 ${user.base_aggression_other.toFixed(1)}）
自力比多：${self.current_libido_self.toFixed(1)}/50（基线 ${self.base_libido_self.toFixed(1)}）
自攻击性：${self.current_aggression_self.toFixed(1)}/50（基线 ${self.base_aggression_self.toFixed(1)}）
对话轮次：第 ${turn} 轮

**用户消息**：${message}

**请只输出 JSON**：
{"libido_other_delta":0,"aggression_other_delta":0,"libido_self_delta":0,"aggression_self_delta":0,"affection_delta":0,"base_libido_other_delta":0,"base_aggression_other_delta":0,"base_libido_self_delta":0,"base_aggression_self_delta":0,"intensity":1.0}

输出 JSON 后，调用 emotion_apply_deltas 提交结果。`,
      );
    }

    case "emotion_apply_deltas": {
      const uid = String(args?.user_id ?? "");
      const deltas = (args?.deltas ?? {}) as Record<string, unknown>;
      const result = engine.applyDeltas(uid, {
        libido_other_delta: Number(deltas.libido_other_delta ?? 0),
        aggression_other_delta: Number(deltas.aggression_other_delta ?? 0),
        libido_self_delta: Number(deltas.libido_self_delta ?? 0),
        aggression_self_delta: Number(deltas.aggression_self_delta ?? 0),
        affection_delta: Number(deltas.affection_delta ?? 0),
        base_libido_other_delta: Number(deltas.base_libido_other_delta ?? 0),
        base_aggression_other_delta: Number(deltas.base_aggression_other_delta ?? 0),
        base_libido_self_delta: Number(deltas.base_libido_self_delta ?? 0),
        base_aggression_self_delta: Number(deltas.base_aggression_self_delta ?? 0),
        intensity: Number(deltas.intensity ?? 1.0),
      });
      return json(result);
    }

    case "emotion_analyze": {
      const result = await engine.analyzeAndUpdate(
        String(args?.user_id ?? ""),
        String(args?.message ?? ""),
        String(args?.history ?? ""),
      );
      return json(result);
    }

    case "emotion_reset":
      return json(engine.resetUser(String(args?.user_id ?? "")));

    case "emotion_set": {
      const uid = String(args?.user_id ?? "");
      const fields: Record<string, number> = {};
      for (const k of ["affection", "libido_other", "aggression_other", "libido_self", "aggression_self"]) {
        if (args?.[k] !== undefined) fields[k] = Number(args[k]);
      }
      return json(engine.setEmotion(uid, fields));
    }

    case "emotion_reset_all":
      engine.resetAll();
      return text("⚠️ 已清除所有用户情绪档案，机器人自身情绪已重置为初始值。");

    case "emotion_apply_decay":
      return text("已对所有用户和自身数据应用时间衰减。");

    default:
      return text(`未知工具: ${name}`);
  }
});

// ==================== 启动 ====================

async function main(): Promise<void> {
  engine.log(`启动中... 数据目录: ${engine.config.dataDir}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[EmotionMCP] Fatal: ${err}\n`);
  process.exit(1);
});
