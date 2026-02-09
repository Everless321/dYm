import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Loader2, CheckCircle } from 'lucide-react'
import { settingsApi, grokApi } from '@/api/client'

export default function SystemPage() {
  const [cookie, setCookie] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://api.x.ai/v1')
  const [verifyingApi, setVerifyingApi] = useState(false)

  const [downloadPath, setDownloadPath] = useState('')
  const [maxDownloadCount, setMaxDownloadCount] = useState('0')
  const [videoDownloadConcurrency, setVideoDownloadConcurrency] = useState('3')

  const [analysisConcurrency, setAnalysisConcurrency] = useState('2')
  const [analysisRpm, setAnalysisRpm] = useState('10')
  const [analysisModel, setAnalysisModel] = useState('grok-4-fast')
  const [analysisSlices, setAnalysisSlices] = useState('4')
  const [analysisPrompt, setAnalysisPrompt] = useState('')

  const [showConcurrencyDropdown, setShowConcurrencyDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showAnalysisConcurrencyDropdown, setShowAnalysisConcurrencyDropdown] = useState(false)
  const [showSlicesDropdown, setShowSlicesDropdown] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    const settings = await settingsApi.getAll()
    setCookie(settings.douyin_cookie || '')
    setApiKey(settings.grok_api_key || '')
    setApiUrl(settings.grok_api_url || 'https://api.x.ai/v1')
    setDownloadPath(settings.download_path || '')
    setMaxDownloadCount(settings.max_download_count || '0')
    setVideoDownloadConcurrency(settings.video_download_concurrency || '3')
    setAnalysisConcurrency(settings.analysis_concurrency || '2')
    setAnalysisRpm(settings.analysis_rpm || '10')
    setAnalysisModel(settings.analysis_model || 'grok-4-fast')
    setAnalysisSlices(settings.analysis_slices || '4')
    setAnalysisPrompt(settings.analysis_prompt || '')
  }

  const handleSaveCookie = async () => {
    try {
      await settingsApi.set('douyin_cookie', cookie)
      toast.success('Cookie 已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleSaveApi = async () => {
    try {
      await settingsApi.set('grok_api_key', apiKey)
      await settingsApi.set('grok_api_url', apiUrl)
      toast.success('API 设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleVerifyApi = async () => {
    if (!apiKey) {
      toast.error('请先输入 API Key')
      return
    }
    setVerifyingApi(true)
    try {
      await grokApi.verify(apiKey, apiUrl)
      toast.success('API Key 验证成功')
    } catch (error) {
      toast.error(`验证失败: ${(error as Error).message}`)
    } finally {
      setVerifyingApi(false)
    }
  }

  const handleSaveDownload = async () => {
    try {
      await settingsApi.set('download_path', downloadPath)
      await settingsApi.set('max_download_count', maxDownloadCount)
      await settingsApi.set('video_download_concurrency', videoDownloadConcurrency)
      toast.success('下载设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleSaveAnalysis = async () => {
    try {
      await settingsApi.set('analysis_concurrency', analysisConcurrency)
      await settingsApi.set('analysis_rpm', analysisRpm)
      await settingsApi.set('analysis_model', analysisModel)
      await settingsApi.set('analysis_slices', analysisSlices)
      await settingsApi.set('analysis_prompt', analysisPrompt)
      toast.success('分析设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleClearData = async () => {
    if (window.confirm('确定要清除所有数据吗？此操作不可恢复。')) {
      toast.success('数据已清除')
    }
  }

  const concurrencyOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
  const modelOptions = ['grok-4-fast', 'grok-4', 'grok-3-vision', 'gpt-4-vision']
  const slicesOptions = ['1', '2', '3', '4', '5', '6', '8', '10']

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center px-6 border-b border-[#E5E5E7] bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-[#1D1D1F]">系统设置</h1>
          <p className="text-sm text-[#6E6E73] mt-0.5">下载、分析与更新的全局配置</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-widest">
                基础配置
              </p>
              <h2 className="text-lg font-semibold text-[#1D1D1F] mt-1">账号与接口</h2>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Cookie Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-[#1D1D1F]">抖音 Cookie</h2>
                  <p className="text-xs text-[#A1A1A6]">设置抖音登录 Cookie 用于获取视频数据</p>
                </div>

                <div className="space-y-3 mt-4">
                  <textarea
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder="粘贴 Cookie..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono resize-none transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveCookie}
                      className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors"
                    >
                      保存 Cookie
                    </button>
                  </div>
                </div>
              </div>

              {/* API Settings Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">API 设置</h2>
                <p className="text-xs text-[#A1A1A6] mb-4">配置 Grok API 用于视频内容分析</p>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="md:min-w-[120px]">
                      <p className="text-sm text-[#1D1D1F]">API Key</p>
                    </div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="xai-**********************"
                      className="w-full md:w-[360px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="md:min-w-[120px]">
                      <p className="text-sm text-[#1D1D1F]">API URL</p>
                    </div>
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="https://api.x.ai/v1"
                      className="w-full md:w-[360px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleVerifyApi}
                      disabled={verifyingApi}
                      className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {verifyingApi ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      验证
                    </button>
                    <button
                      onClick={handleSaveApi}
                      className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-widest">
                任务参数
              </p>
              <h2 className="text-lg font-semibold text-[#1D1D1F] mt-1">下载与分析</h2>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Download Settings Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">下载设置</h2>

                <div className="divide-y divide-[#E5E5E7]">
                  {/* Download Path */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">下载路径</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">视频下载保存位置</p>
                    </div>
                    <input
                      type="text"
                      value={downloadPath}
                      onChange={(e) => setDownloadPath(e.target.value)}
                      placeholder="/path/to/downloads"
                      className="w-full md:w-[320px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                    />
                  </div>

                  {/* Max Download Count */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">最大下载数量</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">0 表示无限制</p>
                    </div>
                    <input
                      type="number"
                      value={maxDownloadCount}
                      onChange={(e) => setMaxDownloadCount(e.target.value)}
                      className="w-full md:w-[140px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20 text-center"
                    />
                  </div>

                  {/* Concurrency */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">并发下载数</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">同时下载的视频数量</p>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowConcurrencyDropdown(!showConcurrencyDropdown)}
                        className="w-full md:w-[160px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-between"
                      >
                        <span className="text-sm text-[#1D1D1F]">{videoDownloadConcurrency}</span>
                        <ChevronDown className="h-4 w-4 text-[#A1A1A6] ml-2" />
                      </button>
                      {showConcurrencyDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-lg border border-[#E5E5E7] shadow-md z-10 max-h-48 overflow-y-auto min-w-[120px]">
                          {concurrencyOptions.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => {
                                setVideoDownloadConcurrency(opt)
                                setShowConcurrencyDropdown(false)
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-[#F2F2F4] transition-colors ${
                                opt === videoDownloadConcurrency
                                  ? 'text-[#0A84FF] font-medium'
                                  : 'text-[#1D1D1F]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveDownload}
                    className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors"
                  >
                    保存下载设置
                  </button>
                </div>
              </div>

              {/* Analysis Settings Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">分析设置</h2>
                <p className="text-xs text-[#A1A1A6] mb-4">配置视频内容分析参数</p>

                <div className="divide-y divide-[#E5E5E7]">
                  {/* Analysis Model */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">AI 模型</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">用于视频分析的模型</p>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                        className="w-full md:w-[220px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-between"
                      >
                        <span className="text-sm text-[#1D1D1F]">{analysisModel}</span>
                        <ChevronDown className="h-4 w-4 text-[#A1A1A6] ml-2" />
                      </button>
                      {showModelDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-lg border border-[#E5E5E7] shadow-md z-10 min-w-[200px]">
                          {modelOptions.map((model) => (
                            <button
                              key={model}
                              onClick={() => {
                                setAnalysisModel(model)
                                setShowModelDropdown(false)
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-[#F2F2F4] transition-colors ${
                                model === analysisModel
                                  ? 'text-[#0A84FF] font-medium'
                                  : 'text-[#1D1D1F]'
                              }`}
                            >
                              {model}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Analysis Concurrency */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">分析并发数</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">同时分析的视频数量</p>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() =>
                          setShowAnalysisConcurrencyDropdown(!showAnalysisConcurrencyDropdown)
                        }
                        className="w-full md:w-[160px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-between"
                      >
                        <span className="text-sm text-[#1D1D1F]">{analysisConcurrency}</span>
                        <ChevronDown className="h-4 w-4 text-[#A1A1A6] ml-2" />
                      </button>
                      {showAnalysisConcurrencyDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-lg border border-[#E5E5E7] shadow-md z-10 max-h-48 overflow-y-auto min-w-[120px]">
                          {concurrencyOptions.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => {
                                setAnalysisConcurrency(opt)
                                setShowAnalysisConcurrencyDropdown(false)
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-[#F2F2F4] transition-colors ${
                                opt === analysisConcurrency
                                  ? 'text-[#0A84FF] font-medium'
                                  : 'text-[#1D1D1F]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Analysis RPM */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">RPM 限制</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">每分钟最大请求数</p>
                    </div>
                    <input
                      type="number"
                      value={analysisRpm}
                      onChange={(e) => setAnalysisRpm(e.target.value)}
                      className="w-full md:w-[140px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20 text-center"
                    />
                  </div>

                  {/* Analysis Slices */}
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">视频切片数</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">每个视频分析的帧数</p>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowSlicesDropdown(!showSlicesDropdown)}
                        className="w-full md:w-[160px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-between"
                      >
                        <span className="text-sm text-[#1D1D1F]">{analysisSlices}</span>
                        <ChevronDown className="h-4 w-4 text-[#A1A1A6] ml-2" />
                      </button>
                      {showSlicesDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-lg border border-[#E5E5E7] shadow-md z-10 min-w-[120px]">
                          {slicesOptions.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => {
                                setAnalysisSlices(opt)
                                setShowSlicesDropdown(false)
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-[#F2F2F4] transition-colors ${
                                opt === analysisSlices
                                  ? 'text-[#0A84FF] font-medium'
                                  : 'text-[#1D1D1F]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Analysis Prompt */}
                  <div className="py-4">
                    <div className="mb-2">
                      <p className="text-sm text-[#1D1D1F]">自定义 Prompt</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">留空使用默认 Prompt</p>
                    </div>
                    <textarea
                      value={analysisPrompt}
                      onChange={(e) => setAnalysisPrompt(e.target.value)}
                      placeholder="自定义分析提示词..."
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] resize-none transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveAnalysis}
                    className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors"
                  >
                    保存分析设置
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-widest">系统</p>
              <h2 className="text-lg font-semibold text-[#1D1D1F] mt-1">关于</h2>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* About Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">关于</h2>

                <div className="divide-y divide-[#E5E5E7]">
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">GitHub</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">查看源代码和发布记录</p>
                    </div>
                    <a
                      href="https://github.com/Everless321/dYm"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[#0A84FF] hover:underline"
                    >
                      Everless321/dYm
                    </a>
                  </div>
                </div>
              </div>

              {/* Danger Zone Card */}
              <div className="bg-white rounded-2xl border border-[#FF3B30]/30 shadow-sm p-6">
                <h2 className="text-base font-semibold text-[#FF3B30] mb-4">危险区域</h2>

                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">清除所有数据</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">删除所有下载的视频和用户数据</p>
                  </div>
                  <button
                    onClick={handleClearData}
                    className="h-9 px-4 rounded-lg border border-[#0A84FF] text-sm font-medium text-[#0A84FF] hover:bg-[#E8F0FE] transition-colors"
                  >
                    清除数据
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
