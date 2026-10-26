import type { Paper } from '../../shared/types'
import type { QuestionCore } from '../../shared/difficulty'
import { papers2026, questions2026 } from './gk/2026'
import { papers2025, questions2025 } from './gk/2025'
import { papers2024, questions2024 } from './gk/2024'
import { papers2023, questions2023 } from './gk/2023'
import { papers2022, questions2022 } from './gk/2022'
import { papers2021, questions2021 } from './gk/2021'
import { papers2020, questions2020 } from './gk/2020'
import { papers2019, questions2019 } from './gk/2019'
import { papers2018, questions2018 } from './gk/2018'
import { papers2017, questions2017 } from './gk/2017'
import { papers2016, questions2016 } from './gk/2016'

// 2016—2026 年国家公务员考试《申论》真题汇总（副省级 / 地市级 / 行政执法类）
// 数据按年份拆分在 ./gk/ 目录下，题干、给定资料与参考答案整理自公开真题库
// （ProfessorZhi/gwy-zhenti，粉笔题库整理版本），采分点供练习评分参考。

export const gkQuestions: QuestionCore[] = [
  ...questions2026,
  ...questions2025,
  ...questions2024,
  ...questions2023,
  ...questions2022,
  ...questions2021,
  ...questions2020,
  ...questions2019,
  ...questions2018,
  ...questions2017,
  ...questions2016
]

export const gkPapers: Paper[] = [
  ...papers2026,
  ...papers2025,
  ...papers2024,
  ...papers2023,
  ...papers2022,
  ...papers2021,
  ...papers2020,
  ...papers2019,
  ...papers2018,
  ...papers2017,
  ...papers2016
]
