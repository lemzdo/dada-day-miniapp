const TERMINAL_SAVED_STATUSES = new Set(['confirmed', 'saved']);
const PROCESSING_SEGMENT_STATUSES = new Set(['queued', 'processing']);
const PROCESSED_IMAGE_STATUSES = new Set(['detected', 'completed', 'success', 'empty', 'failed']);

function buildUploadConfirmState({ batch = null, images = [], drafts = [], saving = false } = {}) {
  const taskStatus = normalizeUploadBatchStatus(batch && batch.status);
  const batchProgress = getBatchProgress(batch, images);
  const recognizedDrafts = drafts.filter(isRecognizedDraft);
  const selectedDrafts = recognizedDrafts.filter((draft) => draft.selected);
  const savableDrafts = selectedDrafts.filter(isSavableDraft);
  const discardedDrafts = drafts.filter((draft) => draft.status === 'discarded');
  const savedDrafts = drafts.filter((draft) => TERMINAL_SAVED_STATUSES.has(draft.status));
  const processingDrafts = drafts.filter(isProcessingDraft);
  const recognizedCount = recognizedDrafts.length;
  const pageState = getPageState({
    taskStatus,
    isBatchComplete: batchProgress.isBatchComplete,
    recognizedCount,
    savableCount: savableDrafts.length,
  });

  return {
    taskStatus,
    pageState,
    batchProgress,
    totalImages: batchProgress.totalImages,
    processedImages: batchProgress.processedImages,
    recognizedCount,
    recognizedDrafts,
    selectedDrafts,
    savableDrafts,
    discardedDrafts,
    savedDrafts,
    processingDrafts,
    visibleDrafts: drafts.filter((draft) => isRecognizedDraft(draft) || isProcessingDraft(draft)),
    selectableDraftCount: recognizedDrafts.length,
    allSelectableDraftsSelected: recognizedDrafts.length > 0 && recognizedDrafts.every((draft) => draft.selected),
    showProcessingProgress: pageState === 'processing',
    canEditDrafts: taskStatus !== 'saved' && taskStatus !== 'discarded',
    canDiscardBatch: taskStatus === 'processing' || taskStatus === 'ready' || taskStatus === 'failed',
    canSave: batchProgress.isBatchComplete && savableDrafts.length > 0 && !saving,
    saving,
  };
}

function getPageState({ taskStatus, isBatchComplete, recognizedCount, savableCount }) {
  if (taskStatus === 'saved') return 'saved';
  if (taskStatus === 'discarded') return 'discarded';
  if (!isBatchComplete) return 'processing';
  if (recognizedCount > 0 && savableCount > 0) return 'ready';
  if (recognizedCount > 0) return 'noneSelected';
  if (taskStatus === 'failed') return 'failed';
  return 'empty';
}

function getProgressTitle(state) {
  if (state.taskStatus === 'saved' || state.pageState === 'saved') return '这批衣服已保存到衣橱';
  if (state.taskStatus === 'discarded' || state.pageState === 'discarded') return '这批识别已舍弃';
  if (state.pageState === 'processing') return '小搭正在帮你整理新衣服';
  if (state.pageState === 'ready' || state.pageState === 'noneSelected') {
    return `这次识别到 ${state.recognizedCount} 件衣服`;
  }
  return '这次没有识别出可保存的衣服';
}

function getProgressDesc(state) {
  if (state.taskStatus === 'saved' || state.pageState === 'saved') return '返回衣橱，就能看到刚刚保存好的衣服啦。';
  if (state.taskStatus === 'discarded' || state.pageState === 'discarded') return '这批识别结果不会保存到衣橱。';
  if (state.pageState === 'ready') return `已选择 ${state.savableDrafts.length} 件，保存前还可以继续编辑。`;
  if (state.pageState === 'noneSelected') return '暂未选择要保存的衣服，可重新勾选后保存。';
  if (state.pageState === 'empty' || state.pageState === 'failed') return '可以换张更清晰的照片再试试，或放弃本次识别。';
  if (state.recognizedCount > 0) {
    return `小搭已经识别出 ${state.recognizedCount} 件衣服，正在处理剩下的图片，全部完成后就可以一起确认啦。`;
  }
  return `正在处理 ${state.processedImages}/${state.totalImages} 张图片，整理完成后就可以确认啦。`;
}

function getSaveButtonText(state) {
  if (state.saving) return '保存中...';
  if (state.pageState === 'ready' && state.savableDrafts.length > 0) return `保存 ${state.savableDrafts.length} 件`;
  if (state.pageState === 'noneSelected') return '请选择要保存的衣服';
  if (state.pageState === 'processing') return `识别中 ${state.processedImages}/${state.totalImages}`;
  return '暂无可保存衣服';
}

function getEmptyTitle(state) {
  if (state.pageState === 'saved') return '这批衣服已保存到衣橱';
  if (state.pageState === 'discarded') return '这批识别已舍弃';
  if (state.pageState === 'failed') return '暂无可确认的衣物';
  return '这批新衣暂时没有可确认的结果';
}

function getEmptyDesc(state, batch) {
  if (state.pageState === 'saved') return '返回衣橱即可查看已保存的衣服。';
  if (state.pageState === 'discarded') return '这批识别结果不会保存到衣橱。';
  if (state.pageState === 'failed') return getFailedStatusMessage(batch);
  return '可以返回衣橱重新上传更清晰的照片。';
}

function getFailedStatusMessage(batch) {
  return (batch && (batch.errorMessage || batch.summaryMessage)) || '本次识别未成功，可以返回衣橱重新上传更清晰的照片。';
}

function getBatchProgress(batch, images) {
  const totalImages = Math.max(0, Number((batch && batch.totalImages) ?? images.length));
  const fallbackProcessedImages = images.filter((item) => isImageProcessed(item)).length;
  const processedImages = Math.min(
    totalImages,
    Math.max(0, Number((batch && batch.processedImages) ?? fallbackProcessedImages)),
  );

  return {
    totalImages,
    processedImages,
    isBatchComplete: totalImages > 0 && processedImages >= totalImages,
  };
}

function normalizeUploadBatchStatus(status) {
  if (status === 'ready' || status === 'success' || status === 'partial_success' || status === 'completed') return 'ready';
  if (status === 'failed' || status === 'empty' || status === 'partial_failed') return 'failed';
  if (status === 'saved') return 'saved';
  if (status === 'discarded') return 'discarded';
  return 'processing';
}

function isRecognizedDraft(draft) {
  return (
    draft
    && draft.status === 'pending'
    && !isProcessingDraft(draft)
    && Boolean(getSavableDraftImage(draft))
  );
}

function isSavableDraft(draft) {
  return isRecognizedDraft(draft) && Boolean(draft.selected);
}

function isDraftSelectable(draft) {
  return isRecognizedDraft(draft);
}

function isProcessingDraft(draft) {
  return Boolean(draft && PROCESSING_SEGMENT_STATUSES.has(draft.segmentStatus));
}

function isImageProcessed(item) {
  return Boolean(item && PROCESSED_IMAGE_STATUSES.has(item.status));
}

function getSavableDraftImage(draft) {
  return draft && (draft.displayImageUrl || draft.originalImageUrl);
}

module.exports = {
  buildUploadConfirmState,
  getBatchProgress,
  getEmptyDesc,
  getEmptyTitle,
  getFailedStatusMessage,
  getPageState,
  getProgressDesc,
  getProgressTitle,
  getSavableDraftImage,
  getSaveButtonText,
  isDraftSelectable,
  isImageProcessed,
  isProcessingDraft,
  isRecognizedDraft,
  isSavableDraft,
  normalizeUploadBatchStatus,
};
