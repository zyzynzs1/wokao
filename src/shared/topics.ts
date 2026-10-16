// 申论话题标签体系（三级）
// 一级 = “五位一体”总体布局的五大领域；二级 = 国省考高频话题；三级 = 具体切口/热点。
// 题目以“三级路径”形式记录话题，例如 ['社会/民生保障/养老服务与一老一小']。
// 筛选时按层级前缀匹配：选“社会”匹配该领域全部题目，选“社会/民生保障”匹配该话题全部题目。
// 说明：话题仅作检索与统计用，练习时不作为必选项，未打标签的题目不参与话题筛选。

export interface TopicNode {
  id: string // 完整路径，如 '社会' / '社会/民生保障' / '社会/民生保障/养老服务与一老一小'
  label: string // 本级名称（展示用）
  children?: TopicNode[]
}

export const TOPIC_TREE: TopicNode[] = [
  {
    id: '政治',
    label: '政治',
    children: [
      {
        id: '政治/政务服务与放管服',
        label: '政务服务与放管服',
        children: [
          { id: '政治/政务服务与放管服/一网通办与高效办成一件事', label: '一网通办与高效办成一件事' },
          { id: '政治/政务服务与放管服/无感智办与免申即享', label: '无感智办与免申即享' },
          { id: '政治/政务服务与放管服/简政放权', label: '简政放权' }
        ]
      },
      {
        id: '政治/基层治理',
        label: '基层治理',
        children: [
          { id: '政治/基层治理/网格化管理', label: '网格化管理' },
          { id: '政治/基层治理/共建共治共享', label: '共建共治共享' },
          { id: '政治/基层治理/枫桥经验与接诉即办', label: '枫桥经验与接诉即办' },
          { id: '政治/基层治理/为基层减负', label: '为基层减负' }
        ]
      },
      {
        id: '政治/数字政府',
        label: '数字政府',
        children: [
          { id: '政治/数字政府/数据共享', label: '数据共享' },
          { id: '政治/数字政府/智慧监管', label: '智慧监管' },
          { id: '政治/数字政府/数字形式主义', label: '数字形式主义' }
        ]
      },
      {
        id: '政治/法治与执法',
        label: '法治与执法',
        children: [
          { id: '政治/法治与执法/柔性执法与首违不罚', label: '柔性执法与首违不罚' },
          { id: '政治/法治与执法/规范执法与跨部门联合检查', label: '规范执法与跨部门联合检查' },
          { id: '政治/法治与执法/法治政府建设', label: '法治政府建设' }
        ]
      },
      {
        id: '政治/党建与作风',
        label: '党建与作风',
        children: [
          { id: '政治/党建与作风/基层党建', label: '基层党建' },
          { id: '政治/党建与作风/形式主义整治', label: '形式主义整治' },
          { id: '政治/党建与作风/干部担当作为', label: '干部担当作为' }
        ]
      },
      {
        id: '政治/营商环境',
        label: '营商环境',
        children: [
          { id: '政治/营商环境/涉企服务与优化审批', label: '涉企服务与优化审批' },
          { id: '政治/营商环境/民营经济', label: '民营经济' },
          { id: '政治/营商环境/亲清政商关系', label: '亲清政商关系' }
        ]
      }
    ]
  },
  {
    id: '经济',
    label: '经济',
    children: [
      {
        id: '经济/新质生产力与科技创新',
        label: '新质生产力与科技创新',
        children: [
          { id: '经济/新质生产力与科技创新/科技自立自强', label: '科技自立自强' },
          { id: '经济/新质生产力与科技创新/人工智能与数字经济', label: '人工智能与数字经济' },
          { id: '经济/新质生产力与科技创新/产学研融合', label: '产学研融合' }
        ]
      },
      {
        id: '经济/产业发展与转型升级',
        label: '产业发展与转型升级',
        children: [
          { id: '经济/产业发展与转型升级/高质量发展', label: '高质量发展' },
          { id: '经济/产业发展与转型升级/传统产业改造', label: '传统产业改造' },
          { id: '经济/产业发展与转型升级/特色产业集群', label: '特色产业集群' },
          { id: '经济/产业发展与转型升级/低空经济等新赛道', label: '低空经济等新赛道' }
        ]
      },
      {
        id: '经济/数字经济',
        label: '数字经济',
        children: [
          { id: '经济/数字经济/数据要素市场化', label: '数据要素市场化' },
          { id: '经济/数字经济/产业数字化', label: '产业数字化' },
          { id: '经济/数字经济/数字乡村', label: '数字乡村' }
        ]
      },
      {
        id: '经济/乡村振兴',
        label: '乡村振兴',
        children: [
          { id: '经济/乡村振兴/产业振兴与特色农业', label: '产业振兴与特色农业' },
          { id: '经济/乡村振兴/农村电商与直播助农', label: '农村电商与直播助农' },
          { id: '经济/乡村振兴/人才振兴', label: '人才振兴' },
          { id: '经济/乡村振兴/新型农村集体经济', label: '新型农村集体经济' }
        ]
      },
      {
        id: '经济/区域协调与城乡融合',
        label: '区域协调与城乡融合',
        children: [
          { id: '经济/区域协调与城乡融合/城乡融合', label: '城乡融合' },
          { id: '经济/区域协调与城乡融合/区域协同发展', label: '区域协同发展' },
          { id: '经济/区域协调与城乡融合/县域经济', label: '县域经济' }
        ]
      },
      {
        id: '经济/扩大内需与消费',
        label: '扩大内需与消费',
        children: [
          { id: '经济/扩大内需与消费/消费提振', label: '消费提振' },
          { id: '经济/扩大内需与消费/现代服务业', label: '现代服务业' }
        ]
      }
    ]
  },
  {
    id: '文化',
    label: '文化',
    children: [
      {
        id: '文化/文化传承与文化自信',
        label: '文化传承与文化自信',
        children: [
          { id: '文化/文化传承与文化自信/传统文化与非遗活化', label: '传统文化与非遗活化' },
          { id: '文化/文化传承与文化自信/文物与遗产保护', label: '文物与遗产保护' },
          { id: '文化/文化传承与文化自信/文艺精品创作', label: '文艺精品创作' },
          { id: '文化/文化传承与文化自信/中华文化走出去', label: '中华文化走出去' }
        ]
      },
      {
        id: '文化/文旅融合',
        label: '文旅融合',
        children: [
          { id: '文化/文旅融合/文旅产业', label: '文旅产业' },
          { id: '文化/文旅融合/流量变留量', label: '流量变留量' },
          { id: '文化/文旅融合/城市文化IP', label: '城市文化IP' }
        ]
      },
      {
        id: '文化/公共文化服务',
        label: '公共文化服务',
        children: [
          { id: '文化/公共文化服务/文化惠民', label: '文化惠民' },
          { id: '文化/公共文化服务/文化数字化', label: '文化数字化' },
          { id: '文化/公共文化服务/阅读推广', label: '阅读推广' }
        ]
      },
      {
        id: '文化/精神文明与职业道德',
        label: '精神文明与职业道德',
        children: [
          { id: '文化/精神文明与职业道德/移风易俗与乡风文明', label: '移风易俗与乡风文明' },
          { id: '文化/精神文明与职业道德/工匠精神与科学家精神', label: '工匠精神与科学家精神' },
          { id: '文化/精神文明与职业道德/青年奋斗与担当', label: '青年奋斗与担当' }
        ]
      }
    ]
  },
  {
    id: '社会',
    label: '社会',
    children: [
      {
        id: '社会/民生保障',
        label: '民生保障',
        children: [
          { id: '社会/民生保障/养老服务与一老一小', label: '养老服务与一老一小' },
          { id: '社会/民生保障/教育公平与双减', label: '教育公平与双减' },
          { id: '社会/民生保障/医疗保障与集采', label: '医疗保障与集采' },
          { id: '社会/民生保障/住房保障与老旧小区改造', label: '住房保障与老旧小区改造' }
        ]
      },
      {
        id: '社会/就业与青年发展',
        label: '就业与青年发展',
        children: [
          { id: '社会/就业与青年发展/高质量充分就业', label: '高质量充分就业' },
          { id: '社会/就业与青年发展/新就业形态劳动者权益', label: '新就业形态劳动者权益' },
          { id: '社会/就业与青年发展/返乡创业', label: '返乡创业' }
        ]
      },
      {
        id: '社会/社会治理与矛盾化解',
        label: '社会治理与矛盾化解',
        children: [
          { id: '社会/社会治理与矛盾化解/矛盾纠纷多元化解', label: '矛盾纠纷多元化解' },
          { id: '社会/社会治理与矛盾化解/社会心理服务', label: '社会心理服务' },
          { id: '社会/社会治理与矛盾化解/志愿服务', label: '志愿服务' }
        ]
      },
      {
        id: '社会/城市治理与更新',
        label: '城市治理与更新',
        children: [
          { id: '社会/城市治理与更新/城市更新', label: '城市更新' },
          { id: '社会/城市治理与更新/智慧城市', label: '智慧城市' },
          { id: '社会/城市治理与更新/市容秩序与夜市管理', label: '市容秩序与夜市管理' }
        ]
      },
      {
        id: '社会/公共服务与便民',
        label: '公共服务与便民',
        children: [
          { id: '社会/公共服务与便民/便民服务', label: '便民服务' },
          { id: '社会/公共服务与便民/适老化与无障碍', label: '适老化与无障碍' },
          { id: '社会/公共服务与便民/食品安全', label: '食品安全' }
        ]
      }
    ]
  },
  {
    id: '生态',
    label: '生态',
    children: [
      {
        id: '生态/生态文明与绿色发展',
        label: '生态文明与绿色发展',
        children: [
          { id: '生态/生态文明与绿色发展/绿水青山就是金山银山', label: '绿水青山就是金山银山' },
          { id: '生态/生态文明与绿色发展/生态修复与再野化', label: '生态修复与再野化' },
          { id: '生态/生态文明与绿色发展/生态产品价值实现', label: '生态产品价值实现' }
        ]
      },
      {
        id: '生态/双碳与能源转型',
        label: '双碳与能源转型',
        children: [
          { id: '生态/双碳与能源转型/新能源产业', label: '新能源产业' },
          { id: '生态/双碳与能源转型/绿色低碳生活', label: '绿色低碳生活' }
        ]
      },
      {
        id: '生态/环境治理',
        label: '环境治理',
        children: [
          { id: '生态/环境治理/污染防治', label: '污染防治' },
          { id: '生态/环境治理/人居环境整治', label: '人居环境整治' },
          { id: '生态/环境治理/垃圾分类', label: '垃圾分类' }
        ]
      }
    ]
  }
]

// 一级领域（五位一体）
export const TOPIC_DOMAINS: TopicNode[] = TOPIC_TREE

// 取某个路径的指定层级名称：0 为一级，1 为二级，2 为三级
export function topicLevel(path: string, index: number): string {
  return path.split('/')[index] ?? ''
}

// 取末级名称，用于展示
export function topicLabel(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

// 路径深度：1/2/3
export function topicDepth(path: string): number {
  return path.split('/').filter(Boolean).length
}

// 单个路径是否命中筛选条件（按层级前缀匹配，避免“社会/民生”误配“社会/民生X”）
export function topicPathMatch(path: string, filter: string): boolean {
  return path === filter || path.startsWith(filter + '/')
}

// 题目是否命中话题筛选；filter 为空或 'all' 表示不限
export function questionMatchTopic(topics: string[] | undefined, filter?: string): boolean {
  if (!filter || filter === 'all') return true
  if (!topics || topics.length === 0) return false
  return topics.some((t) => topicPathMatch(t, filter))
}

// 按话题筛选题目
export function filterByTopic<T extends { topics?: string[] }>(list: T[], filter?: string): T[] {
  if (!filter || filter === 'all') return list
  return list.filter((q) => questionMatchTopic(q.topics, filter))
}

// 取某个一级领域下的二级话题
export function secondLevelTopics(domainId: string): TopicNode[] {
  return TOPIC_TREE.find((d) => d.id === domainId)?.children ?? []
}

// 收集树中所有路径
function collectPaths(nodes: TopicNode[], out: string[]): string[] {
  for (const n of nodes) {
    out.push(n.id)
    if (n.children) collectPaths(n.children, out)
  }
  return out
}

const TOPIC_PATH_SET = new Set(collectPaths(TOPIC_TREE, []))

// 是否为合法的三级路径（用于校验大模型输出的话题标签）
export function isValidTopicPath(path: string): boolean {
  return TOPIC_PATH_SET.has(path)
}

// 全部三级（末级）路径：供 AI 命题提示词限定可选话题范围
export function leafTopicPaths(): string[] {
  const out: string[] = []
  for (const d of TOPIC_TREE) {
    for (const s of d.children ?? []) {
      for (const t of s.children ?? []) out.push(t.id)
    }
  }
  return out
}
