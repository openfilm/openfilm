/**
 * The models ranked by how well they make films. An OpenFilm film is a web page, so Arena's WebDev leaderboard is the
 * film leaderboard (the Community's Model leaderboard, components/library/ModelBenchmark): its score, and what a task
 * costs on each model (the median per task, and the price per million tokens, input and output blended 3:1), so the
 * person can weigh one against the other.
 *
 * A copy of the board as it stood on the day below, its top hundred (of 162 ranked by votes; one scored only by Arena's
 * automatic evaluation is left out). Who makes each model is as the board's own Labs view names the makers.
 */
export interface BenchmarkRow {
  name: string;
  variant: string;
  lab: string;
  score: number;
  /** the median cost of one task, in US dollars (null: the board does not say) */
  cost: number | null;
  /** the price per million tokens, input and output blended 3:1, in US dollars (null: not said) */
  price: number | null;
  /** the price per million input tokens and per million output tokens (null: not said) */
  io: readonly [number | null, number | null] | null;
}

export const WEBDEV_BENCHMARK = {
  source: 'https://arena.ai/leaderboard/webdev',
  /** the day the board was read (the date it shows) */
  date: '2026-11-20',
  votes: 1_039_371,
  models: 163,
  rows: [
    { name: "Claude Fable 5.2", variant: "xHigh", lab: "Anthropic", score: 1824, cost: 11.7, price: 32, io: [8, 40] },
    { name: "Claude Opus 5.5", variant: "Max", lab: "Anthropic", score: 1819, cost: 9, price: 16, io: [4, 20] },
    { name: "Claude Sonnet 5.5", variant: "xHigh", lab: "Anthropic", score: 1772, cost: 3.03, price: 8, io: [2, 10] },
    { name: "Gemini 4 Carbon", variant: "High", lab: "Google", score: 1769, cost: 1.61, price: 8, io: [2, 10] },
    { name: "GPT-6.2 Astra", variant: "Max", lab: "OpenAI", score: 1766, cost: 5.54, price: 32, io: [8, 40] },
    { name: "Gemini 4 Neon", variant: "High", lab: "Google", score: 1765, cost: 2.59, price: 6, io: [1.5, 7.5] },
    { name: "GPT-6 Astra", variant: "Max", lab: "OpenAI", score: 1764, cost: 9.52, price: 40, io: [10, 50] },
    { name: "GPT-6.2 Sol", variant: "Max", lab: "OpenAI", score: 1754, cost: 1.51, price: 8, io: [2, 10] },
    { name: "Qwen4-Max", variant: "xHigh", lab: "Alibaba", score: 1751, cost: 4.17, price: 3.75, io: [1.5, 4.5] },
    { name: "GPT-6.1 Sol", variant: "Max", lab: "OpenAI", score: 1743, cost: 1.84, price: 8, io: [2, 10] },
    { name: "Claude Fable 5.1", variant: "Max", lab: "Anthropic", score: 1742, cost: 11.54, price: 40, io: [10, 50] },
    { name: "Muse Wonder Full", variant: "Max", lab: "Meta", score: 1723, cost: null, price: null, io: null },
    { name: "Claude Sonnet 5.5", variant: "High", lab: "Anthropic", score: 1715, cost: 1.29, price: 8, io: [2, 10] },
    { name: "Gemini 4 Hydrogen", variant: "High", lab: "Google", score: 1701, cost: 1.36, price: 6, io: [1.5, 7.5] },
    { name: "Claude Opus 5", variant: "Max", lab: "Anthropic", score: 1692, cost: 4.77, price: 20, io: [5, 25] },
    { name: "GPT-6.1 Terra", variant: "Max", lab: "OpenAI", score: 1685, cost: 0.69, price: 4, io: [1, 5] },
    { name: "Kimi K3.1 Pro", variant: "Max", lab: "Moonshot", score: 1683, cost: 0.82, price: 8, io: [2, 10] },
    { name: "Gemini 4 Argon", variant: "High", lab: "Google", score: 1682, cost: 1.15, price: 8, io: [2, 10] },
    { name: "GPT-6 Sol", variant: "Max", lab: "OpenAI", score: 1674, cost: 1.83, price: 8, io: [2, 10] },
    { name: "Qwen3.8-Max", variant: "0902", lab: "Alibaba", score: 1674, cost: 1.91, price: 5, io: [2, 6] },
    { name: "Qwen3.8-Max", variant: "", lab: "Alibaba", score: 1670, cost: 2.3, price: 5, io: [2, 6] },
    { name: "Kimi K3", variant: "Max", lab: "Moonshot", score: 1659, cost: 1.75, price: 12, io: [3, 15] },
    { name: "DeepSeek-V4.1-Flash-20261017", variant: "Max", lab: "DeepSeek", score: 1658, cost: 0.11, price: 0.49, io: [0.15, 0.6] },
    { name: "Claude Opus 5", variant: "High", lab: "Anthropic", score: 1657, cost: 2.94, price: 20, io: [5, 25] },
    { name: "Muse Spark 1.3", variant: "Max", lab: "Meta", score: 1653, cost: 0.76, price: 3.5, io: [1.25, 4.25] },
    { name: "Hy4", variant: "", lab: "Tencent", score: 1650, cost: 0.41, price: null, io: null },
    { name: "Muse Wonder", variant: "Max", lab: "Meta", score: 1647, cost: 1.59, price: 16, io: [4, 20] },
    { name: "Inkling 2 Small", variant: "", lab: "Thinky", score: 1643, cost: 0.31, price: 0.82, io: [0.3, 1] },
    { name: "Grok 4.7", variant: "xHigh", lab: "SpaceXAI", score: 1639, cost: 3.76, price: 5, io: [2, 6] },
    { name: "MiMo-V2.6-Flash", variant: "", lab: "Xiaomi", score: 1638, cost: 0.05, price: 0.25, io: [0.14, 0.28] },
    { name: "Hy4 preview", variant: "", lab: "Tencent", score: 1631, cost: 0.34, price: 1.88, io: [0.75, 2.25] },
    { name: "Claude Fable 5", variant: "High", lab: "Anthropic", score: 1626, cost: 3.06, price: 40, io: [10, 50] },
    { name: "Qwen3.8-Flash-Next", variant: "", lab: "Alibaba", score: 1626, cost: 0.18, price: 0.39, io: [0.16, 0.47] },
    { name: "GLM-5.3", variant: "Max", lab: "Z.ai", score: 1623, cost: 1.4, price: 3.65, io: [1.4, 4.4] },
    { name: "MiMo-V2.6-Pro", variant: "", lab: "Xiaomi", score: 1622, cost: 0.1, price: 0.76, io: [0.43, 0.87] },
    { name: "DeepSeek-V4.1-Flash-20260910", variant: "Max", lab: "DeepSeek", score: 1621, cost: 0.06, price: 0.97, io: [0.3, 1.2] },
    { name: "Muse Spark 1.3", variant: "xHigh", lab: "Meta", score: 1621, cost: 0.48, price: 3.5, io: [1.25, 4.25] },
    { name: "Grok 4.6", variant: "High", lab: "SpaceXAI", score: 1618, cost: 1.57, price: 4, io: [1.6, 4.8] },
    { name: "GPT-5.6 Sol", variant: "xHigh, Codex Harness", lab: "OpenAI", score: 1615, cost: 1.47, price: 16, io: [4, 20] },
    { name: "GLM-5.3-Flash", variant: "", lab: "Z.ai", score: 1610, cost: 0.15, price: 0.06, io: [0.02, 0.07] },
    { name: "U2 Flash", variant: "", lab: "Unisound", score: 1609, cost: 0.11, price: 0.26, io: [0.15, 0.3] },
    { name: "Muse Ember", variant: "Max", lab: "Meta", score: 1608, cost: 0.03, price: 0.4, io: [0.1, 0.5] },
    { name: "GLM-5.2", variant: "Max", lab: "Z.ai", score: 1608, cost: 0.94, price: 3.65, io: [1.4, 4.4] },
    { name: "Claude Haiku 5.5", variant: "High", lab: "Anthropic", score: 1595, cost: 0.12, price: 0.4, io: [0.1, 0.5] },
    { name: "Qwen3.8-27B", variant: "", lab: "Alibaba", score: 1590, cost: 0.41, price: 2.35, io: [0.4, 3] },
    { name: "Gemini 3.7 Flash", variant: "High", lab: "Google", score: 1589, cost: 0.7, price: 3, io: [0.75, 3.75] },
    { name: "Gemini 3.8 Flash", variant: "High", lab: "Google", score: 1584, cost: 0.66, price: 3, io: [0.75, 3.75] },
    { name: "DeepSeek-V4-Flash", variant: "High", lab: "DeepSeek", score: 1582, cost: 0.12, price: 0.97, io: [0.3, 1.2] },
    { name: "MiniMax-M3.1-Flash", variant: "", lab: "MiniMax", score: 1581, cost: 0.14, price: 0.49, io: [0.15, 0.6] },
    { name: "DeepSeek-V4-Pro", variant: "High, 20260813", lab: "DeepSeek", score: 1581, cost: 0.37, price: 3.3, io: [1.32, 3.96] },
    { name: "GPT-6 Luna", variant: "Max", lab: "OpenAI", score: 1578, cost: 0.06, price: 0.4, io: [0.1, 0.5] },
    { name: "Mistral Large 4", variant: "", lab: "Mistral", score: 1573, cost: 0.38, price: 1.75, io: [0.7, 2.1] },
    { name: "Step 5 Preview", variant: "High", lab: "StepFun", score: 1570, cost: 0.86, price: 2.28, io: [1, 2.7] },
    { name: "Claude Opus 4.7", variant: "High", lab: "Anthropic", score: 1557, cost: 1.33, price: 20, io: [5, 25] },
    { name: "Claude Opus 4.7", variant: "", lab: "Anthropic", score: 1556, cost: 1.22, price: 20, io: [5, 25] },
    { name: "Claude Opus 4.8", variant: "High", lab: "Anthropic", score: 1555, cost: 1.7, price: 20, io: [5, 25] },
    { name: "Grok 4.5", variant: "", lab: "SpaceXAI", score: 1552, cost: 0.35, price: 5, io: [2, 6] },
    { name: "Claude Opus 4.6", variant: "High", lab: "Anthropic", score: 1546, cost: 1.67, price: 20, io: [5, 25] },
    { name: "Muse Spark 1.1", variant: "", lab: "Meta", score: 1541, cost: 0.36, price: 3.5, io: [1.25, 4.25] },
    { name: "Claude Sonnet 5", variant: "High", lab: "Anthropic", score: 1539, cost: 1, price: 8, io: [2, 10] },
    { name: "Gemini 3.6 Flash", variant: "High", lab: "Google", score: 1538, cost: 0.76, price: 3, io: [0.75, 3.75] },
    { name: "Claude Opus 4.6", variant: "", lab: "Anthropic", score: 1537, cost: 1.58, price: 20, io: [5, 25] },
    { name: "Claude Opus 4.8", variant: "", lab: "Anthropic", score: 1537, cost: 1.46, price: 20, io: [5, 25] },
    { name: "Muse Spark 1.2", variant: "xHigh", lab: "Meta", score: 1533, cost: 0.37, price: 3.5, io: [1.25, 4.25] },
    { name: "Muse Spark Open", variant: "Max", lab: "Meta", score: 1527, cost: 0.15, price: 3.5, io: [1.25, 4.25] },
    { name: "Claude Sonnet 4.6", variant: "", lab: "Anthropic", score: 1522, cost: 1.08, price: 6, io: [1.5, 7.5] },
    { name: "GPT-5.6 Terra", variant: "xHigh, Codex Harness", lab: "OpenAI", score: 1520, cost: 0.56, price: 9.5, io: [2, 12] },
    { name: "GPT-5.6 Luna", variant: "xHigh, Codex Harness", lab: "OpenAI", score: 1519, cost: 0.08, price: 0.95, io: [0.2, 1.2] },
    { name: "Seed2.1 Pro Preview", variant: "", lab: "Bytedance", score: 1518, cost: 0.33, price: 3.54, io: [0.88, 4.42] },
    { name: "Qwen3.7-Max", variant: "20260517", lab: "Alibaba", score: 1516, cost: 0.54, price: 3.69, io: [1.48, 4.42] },
    { name: "GPT-5.5", variant: "xHigh, Codex Harness", lab: "OpenAI", score: 1512, cost: 1.45, price: 23.75, io: [5, 30] },
    { name: "Kimi K2.6", variant: "", lab: "Moonshot", score: 1509, cost: 0.24, price: 3.24, io: [0.95, 4] },
    { name: "GLM-5.1", variant: "", lab: "Z.ai", score: 1508, cost: 0.31, price: 3.65, io: [1.4, 4.4] },
    { name: "gemini-3.5-flash", variant: "", lab: "Google", score: 1507, cost: 0.95, price: 3.56, io: [0.75, 4.5] },
    { name: "Hy3", variant: "", lab: "Tencent", score: 1506, cost: 0.04, price: 0.47, io: [0.14, 0.58] },
    { name: "Gemini 3.5 Flash", variant: "High", lab: "Google", score: 1500, cost: 0.99, price: 3.56, io: [0.75, 4.5] },
    { name: "Claude Opus 4.5", variant: "High, 32K, 20251101", lab: "Anthropic", score: 1494, cost: null, price: 20, io: [5, 25] },
    { name: "Gemini 3.5 Flash", variant: "Medium", lab: "Google", score: 1490, cost: 0.97, price: 3.56, io: [0.75, 4.5] },
    { name: "GPT-5.5", variant: "High, Codex Harness", lab: "OpenAI", score: 1487, cost: 1.04, price: 23.75, io: [5, 30] },
    { name: "Spark-X2.6", variant: "", lab: "XHToken", score: 1486, cost: 0.09, price: 0.44, io: [0.14, 0.54] },
    { name: "MiniMax-M3", variant: "", lab: "MiniMax", score: 1484, cost: 0.11, price: 0.97, io: [0.3, 1.2] },
    { name: "Qwen3.6-Max-Preview", variant: "", lab: "Alibaba", score: 1481, cost: 0.79, price: 6.02, io: [1.27, 7.61] },
    { name: "MiMo-V2.5-Pro", variant: "", lab: "Xiaomi", score: 1479, cost: 0.07, price: 1.47, io: [0.48, 1.8] },
    { name: "Kimi K2.7 Code", variant: "", lab: "Moonshot", score: 1475, cost: 0.2, price: 2.4, io: [0.6, 3] },
    { name: "Claude Opus 4.5", variant: "20251101", lab: "Anthropic", score: 1469, cost: null, price: 20, io: [5, 25] },
    { name: "DeepSeek-V4-Pro Preview", variant: "High", lab: "DeepSeek", score: 1464, cost: 0.06, price: 3.3, io: [1.32, 3.96] },
    { name: "Qwen3.6-Plus", variant: "", lab: "Alibaba", score: 1462, cost: 0.37, price: 2.38, io: [0.5, 3] },
    { name: "GPT-5.4", variant: "High, Codex Harness", lab: "OpenAI", score: 1462, cost: null, price: 11.88, io: [2.5, 15] },
    { name: "GPT-5.5", variant: "Codex Harness", lab: "OpenAI", score: 1456, cost: 0.65, price: 23.75, io: [5, 30] },
    { name: "DeepSeek-V4-Pro", variant: "", lab: "DeepSeek", score: 1448, cost: 0.05, price: 3.3, io: [1.32, 3.96] },
    { name: "Gemini 3.1 Pro Preview", variant: "", lab: "Google", score: 1446, cost: 0.5, price: 4.75, io: [1, 6] },
    { name: "GPT-5.4", variant: "Medium, Codex Harness", lab: "OpenAI", score: 1442, cost: null, price: 11.88, io: [2.5, 15] },
    { name: "Gemini 3 Pro", variant: "", lab: "Google", score: 1441, cost: null, price: 9.5, io: [2, 12] },
    { name: "Gemini 3 Flash", variant: "", lab: "Google", score: 1440, cost: null, price: 3.21, io: [0.68, 4.05] },
    { name: "MiMo-V2.5", variant: "", lab: "Xiaomi", score: 1438, cost: 0.03, price: 1.6, io: [0.4, 2] },
    { name: "Beam 1.0 501B A23B", variant: "", lab: "Reflection", score: 1437, cost: null, price: 0.81, io: [0.25, 1] },
    { name: "Kimi K2.5", variant: "Thinking", lab: "Moonshot", score: 1436, cost: 0.08, price: 2.4, io: [0.6, 3] },
    { name: "GLM-4.7", variant: "", lab: "Z.ai", score: 1436, cost: null, price: 1.8, io: [0.6, 2.2] },
    { name: "GLM-5", variant: "", lab: "Z.ai", score: 1435, cost: null, price: 2.65, io: [1, 3.2] },
    { name: "MiMo-V2-Pro", variant: "", lab: "Xiaomi", score: 1435, cost: 0.11, price: 2.75, io: [1.1, 3.3] },
  ] satisfies BenchmarkRow[],
} as const;

/** A row's own key (a model can be on the board at more than one setting). */
export const rowKey = (row: BenchmarkRow): string => `${row.name} · ${row.variant}`;

/**
 * The value frontier: the models no other model beats on both counts (a higher score for no more money). Read from the
 * cheapest up, each that scores higher than everything cheaper. Rows without a cost are not on it.
 */
export function valueFrontier(rows: readonly BenchmarkRow[]): Set<string> {
  const priced = rows.filter((row): row is BenchmarkRow & { cost: number } => row.cost != null).sort((a, b) => a.cost - b.cost || b.score - a.score);
  const out = new Set<string>();
  let best = -Infinity;
  for (const row of priced) if (row.score > best) { out.add(rowKey(row)); best = row.score; }
  return out;
}

/** The labs given a colour of their own on the board (the rest share one): the three that place the most models. */
export const COLOURED_LABS = ['Google', 'Anthropic', 'OpenAI'] as const;
