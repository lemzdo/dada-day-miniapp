import { Text, View } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useState } from 'react';
import './index.scss';

type DetailType = 'data' | 'legal';

interface DetailSection {
  title: string;
  paragraphs: string[];
}

interface DetailContent {
  title: string;
  updatedAt: string;
  intro?: string[];
  sections: DetailSection[];
}

const DETAILS: Record<DetailType, DetailContent> = {
  data: {
    title: '使用与数据说明',
    updatedAt: '最近更新：2026年6月',
    sections: [
      {
        title: '一、搭搭day 的服务内容',
        paragraphs: [
          '搭搭day 是一款日常穿搭整理与推荐工具。你可以将常穿衣物添加到衣橱，记录穿搭偏好，并在不同天气和场景下获取穿搭参考。',
          '搭搭day 提供的是穿搭建议和灵感，不替代你的个人判断。你可以根据实际温度、场合要求、当天心情和个人喜好进行调整。',
        ],
      },
      {
        title: '二、衣橱图片的使用方式',
        paragraphs: [
          '你上传的衣物图片会用于生成个人衣橱，并辅助完成衣物识别、分类、标签整理和穿搭推荐。',
          '在识别过程中，系统可能会根据图片分析衣物的大致类型、颜色、材质、厚薄、风格等信息。这些信息主要用于提升衣橱管理和推荐结果的准确性。',
        ],
      },
      {
        title: '三、推荐结果的生成依据',
        paragraphs: [
          '穿搭推荐可能会参考你的衣橱单品、天气情况、使用场景、穿搭偏好、收藏记录、穿搭历史，以及近期生成或浏览过的搭配记录。',
          '推荐结果仅作为日常穿搭参考，不代表唯一或绝对正确的搭配方案。',
        ],
      },
      {
        title: '四、衣橱内容的可见范围',
        paragraphs: [
          '你的衣橱内容默认仅你自己可见。搭搭day 不会将你的衣橱图片、穿搭记录或个人偏好公开展示给其他用户。',
          '如果后续提供分享功能，分享内容会以你主动操作为前提，不会自动公开。',
        ],
      },
      {
        title: '五、内容管理',
        paragraphs: [
          '你可以在产品内删除衣物、移出收藏、调整穿搭偏好，或通过意见反馈告诉我们你遇到的问题。',
          '为保障服务稳定、排查异常或防止误操作，部分操作记录可能会在合理范围内短期保留。相关临时数据会根据产品规则逐步清理。',
        ],
      },
      {
        title: '六、反馈截图的使用',
        paragraphs: [
          '如果你在意见反馈中上传截图，截图将主要用于帮助我们理解问题、定位异常和改进体验。',
          '建议你在上传截图前，确认截图中不包含你不希望被看到的私人信息。',
        ],
      },
    ],
  },
  legal: {
    title: '用户协议与隐私政策',
    updatedAt: '最近更新：2026年6月',
    intro: ['欢迎使用搭搭day。请你在使用本产品前阅读并理解以下内容。继续使用搭搭day，即表示你已了解并同意本说明中的基本规则。'],
    sections: [
      {
        title: '一、服务内容',
        paragraphs: [
          '搭搭day 为用户提供衣橱管理、衣物识别、穿搭推荐、收藏记录、穿搭历史和意见反馈等功能。',
          '我们会根据产品发展和用户反馈持续优化服务。部分功能可能会根据版本更新进行调整、暂停或升级。',
        ],
      },
      {
        title: '二、使用规则',
        paragraphs: [
          '你在使用搭搭day 时，应遵守相关法律法规、微信平台规则及本产品的使用要求。',
          '请勿上传违法、侵权、恶意、明显不适合或可能影响他人权益的内容。请尽量上传与你本人衣橱和穿搭相关的图片，以便获得更准确的整理和推荐结果。',
        ],
      },
      {
        title: '三、用户内容',
        paragraphs: [
          '你保留对自己上传内容的合法权利。',
          '为了提供衣橱整理、图片识别、穿搭推荐、问题反馈等服务，搭搭day 会在必要范围内处理你上传的图片、衣物信息、穿搭记录和反馈内容。',
          '未经你的主动操作，我们不会将你的个人衣橱内容公开展示给其他用户。',
        ],
      },
      {
        title: '四、信息使用范围',
        paragraphs: [
          '为提供和改进服务，搭搭day 可能会使用你上传的衣物图片和衣物信息、穿搭偏好、场景选择、收藏记录、穿搭历史、推荐交互记录、意见反馈、截图、可选联系方式，以及设备、系统、页面等必要基础信息。',
          '上述信息主要用于完成产品功能、优化推荐效果、处理问题反馈、保障服务稳定和提升使用体验。',
        ],
      },
      {
        title: '五、隐私保护',
        paragraphs: [
          '我们会尽力采取合理措施保护你的数据安全，避免未经授权的访问、使用或泄露。',
          '由于互联网服务存在复杂的运行环境，我们无法保证绝对安全，但会在能力范围内持续改进数据保护和系统稳定性。',
        ],
      },
      {
        title: '六、内容删除与管理',
        paragraphs: [
          '你可以在产品内删除衣物、移出收藏、调整偏好或提交反馈。',
          '部分操作可能不会立即清除所有系统记录。例如，为保障服务稳定、排查异常或防止误操作，系统可能会在合理范围内保留必要的操作记录或备份数据。',
        ],
      },
      {
        title: '七、意见反馈',
        paragraphs: [
          '如果你在使用过程中遇到识别不准、推荐不合适、图片加载慢或页面异常等问题，可以通过「意见反馈」告诉我们。',
          '如果你愿意留下联系方式，我们可能会在需要进一步了解问题时联系你；不填写联系方式也可以正常提交反馈。',
        ],
      },
      {
        title: '八、说明更新',
        paragraphs: [
          '本说明可能会随着产品功能、服务范围或合规要求的变化而更新。更新后，我们会在页面中展示新的更新时间。',
          '如果你继续使用搭搭day，即表示你理解并接受更新后的说明。',
        ],
      },
    ],
  },
};

export default function AboutDetailPage() {
  const [detailType, setDetailType] = useState<DetailType>('data');
  const detail = DETAILS[detailType];

  useLoad((options) => {
    const nextType: DetailType = options.type === 'legal' ? 'legal' : 'data';
    setDetailType(nextType);
    Taro.setNavigationBarTitle({ title: DETAILS[nextType].title });
  });

  return (
    <View className="about-detail-page">
      <View className="detail-hero">
        <Text className="detail-title">{detail.title}</Text>
        <Text className="detail-updated">{detail.updatedAt}</Text>
      </View>

      <View className="detail-content">
        {detail.intro?.map((paragraph) => (
          <Text key={paragraph} className="section-paragraph intro">
            {paragraph}
          </Text>
        ))}
        {detail.sections.map((section) => (
          <View key={section.title} className="detail-section">
            <Text className="section-title">{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} className="section-paragraph">
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
