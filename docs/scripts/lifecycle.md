# 运行与停止

脚本是为长任务设计的：默认不限执行时长，几十小时的批量作业照跑。
代价是你得知道「停止」到底能在什么时候停下来。

## 运行

同一个脚本不能并发运行，正在跑的时候「运行」按钮会变成「停止」。
不同脚本之间互不影响，可以同时跑。

运行状态由主进程广播，**离开页面不会中断脚本**——切到别的页面、甚至关掉开发者模式，
脚本都在后台继续跑，回到页面时状态和日志都还在。

只有退出应用会一并结束运行中的脚本。

## 日志

`api.log(...args)` 输出到「输出」标签页。非字符串参数会被格式化展开
（对象最多展开 4 层），多个参数用空格连接：

```js
api.log('用户', { id: 7, nickname: '张三' })
// 用户 { id: 7, nickname: '张三' }
```

日志缓存在主进程里，每个脚本保留最近 **1000** 条，页面上最多渲染 **500** 条。
缓存只在内存里，**不跨应用重启保留**。要留档就自己写文件：

```js
api.fs.write(api.fs.join(api.fs.userDataRoot, 'my-script.log'), lines.join('\n'))
```

## 停止是协作式的

JavaScript 没法强行中断正在执行的代码，所以「停止」只能在脚本**主动交出控制权**时生效。
具体会在这两个时机停下：

- `await api.sleep(...)` 等待中 —— 立即中断
- 下一次调用**任意** `api.*` 方法时 —— 抛出中断错误

也就是说，只要脚本在循环里调 api 或者 sleep，「停止」就是即时的。

### 纯计算循环停不下来

不调 api、也不 await 的长循环拿不到中断机会，得自己检查：

```js
for (const item of hugeList) {
  api.throwIfCancelled() // 已请求停止则抛出，终止脚本
  heavyComputation(item)
}
```

或者用不抛异常的写法：

```js
for (const item of hugeList) {
  if (api.cancelled) break
  heavyComputation(item)
}
```

### 别把中断当成业务失败

脚本里用 `try/catch` 包 api 调用时，记得让中断错误穿过去：

```js
try {
  await api.actions.syncUser(id)
} catch (error) {
  if (api.cancelled) throw error // 停止不算同步失败，直接终止整个脚本
  api.log('同步失败：' + error.message)
}
```

漏了这一句，点「停止」会被当成一次普通的业务失败，脚本继续往下跑。

## 超时

脚本**默认不限时长**（`timeout` 不填或填 0）。需要保险的话在 `meta` 里设：

```js
exports.meta = {
  name: '...',
  timeout: 2 * 60 * 60 * 1000 // 2 小时后自动中断
}
```

超时走的是和「停止」完全相同的 abort 机制，所以**同样要求脚本会交出控制权**。
纯计算死循环既停不掉也超时不了——长循环记得插 `api.throwIfCancelled()`。

## 结束状态

脚本结束有三种情况，输出面板最后一行会标明：

| 结尾 | 含义 |
| --- | --- |
| `✔ 运行完成，耗时 …` | `run` 正常返回，返回值显示在结果里 |
| `■ 脚本已停止（耗时 …）` | 用户点了停止，或超时触发 |
| `✖ 运行失败：…` | 脚本抛了异常 |

`run` 的返回值需要 **JSON 可序列化**才会被透传，含函数、循环引用之类的值会变成
`undefined`（脚本本身不受影响）。

## 给请求之间加间隔

连续打抖音接口容易触发风控，批量任务应该在每一轮之间随机等一会儿：

```js
const DELAY_MIN_MS = 3000
const DELAY_MAX_MS = 6000

for (const [index, item] of queue.entries()) {
  api.throwIfCancelled()
  await doSomething(item)

  // 最后一个之后不用再等
  if (index < queue.length - 1) {
    await api.sleep(DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)))
  }
}
```

`api.sleep` 在等待期间响应停止，所以哪怕设了 10 分钟的间隔，点「停止」也是立刻生效的。
