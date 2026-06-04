const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const SYSTEM_CATEGORIES = ['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other']

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const { parentCategory } = event
    
    const filter = {
      userId: OPENID,
      status: 'active'
    }
    
    if (parentCategory && SYSTEM_CATEGORIES.includes(parentCategory)) {
      filter.parentCategory = parentCategory
    }
    
    const res = await db.collection('user_clothing_subcategories')
      .where(filter)
      .orderBy('createdAt', 'desc')
      .get()
    
    return {
      code: 0,
      data: res.data.map(item => ({
        ...item,
        id: item._id
      })),
      message: 'success'
    }
  } catch (err) {
    console.error('getUserClothingSubcategories error:', err)
    return {
      code: -1,
      data: [],
      message: '获取分类列表失败'
    }
  }
}
