import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Save, FolderOpen, Key, Cookie, Database, CheckCircle, Chrome, Loader2, Download, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export default function SystemPage() {
  const [cookie, setCookie] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://api.x.ai/v1')
  const [downloadPath, setDownloadPath] = useState('')
  const [maxDownloadCount, setMaxDownloadCount] = useState('50')
  const [videoDownloadConcurrency, setVideoDownloadConcurrency] = useState('3')
  const [fetchingCookie, setFetchingCookie] = useState(false)
  const [verifyingApi, setVerifyingApi] = useState(false)
  const [analysisConcurrency, setAnalysisConcurrency] = useState('2')
  const [analysisRpm, setAnalysisRpm] = useState('10')
  const [analysisModel, setAnalysisModel] = useState('grok-4-fast')
  const [analysisSlices, setAnalysisSlices] = useState('4')
  const [analysisPrompt, setAnalysisPrompt] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    const settings = await window.api.settings.getAll()
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

  const handleFetchCookie = async () => {
    setFetchingCookie(true)
    try {
      const result = await window.api.cookie.fetchDouyin()
      setCookie(result)
      if (result) {
        toast.success('Cookie 获取成功')
      } else {
        toast.warning('未获取到 Cookie，请确保已登录')
      }
    } catch {
      toast.error('获取 Cookie 失败')
    } finally {
      setFetchingCookie(false)
    }
  }

  const handleSaveCookie = async () => {
    try {
      await window.api.settings.set('douyin_cookie', cookie)
      toast.success('Cookie 已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleSaveApi = async () => {
    try {
      await window.api.settings.set('grok_api_key', apiKey)
      await window.api.settings.set('grok_api_url', apiUrl)
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
      await window.api.grok.verify(apiKey, apiUrl)
      toast.success('API Key 验证成功')
    } catch (error) {
      toast.error(`验证失败: ${(error as Error).message}`)
    } finally {
      setVerifyingApi(false)
    }
  }

  const handleSaveStorage = async () => {
    try {
      await window.api.settings.set('download_path', downloadPath)
      toast.success('存储设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleSaveDownload = async () => {
    try {
      await window.api.settings.set('max_download_count', maxDownloadCount)
      await window.api.settings.set('video_download_concurrency', videoDownloadConcurrency)
      toast.success('下载设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleSaveAnalysis = async () => {
    try {
      await window.api.settings.set('analysis_concurrency', analysisConcurrency)
      await window.api.settings.set('analysis_rpm', analysisRpm)
      await window.api.settings.set('analysis_model', analysisModel)
      await window.api.settings.set('analysis_slices', analysisSlices)
      await window.api.settings.set('analysis_prompt', analysisPrompt)
      toast.success('分析设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">系统设置</h2>
        <p className="text-sm text-muted-foreground mt-1">配置应用程序设置</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <Cookie className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <CardTitle className="text-lg">抖音 Cookie</CardTitle>
              <CardDescription>设置抖音登录 Cookie 用于获取视频数据</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="cookie">Cookie</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchCookie}
                disabled={fetchingCookie}
              >
                {fetchingCookie ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Chrome className="h-4 w-4 mr-2" />
                )}
                {fetchingCookie ? '等待登录...' : '从浏览器获取'}
              </Button>
            </div>
            <Textarea
              id="cookie"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="请输入抖音 Cookie..."
              className="min-h-32 font-mono text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">
              点击"从浏览器获取"将打开 Chrome，登录抖音后关闭浏览器即可自动获取
            </p>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSaveCookie}>
              <Save className="h-4 w-4 mr-2" />
              保存 Cookie
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <Key className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Grok API</CardTitle>
              <CardDescription>配置 Grok API 用于视频内容分析</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <div className="flex gap-3">
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xai-..."
                className="flex-1 font-mono"
              />
              <Button variant="outline" onClick={handleVerifyApi} disabled={verifyingApi}>
                {verifyingApi ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                {verifyingApi ? '验证中...' : '验证'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">从 x.ai 控制台获取 API Key</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-url">API URL</Label>
            <Input
              id="api-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.x.ai/v1"
              className="font-mono"
            />
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSaveApi}>
              <Save className="h-4 w-4 mr-2" />
              保存设置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Database className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg">存储设置</CardTitle>
              <CardDescription>配置视频下载存储位置</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="storage-path">下载目录</Label>
            <div className="flex gap-3">
              <Input
                id="storage-path"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder="/path/to/downloads"
                className="flex-1 font-mono"
              />
              <Button variant="outline">
                <FolderOpen className="h-4 w-4 mr-2" />
                选择
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">视频将保存到此目录下</p>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSaveStorage}>
              <Save className="h-4 w-4 mr-2" />
              保存设置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Download className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-lg">下载设置</CardTitle>
              <CardDescription>配置视频下载参数</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="max-download">单次最大下载数量</Label>
              <Input
                id="max-download"
                type="number"
                min="0"
                max="500"
                value={maxDownloadCount}
                onChange={(e) => setMaxDownloadCount(e.target.value)}
                placeholder="0"
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">每个用户最多下载的视频数量，0 表示不限制</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="video-concurrency">视频下载并发数</Label>
              <Input
                id="video-concurrency"
                type="number"
                min="1"
                max="10"
                value={videoDownloadConcurrency}
                onChange={(e) => setVideoDownloadConcurrency(e.target.value)}
                placeholder="3"
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">同时下载的视频数量</p>
            </div>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSaveDownload}>
              <Save className="h-4 w-4 mr-2" />
              保存设置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-pink-100 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-pink-600" />
            </div>
            <div>
              <CardTitle className="text-lg">分析设置</CardTitle>
              <CardDescription>配置视频内容分析参数</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="analysis-concurrency">并发数量</Label>
              <Input
                id="analysis-concurrency"
                type="number"
                min="1"
                max="10"
                value={analysisConcurrency}
                onChange={(e) => setAnalysisConcurrency(e.target.value)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">同时分析的视频数量</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis-rpm">每分钟请求数 (RPM)</Label>
              <Input
                id="analysis-rpm"
                type="number"
                min="1"
                max="60"
                value={analysisRpm}
                onChange={(e) => setAnalysisRpm(e.target.value)}
                placeholder="10"
              />
              <p className="text-xs text-muted-foreground">API 请求速率限制</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis-model">模型名称</Label>
              <Input
                id="analysis-model"
                value={analysisModel}
                onChange={(e) => setAnalysisModel(e.target.value)}
                placeholder="grok-2-vision-latest"
              />
              <p className="text-xs text-muted-foreground">用于分析的视觉模型</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis-slices">视频切片数</Label>
              <Input
                id="analysis-slices"
                type="number"
                min="1"
                max="20"
                value={analysisSlices}
                onChange={(e) => setAnalysisSlices(e.target.value)}
                placeholder="4"
              />
              <p className="text-xs text-muted-foreground">从视频中均匀截取的帧数</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="analysis-prompt">分析提示词</Label>
            <Textarea
              id="analysis-prompt"
              value={analysisPrompt}
              onChange={(e) => setAnalysisPrompt(e.target.value)}
              placeholder="请输入分析提示词..."
              className="min-h-48 font-mono text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">发送给 AI 的分析指令，用于生成标签和分类</p>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={handleSaveAnalysis}>
              <Save className="h-4 w-4 mr-2" />
              保存设置
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
