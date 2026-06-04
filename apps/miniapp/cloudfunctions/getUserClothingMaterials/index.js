const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const result = await db.collection('user_clothing_materials')
      .where({
        userId: OPENID,
        status: 'active'
      })
      .get()

    const list = result.data
      .slice()
      .sort((a, b) => String(b.lastUsedAt || b.createdAt || '').localeCompare(String(a.lastUsedAt || a.createdAt || '')))
    
    return {
      code: 0,
      data: list.map(item => ({
        id: item._id,
        userId: item.userId,
        name: item.name,
        normalizedName: item.normalizedName,
        usageCount: item.usageCount,
        lastUsedAt: item.lastUsedAt,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      })),
      message: '获取成功'
    }
  } catch (err) {
    console.error('getUserClothingMaterials error:', err)
    return {
      code: -1,
      data: [],
      message: '获取用户材质失败'
    }
  }
}
