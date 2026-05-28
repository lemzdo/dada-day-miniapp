import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh } from '@tarojs/taro';
import { useCallback, useState } from 'react';
import { getRecoverableUploadBatches } from '@/lib/cloud';
import type { RecoverableUploadBatch } from '@/lib/cloud';
import './index.scss';

type UploadTaskViewStatus = 'processing' | 'ready' | 'partial' | 'failed';

export default function UploadTasksPage() {
  const [batches, setBatches] = useState<RecoverableUploadBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBatches = useCallback(async () => {
    try {
      const result = await getRecoverableUploadBatches(10);
      setBatches((result.list || []).filter(isActiveUploadBatch));
    } catch (error) {
      console.warn('Fetch upload tasks failed:', error);
      Taro.showToast({ title: '加载失败', icon: 'none' });
      setBatches([]);
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useLoad(() => {
    void fetchBatches();
  });

  useDidShow(() => {
    void fetchBatches();
  });

  usePullDownRefresh(() => {
    void fetchBatches();
  });

  function handleBackToWardrobe() {
    Taro.switchTab({ url: '/pages/wardrobe/index' });
  }

  function handleOpenBatch(batchId: string) {
    Taro.navigateTo({ url: `/pages/upload-confirm/index?batchId=${batchId}` });
  }

  if (loading) {
    return (
      <View className="upload-tasks-page loading">
        <Text className="loading-text">小搭正在看看有哪些衣服要整理...</Text>
      </View>
    );
  }

  return (
    <View className="upload-tasks-page">
      <View className="page-head">
        <Text className="page-title">新衣服识别</Text>
        <Text className="page-desc">小搭把还没处理完的衣服都放在这里啦。</Text>
      </View>

      {batches.length === 0 ? (
        <View className="empty-panel">
          <Text className="empty-title">小搭暂时没有正在整理的衣服</Text>
          <Text className="empty-desc">有新衣服上传后，这里会出现整理进度和确认入口。</Text>
          <View className="empty-btn" onClick={handleBackToWardrobe}>
            <Text className="empty-btn-text">返回衣橱</Text>
          </View>
        </View>
      ) : (
        <View className="task-list">
          {batches.map((batch) => {
            const status = getUploadTaskStatus(batch);
            const message = getBatchMessage(batch);
            return (
              <View key={batch.id} className={`task-card ${status}`} onClick={() => handleOpenBatch(batch.id)}>
                <View className="task-topline">
                  <Text className={`task-status ${status}`}>{getStatusText(status)}</Text>
                  <Text className="task-time">{formatBatchTime(batch.updatedAt || batch.createdAt)}</Text>
                </View>

                <Text className="task-title">{getTaskTitle(status)}</Text>

                <View className="task-meta">
                  <Text className="task-meta-item">图片 {getProcessedImages(batch)}/{getTotalImages(batch)}</Text>
                  <Text className="task-meta-item">识别 {getRecognizedCount(batch)} 件</Text>
                </View>

                {message && <Text className="task-message">{message}</Text>}

                <View className="task-action">
                  <Text className="task-action-text">{getActionText(status)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function isActiveUploadBatch(batch: RecoverableUploadBatch) {
  return Boolean(getUploadTaskStatus(batch));
}

function isTerminalUploadBatchStatus(status?: string) {
  return status === 'saved' || status === 'discarded' || status === 'deleted' || status === 'expired';
}

function getUploadTaskStatus(batch: RecoverableUploadBatch): UploadTaskViewStatus | null {
  if (isTerminalUploadBatchStatus(batch.status)) return null;

  const rawStatus = String(batch.status || '');
  if (rawStatus === 'partial_success' || rawStatus === 'partial_failed') return 'partial';

  const totalImages = getTotalImages(batch);
  const processedImages = getProcessedImages(batch);
  const recognizedCount = getRecognizedCount(batch);
  const isComplete = totalImages > 0 && processedImages >= totalImages;

  if (isComplete && recognizedCount > 0) return 'ready';
  if (isComplete) return 'failed';
  if (rawStatus === 'pending' || rawStatus === 'processing') return 'processing';
  if (rawStatus === 'ready' || rawStatus === 'success' || rawStatus === 'completed') return 'ready';
  if (rawStatus === 'failed' || rawStatus === 'empty') return 'failed';
  return null;
}

function getTotalImages(batch: RecoverableUploadBatch) {
  return Math.max(0, Number(batch.totalImages || 0));
}

function getProcessedImages(batch: RecoverableUploadBatch) {
  return Math.min(
    getTotalImages(batch),
    Math.max(0, Number(batch.processedImages || 0)),
  );
}

function getRecognizedCount(batch: RecoverableUploadBatch) {
  return Math.max(0, Number(batch.recognizedCount ?? batch.draftCount ?? batch.totalDetectedClothes ?? 0));
}

function getBatchMessage(batch: RecoverableUploadBatch) {
  return batch.summaryMessage || batch.errorMessage || '';
}

function getStatusText(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '待确认';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '识别失败';
  return '整理中';
}

function getTaskTitle(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '小搭整理好啦，等你确认';
  if (status === 'partial') return '有些衣服已经整理出来了';
  if (status === 'failed') return '这批照片需要看一下';
  return '小搭还在整理这批新衣服';
}

function getActionText(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '查看并保存';
  if (status === 'partial') return '查看并处理';
  if (status === 'failed') return '查看原因';
  return '查看进度';
}

function formatBatchTime(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '刚刚';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;

  if (isToday) return `今天 ${time}`;
  if (isYesterday) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function padTime(value: number) {
  return value < 10 ? `0${value}` : String(value);
}
