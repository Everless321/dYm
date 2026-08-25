/**
 * 钩子范例：每个作品下载完成后打一行日志。
 * 创建脚本时选「作品下载完成」就会得到类似这份的模板。
 * 只记录不改文件。内置这份不会自动跑，点「以此为模板新建」复制后才会挂上钩子。
 */

exports.meta = {
  name: '下载完成后记一笔',
  description: '作品下载完成时在输出里记下作者、作品 id 和文件夹',
  hook: 'post.downloaded'
}

exports.run = async (api, event) => {
  if (!event || event.hook !== 'post.downloaded') {
    api.log('这是「作品下载完成」钩子脚本，请等作品下完后自动触发。')
    return
  }

  const post = event.post
  api.log(`${post.nickname} · ${post.awemeId} · ${event.source}`)
  api.log(event.folderPath)
}
