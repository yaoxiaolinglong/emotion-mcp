/**
 * Emotion MCP — 核心逻辑模块
 * 弗洛伊德双驱情绪引擎（无 MCP 依赖，可独立使用）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================
// 类型
// ============================================================

export interface EmotionData {
  affection: number;
  base_libido_other: number;
  base_aggression_other: number;
  current_libido_other: number;
  current_aggression_other: number;
  turn_count: number;
  last_interaction: number;
  last_update: number;
  idle_triggered: boolean;
}

export interface SelfData {
  base_libido_self: number;
  base_aggression_self: number;
  current_libido_self: number;
  current_aggression_self: number;
  last_update: number;
}

export interface Deltas {
  libido_other_delta: number;
  aggression_other_delta: number;
  libido_self_delta: number;
  aggression_self_delta: number;
  affection_delta: number;
  base_libido_other_delta: number;
  base_aggression_other_delta: number;
  base_libido_self_delta: number;
  base_aggression_self_delta: number;
  intensity: number;
}

export interface EmotionPanel {
  user_id: string;
  affection: number;
  libido_other: { current: number; base: number };
  aggression_other: { current: number; base: number };
  libido_self: { current: number; base: number };
  aggression_self: { current: number; base: number };
  turn_count: number;
  emotion_towards_user: string;
  emotion_self_state: string;
  special_mode: string | null;
}

// ============================================================
// 配置（可在创建引擎时覆盖）
// ============================================================

export interface EmotionConfig {
  llmApiBase: string;
  llmApiKey: string;
  llmModel: string;
  sensitivity: number;
  initialAffection: number;
  initialLibidoOther: number;
  initialAggressionOther: number;
  initialLibidoSelf: number;
  initialAggressionSelf: number;
  debug: boolean;
  dataDir: string;
}

export const defaultConfig: EmotionConfig = {
  llmApiBase: process.env["EMOTION_LLM_API_BASE"]?.trim() || "https://api.mulanteastory.cn",
  llmApiKey: process.env["EMOTION_LLM_API_KEY"]?.trim() || "",
  llmModel: process.env["EMOTION_LLM_MODEL"]?.trim() || "gpt-3.5-turbo",
  sensitivity: parseFloat(process.env["EMOTION_SENSITIVITY"] || "30") / 100,
  initialAffection: parseFloat(process.env["EMOTION_INITIAL_AFFECTION"] || "50"),
  initialLibidoOther: parseFloat(process.env["EMOTION_INITIAL_LIBIDO_OTHER"] || "25"),
  initialAggressionOther: parseFloat(process.env["EMOTION_INITIAL_AGGRESSION_OTHER"] || "25"),
  initialLibidoSelf: parseFloat(process.env["EMOTION_INITIAL_LIBIDO_SELF"] || "25"),
  initialAggressionSelf: parseFloat(process.env["EMOTION_INITIAL_AGGRESSION_SELF"] || "25"),
  debug: (process.env["EMOTION_DEBUG"] || "false").toLowerCase() === "true",
  dataDir: process.env["EMOTION_DATA_DIR"]?.trim() || path.join(os.homedir(), ".emotion-mcp"),
};

// ============================================================
// 情绪引擎
// ============================================================

export class EmotionEngine {
  readonly config: EmotionConfig;
  private userData: Record<string, EmotionData> = {};
  private selfData: SelfData;

  constructor(config: Partial<EmotionConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.selfData = EmotionEngine.defaultSelfData(this.config);

    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }

    this.loadData();
  }

  // ==================== 工厂 ====================

  static defaultSelfData(cfg: EmotionConfig): SelfData {
    return {
      base_libido_self: cfg.initialLibidoSelf,
      base_aggression_self: cfg.initialAggressionSelf,
      current_libido_self: cfg.initialLibidoSelf,
      current_aggression_self: cfg.initialAggressionSelf,
      last_update: Date.now(),
    };
  }

  // ==================== 持久化 ====================

  private get userDataFile(): string { return path.join(this.config.dataDir, "user_data.json"); }
  private get selfDataFile(): string { return path.join(this.config.dataDir, "self_data.json"); }

  private loadJson<T>(filePath: string, fallback: T): T {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch (e) {
      this.log(`WARN: failed to load ${filePath}: ${e}`);
    }
    return fallback;
  }

  private saveJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  private loadData(): void {
    const loaded = this.loadJson<Record<string, EmotionData>>(this.userDataFile, {});
    Object.assign(this.userData, loaded);

    const selfLoaded = this.loadJson<SelfData | null>(this.selfDataFile, null);
    if (selfLoaded) {
      Object.assign(this.selfData, selfLoaded);
    } else {
      this.saveJson(this.selfDataFile, this.selfData);
    }
  }

  private saveUserDataSync(): void { this.saveJson(this.userDataFile, this.userData); }
  private saveSelfDataSync(): void { this.saveJson(this.selfDataFile, this.selfData); }

  // ==================== 日志 ====================

  log(msg: string): void {
    if (this.config.debug) {
      process.stderr.write(`[EmotionMCP] ${msg}\n`);
    }
  }

  // ==================== 用户 CRUD ====================

  createUser(uid: string): EmotionData {
    const now = Date.now();
    const user: EmotionData = {
      affection: this.config.initialAffection,
      base_libido_other: this.config.initialLibidoOther,
      base_aggression_other: this.config.initialAggressionOther,
      current_libido_other: this.config.initialLibidoOther,
      current_aggression_other: this.config.initialAggressionOther,
      turn_count: 0,
      last_interaction: 0,  // 0 = 尚未互动
      last_update: now,
      idle_triggered: false,
    };
    this.userData[uid] = user;
    return { ...user };
  }

  getUser(uid: string): EmotionData {
    return this.userData[uid] ? { ...this.userData[uid] } : this.createUser(uid);
  }

  getSelf(): SelfData {
    return { ...this.selfData };
  }

  // ==================== 情绪映射表 ====================

  private static mapValueToBracket(value: number): number {
    for (const b of [0.0, 12.5, 25.0, 37.5, 50.0]) {
      if (value <= b) return b;
    }
    return 50.0;
  }

  private static getAffectionLevel(affection: number): number {
    if (affection < 12.5) return 0;
    if (affection < 37.5) return 25;
    if (affection < 62.5) return 50;
    if (affection < 87.5) return 75;
    return 100;
  }

  // prettier-ignore
  private static TOWARDS_USER_TABLE: Record<number, Record<string, string>> = {
    0: {
      "50.0,0.0": "痴迷(病态)", "50.0,12.5": "纠缠(偏执)", "50.0,25.0": "憎恨(爱转恨)", "50.0,37.5": "毁灭性恨", "50.0,50.0": "同归于尽",
      "37.5,0.0": "依赖(绝望)", "37.5,12.5": "烦躁", "37.5,25.0": "厌恶", "37.5,37.5": "仇恨", "37.5,50.0": "残暴",
      "25.0,0.0": "冷淡", "25.0,12.5": "无聊", "25.0,25.0": "轻蔑", "25.0,37.5": "蔑视", "25.0,50.0": "冷酷",
      "12.5,0.0": "回避", "12.5,12.5": "疏离", "12.5,25.0": "嫌弃", "12.5,37.5": "恶心", "12.5,50.0": "憎恶",
      "0.0,0.0": "无视", "0.0,12.5": "不存在", "0.0,25.0": "否定", "0.0,37.5": "驱逐", "0.0,50.0": "湮灭",
    },
    25: {
      "50.0,0.0": "执着", "50.0,12.5": "猜疑", "50.0,25.0": "嫉妒", "50.0,37.5": "报复欲", "50.0,50.0": "毁灭欲",
      "37.5,0.0": "渴求(卑微)", "37.5,12.5": "试探(不安)", "37.5,25.0": "敌意", "37.5,37.5": "愤怒", "37.5,50.0": "仇恨",
      "25.0,0.0": "普通", "25.0,12.5": "不耐烦", "25.0,25.0": "竞争", "25.0,37.5": "攻击性玩笑", "25.0,50.0": "讽刺",
      "12.5,0.0": "礼貌", "12.5,12.5": "无聊", "12.5,25.0": "烦躁", "12.5,37.5": "厌恶", "12.5,50.0": "憎恨",
      "0.0,0.0": "冷漠", "0.0,12.5": "沉默", "0.0,25.0": "回避", "0.0,37.5": "拒绝", "0.0,50.0": "驱赶",
    },
    50: {
      "50.0,0.0": "迷恋", "50.0,12.5": "占有", "50.0,25.0": "嫉妒", "50.0,37.5": "施虐倾向", "50.0,50.0": "毁灭性爱",
      "37.5,0.0": "依恋", "37.5,12.5": "激情", "37.5,25.0": "纠缠", "37.5,37.5": "报复", "37.5,50.0": "仇恨",
      "25.0,0.0": "喜欢", "25.0,12.5": "渴望", "25.0,25.0": "竞争", "25.0,37.5": "愤怒", "25.0,50.0": "残暴",
      "12.5,0.0": "好感", "12.5,12.5": "无聊", "12.5,25.0": "烦躁", "12.5,37.5": "厌恶", "12.5,50.0": "憎恨",
      "0.0,0.0": "冷漠", "0.0,12.5": "疏离", "0.0,25.0": "轻蔑", "0.0,37.5": "蔑视", "0.0,50.0": "冷酷",
    },
    75: {
      "50.0,0.0": "痴迷", "50.0,12.5": "占有欲", "50.0,25.0": "吃醋", "50.0,37.5": "霸道", "50.0,50.0": "毁灭性占有",
      "37.5,0.0": "依恋(甜)", "37.5,12.5": "热情", "37.5,25.0": "撒娇式纠缠", "37.5,37.5": "管教欲", "37.5,50.0": "因爱生恨",
      "25.0,0.0": "欣赏", "25.0,12.5": "心动", "25.0,25.0": "争宠", "25.0,37.5": "着急", "25.0,50.0": "暴躁(但会后悔)",
      "12.5,0.0": "友善", "12.5,12.5": "小无聊", "12.5,25.0": "小烦躁", "12.5,37.5": "恼火", "12.5,50.0": "气话(很快哄好)",
      "0.0,0.0": "平淡", "0.0,12.5": "安静", "0.0,25.0": "冷一下", "0.0,37.5": "生闷气", "0.0,50.0": "冷战",
    },
    100: {
      "50.0,0.0": "崇拜", "50.0,12.5": "完全占有", "50.0,25.0": "吃醋到失控", "50.0,37.5": "施虐(play)", "50.0,50.0": "共依存(病态)",
      "37.5,0.0": "依恋到离不开", "37.5,12.5": "热情似火", "37.5,25.0": "黏人到烦人", "37.5,37.5": "调教欲", "37.5,50.0": "相爱相杀",
      "25.0,0.0": "喜欢到溺爱", "25.0,12.5": "渴望融合", "25.0,25.0": "撒娇争夺", "25.0,37.5": "炸毛(可爱型)", "25.0,50.0": "虐恋",
      "12.5,0.0": "安心", "12.5,12.5": "小撒娇", "12.5,25.0": "小赌气", "12.5,37.5": "假生气", "12.5,50.0": "闹别扭",
      "0.0,0.0": "平静幸福", "0.0,12.5": "沉默但有爱", "0.0,25.0": "闷气但心软", "0.0,37.5": "委屈", "0.0,50.0": "冷战但等你哄",
    },
  };

  // prettier-ignore
  private static SELF_TABLE: Record<string, string> = {
    "50.0,0.0": "自恋", "50.0,12.5": "自满", "50.0,25.0": "自傲", "50.0,37.5": "自大", "50.0,50.0": "自毁冲动",
    "37.5,0.0": "自爱", "37.5,12.5": "自怜", "37.5,25.0": "自责", "37.5,37.5": "自卑", "37.5,50.0": "自我仇恨",
    "25.0,0.0": "自信", "25.0,12.5": "平淡", "25.0,25.0": "内疚", "25.0,37.5": "自我厌恶", "25.0,50.0": "自残欲",
    "12.5,0.0": "自保", "12.5,12.5": "空虚", "12.5,25.0": "羞愧", "12.5,37.5": "自贬", "12.5,50.0": "自毁欲",
    "0.0,0.0": "无我", "0.0,12.5": "麻木", "0.0,25.0": "自我否定", "0.0,37.5": "自我毁灭", "0.0,50.0": "湮灭",
  };

  getEmotionDesc(
    affection: number,
    libidoOther: number,
    aggressionOther: number,
    libidoSelf: number,
    aggressionSelf: number,
  ): { towards_user: string; self_state: string } {
    const affLevel = EmotionEngine.getAffectionLevel(affection);
    const loB = EmotionEngine.mapValueToBracket(libidoOther);
    const aoB = EmotionEngine.mapValueToBracket(aggressionOther);
    const lsB = EmotionEngine.mapValueToBracket(libidoSelf);
    const asB = EmotionEngine.mapValueToBracket(aggressionSelf);

    const towards = EmotionEngine.TOWARDS_USER_TABLE[affLevel]?.[`${loB},${aoB}`] ?? "——";
    const selfState = EmotionEngine.SELF_TABLE[`${lsB},${asB}`] ?? "——";

    return { towards_user: towards, self_state: selfState };
  }

  // ==================== 衰减 ====================

  static computeDecay(elapsedHours: number, initialDeviation: number, durationHours: number = 2.0): number {
    if (durationHours <= 0) durationHours = 0.5;
    if (elapsedHours >= durationHours) return -initialDeviation;
    const ratio = elapsedHours / durationHours;
    return -initialDeviation * ratio * ratio;
  }

  applyDecay(): boolean {
    let changed = false;
    const now = Date.now();

    // 自身衰减
    const lastSelf = this.selfData.last_update;
    const elapsedSelf = (now - lastSelf) / 3600000;
    for (const [curF, baseF] of [
      ["current_libido_self", "base_libido_self"],
      ["current_aggression_self", "base_aggression_self"],
    ] as const) {
      const base = this.selfData[baseF];
      const cur = this.selfData[curF];
      const dev = cur - base;
      if (Math.abs(dev) < 0.001) continue;
      const delta = EmotionEngine.computeDecay(elapsedSelf, dev);
      const newVal = Math.max(0, Math.min(50, cur + delta));
      if (Math.abs(newVal - cur) > 0.0001) {
        (this.selfData as unknown as Record<string, number>)[curF] = newVal;
        changed = true;
      }
    }
    if (changed) {
      this.selfData.last_update = now;
      this.saveSelfDataSync();
    }

    // 用户衰减
    for (const [, user] of Object.entries(this.userData)) {
      const lastUpdate = user.last_update;
      const elapsed = (now - lastUpdate) / 3600000;
      let userChanged = false;
      for (const [curF, baseF] of [
        ["current_libido_other", "base_libido_other"],
        ["current_aggression_other", "base_aggression_other"],
      ] as const) {
        const base = user[baseF];
        const cur = user[curF];
        const dev = cur - base;
        if (Math.abs(dev) < 0.001) continue;
        const delta = EmotionEngine.computeDecay(elapsed, dev);
        const newVal = Math.max(0, Math.min(50, cur + delta));
        if (Math.abs(newVal - cur) > 0.0001) {
          (user as unknown as Record<string, number>)[curF] = newVal;
          userChanged = true;
        }
      }
      if (userChanged) {
        user.last_update = now;
        changed = true;
      }
    }
    if (changed) {
      this.saveUserDataSync();
    }

    return changed;
  }

  // ==================== 面板 ====================

  buildPanel(uid: string): EmotionPanel {
    const user = this.getUser(uid);
    const self = this.getSelf();
    const emotion = this.getEmotionDesc(
      user.affection,
      user.current_libido_other,
      user.current_aggression_other,
      self.current_libido_self,
      self.current_aggression_self,
    );

    const specialMode =
      self.current_aggression_self >= 37.5 && self.current_libido_self <= 12.5
        ? "自毁倾诉模式"
        : null;

    const round1 = (v: number) => Math.round(v * 10) / 10;

    return {
      user_id: uid,
      affection: round1(user.affection),
      libido_other: { current: round1(user.current_libido_other), base: round1(user.base_libido_other) },
      aggression_other: { current: round1(user.current_aggression_other), base: round1(user.base_aggression_other) },
      libido_self: { current: round1(self.current_libido_self), base: round1(self.base_libido_self) },
      aggression_self: { current: round1(self.current_aggression_self), base: round1(self.base_aggression_self) },
      turn_count: user.turn_count,
      emotion_towards_user: emotion.towards_user,
      emotion_self_state: emotion.self_state,
      special_mode: specialMode,
    };
  }

  buildEmotionPromptText(uid: string): string {
    const panel = this.buildPanel(uid);
    let text =
      `【当前情绪数值】\n` +
      `他力比多：${panel.libido_other.current.toFixed(1)}/50（亲近/给予温暖的欲望）\n` +
      `他攻击性：${panel.aggression_other.current.toFixed(1)}/50（推开/伤害的冲动）\n` +
      `好感度：${panel.affection.toFixed(1)}/100\n` +
      `自力比多：${panel.libido_self.current.toFixed(1)}/50（自爱/珍视自己）\n` +
      `自攻击性：${panel.aggression_self.current.toFixed(1)}/50（自责/自我毁灭）\n` +
      `参考标签：对用户「${panel.emotion_towards_user}」，自身「${panel.emotion_self_state}」`;
    if (panel.special_mode) {
      text += `\n⚠️ 特殊模式：${panel.special_mode}`;
    }
    text += "\n（请根据上述数值和你在人设中定义的「情绪驱动规则」来演绎角色，不要提及数值。）";
    return text;
  }

  static EMOTION_REFERENCE_TABLE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
情绪档案参考
好感 = 0（强烈厌恶）
他力/他攻    0       12.5     25       37.5     50
50           痴迷    纠缠     憎恨     毁灭性恨 同归于尽
37.5         依赖    烦躁     厌恶     仇恨     残暴
25           冷淡    无聊     轻蔑     蔑视     冷酷
12.5         回避    疏离     嫌弃     恶心     憎恶
0            无视    不存在   否定     驱逐     湮灭

好感 = 50（陌生人）
50           迷恋    占有     嫉妒     施虐倾向 毁灭性爱
37.5         依恋    激情     纠缠     报复     仇恨
25           喜欢    渴望     竞争     愤怒     残暴
12.5         好感    无聊     烦躁     厌恶     憎恨
0            冷漠    疏离     轻蔑     蔑视     冷酷

好感 = 75（普通朋友）
50           痴迷    占有欲   吃醋     霸道     毁灭占有
37.5         依恋甜  热情     撒娇纠缠 管教欲   因爱生恨
25           欣赏    心动     争宠     着急     暴躁后悔
12.5         友善    小无聊   小烦躁   恼火     气话哄好
0            平淡    安静     冷一下   生闷气   冷战

好感 = 100（生命最重要）
50           崇拜    完全占有 吃醋失控 施虐play 共依存
37.5         离不开  热情似火 黏人烦   调教欲   相爱相杀
25           溺爱    渴望融合 撒娇争夺 炸毛     虐恋
12.5         安心    小撒娇   小赌气   假生气   闹别扭
0            平静幸福 沉默有爱 闷气心软 委屈     冷战等你哄

自身情绪（自力比多 × 自攻击性）
自力/自攻    0       12.5     25       37.5     50
50           自恋    自满     自傲     自大     自毁冲动
37.5         自爱    自怜     自责     自卑     自我仇恨
25           自信    平淡     内疚     自我厌恶 自残欲
12.5         自保    空虚     羞愧     自贬     自毁欲
0            无我    麻木     自我否定 自我毁灭 湮灭
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  // ==================== LLM 调用 ====================

  private static ANALYSIS_SYSTEM_PROMPT = "你是一个情绪数值调节器，只输出 JSON，不添加任何解释。";

  buildAnalysisPrompt(uid: string, message: string, history: string = ""): { prompt: string; user: EmotionData; self: SelfData; turn: number } {
    const user = this.getUser(uid);
    const self = this.getSelf();
    const turn = user.last_interaction === 0 ? 1 : user.turn_count || 1;

    const historySnippet = history.length > 2000 ? history.slice(-2000) : history;
    const prompt = EmotionEngine.ANALYSIS_SYSTEM_PROMPT + "\n\n" +
      `当前状态：
- 对话轮次：第 ${turn} 轮
- 好感度：${user.affection.toFixed(1)}/100
- 对他基线：原他力比多 ${user.base_libido_other.toFixed(1)}，原他攻击性 ${user.base_aggression_other.toFixed(1)}
- 对他当前：他力比多 ${user.current_libido_other.toFixed(1)}，他攻击性 ${user.current_aggression_other.toFixed(1)}
- 对己基线：原自力比多 ${self.base_libido_self.toFixed(1)}，原自攻击性 ${self.base_aggression_self.toFixed(1)}
- 对己当前：自力比多 ${self.current_libido_self.toFixed(1)}，自攻击性 ${self.current_aggression_self.toFixed(1)}

最近对话历史：
${historySnippet}

用户最新消息：${message}`;

    return { prompt, user, self, turn };
  }

  applyDeltas(uid: string, deltas: Deltas, turn?: number): Record<string, unknown> {
    this.applyDecay();

    const user = this.getUser(uid);
    const now = Date.now();
    const t = turn ?? (user.last_interaction === 0 ? 1 : Math.max(1, user.turn_count));

    const isFirst = user.last_interaction === 0;

    if (isFirst) {
      user.last_interaction = now;
      user.turn_count = 1;
      this.userData[uid] = user;
      this.saveUserDataSync();
      return {
        status: "first_interaction",
        message: "初次互动，保持平淡中性",
        ...this.buildPanel(uid),
      };
    }

    let clamped = EmotionEngine.clampDeltas(deltas, t);
    clamped = EmotionEngine.ensureNonZero(clamped, user);

    const sens = this.config.sensitivity * clamped.intensity;

    user.current_libido_other = Math.max(0, Math.min(50, user.current_libido_other + clamped.libido_other_delta * sens));
    user.current_aggression_other = Math.max(0, Math.min(50, user.current_aggression_other + clamped.aggression_other_delta * sens));
    user.affection = Math.max(0, Math.min(100, user.affection + clamped.affection_delta * sens));

    const baseCoef = t <= 10 ? 1.0 : 0.2;
    user.base_libido_other = Math.max(0, Math.min(50, user.base_libido_other + clamped.base_libido_other_delta * baseCoef));
    user.base_aggression_other = Math.max(0, Math.min(50, user.base_aggression_other + clamped.base_aggression_other_delta * baseCoef));

    user.turn_count = t + 1;
    user.last_interaction = now;
    user.last_update = now;
    user.idle_triggered = false;
    this.userData[uid] = user;
    this.saveUserDataSync();

    this.selfData.current_libido_self = Math.max(0, Math.min(50, this.selfData.current_libido_self + clamped.libido_self_delta * sens));
    this.selfData.current_aggression_self = Math.max(0, Math.min(50, this.selfData.current_aggression_self + clamped.aggression_self_delta * sens));
    this.selfData.base_libido_self = Math.max(0, Math.min(50, this.selfData.base_libido_self + clamped.base_libido_self_delta * 0.2));
    this.selfData.base_aggression_self = Math.max(0, Math.min(50, this.selfData.base_aggression_self + clamped.base_aggression_self_delta * 0.2));
    this.selfData.last_update = now;
    this.saveSelfDataSync();

    const round4 = (v: number) => Math.round(v * 10000) / 10000;
    return {
      status: "updated",
      deltas: Object.fromEntries(Object.entries(clamped).map(([k, v]) => [k, round4(v)])),
      sensitivity: round4(sens),
      ...this.buildPanel(uid),
    };
  }

  // ==================== LLM 调用（可选 — 仅在配置了 API Key 时使用） ====================

  private buildAnalysisPrompt_inner(user: EmotionData, self: SelfData, history: string, latestMsg: string, turn: number): string {
    const historySnippet = history.length > 2000 ? history.slice(-2000) : history;
    return `你是潜意识的数值调节器。根据用户最新消息和对话历史，分析对机器人情绪的影响。

**重要规则**：
1. 必须对"他力比多"和"他攻击性"的**当前值**给出非零的调整增量（即使是很小的 ±0.1），因为每次互动都会引起情绪波动。
2. 对"自力比多"和"自攻击性"的当前值也建议给出非零增量，除非对话完全中性。
3. 同时评估本次互动是否影响**长期印象（基线值）**：
   - 对他人的基线（原他力比多/原他攻击性）：当前是第 ${turn} 轮对话。
     * 若 turn <= 10，基线变化可以较明显（增量范围 -1.5 ~ +1.5）。
     * 若 turn > 10，基线变化必须极小（增量范围 -0.2 ~ +0.2），因为初印象已形成。
   - 对自身的基线（原自力比多/原自攻击性）：始终很难改变，增量范围 -0.2 ~ +0.2。
4. 好感度变化范围 -0.5 ~ +0.5。
5. **场景强度识别**：判断当前对话场景的情感强度：
   - 高强度（2.0）：生死离别、深爱表白、极度崇拜、仇恨爆发、自毁倾诉、重大牺牲
   - 中强度（1.0）：普通争执、日常关心、轻度调侃、常规互动
   - 低强度（0.5）：寒暄、中性闲聊、无关话题、简单应答
   输出 \`intensity\` 字段。

**情绪解读指南**：
- 用户表达喜爱、关心、赞美、感谢、不舍、祝福 → 他力比多 ↑，攻击性 ↓
- 用户表达批评、指责、冷漠、拒绝、贬低 → 他力比多 ↓，攻击性 ↑
- 用户表达悲伤、无助、自我否定 → 他力比多 ↑（安慰欲），但若用户攻击机器人则攻击性 ↑
- 用户调侃、玩笑但无恶意 → 他力比多可能微降，攻击性微升（傲娇反应）
- 对自身：获得正面反馈时自力比多 ↑，被否定或自省时自攻击性 ↑

当前状态：
- 对话轮次：第 ${turn} 轮
- 好感度：${user.affection.toFixed(1)}/100
- 对他基线：原他力比多 ${user.base_libido_other.toFixed(1)}，原他攻击性 ${user.base_aggression_other.toFixed(1)}
- 对他当前：他力比多 ${user.current_libido_other.toFixed(1)}，他攻击性 ${user.current_aggression_other.toFixed(1)}
- 对己基线：原自力比多 ${self.base_libido_self.toFixed(1)}，原自攻击性 ${self.base_aggression_self.toFixed(1)}
- 对己当前：自力比多 ${self.current_libido_self.toFixed(1)}，自攻击性 ${self.current_aggression_self.toFixed(1)}

最近对话历史：
${historySnippet}

用户最新消息：${latestMsg}

请输出 JSON 格式：
{
  "libido_other_delta": 0.0,
  "aggression_other_delta": 0.0,
  "libido_self_delta": 0.0,
  "aggression_self_delta": 0.0,
  "affection_delta": 0.0,
  "base_libido_other_delta": 0.0,
  "base_aggression_other_delta": 0.0,
  "base_libido_self_delta": 0.0,
  "base_aggression_self_delta": 0.0,
  "intensity": 1.0
}

只输出 JSON，不要其他文字。`;
  }

  private static parseLLMJson(text: string): Deltas {
    try {
      return JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }
    return EmotionEngine.defaultDeltas();
  }

  private static defaultDeltas(): Deltas {
    return {
      libido_other_delta: 0.05, aggression_other_delta: 0.05,
      libido_self_delta: 0, aggression_self_delta: 0,
      affection_delta: 0,
      base_libido_other_delta: 0, base_aggression_other_delta: 0,
      base_libido_self_delta: 0, base_aggression_self_delta: 0,
      intensity: 1.0,
    };
  }

  private static clampDeltas(data: Deltas, turn: number): Deltas {
    const baseOLimit = turn <= 10 ? 1.5 : 0.2;
    const intensity = Math.max(0.5, Math.min(2.0, data.intensity || 1.0));
    return {
      libido_other_delta: Math.max(-2.0, Math.min(2.0, data.libido_other_delta || 0)),
      aggression_other_delta: Math.max(-2.0, Math.min(2.0, data.aggression_other_delta || 0)),
      libido_self_delta: Math.max(-2.0, Math.min(2.0, data.libido_self_delta || 0)),
      aggression_self_delta: Math.max(-2.0, Math.min(2.0, data.aggression_self_delta || 0)),
      affection_delta: Math.max(-0.5, Math.min(0.5, data.affection_delta || 0)),
      base_libido_other_delta: Math.max(-baseOLimit, Math.min(baseOLimit, data.base_libido_other_delta || 0)),
      base_aggression_other_delta: Math.max(-baseOLimit, Math.min(baseOLimit, data.base_aggression_other_delta || 0)),
      base_libido_self_delta: Math.max(-0.2, Math.min(0.2, data.base_libido_self_delta || 0)),
      base_aggression_self_delta: Math.max(-0.2, Math.min(0.2, data.base_aggression_self_delta || 0)),
      intensity,
    };
  }

  private static ensureNonZero(deltas: Deltas, user: EmotionData): Deltas {
    for (const key of ["libido_other_delta", "aggression_other_delta"] as const) {
      if (Math.abs(deltas[key]) < 0.001) {
        if (user.affection > 60) deltas[key] = 0.1;
        else if (user.affection < 40) deltas[key] = -0.1;
        else deltas[key] = 0.05;
      }
    }
    return deltas;
  }

  async callUnconsciousLLM(prompt: string): Promise<Deltas> {
    if (!this.config.llmApiKey) {
      this.log("未配置 LLM API Key，使用默认增量");
      return EmotionEngine.defaultDeltas();
    }

    const url = `${this.config.llmApiBase.replace(/\/+$/, "")}/v1/chat/completions`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.llmApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          messages: [
            { role: "system", content: EmotionEngine.ANALYSIS_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const result = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = result.choices?.[0]?.message?.content || "";
      this.log(`LLM response: ${text}`);
      return this.callUnconsciousLLM_postProcess(text);
    } catch (e) {
      this.log(`LLM call failed: ${e}`);
      return EmotionEngine.defaultDeltas();
    }
  }

  // Separate for easier test stubbing
  callUnconsciousLLM_postProcess(text: string): Deltas {
    return EmotionEngine.clampDeltas(EmotionEngine.parseLLMJson(text), 0);
  }

  // ==================== 核心：分析并更新 ====================

  async analyzeAndUpdate(uid: string, message: string, history: string = ""): Promise<Record<string, unknown>> {
    this.applyDecay();

    const user = this.getUser(uid);
    const self = this.getSelf();
    const now = Date.now();

    const isFirst = user.last_interaction === 0;

    if (isFirst) {
      user.last_interaction = now;
      user.turn_count = 1;
      this.userData[uid] = user;
      this.saveUserDataSync();
      return {
        status: "first_interaction",
        message: "初次互动，保持平淡中性",
        ...this.buildPanel(uid),
      };
    }

    const turn = user.turn_count || 1;
    let deltas = await this.callUnconsciousLLM(
      this.buildAnalysisPrompt_inner(user, self, history, message, turn),
    );
    deltas = EmotionEngine.clampDeltas(deltas, turn);
    deltas = EmotionEngine.ensureNonZero(deltas, user);

    const sens = this.config.sensitivity * deltas.intensity;

    // 更新用户当前值
    user.current_libido_other = Math.max(0, Math.min(50, user.current_libido_other + deltas.libido_other_delta * sens));
    user.current_aggression_other = Math.max(0, Math.min(50, user.current_aggression_other + deltas.aggression_other_delta * sens));
    user.affection = Math.max(0, Math.min(100, user.affection + deltas.affection_delta * sens));

    const baseCoef = turn <= 10 ? 1.0 : 0.2;
    user.base_libido_other = Math.max(0, Math.min(50, user.base_libido_other + deltas.base_libido_other_delta * baseCoef));
    user.base_aggression_other = Math.max(0, Math.min(50, user.base_aggression_other + deltas.base_aggression_other_delta * baseCoef));

    user.turn_count = turn + 1;
    user.last_interaction = now;
    user.last_update = now;
    user.idle_triggered = false;
    this.userData[uid] = user;
    this.saveUserDataSync();

    // 更新自身
    this.selfData.current_libido_self = Math.max(0, Math.min(50, this.selfData.current_libido_self + deltas.libido_self_delta * sens));
    this.selfData.current_aggression_self = Math.max(0, Math.min(50, this.selfData.current_aggression_self + deltas.aggression_self_delta * sens));
    this.selfData.base_libido_self = Math.max(0, Math.min(50, this.selfData.base_libido_self + deltas.base_libido_self_delta * 0.2));
    this.selfData.base_aggression_self = Math.max(0, Math.min(50, this.selfData.base_aggression_self + deltas.base_aggression_self_delta * 0.2));
    this.selfData.last_update = now;
    this.saveSelfDataSync();

    const round4 = (v: number) => Math.round(v * 10000) / 10000;
    return {
      status: "updated",
      deltas: Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, round4(v)])),
      sensitivity: round4(sens),
      ...this.buildPanel(uid),
    };
  }

  // ==================== 管理操作 ====================

  resetUser(uid: string): EmotionPanel {
    this.createUser(uid);
    this.saveUserDataSync();
    return this.buildPanel(uid);
  }

  setEmotion(uid: string, fields: Partial<{
    affection: number; libido_other: number; aggression_other: number;
    libido_self: number; aggression_self: number;
  }>): EmotionPanel {
    const user = this.getUser(uid);
    if (fields.affection !== undefined) user.affection = Math.max(0, Math.min(100, fields.affection));
    if (fields.libido_other !== undefined) {
      const v = Math.max(0, Math.min(50, fields.libido_other));
      user.current_libido_other = v;
      user.base_libido_other = v;
    }
    if (fields.aggression_other !== undefined) {
      const v = Math.max(0, Math.min(50, fields.aggression_other));
      user.current_aggression_other = v;
      user.base_aggression_other = v;
    }
    if (fields.libido_self !== undefined) {
      const v = Math.max(0, Math.min(50, fields.libido_self));
      this.selfData.current_libido_self = v;
      this.selfData.base_libido_self = v;
      this.saveSelfDataSync();
    }
    if (fields.aggression_self !== undefined) {
      const v = Math.max(0, Math.min(50, fields.aggression_self));
      this.selfData.current_aggression_self = v;
      this.selfData.base_aggression_self = v;
      this.saveSelfDataSync();
    }
    this.userData[uid] = user;
    this.saveUserDataSync();
    return this.buildPanel(uid);
  }

  resetAll(): void {
    for (const key of Object.keys(this.userData)) {
      delete this.userData[key];
    }
    this.selfData = EmotionEngine.defaultSelfData(this.config);
    this.saveUserDataSync();
    this.saveSelfDataSync();
  }
}
