import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import { getRecoverableUploadBatches } from '@/lib/cloud';
import type { RecoverableUploadBatch } from '@/lib/cloud';
import './index.scss';

type UploadTaskViewStatus = 'processing' | 'ready' | 'partial' | 'failed';

export default function UploadTasksPage() {
  const [batches, setBatches] = useState<RecoverableUploadBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(false);
  const skipFirstDidShowRef = useRef(false);
  const inflightRef = useRef<Promise<void> | null>(null);

  const fetchBatches = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const request = (async () => {
      const startedAt = Date.now();
      try {
      setErrorState(false);
      const result = await getRecoverableUploadBatches(10);
      setBatches((result.list || []).filter(isActiveUploadBatch));
      console.log('[UploadTasksPage] fetchBatches', {
        returned: result.list?.length ?? 0,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.warn('Fetch upload tasks failed:', error);
      setErrorState(true);
      Taro.showToast({ title: '加载失败', icon: 'none' });
      setBatches([]);
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
    })().finally(() => {
      inflightRef.current = null;
    });

    inflightRef.current = request;
    return request;
  }, []);

  useLoad(() => {
    skipFirstDidShowRef.current = true;
    void fetchBatches();
  });

  useDidShow(() => {
    if (skipFirstDidShowRef.current) {
      skipFirstDidShowRef.current = false;
      return;
    }
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
        <View className="loading-panel">
          <View className="loading-dot" />
          <Text className="loading-text">小搭正在看看有没有新衣要整理...</Text>
        </View>
      </View>
    );
  }

  if (errorState) {
    return (
      <View className="upload-tasks-page">
        <View className="page-head">
          <Text className="page-title">新衣整理</Text>
          <Text className="page-desc">新上传的衣服会先放在这里，确认后就能进衣橱</Text>
        </View>
        <View className="error-panel">
          <Text className="error-title">小搭暂时没拿到整理进度</Text>
          <Text className="error-desc">可能是网络不太稳，下拉刷新或点下面再试一次</Text>
          <View className="error-btn" onClick={fetchBatches}>
            <Text className="error-btn-text">重新看看</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="upload-tasks-page">
      <View className="page-head">
        <Text className="page-title">新衣整理</Text>
        <Text className="page-desc">新上传的衣服会先放在这里，确认后就能进衣橱</Text>
      </View>

      {batches.length === 0 ? (
        <View className="empty-panel">
          <View className="empty-illustration">
            <Text className="empty-icon">衣</Text>
          </View>
          <Text className="empty-title">整理间暂时空着</Text>
          <Text className="empty-desc">添新衣后，小搭会把识别进度放在这里</Text>
          <View className="empty-btn" onClick={handleBackToWardrobe}>
            <Text className="empty-btn-text">回衣橱</Text>
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
                <Text className="task-subtitle">{getTaskSubtitle(status, batch)}</Text>

                <View className="task-meta">
                  <Text className="task-meta-item">图片 {getProcessedImages(batch)}/{getTotalImages(batch)}</Text>
                  <Text className="task-meta-item">识别 {getRecognizedCount(batch)} 件</Text>
                </View>

                {message && <Text className="task-message">{message}</Text>}

                {status === 'processing' && getTotalImages(batch) > 0 && (
                  <View className="task-progress">
                    <View
                      className="task-progress-fill"
                      style={{ width: `${Math.min(100, Math.round((getProcessedImages(batch) / getTotalImages(batch)) * 100))}%` }}
                    />
                  </View>
                )}

                <View className={`task-action ${status}`}>
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

function getFailedImagesCount(batch: RecoverableUploadBatch) {
  const total = getTotalImages(batch);
  const success = Number(batch.successImages || 0);
  if (total > 0) return Math.max(0, total - success);
  return Math.max(0, Number(batch.failedImages || 0));
}

function getBatchMessage(batch: RecoverableUploadBatch) {
  return batch.summaryMessage || batch.errorMessage || '';
}

function getStatusText(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '待确认';
  if (status === 'partial') return '需处理';
  if (status === 'failed') return '需处理';
  return '整理中';
}

function getTaskTitle(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '小搭整理好啦，等你确认';
  if (status === 'partial') return '有些衣服已经整理出来了';
  if (status === 'failed') return '这批照片小搭没看清楚';
  return '小搭正在整理这批新衣';
}

function getTaskSubtitle(status: UploadTaskViewStatus | null, batch: RecoverableUploadBatch) {
  const recognizedCount = getRecognizedCount(batch);
  const processedImages = getProcessedImages(batch);
  const totalImages = getTotalImages(batch);
  const failedCount = getFailedImagesCount(batch);

  if (status === 'ready') {
    return `识别 ${recognizedCount} 件 · 等你保存`;
  }
  if (status === 'partial') {
    if (failedCount > 0) {
      return `${recognizedCount} 件可保存 · ${failedCount} 张需处理`;
    }
    return `${recognizedCount} 件可保存，部分图片需要处理`;
  }
  if (status === 'failed') {
    return '可以换更清晰的照片再试试';
  }
  return `图片 ${processedImages}/${totalImages} · 已识别 ${recognizedCount} 件`;
}

function getActionText(status: UploadTaskViewStatus | null) {
  if (status === 'ready') return '确认入库';
  if (status === 'partial') return '查看结果';
  if (status === 'failed') return '查看详情';
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
