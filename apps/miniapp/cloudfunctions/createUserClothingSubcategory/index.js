const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const SYSTEM_CATEGORIES = ['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other']
const NAME_MIN_LENGTH = 1
const NAME_MAX_LENGTH = 16

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

function validateName(name) {
  const trimmed = name.trim()
  if (!trimmed) return '分类名称不能为空'
  if (trimmed.length < NAME_MIN_LENGTH) return '分类名称太短'
  if (trimmed.length > NAME_MAX_LENGTH) return `分类名称不能超过${NAME_MAX_LENGTH}个字符`
  
  const invalidChars = /[<>/\\|:*?"']/
  if (invalidChars.test(trimmed)) return '分类名称包含非法字符'
  
  return null
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const { name, parentCategory } = event
    
    const validationError = validateName(name)
    if (validationError) {
      return {
        code: -1,
        data: null,
        message: validationError
      }
    }
    
    if (!parentCategory || !SYSTEM_CATEGORIES.includes(parentCategory)) {
      return {
        code: -1,
        data: null,
        message: '请选择正确的所属大类'
      }
    }
    
    const normalizedName = normalizeName(name)
    
    const existing = await db.collection('user_clothing_subcategories')
      .where({
        userId: OPENID,
        parentCategory,
        normalizedName,
        status: 'active'
      })
      .get()
    
    if (existing.data.length > 0) {
      const item = existing.data[0]
      return {
        code: 0,
        data: {
          ...item,
          id: item._id,
          reused: true
        },
        message: '这个分类已经在你的衣橱里啦'
      }
    }
    
    const now = new Date().toISOString()
    const result = await db.collection('user_clothing_subcategories').add({
      data: {
        userId: OPENID,
        name: name.trim(),
        normalizedName,
        parentCategory,
        sortOrder: 0,
        usageCount: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
    })
    
    const newCategory = await db.collection('user_clothing_subcategories')
      .doc(result._id)
      .get()
    
    return {
      code: 0,
      data: {
        ...newCategory.data,
        id: newCategory.data._id,
        reused: false
      },
      message: '添加成功'
    }
  } catch (err) {
    console.error('createUserClothingSubcategory error:', err)
    return {
      code: -1,
      data: null,
      message: '添加分类失败'
    }
  }
}
