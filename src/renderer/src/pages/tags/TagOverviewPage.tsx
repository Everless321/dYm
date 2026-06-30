import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Library } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { getAvatarUrl } from '@/lib/utils'

export default function TagOverviewPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<TagOverviewStats>({
    totalVideos: 0,
    tagged: 0,
    untagged: 0,
    tagKinds: 0
  })
  const [users, setUsers] = useState<UserTagStats[]>([])
  const [search, setSearch] = useState('')

  const load = async () => {
    const [s, u] = await Promise.all([
      window.api.tag.getOverviewStats(),
      window.api.tag.getUserStats()
    ])
    setStats(s)
    setUsers(u.filter((x) => x.total > 0))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return users
    return users.filter((u) => u.nickname.toLowerCase().includes(kw))
  }, [users, search])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-8 border-b border-[#E5E5E7] bg-white shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-[#1D1D1F]">标签管理</h1>
          <p className="text-xs text-[#A1A1A6] mt-0.5">选择用户，查看并管理每个用户的视频标签</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/tags/library')}>
          <Library className="h-4 w-4 mr-1.5" />
          标签库管理
        </Button>
      </div>

      <div className="flex-1 overflow-hidden p-8 flex flex-col gap-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 shrink-0">
          <StatCard label="总视频数" value={stats.totalVideos} />
          <StatCard label="已标记" value={stats.tagged} color="#34C759" />
          <StatCard label="未标记" value={stats.untagged} color="#FF9500" />
          <StatCard label="标签种类" value={stats.tagKinds} color="#0A84FF" />
        </div>

        {/* User list */}
        <div className="flex-1 min-h-0 rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F2] shrink-0">
            <span className="text-sm font-medium text-[#1D1D1F]">用户列表</span>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索用户"
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* Column header */}
          <div className="flex items-center px-6 py-3 bg-[#FAFAFA] text-xs font-medium text-[#A1A1A6] border-b border-[#F0F0F2] shrink-0">
            <span className="flex-1">用户</span>
            <div className="flex items-center gap-8">
              <span className="w-12 text-right">视频数</span>
              <span className="w-40 text-center">标记进度</span>
              <span className="w-16 text-right">操作</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#F4F4F6]">
            {filtered.map((u) => {
              const pct = u.total ? (u.tagged / u.total) * 100 : 0
              return (
                <div
                  key={u.sec_uid}
                  className="flex items-center px-6 py-3.5 hover:bg-[#FAFAFA] transition-colors"
                >
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={getAvatarUrl(u)} className="object-cover" />
                      <AvatarFallback className="bg-[#E8F0FE] text-[#0A84FF]">
                        {u.nickname?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-[#1D1D1F] truncate">{u.nickname}</span>
                  </div>
                  <div className="flex items-center gap-8">
                    <span className="w-12 text-right text-sm text-[#1D1D1F] tabular-nums">
                      {u.total}
                    </span>
                    <div className="w-40 flex items-center gap-2.5">
                      <Progress value={pct} className="flex-1" />
                      <span className="text-xs text-[#A1A1A6] whitespace-nowrap tabular-nums w-9 text-right">
                        {u.tagged}/{u.total}
                      </span>
                    </div>
                    <div className="w-16 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/tags/user/${u.sec_uid}`)}
                      >
                        查看
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-[#A1A1A6]">暂无用户</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  color = '#1D1D1F'
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] px-5 py-4">
      <div className="text-xs text-[#A1A1A6]">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1.5" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
