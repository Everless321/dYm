import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Video, Sparkles, Download, RefreshCw, ArrowRight, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'

const CHART_BLUE = '#0A84FF'
const CHART_HEIGHT = 220

const tooltipStyle = {
  borderRadius: 10,
  border: 'none',
  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
  fontSize: 12,
  padding: '6px 12px'
}

interface StatCardProps {
  label: string
  value: number
  icon: React.ElementType
  color: string
  bgColor: string
}

function StatCard({ label, value, icon: Icon, color, bgColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex items-center" style={{ padding: '14px 18px', gap: 14 }}>
      <div
        className="rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: bgColor, width: 40, height: 40 }}
      >
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[26px] font-bold text-[#1D1D1F] tabular-nums leading-none tracking-tight">
          {value.toLocaleString()}
        </p>
        <p className="text-[12px] text-[#86868B]" style={{ marginTop: 3 }}>{label}</p>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06)]" style={{ padding: '16px 20px' }}>
      <h3 className="text-[13px] font-medium text-[#86868B]" style={{ marginBottom: 12 }}>{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart() {
  return (
    <div
      className="flex items-center justify-center text-[13px] text-[#C7C7CC]"
      style={{ height: CHART_HEIGHT }}
    >
      暂无数据
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [userDist, setUserDist] = useState<UserDistItem[]>([])
  const [topTags, setTopTags] = useState<TagStatItem[]>([])
  const [levelDist, setLevelDist] = useState<LevelDistItem[]>([])
  const [webInfo, setWebInfo] = useState<WebServerInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, tr, ud, tt, ld, wi] = await Promise.all([
        window.api.dashboard.getOverview(),
        window.api.dashboard.getDownloadTrend(30),
        window.api.dashboard.getUserDistribution(10),
        window.api.dashboard.getTopTags(15),
        window.api.dashboard.getContentLevelDistribution(),
        window.api.system.getWebServerInfo()
      ])
      setOverview(ov)
      setTrend(tr)
      setUserDist(ud)
      setTopTags(tt)
      setLevelDist(ld)
      setWebInfo(wi)
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const trendFormatted = useMemo(
    () => trend.map((p) => ({ ...p, label: p.date.slice(5) })),
    [trend]
  )
  const webEntry =
    webInfo?.urls.find((url) => !url.includes('127.0.0.1') && !url.includes('localhost')) ??
    webInfo?.origin

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F5F7]">
      {/* Header */}
      <div className="flex items-center justify-between bg-white border-b border-[#E5E5E7]" style={{ height: 56, padding: '0 28px' }}>
        <h1 className="text-[16px] font-semibold text-[#1D1D1F]">数据概览</h1>
        <div className="flex items-center" style={{ gap: 8 }}>
          {webEntry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.api.system.openInAppBrowser(webEntry, '网页端视频流')}
              className="text-[#30D158] hover:text-[#30D158]/80"
            >
              <Wifi className="w-3.5 h-3.5 mr-1" />
              Web {webInfo?.port}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            className="text-[#86868B] hover:text-[#1D1D1F]"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/browse')}
            className="text-[#0A84FF] hover:text-[#0A84FF]/80"
          >
            浏览视频
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col" style={{ padding: '20px 28px 28px', gap: 16 }}>
        {webEntry && (
          <div className="bg-[#0F172A] rounded-2xl text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]" style={{ padding: '18px 20px' }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/55">LAN Feed</p>
                <p className="text-[20px] font-semibold mt-1">网页端已经随客户端启动</p>
                <p className="text-[13px] text-white/70 mt-1">{webEntry}</p>
              </div>
              <Button
                size="sm"
                onClick={() => window.api.system.openInAppBrowser(webEntry, '网页端视频流')}
                className="bg-white text-[#0F172A] hover:bg-white/90"
              >
                打开网页端
              </Button>
            </div>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-4" style={{ gap: 14 }}>
          <StatCard label="关注用户" value={overview?.totalUsers ?? 0} icon={Users} color="#0A84FF" bgColor="#E8F0FE" />
          <StatCard label="视频总数" value={overview?.totalPosts ?? 0} icon={Video} color="#30D158" bgColor="#E3F9E8" />
          <StatCard label="已分析" value={overview?.analyzedPosts ?? 0} icon={Sparkles} color="#FF9F0A" bgColor="#FFF3E0" />
          <StatCard label="今日下载" value={overview?.todayDownloads ?? 0} icon={Download} color="#BF5AF2" bgColor="#F3E8FF" />
        </div>

        {/* Row 1: Trend + User Distribution */}
        <div className="grid grid-cols-2" style={{ gap: 14 }}>
          <ChartCard title="近 30 天下载趋势">
            {trendFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <AreaChart data={trendFormatted} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_BLUE} stopOpacity={0.1} />
                      <stop offset="100%" stopColor={CHART_BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#A1A1A6' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#A1A1A6' }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value ?? 0, '下载数']} />
                  <Area type="monotone" dataKey="count" stroke={CHART_BLUE} strokeWidth={2} fill="url(#trendFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: CHART_BLUE }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard title="用户视频分布 Top 10">
            {userDist.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={userDist} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#A1A1A6' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="nickname" tick={{ fontSize: 11, fill: '#6E6E73' }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value ?? 0, '视频数']} />
                  <Bar dataKey="count" fill={CHART_BLUE} radius={[0, 5, 5, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>
        </div>

        {/* Row 2: Tags + Content Level */}
        <div className="grid grid-cols-2" style={{ gap: 14 }}>
          <ChartCard title="热门标签 Top 15">
            {topTags.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={topTags} margin={{ bottom: 4, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" vertical={false} />
                  <XAxis dataKey="tag" tick={{ fontSize: 9, fill: '#6E6E73' }} axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={52} />
                  <YAxis tick={{ fontSize: 10, fill: '#A1A1A6' }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value ?? 0, '出现次数']} />
                  <Bar dataKey="count" fill="#30D158" radius={[4, 4, 0, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard title="内容等级分布">
            {levelDist.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={levelDist} margin={{ bottom: 0, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" vertical={false} />
                  <XAxis dataKey="level" tick={{ fontSize: 11, fill: '#6E6E73' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#A1A1A6' }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value ?? 0, '视频数']} labelFormatter={(l) => `等级 ${l}`} />
                  <Bar dataKey="count" fill="#FF9F0A" radius={[4, 4, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
