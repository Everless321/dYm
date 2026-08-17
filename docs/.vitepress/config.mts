import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'dYm 文档',
  description: 'dYm 自定义脚本 API 与使用文档',

  // 部署到 GitHub Pages 项目站点（.github.io/dYm/）时改成 '/dYm/'
  base: '/',

  // docs/ 下这些是仓库内部资料，不是要发布的页面
  srcExclude: ['TODO.md', 'changelog/**'],

  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: '自定义脚本', link: '/scripts/', activeMatch: '/scripts/' },
      { text: '使用指南', link: '/guide/', activeMatch: '/guide/' },
      { text: 'GitHub', link: 'https://github.com/Everless321/dYm' }
    ],

    sidebar: {
      '/scripts/': [
        {
          text: '自定义脚本',
          items: [
            { text: '总览', link: '/scripts/' },
            { text: '快速开始', link: '/scripts/getting-started' },
            { text: '运行与停止', link: '/scripts/lifecycle' }
          ]
        },
        {
          text: '参考',
          items: [
            { text: 'API 参考', link: '/scripts/api' },
            { text: '示例脚本', link: '/scripts/examples' }
          ]
        }
      ],
      '/guide/': [{ text: '使用指南', items: [{ text: '概览', link: '/guide/' }] }]
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Everless321/dYm' }],

    search: { provider: 'local' },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    returnToTopLabel: '回到顶部',
    lastUpdatedText: '最后更新',

    footer: {
      message: '基于 GPL-3.0 许可发布',
      copyright: 'Copyright © 2026 Everless'
    }
  }
})
