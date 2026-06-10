import { Image, Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useState } from 'react';
import { submitFeedback, uploadFeedbackImage } from '@/lib/cloud';
import './index.scss';

const FEEDBACK_TYPES = ['识别不准', '推荐不合适', '图片加载慢', '页面不好用', '想要新功能', '其他'];
const MAX_IMAGES = 3;

export default function FeedbackPage() {
  const [selectedType, setSelectedType] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [contact, setContact] = useState('');
  const [sourcePage, setSourcePage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useLoad((options) => {
    setSourcePage(typeof options.page === 'string' ? options.page : '');
  });

  async function handleChooseImages() {
    if (images.length >= MAX_IMAGES) return;
    try {
      const result = await Taro.chooseMedia({
        count: MAX_IMAGES - images.length,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      const paths = result.tempFiles.map((file) => file.tempFilePath).filter(Boolean);
      setImages((prev) => [...prev, ...paths].slice(0, MAX_IMAGES));
    } catch (error) {
      if (!isUserCancel(error)) {
        Taro.showToast({ title: '截图暂时没选好，稍后再试试', icon: 'none' });
      }
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleSubmit() {
    if (submitting) return;
    const trimmed = content.trim();
    if (!selectedType) {
      Taro.showToast({ title: '先选一个反馈类型吧', icon: 'none' });
      return;
    }
    if (!trimmed && images.length === 0) {
      Taro.showToast({ title: '写几句或添张截图，小搭才知道怎么改', icon: 'none' });
      return;
    }

    setSubmitting(true);
    try {
      Taro.showLoading({ title: '提交中...' });
      const uploadedImages: string[] = [];
      for (const image of images) {
        uploadedImages.push(await uploadFeedbackImage(image));
      }
      const trimmedContact = contact.trim();
      const systemInfo = Taro.getSystemInfoSync() as unknown as Record<string, unknown>;
      await submitFeedback({
        type: selectedType,
        content: trimmed,
        images: uploadedImages,
        contact: trimmedContact,
        page: sourcePage,
        systemInfo,
      });
      Taro.hideLoading();
      Taro.showToast({ title: '收到啦', icon: 'success' });
      setSelectedType('');
      setContent('');
      setImages([]);
      setContact('');
      setSubmitted(true);
    } catch (error) {
      console.error('Submit feedback failed:', error);
      Taro.hideLoading();
      Taro.showToast({ title: '反馈暂时没送出去，稍后再试试', icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  }

  function handleContinue() {
    setSubmitted(false);
  }

  function handleBackToProfile() {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1) {
      Taro.navigateBack();
      return;
    }
    Taro.switchTab({ url: '/pages/profile/index' });
  }

  if (submitted) {
    return (
      <View className="feedback-page success-page">
        <View className="success-card">
          <View className="success-mark">
            <Text className="success-mark-text">✦</Text>
          </View>
          <Text className="success-title">收到啦</Text>
          <Text className="success-desc">小搭已经记下你的反馈。</Text>
          <Text className="success-desc">谢谢你帮我们把搭搭day变得更好。</Text>
          <View className="success-actions">
            <View className="success-btn secondary" onClick={handleContinue}>
              <Text className="success-btn-text secondary">继续反馈</Text>
            </View>
            <View className="success-btn primary" onClick={handleBackToProfile}>
              <Text className="success-btn-text primary">返回我的</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="feedback-page">
      <View className="page-header">
        <Text className="page-title">哪里不顺手，告诉小搭</Text>
        <Text className="page-subtitle">我们会认真看，也会一点点把搭搭day打磨得更好</Text>
      </View>

      <View className="feedback-card">
        <Text className="section-title">反馈类型</Text>
        <View className="type-grid">
          {FEEDBACK_TYPES.map((type) => (
            <View
              key={type}
              className={`type-chip ${selectedType === type ? 'active' : ''}`}
              onClick={() => setSelectedType(type)}
            >
              <Text className="type-chip-text">{type}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="feedback-card">
        <Text className="section-title">具体说说</Text>
        <View className="textarea-wrap">
          <Textarea
            className="feedback-textarea"
            value={content}
            maxlength={500}
            placeholder="说说你遇到了什么，或者希望小搭怎么改"
            placeholderClass="textarea-placeholder"
            onInput={(event) => setContent(String(event.detail.value ?? ''))}
          />
        </View>
        <Text className="input-count">{content.length}/500</Text>
      </View>

      <View className="feedback-card">
        <View className="section-row">
          <Text className="section-title">截图</Text>
          <Text className="section-hint">可选，最多 3 张</Text>
        </View>
        <View className="image-list">
          {images.map((image, index) => (
            <View key={image} className="image-thumb-wrap">
              <Image className="image-thumb" src={image} mode="aspectFill" />
              <View className="image-remove" onClick={() => removeImage(index)}>
                <Text className="image-remove-text">×</Text>
              </View>
            </View>
          ))}
          {images.length < MAX_IMAGES && (
            <View className="image-add" onClick={handleChooseImages}>
              <Text className="image-add-plus">+</Text>
              <Text className="image-add-text">添加截图</Text>
            </View>
          )}
        </View>
      </View>

      <View className="feedback-card">
        <Text className="section-title">联系方式（选填）</Text>
        <View className="contact-wrap">
          <Input
            className="contact-input"
            value={contact}
            maxlength={80}
            placeholder="微信号或邮箱，方便我们需要时联系你"
            placeholderClass="contact-placeholder"
            onInput={(event) => setContact(String(event.detail.value ?? ''))}
          />
        </View>
        <Text className="contact-hint">不填写也可以提交反馈</Text>
      </View>

      <View className={`submit-btn ${submitting ? 'disabled' : ''}`} onClick={handleSubmit}>
        <Text className="submit-text">{submitting ? '提交中...' : '提交反馈'}</Text>
      </View>
    </View>
  );
}

function isUserCancel(error: unknown) {
  if (typeof error === 'object' && error && 'errMsg' in error) {
    return String((error as { errMsg?: unknown }).errMsg ?? '').includes('cancel');
  }
  return error instanceof Error && error.message.includes('cancel');
}
