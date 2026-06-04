const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const NAME_MIN_LENGTH = 1
const NAME_MAX_LENGTH = 12

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

function validateName(name) {
  if (typeof name !== 'string') return '材质名称不能为空'
  const trimmed = name.trim()
  if (!trimmed) return '材质名称不能为空'
  if (trimmed.length < NAME_MIN_LENGTH) return '材质名称太短'
  if (trimmed.length > NAME_MAX_LENGTH) return `材质名称不能超过${NAME_MAX_LENGTH}个字符`
  return null
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  
  try {
    const { name } = event
    
    const validationError = validateName(name)
    if (validationError) {
      return {
        code: -1,
        data: null,
        message: validationError
      }
    }
    
    const normalizedName = normalizeName(name)
    
    const existing = await db.collection('user_clothing_materials')
      .where({
        userId: OPENID,
        normalizedName
      })
      .get()
    
    const activeItem = existing.data.find(item => item.status === 'active')
    if (activeItem) {
      return {
        code: 0,
        data: {
          ...activeItem,
          id: activeItem._id,
          reused: true
        },
        message: '这个材质已经在你的衣橱里啦'
      }
    }

    const archivedItem = existing.data.find(item => item.status === 'archived')
    if (archivedItem) {
      const now = new Date().toISOString()
      await db.collection('user_clothing_materials').doc(archivedItem._id).update({
        data: {
          name: name.trim(),
          status: 'active',
          archivedAt: null,
          lastUsedAt: now,
          updatedAt: now
        }
      })

      const restored = await db.collection('user_clothing_materials')
        .doc(archivedItem._id)
        .get()

      return {
        code: 0,
        data: {
          ...restored.data,
          id: restored.data._id,
          reused: true,
          restored: true
        },
        message: '已重新加入你的材质'
      }
    }
    
    const now = new Date().toISOString()
    const result = await db.collection('user_clothing_materials').add({
      data: {
        userId: OPENID,
        name: name.trim(),
        normalizedName,
        usageCount: 0,
        lastUsedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
    })
    
    const newMaterial = await db.collection('user_clothing_materials')
      .doc(result._id)
      .get()
    
    return {
      code: 0,
      data: {
        ...newMaterial.data,
        id: newMaterial.data._id,
        reused: false
      },
      message: '添加成功'
    }
  } catch (err) {
    console.error('createUserClothingMaterial error:', err)
    return {
      code: -1,
      data: null,
      message: '添加材质失败'
    }
  }
}
