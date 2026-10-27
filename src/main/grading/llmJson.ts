// 评分阶段的统一模型调用：温度 0、JSON 输出、失败重试一次。
import type { DeepSeekConfig } from '../llm'
import { chat } from '../llm'
import type { ChatMsg } from './prompts'
import { parseJsonObject } from './validators'

export async function callJson(
  llm: DeepSeekConfig,
  messages: ChatMsg[],
  opts?: { maxTokens?: number; temperature?: number }
): Promise<Record<string, unknown>> {
  const maxTokens = opts?.maxTokens ?? 4000
  const temperature = opts?.temperature ?? 0
  const raw = await chat(llm, messages, { temperature, json: true, maxTokens })
  const parsed = parseJsonObject(raw)
  if (parsed) return parsed
  // 一次修复重试：把上一轮输出截断后要求只输出 JSON
  const retry = await chat(
    llm,
    [
      ...messages,
      {
        role: 'assistant',
        content: raw.slice(0, 1200)
      },
      {
        role: 'user',
        content: '你上一次的输出不是合法 JSON。请只输出一个合法的 JSON 对象，不要解释、不要 markdown 围栏。'
      }
    ],
    { temperature, json: true, maxTokens }
  )
  const second = parseJsonObject(retry)
  if (!second) throw new Error('模型未返回合法 JSON（评分阶段）')
  return second
}
