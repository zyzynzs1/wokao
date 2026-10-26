import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import type { AnswerLayout, AppSettings, LanSyncInfo } from '../../../shared/types'
import { MODEL_PRESETS, PROVINCES } from '../../../shared/types'
import './settings.css'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export default function SettingsPage(): JSX.Element {
  const { user } = useAuth()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerId, setProviderId] = useState('custom')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [province, setProvince] = useState('辽宁')
  const [localStudyDir, setLocalStudyDir] = useState('')
  const [answerLayout, setAnswerLayout] = useState<AnswerLayout>('vertical')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  // 局域网同步
  const [lanSync, setLanSync] = useState<LanSyncInfo | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [syncToken, setSyncToken] = useState('')
  const [lanMsg, setLanMsg] = useState('')
  const [lanBusy, setLanBusy] = useState(false)

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setBaseUrl(s.deepseek.baseUrl)
      setModel(s.deepseek.model)
      setApiKey(s.deepseek.apiKey)
      // 回显服务商：优先按接口地址反查（老配置更能反映真实平台），其次用已保存的 provider
      const matched = MODEL_PRESETS.find(
        (p) => p.id !== 'custom' && p.baseUrl && p.baseUrl === s.deepseek.baseUrl.trim()
      )
      setProviderId(matched?.id ?? s.provider ?? 'custom')
      setProvince(s.province ?? '辽宁')
      setLocalStudyDir(s.localStudyDir ?? '')
      setAnswerLayout(s.answerLayout ?? 'vertical')
    })
    void window.api.getLanSyncInfo().then((info) => {
      setLanSync(info)
      setServerUrl(info.serverUrl)
      setSyncToken(info.token)
    })
  }, [])

  // 当前选中的服务商预设（找不到时回退到「自定义」）
  const preset =
    MODEL_PRESETS.find((p) => p.id === providerId) ?? MODEL_PRESETS[MODEL_PRESETS.length - 1]

  const pickProvider = (id: string): void => {
    setProviderId(id)
    const p = MODEL_PRESETS.find((x) => x.id === id)
    // 预设服务商自动填好地址与模型名；自定义保留手填内容
    if (p && p.id !== 'custom') {
      setBaseUrl(p.baseUrl)
      setModel(p.model)
    }
  }

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    setMessage('')
    const next: AppSettings = {
      province,
      localStudyDir: localStudyDir.trim(),
      provider: providerId,
      answerLayout,
      deepseek: { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() }
    }
    await window.api.updateSettings(next)
    setSettings(next)
    setSaving(false)
    setMessage('已保存')
  }

  // 布局方式即时生效：选中后立刻写回设置，无需再点保存
  const pickLayout = async (layout: AnswerLayout): Promise<void> => {
    setAnswerLayout(layout)
    if (!settings) return
    const next: AppSettings = { ...settings, answerLayout: layout }
    await window.api.updateSettings(next)
    setSettings(next)
  }

  const test = async (): Promise<void> => {
    await save()
    setTesting(true)
    setMessage('')
    const res = await window.api.testConnection()
    setTesting(false)
    setMessage(res.ok ? `✅ ${res.message}` : `❌ ${res.message}`)
  }

  const copy = async (text: string): Promise<void> => {
    setLanMsg((await copyText(text)) ? '已复制到剪贴板' : '复制失败，请手动输入')
  }

  const toggleServer = async (): Promise<void> => {
    if (!lanSync) return
    setLanBusy(true)
    setLanMsg('')
    setLanSync(await window.api.setLanSyncServer(!lanSync.running))
    setLanBusy(false)
  }

  const regenToken = async (): Promise<void> => {
    setLanBusy(true)
    const info = await window.api.regenerateSyncToken()
    setLanSync(info)
    setLanBusy(false)
    setLanMsg('同步码已更新，手机端需重新填写')
  }

  const saveClient = async (): Promise<void> => {
    setLanBusy(true)
    setLanSync(await window.api.saveLanSyncClient(serverUrl, syncToken))
    setLanBusy(false)
    setLanMsg('已保存')
  }

  const doSync = async (): Promise<void> => {
    setLanBusy(true)
    setLanMsg('')
    await window.api.saveLanSyncClient(serverUrl, syncToken)
    const res = await window.api.runLanSync()
    setLanSync(await window.api.getLanSyncInfo())
    setLanBusy(false)
    setLanMsg(
      res.ok
        ? `✅ 同步完成：新增 ${res.added ?? 0} 条，本机共 ${res.total ?? 0} 条`
        : `❌ ${res.error}`
    )
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">设置</h1>

      <div className="card">
        <h3 className="settings-section">账号信息</h3>
        <div className="settings-row">
          <span className="settings-label">昵称</span>
          <span>{user?.nickname}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">用户名</span>
          <span>{user?.username}</span>
        </div>
      </div>

      <div className="card">
        <h3 className="settings-section">备考偏好</h3>
        <div className="settings-form">
          <div className="settings-field">
            <label>省考目标省份（默认辽宁）</label>
            <select
              className="input"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label>本地学习资料目录</label>
            <input
              className="input"
              value={localStudyDir}
              onChange={(e) => setLocalStudyDir(e.target.value)}
              placeholder="例如 D:\BaiduNetdiskDownload\shenlun"
            />
          </div>
          <div className="settings-field">
            <label>作答布局方式（选中即生效）</label>
            <div className="layout-picker">
              <button
                type="button"
                className={`layout-option${answerLayout === 'vertical' ? ' active' : ''}`}
                onClick={() => void pickLayout('vertical')}
              >
                <span className="layout-preview layout-preview-vertical">
                  <i />
                  <i />
                </span>
                <span className="layout-option-title">上下布局</span>
                <span className="layout-option-desc">资料在上，作答在下（默认）</span>
              </button>
              <button
                type="button"
                className={`layout-option${answerLayout === 'horizontal' ? ' active' : ''}`}
                onClick={() => void pickLayout('horizontal')}
              >
                <span className="layout-preview layout-preview-horizontal">
                  <i />
                  <i />
                </span>
                <span className="layout-option-title">左右布局</span>
                <span className="layout-option-desc">资料在左，作答在右并对齐</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="settings-section">AI 评分模型</h3>
        <p className="settings-hint">
          用于大作文划档精修与答题点评。小题分数由本地采分点规则计算，不依赖接口。没有 API Key
          也可正常练习与评分，配置免费模型后可额外获得 AI 点评、范文与答题骨架。
        </p>
        <div className="settings-form">
          <div className="settings-field">
            <label>模型服务商</label>
            <select
              className="input"
              value={providerId}
              onChange={(e) => pickProvider(e.target.value)}
            >
              {MODEL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {preset.note && <p className="settings-note">{preset.note}</p>}
          <div className="settings-field">
            <label>接口地址 Base URL</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="settings-field">
            <label>模型 Model</label>
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="settings-field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="粘贴你自己的 API Key"
            />
          </div>
          {!apiKey.trim() && (
            <div className="settings-guide">
              <span className="settings-guide-text">
                未填写 API Key 时仅使用本地规则评分，不会有 AI 点评与范文。
              </span>
              {preset.applyUrl && (
                <a
                  className="settings-guide-link"
                  href={preset.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {preset.free ? '免费领取 API Key' : '获取 API Key'} →
                </a>
              )}
            </div>
          )}
        </div>
        {message && <div className="settings-message">{message}</div>}
        <div className="settings-actions">
          <button className="btn btn-outline" onClick={test} disabled={testing || saving}>
            {testing ? '测试中…' : '保存并测试连接'}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="settings-section">局域网同步</h3>
        {!lanSync ? (
          <div className="empty">加载中…</div>
        ) : lanSync.role === 'server' ? (
          <>
            <p className="settings-hint">
              本机作为同步服务端。手机连同一 Wi-Fi 后，把下面两个值填到手机端「设置 →
              局域网同步」即可同步作答记录。合并只新增不覆盖，两端数据都不会丢。
            </p>
            <div className="settings-row">
              <span className="settings-label">服务状态</span>
              <span>
                {lanSync.running ? '✅ 运行中' : lanSync.error ? `❌ ${lanSync.error}` : '⏸ 未启动'}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">手机端填这个地址</span>
              <span className="sync-values">
                {lanSync.addresses.length === 0 ? (
                  <span className="sync-empty">未检测到局域网地址，请确认电脑已连 Wi-Fi 或网线</span>
                ) : (
                  lanSync.addresses.map((a) => (
                    <button key={a} className="sync-copy" onClick={() => void copy(a)}>
                      {a} ⧉
                    </button>
                  ))
                )}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">同步码</span>
              <span className="sync-values">
                <button className="sync-copy" onClick={() => void copy(lanSync.token)}>
                  {lanSync.token} ⧉
                </button>
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">最近同步</span>
              <span>
                {lanSync.lastSyncAt ? formatTime(lanSync.lastSyncAt) : '暂无'}
                {lanSync.mergedCount > 0 ? ` · 本次运行已合并 ${lanSync.mergedCount} 条` : ''}
              </span>
            </div>
            <div className="settings-actions">
              <button className="btn btn-outline" onClick={regenToken} disabled={lanBusy}>
                重新生成同步码
              </button>
              {lanSync.running ? (
                <button className="btn btn-outline" onClick={toggleServer} disabled={lanBusy}>
                  停止同步服务
                </button>
              ) : (
                <button className="btn btn-primary" onClick={toggleServer} disabled={lanBusy}>
                  开启同步服务
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="settings-hint">
              在电脑端「设置 → 局域网同步」开启服务，把它显示的地址和同步码填到下面。手机需与电脑连接同一
              Wi-Fi。
            </p>
            <div className="settings-form">
              <div className="settings-field">
                <label>电脑端地址</label>
                <input
                  className="input"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="例如 192.168.1.5:8848"
                />
              </div>
              <div className="settings-field">
                <label>同步码</label>
                <input
                  className="input"
                  value={syncToken}
                  onChange={(e) => setSyncToken(e.target.value)}
                  placeholder="电脑端显示的 8 位同步码"
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">上次同步</span>
              <span>{lanSync.lastSyncAt ? formatTime(lanSync.lastSyncAt) : '暂无'}</span>
            </div>
            <div className="settings-actions">
              <button className="btn btn-outline" onClick={saveClient} disabled={lanBusy}>
                保存
              </button>
              <button className="btn btn-primary" onClick={doSync} disabled={lanBusy}>
                {lanBusy ? '同步中…' : '立即同步'}
              </button>
            </div>
          </>
        )}
        {lanMsg && <div className="settings-message">{lanMsg}</div>}
      </div>

      <div className="card">
        <h3 className="settings-section">关于</h3>
        <p className="settings-hint">
          wokao · 专注国考与省考申论练习。所有数据保存在本地，请妥善保管账号信息。
        </p>
      </div>
    </div>
  )
}
