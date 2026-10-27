// 评分 v2 各阶段提示词。版本：grading-v2.0.0
// 设计原则：模型只做“判断/提取”，不计算总分；所有输出严格 JSON。
import type { GradingConstraints, GradingPoint, PointPool, Question } from '../../shared/types'

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const JSON_ONLY = '只输出 JSON，不要任何解释文字，不要 markdown 围栏。'

function pointLines(points: GradingPoint[]): string {
  return points
    .map((p) => {
      const group = p.group ? `[${p.group}] ` : ''
      return `${p.id}. ${group}${p.text}（材料依据：${p.evidence || '无'}）`
    })
    .join('\n')
}

// ---- 材料建点（不看参考答案、不看考生答案） ----
export function buildPoolMessages(question: Question, constraints: GradingConstraints): ChatMsg[] {
  const typeGuide: Record<string, string> = {
    归纳概括: `本题是“归纳概括”。请先确认题干要概括的要素（问题/原因/做法/变化/特点/成效/观点等），
按“阅卷采分点的概括维度”提炼 4–6 个要点：
- 每个要点是“上位概括词 + 该维度下的具体表现”，不是材料里的每个动作/数据/例子；
- 同一维度下的具体做法、数据、案例全部合并到该要点（可写进 evidence），不得拆成多个独立要点；
- 如果问“变化”，每个要点写成“由 A 转向 B”的维度（如“由事后处罚转向服务型执法”），具体举措作为展开；
- 如果问“特点/成效”，每个要点是概括特点词/成效词，具体表现作为展开。`,
    综合分析: `本题是“综合分析”。按“释义 → 分析（原因/影响/本质）→ 结论/对策”组织 3–5 个要点：
- “释义”要点解释题干词句/观点的含义；
- 分析要点覆盖材料中的关键原因、影响或本质，不要罗列材料所有细节；
- 结论/对策要点落到评价、启示或做法；
- 每个要点是分析维度，不是材料句子。`,
    提出对策: `本题是“提出对策”。提炼 4–6 个对策维度（如设施、队伍、资金、机制、观念、服务等），
每个要点是一条“针对什么问题 + 采取什么对策 + 达到什么目的”的维度；
同一维度下的具体措施合并到该要点，不按材料逐条罗列；对策必须来自材料或由材料问题合理反推。`
  }
  const guide = typeGuide[question.type] ?? ''
  const system = `你是申论阅卷组负责制定评分要点的专家。请只依据【题干】【作答要求】【给定材料】提取本题的“可独立判定的评分要点”。

${guide}

## 核心规则
1. 只从材料提取；不得使用材料外知识，不得写材料没有的内容。
2. **要点数量应接近阅卷采分点数量（通常 4–6 个）**：按概括维度/分析维度/对策维度拆分，不要按材料句子逐条拆。
3. 每个要点必须能单独回答“考生答到没有”；只有彼此独立、能分别得分的维度才拆开；同一维度下的具体做法/数据/例子不单独成点。
4. 背景、例子、宏观意义、标语口号不得作为独立要点。
5. 尽量使用材料原词或规范概括；要点之间语义不得重复。
6. 每条要点的材料依据必须是与该要点同一件事的材料原句，并标明段落位置；找不到依据的不要输出。
7. 不设分值、不排序、不打分。大作文不输出要点。

${JSON_ONLY}
输出格式：
{
  "points": [
    { "text": "标准要点", "group": "分组标签（可空）", "evidence": "[材料X第Y段]：原句", "independent": true }
  ]
}`

  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 题干约束
${JSON.stringify(constraints, null, 2)}

## 给定材料
${question.material}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ---- 应用文内容板块建点（不罗列材料所有事实） ----
export function buildApplicationPoolMessages(question: Question, constraints: GradingConstraints): ChatMsg[] {
  const system = `你是申论公文阅卷专家。请依据【题干】【作答要求】【给定材料】，提炼本题“内容板块”层面的可判定要点（3–6 个），用于应用文内容评分。

## 规则
1. 先判断文种、身份、对象、行文目的（如倡议书要“为什么做/怎么做/怎么参与”，汇报提纲要“基本情况/主要做法/存在问题/下一步”，短评要“观点+理由”）。
2. 要点应覆盖正文的“板块”，例如：背景/目的、核心倡议或做法、参与方式/号召、存在问题、下一步安排等。
3. **每条 point.text 只写板块名称（10–20 字），不要罗列材料事实、活动、数据**；同一板块的材料事实全部放进 evidence（可列 1–3 句关键依据）。
4. 格式要素（标题/称谓/落款/日期）由代码另算，不要写成内容要点。
5. 每条 evidence 必须是与该板块同一主题的材料原句；不得使用材料外知识。
6. 不设分值、不排序、不打分。

${JSON_ONLY}
输出格式：
{
  "points": [
    { "text": "说明活动背景与目的", "group": "内容板块", "evidence": "[材料X第Y段]：原句", "independent": true }
  ]
}`
  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 题干约束
${JSON.stringify(constraints, null, 2)}

## 给定材料
${question.material}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ---- 参考答案校准（参考答案只作候选骨架） ----
export function buildCalibrateMessages(
  question: Question,
  points: GradingPoint[],
  reference: string
): ChatMsg[] {
  const system = `你是申论阅卷组专家。下面给出一份【材料点池】和一份【参考答案】。
参考答案只是候选骨架，不是唯一标准。请回材料校准点池，输出 JSON：

{
  "points": [
    { "text": "标准要点", "group": "分组标签（可空）", "evidence": "[材料X第Y段]：原句", "independent": true }
  ],
  "addedFromMaterial": ["参考答案没写、但材料明确支持且能独立回答题干的要点"],
  "merged": ["参考答案把同一功能拆得过碎、已合并的说明"],
  "conflicts": ["参考答案与材料冲突或无法核实的点，保留说明"]
}

规则：
1. 先补漏：材料明确支持、能独立回答题干的**概括维度/分析维度/对策维度**，即使参考答案没写也要加入；
2. 再合并：参考答案把同一维度拆成多个具体事实/标题的，合并为该维度主点 + 展开；
3. **不得把同一维度下的具体做法、数据、例子拆成新的独立要点**；点池总量保持在 4–6 个维度左右；
4. 不得因参考答案措辞不同而删除材料支持的点；
5. 参考答案与材料冲突时保留争议，不强行纳入；
6. 不得使用材料外知识，不得新增材料没有依据的要点。
${JSON_ONLY}`

  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 当前材料点池
${pointLines(points)}

## 参考答案
${reference}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ---- 逐点判定（不看参考答案，避免锚定） ----
export function buildJudgeMessages(
  question: Question,
  pool: PointPool,
  answer: string,
  application = false
): ChatMsg[] {
  const appNote = application
    ? `\n\n本题为应用文，按“内容板块”整体判断：
- 要点表里的 text 只是板块名称（如“说明背景与目的”），不是逐项核对清单；
- 板块主题写到，且有至少一句具体内容（做法/要求/例子）→ full；
- 只有一句话带过、没有实质内容 → partial；板块完全没提 → none；
- **禁止**以“缺少数据/缺少部门名称/未逐项写明流程/未引用材料原句”为由判 partial；
- 格式要素由代码另算，不要因标题/落款/日期等格式问题判点。`
    : ''
  const system = `你是申论阅卷专家。请逐条判定【要点表】在【考生作答】中的覆盖情况，输出 JSON，不要计算总分。
${appNote}

覆盖状态（只能选一个；要点是“概括维度”，不要求逐字复述所有具体表现）：
- full：完整覆盖（写出了该维度的核心概括，并有至少一个具体表现/做法/说明；表述不同也算）
- equivalent：等义表达（用不同词汇/句式表达同一维度含义）
- partial：部分覆盖（只写了核心概括词、没有具体表现；或只写了具体表现、缺核心概括）
- none：未覆盖（没有出现该维度的核心语义）
- out_of_material：材料外（作答有相关内容但在材料中无依据，不计分）

展开度（结合覆盖状态判断）：
- full：有 2 句以上展开，含材料证据、具体做法或因果分析
- basic：写出核心功能并有必要动作/对象/限定，但展开不充分
- brief：只概括核心方向，没有必要落地信息
- title：只有上位标签或机制名称，无可判定动作
- none：未提及

硬规则：
1. 措辞不同但核心意思到位 → full/equivalent，不得因表述不同扣分；
2. 明确写出核心语义但缺数字/对象/范围 → partial，不得判 none；
3. 要点是概括维度：无需覆盖该维度下所有细节；核心概括 + 至少一个具体表现即可判 full。
   若只写核心概括词而无具体内容 → partial；只写具体表现而缺概括 → partial。
4. 命中/部分覆盖必须抄下考生原句（userQuote）；没有原句的一律不能算命中；
5. 不得新增要点，不得给分，不得编造考生原句；
6. 不要参考任何参考答案，只依据材料与要点表判断。

${JSON_ONLY}
输出格式：
{
  "judgments": [
    { "id": "p1", "status": "full|equivalent|partial|none|out_of_material", "expansion": "full|basic|brief|title|none", "userQuote": "考生原句（未命中留空）", "note": "可选" }
  ]
}`

  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 给定材料
${question.material}

## 要点表（共 ${pool.points.length} 个）
${pointLines(pool.points)}

## 考生作答
${answer}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ---- 复核判点（第二位阅卷专家，独立判断） ----
export function buildReviewMessages(
  question: Question,
  pool: PointPool,
  answer: string,
  application = false
): ChatMsg[] {
  const reversed: PointPool = { ...pool, points: [...pool.points].reverse() }
  const appNote = application
    ? `\n本题为应用文：要点 text 是板块名称，不是逐项清单；板块主题 + 至少一句具体内容 → full；只有一句带过 → partial；完全没提 → none；不因缺数据/缺细节判 partial；格式由代码另算。`
    : ''
  const system = `你是第二位申论阅卷专家，独立复核另一位的判断。请重新逐条判定【要点表】在【考生作答】中的覆盖情况，不要参考其他评分结果。${appNote}

判定标准与输出格式如下，必须完整覆盖全部要点编号：
- 覆盖状态：full（完整覆盖：核心概括 + 至少一个具体表现）/ equivalent（等义）/ partial（只有概括词或只有具体表现）/ none（未覆盖）/ out_of_material（材料外）
- 展开度：full/basic/brief/title/none
- 要点是概括维度，不要求逐字复述所有细节
- 命中必须有考生原句；拿不准时按未覆盖处理（宁可漏判，不要误判）。

${JSON_ONLY}
{
  "judgments": [
    { "id": "p1", "status": "full|equivalent|partial|none|out_of_material", "expansion": "full|basic|brief|title|none", "userQuote": "考生原句", "note": "可选" }
  ]
}`
  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 给定材料
${question.material}

## 要点表（共 ${reversed.points.length} 个）
${pointLines(reversed.points)}

## 考生作答
${answer}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ---- 大作文评阅（袁东累进四类文） ----
export function buildEssayMessages(question: Question, answer: string): ChatMsg[] {
  const system = `你是申论大作文阅卷专家，按袁东“累进四类文”判档。请只依据【题干】【给定材料】【作答要求】【考生作文】输出 JSON，不要计算总分，不要输出建议。

## 判档规则（累进）
- 四类文：跑题（核心命题/关系完全偏离或未涉及）
- 三类文：标题 + 开头（前+后）+ 总论点 + 分论点正确（框架成立）
- 二类文：三类文基础 + 开头、结尾写得好
- 一类文：二类文基础 + 分论点论证写得好
“框架正确”指结构自洽、论点立得住，不是“符合公式”。

## 判题要求（强制顺序）
1. 判主题类型：单主题（1 关键词）/ 双主题（2 关键词，再判 AB 型或 ABC 型）/ 多主题；
2. 判文体：政论（论影响）/ 策论（论对策）/ 议论（对策+影响）；
3. 判是否跑题：核心命题、核心关系是否被覆盖；只“名义提及”限制三类文上限；完全偏题 → 四类；
4. 核对标题、开头（前+后）、总论点、分论点是否正确；
5. 判断开头、结尾是否写得好（决定二类）；
6. 判断分论点论证是否写得好（决定一类）；
7. 列出硬伤：字数、抄材料（连续 ≥20 字）、标题缺主题词、分论点缺关键词、跑题。

## 禁止事项
- 禁止使用“分分总/总分总/并列式/递进式”等通用文章学术语下判语；
- 必须用“主题类型 + 模板层次”说话（如“ABC 型，A→C / B→C / A+B→C”）；
- 不要因为没按公式写而扣结构分，只有结构自洽性、论证力不足才判断。

${JSON_ONLY}
输出格式：
{
  "topicType": "single|double|multi",
  "relationType": "AB|ABC|null",
  "essayStyle": "政论|策论|议论",
  "offTopic": false,
  "offTopicReason": "",
  "titleHasThemeWord": true,
  "structureCorrect": true,
  "openingEndingGood": false,
  "subArgumentEvidenceGood": false,
  "tier": "一类文|二类文|三类文|四类文",
  "tierReason": "逐条说明，引用考生原句",
  "dimensions": [
    { "name": "立意扣题", "level": 0, "note": "0-4 级，附证据" },
    { "name": "材料运用", "level": 0, "note": "" },
    { "name": "论证深度", "level": 0, "note": "" },
    { "name": "结构", "level": 0, "note": "" },
    { "name": "论据例证", "level": 0, "note": "" },
    { "name": "语言", "level": 0, "note": "" }
  ],
  "hardIssues": [ { "type": "字数|抄材料|标题|分论点|跑题|其他", "detail": "具体位置与证据", "penalty": 0 } ]
}`
  const user = `## 题干
${question.title}

## 作答要求
${question.requirement}

## 给定材料
${question.material}

## 考生作文
${answer}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}
