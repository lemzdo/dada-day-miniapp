export default defineAppConfig({
  pages: [
    'pages/today/index',
    'pages/wardrobe/index',
    'pages/profile/index',
    'pages/index/index',
    'pages/outfit-detail/index',
    'pages/outfit-history/index',
    'pages/favorite-outfits/index',
    'pages/style-preferences/index',
    'pages/clothing-detail/index',
    'pages/clothing-form/index',
    'pages/upload-tasks/index',
    'pages/upload-confirm/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FAF6F1',
    navigationBarTitleText: '搭搭day',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FAF6F1',
  },
  permission: {
    'scope.userLocation': {
      desc: '用于获取你所在位置的实时天气，生成更贴近日常场景的穿搭建议',
    },
  },
  requiredPrivateInfos: ['getLocation'],
  tabBar: {
    color: '#A89584',
    selectedColor: '#C9A06A',
    backgroundColor: '#FFFDF9',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/today/index',
        text: '今日推荐',
      },
      {
        pagePath: 'pages/wardrobe/index',
        text: '衣橱',
      },
      {
        pagePath: 'pages/outfit-history/index',
        text: '日历',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
});