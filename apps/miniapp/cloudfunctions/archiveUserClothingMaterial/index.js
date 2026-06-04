const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const { id } = event
    if (!id || typeof id !== 'string') {
      return {
        code: -1,
        data: null,
        message: '材质 id 不能为空'
      }
    }

    const current = await db.collection('user_clothing_materials').doc(id).get()
    if (!current.data || current.data.userId !== OPENID) {
      return {
        code: -1,
        data: null,
        message: '材质不存在或无权限'
      }
    }

    const now = new Date().toISOString()
    await db.collection('user_clothing_materials').doc(id).update({
      data: {
        status: 'archived',
        archivedAt: now,
        updatedAt: now
      }
    })

    return {
      code: 0,
      data: { ok: true, id },
      message: 'ok'
    }
  } catch (err) {
    console.error('archiveUserClothingMaterial error:', err)
    return {
      code: -1,
      data: null,
      message: '归档材质失败'
    }
  }
}
