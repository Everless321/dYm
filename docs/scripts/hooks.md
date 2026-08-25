# 事件钩子

脚本不必一直点「运行」。新建时选好触发时机，应用在对应事件发生时自动调用
同一个 `exports.run`，并把这次的数据放进第二个参数 `event`。

不要自己写 `exports.hooks = { ... }`——钩子位置在创建对话框里选，写入 `meta.hook`。

## 怎么选

点 **新建脚本**，除了文件名还有「什么时候运行」：

| 选项 | `meta.hook` | 什么时候触发 |
| --- | --- | --- |
| 仅手动 / 定时运行 | （不写） | 点运行，或设 cron |
| 作品下载完成 | `post.downloaded` | 文件校验通过并入库之后 |
| 作品分析完成 | `post.analyzed` | AI 分析结果写入之后 |
| 新作者添加 | `user.added` | 第一次把作者写入数据库时 |
| 直播转封装完成 | `live.converted` | 录制 FLV 转成可播放 MP4 之后 |

选好后模板会带上对应的 `event` 字段注释。详情页也能看到入参，并能单独暂停这个钩子
（代码不用改）。内置范例「下载完成后记一笔」只是给复制用，**不会**自己自动跑。

下载任务、用户同步、单条添加（剪贴板 / `addVideo`）都会走到「作品下载完成」，
靠 `event.source` 区分：`task` / `sync` / `single`。

## 入参

钩子脚本的入口是 `run(api, event)`。手动点「运行」或 cron 触发时 **`event` 为空**，
模板里有守卫，避免直接读 `event.post` 报错。

创建对话框和脚本详情页会列出这些字段；下面是完整说明。

### 作品下载完成 `post.downloaded`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event.hook` | `'post.downloaded'` | 固定值，用来和手动运行区分 |
| `event.source` | `'task' \| 'sync' \| 'single'` | 下载任务 / 用户同步 / 单条添加（剪贴板、`addVideo`） |
| `event.folderPath` | `string` | 本地文件夹绝对路径，视频/封面/文案都在里面 |
| `event.post.id` | `number` | 本地数据库主键，打标签用 |
| `event.post.awemeId` | `string` | 抖音作品 id |
| `event.post.userId` | `number` | 作者本地 id |
| `event.post.secUid` | `string` | 作者 sec_uid，也是下载目录第一层 |
| `event.post.nickname` | `string` | 下载当时的作者昵称 |
| `event.post.folderName` | `string` | 作品文件夹名，一般等于 awemeId |
| `event.post.desc` | `string` | 作品文案 |
| `event.post.awemeType` | `number` | `0` 视频，其它值图文 |
| `event.post.tags` 等分析字段 | | 此时通常还是空的，要等「作品分析完成」 |

```js
exports.run = async (api, event) => {
  if (!event || event.hook !== 'post.downloaded') return
  api.log(event.post.nickname, event.post.awemeId, event.source)
  api.log(event.folderPath)
}
```

### 作品分析完成 `post.analyzed`

`event.post` 形状和上面相同，但分析字段已经填上：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event.post.tags` | `string[]` | AI 标签 |
| `event.post.manualTags` | `string[]` | 手打标签 |
| `event.post.category` | `string \| null` | 主分类 |
| `event.post.summary` | `string \| null` | 一句话摘要 |
| `event.post.scene` | `string \| null` | 场景 |
| `event.post.contentLevel` | `number \| null` | 内容分级 |

分析失败不会触发。

### 新作者添加 `user.added`

库里已有这个 `sec_uid` 再添加一次**不会**触发。头像可能还在下。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event.user.id` | `number` | 本地用户 id，改设置用 `api.db.users.updateSettings` |
| `event.user.secUid` | `string` | 抖音稳定身份 |
| `event.user.uid` | `string` | 抖音 uid，可能是空字符串 |
| `event.user.nickname` | `string` | 入库时的昵称 |
| `event.user.uniqueId` | `string` | 抖音号，可能是空字符串 |

### 直播转封装完成 `live.converted`

此时 `filePath` 已经是 mp4。转换失败不会触发。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event.record.id` | `number` | 录制记录主键 |
| `event.record.userId` | `number` | 作者本地 id |
| `event.record.nickname` | `string \| null` | 录制时昵称 |
| `event.record.roomId` | `string` | 直播间房间号 |
| `event.record.filePath` | `string \| null` | 转好的 MP4 绝对路径 |
| `event.record.fileSize` | `number` | 字节 |

## 排队、停止、超时

钩子和手动运行共用「同一脚本不能并发」这条规则。正在跑的时候新事件会排队，
**不会丢掉**（和 cron「跳过本次」不一样）。队列上限 50，超出丢掉最老的并在输出里提示。

下载循环**不等**脚本结束，钩子不会拖慢下载。

钩子默认 **10 分钟**超时；`meta.timeout` 可改，填 `0` 表示不限。卡住会堵住该脚本后面的事件，
点「停止」会中断当前这次并清空队列。

钩子里再调 `api.actions.addVideo` 仍会再打 `post.downloaded`。用 `event.source` 自己决定
要不要跳过，应用不会悄悄吞掉脚本触发的事件。

某一个脚本抛错只记到它自己的输出，不影响下载，也不影响别的钩子脚本。
