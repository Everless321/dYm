export interface HookParamField {
  name: string
  type: string
  desc: string
}

export interface ScriptHookOption {
  value: ScriptHookName | null
  label: string
  hint: string
  /** 什么时候会触发，比 hint 更完整 */
  when: string
  fields: HookParamField[]
}

const POST_FIELDS: HookParamField[] = [
  {
    name: 'event.post.id',
    type: 'number',
    desc: '本地数据库主键。给 api.db.posts.getById、api.db.tags.addToPosts 用。'
  },
  {
    name: 'event.post.awemeId',
    type: 'string',
    desc: '抖音作品 id。判重用 api.db.posts.getByAwemeId，再查详情用 api.douyin.video。'
  },
  {
    name: 'event.post.userId',
    type: 'number',
    desc: '作者在本地库里的 id，对应 users 表。'
  },
  {
    name: 'event.post.secUid',
    type: 'string',
    desc: '作者 sec_uid。下载目录第一层就是它：api.fs.join(api.fs.downloadRoot, secUid, folderName)。'
  },
  {
    name: 'event.post.nickname',
    type: 'string',
    desc: '入库时的作者昵称。之后作者改名，这里仍是下载当时的名字。'
  },
  {
    name: 'event.post.folderName',
    type: 'string',
    desc: '该作品在作者目录下的文件夹名，一般是 awemeId。'
  },
  {
    name: 'event.post.desc',
    type: 'string',
    desc: '作品文案（未转义的原始描述）。'
  },
  {
    name: 'event.post.awemeType',
    type: 'number',
    desc: '0 是视频，其它值是图文。图文没有单个 mp4，文件夹里是图片。'
  },
  {
    name: 'event.post.tags',
    type: 'string[]',
    desc: 'AI 分析标签。下载完成时通常是空数组，分析完成钩子里才有值。'
  },
  {
    name: 'event.post.manualTags',
    type: 'string[]',
    desc: '手打的标签。下载完成时一般是空的。'
  },
  {
    name: 'event.post.category',
    type: 'string | null',
    desc: 'AI 主分类。下载完成时为 null。'
  },
  {
    name: 'event.post.summary',
    type: 'string | null',
    desc: 'AI 一句话摘要。下载完成时为 null。'
  },
  {
    name: 'event.post.scene',
    type: 'string | null',
    desc: 'AI 场景。下载完成时为 null。'
  },
  {
    name: 'event.post.contentLevel',
    type: 'number | null',
    desc: 'AI 内容分级数字。下载完成时为 null。'
  }
]

export const SCRIPT_HOOK_OPTIONS: ScriptHookOption[] = [
  {
    value: null,
    label: '仅手动 / 定时运行',
    hint: '点「运行」或设 cron 才执行。run(api) 没有 event。',
    when: '只在你点运行，或给这个脚本设了 cron 时执行。第二个参数 event 是 undefined。',
    fields: []
  },
  {
    value: 'post.downloaded',
    label: '作品下载完成',
    hint: '每个作品文件校验入库后触发。',
    when: '作品文件校验通过并写入数据库之后。下载任务、用户同步、剪贴板/addVideo 单条添加都会走到这里。手动点运行时 event 为空。',
    fields: [
      {
        name: 'event.hook',
        type: "'post.downloaded'",
        desc: "固定为此字符串。用来和手动运行区分：if (!event || event.hook !== 'post.downloaded') return"
      },
      {
        name: 'event.source',
        type: "'task' | 'sync' | 'single'",
        desc: '这次下载从哪来。task = 下载任务；sync = 用户同步；single = 单条添加（剪贴板、addVideo、添加用户时下载）。'
      },
      {
        name: 'event.folderPath',
        type: 'string',
        desc: '本地文件夹绝对路径，里面是视频/封面/文案。给 api.fs 和 api.shell 用，不要自己拼分隔符。'
      },
      ...POST_FIELDS
    ]
  },
  {
    value: 'post.analyzed',
    label: '作品分析完成',
    hint: 'AI 分析结果写入数据库后触发。',
    when: '这一条的 AI 分析结果已经写进数据库之后。失败的分析不会触发。手动点运行时 event 为空。',
    fields: [
      {
        name: 'event.hook',
        type: "'post.analyzed'",
        desc: '固定为此字符串。'
      },
      ...POST_FIELDS.map((field) =>
        field.name === 'event.post.tags'
          ? { ...field, desc: 'AI 分析标签数组，例如 ["黑丝", "舞蹈"]。' }
          : field.name === 'event.post.category'
            ? { ...field, desc: 'AI 主分类，例如「穿搭展示」。' }
            : field.name === 'event.post.summary'
              ? { ...field, desc: 'AI 一句话摘要。' }
              : field.name === 'event.post.scene'
                ? { ...field, desc: 'AI 判定的场景，例如「室内」。' }
                : field.name === 'event.post.contentLevel'
                  ? { ...field, desc: 'AI 内容分级数字。' }
                  : field
      )
    ]
  },
  {
    value: 'user.added',
    label: '新作者添加',
    hint: '第一次把作者写入数据库时触发（已存在的不会再触发）。',
    when: '作者第一次写入 users 表时触发。库里已有这个 sec_uid 再添加一次不会触发。头像可能还在下载。手动点运行时 event 为空。',
    fields: [
      {
        name: 'event.hook',
        type: "'user.added'",
        desc: '固定为此字符串。'
      },
      {
        name: 'event.user.id',
        type: 'number',
        desc: '本地用户 id。接着改设置用 api.db.users.updateSettings(id, { ... })。'
      },
      {
        name: 'event.user.secUid',
        type: 'string',
        desc: '作者 sec_uid，抖音侧的稳定身份。'
      },
      {
        name: 'event.user.uid',
        type: 'string',
        desc: '抖音 uid，拿不到时可能是空字符串。'
      },
      {
        name: 'event.user.nickname',
        type: 'string',
        desc: '入库时的昵称。'
      },
      {
        name: 'event.user.uniqueId',
        type: 'string',
        desc: '抖音号。拿不到时可能是空字符串。'
      }
    ]
  },
  {
    value: 'live.converted',
    label: '直播转封装完成',
    hint: '录制的 FLV 转成可播放 MP4 之后触发。',
    when: '录制收尾的 FLV 已经转成可播放 MP4，file_path 已改成 .mp4 之后。转换失败或排队期间文件没了不会触发。手动点运行时 event 为空。',
    fields: [
      {
        name: 'event.hook',
        type: "'live.converted'",
        desc: '固定为此字符串。'
      },
      {
        name: 'event.record.id',
        type: 'number',
        desc: 'live_records 表主键。'
      },
      {
        name: 'event.record.userId',
        type: 'number',
        desc: '对应的本地用户 id。'
      },
      {
        name: 'event.record.nickname',
        type: 'string | null',
        desc: '录制时的作者昵称。'
      },
      {
        name: 'event.record.roomId',
        type: 'string',
        desc: '直播间房间号。'
      },
      {
        name: 'event.record.filePath',
        type: 'string | null',
        desc: '转好的 MP4 绝对路径。此时已经是 .mp4，不是录制中的 FLV。'
      },
      {
        name: 'event.record.fileSize',
        type: 'number',
        desc: '文件大小，字节。'
      }
    ]
  }
]

export function scriptHookLabel(hook: ScriptHookName | null | undefined): string {
  if (!hook) return '仅手动 / 定时'
  return SCRIPT_HOOK_OPTIONS.find((item) => item.value === hook)?.label ?? hook
}

export function scriptHookOption(hook: ScriptHookName | null | undefined): ScriptHookOption {
  return SCRIPT_HOOK_OPTIONS.find((item) => item.value === hook) ?? SCRIPT_HOOK_OPTIONS[0]
}
