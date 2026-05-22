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
    'pages/upload-confirm/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: '搭一搭',
    navigationBarTextStyle: 'black',
  },
  permission: {
    'scope.userLocation': {
      desc: '用于获取你所在位置的实时天气，生成更贴近日常场景的穿搭建议',
    },
  },
  requiredPrivateInfos: ['getLocation'],
  tabBar: {
    color: '#999',
    selectedColor: '#1a1a1a',
    backgroundColor: '#fff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/today/index',
        text: '今日',
      },
      {
        pagePath: 'pages/wardrobe/index',
        text: '衣橱',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
});
