const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const PIPELINE_VERSION = process.env.ASSET_PIPELINE_VERSION || 'v2';
const SEGMENT_PROVIDER = 'aliyun_viapi';
const CLOTH_SEGMENT_MODEL = process.env.ALIYUN_SEGMENT_CLOTH_MODEL || 'SegmentCloth';
const COMMODITY_SEGMENT_MODEL = process.env.ALIYUN_SEGMENT_COMMODITY_MODEL || 'SegmentCommodity';
const DEFAULT_AITRYON_PARSING_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/vision/image-process/process';
const DEFAULT_AITRYON_PARSING_MODEL = 'aitryon-parsing-v1';
const AITRYON_PROVIDER = 'bailian_tryon_parsing';
const PRIMARY_AITRYON_CLOTHES_TYPES = ['upper', 'lower'];
const FALLBACK_AITRYON_CLOTHES_TYPES = ['dress'];

const DEFAULT_STAGE_STATUS = {
  router: 'skipped',
  detection: 'skipped',
  crop: 'skipped',
  segment: 'skipped',
  attribute: 'skipped',
};

async function runWardrobeAssetPipeline({ cloud, openid, image }) {
  const sourceFileID = image.cloudFileId || image.originalImageUrl;
  const originalImageUrl = sourceFileID;
  const normalizedImageUrl = image.normalizedImageUrl || originalImageUrl;
  const providerTrace = [];
  const warnings = [];
  const tempImageUrl = await getTempUrl(cloud, normalizedImageUrl);

  const routerStage = await imageRouter(tempImageUrl);
  providerTrace.push(routerStage.trace);
  const routerResult = routerStage.output || buildDefaultRouterResult(routerStage.errorMessage);

  const detectionStage = await detectGarments(tempImageUrl, routerResult, {
    cloud,
    batchId: image.batchId,
    sourceImageId: image._id,
  });
  providerTrace.push(...detectionStage.traces);
  const stageStatus = {
    ...DEFAULT_STAGE_STATUS,
    router: routerStage.status,
    detection: detectionStage.status,
  };

  let candidates = detectionStage.items;
  if (candidates.length === 0 && detectionStage.allowSingleImageFallback) {
    candidates = [buildFallbackWholeImageItem(routerResult, detectionStage.errorMessage)];
  }

  const assets = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const itemIndex = index;
    const assetProviderTrace = cloneJson(providerTrace);
    const asset = buildBaseAsset({
      image,
      originalImageUrl,
      normalizedImageUrl,
      routerResult,
      routerStatus: routerStage.status,
      detectionStatus: detectionStage.status,
      candidate,
      itemIndex,
      providerTrace: assetProviderTrace,
    });

    const allowLargeBbox = shouldAllowLargeBbox(routerResult, candidate);
    const cropStage = candidate.aitryonCropImageUrl
      ? await buildAitryonCropStage({
        cloud,
        originalImageUrl,
        candidate,
      })
      : await cropGarment({
        cloud,
        originalImageUrl,
        bbox: candidate.rawBbox || candidate.bbox,
        batchId: image.batchId,
        sourceImageId: image._id,
        itemIndex,
        allowLargeBbox,
      });
    asset.stageStatus.crop = cropStage.status;
    asset.providerTrace.push(cropStage.trace);
    if (cropStage.errorMessage) {
      addConfirmReason(asset, cropStage.errorMessage);
    }
    if (cropStage.output && cropStage.output.bbox) {
      asset.bbox = cropStage.output.bbox;
      asset.cropBox = cropStage.output.bbox;
      const bboxArea = asset.bbox.width * asset.bbox.height;
      if (!allowLargeBbox && bboxArea > 0.82) addConfirmReason(asset, 'bbox_too_large');
      if (!allowLargeBbox && bboxArea > 0.9) addConfirmReason(asset, 'suspected_multi_item');
      if (cropStage.output.bboxNormalize) {
        asset.aiRawResult.bboxNormalize = cropStage.output.bboxNormalize;
      }
    }
    if (cropStage.output && cropStage.output.cropImageUrl) {
      asset.cropImageUrl = cropStage.output.cropImageUrl;
      asset.croppedImageUrl = cropStage.output.cropImageUrl;
      asset.displayImageUrl = cropStage.output.cropImageUrl;
      asset.imageSourceType = 'crop';
    } else {
      addConfirmReason(asset, cropStage.status === 'skipped' ? 'bbox_invalid' : 'crop_failed');
      addConfirmReason(asset, cropStage.errorMessage || 'crop_failed');
      asset.displayImageUrl = asset.originalImageUrl;
      asset.imageSourceType = 'original';
    }

    const segmentInput = asset.cropImageUrl;
    if (candidate.aitryonParsingImageUrl) {
      const segmentStage = buildStageResult('segment', AITRYON_PROVIDER, getAitryonParsingModel(), 'success', {
        cleanImageUrl: candidate.aitryonParsingImageUrl,
        maskImageUrl: '',
      }, '', Date.now());
      asset.stageStatus.segment = segmentStage.status;
      asset.providerTrace.push(segmentStage.trace);
      asset.cleanImageUrl = candidate.aitryonParsingImageUrl;
      asset.aiSegmentImageUrl = candidate.aitryonParsingImageUrl;
      asset.maskImageUrl = '';
      asset.displayImageUrl = candidate.aitryonParsingImageUrl;
      asset.imageSourceType = 'clean';
    } else if (segmentInput) {
      const segmentStage = await segmentGarment({
        cloud,
        openid,
        sourceFileID: segmentInput,
        batchId: image.batchId,
        sourceImageId: image._id,
        itemIndex,
        category: asset.type,
      });
      asset.stageStatus.segment = segmentStage.status;
      asset.providerTrace.push(segmentStage.trace);
      if (segmentStage.output && segmentStage.output.cleanImageUrl) {
        asset.cleanImageUrl = segmentStage.output.cleanImageUrl;
        asset.aiSegmentImageUrl = segmentStage.output.cleanImageUrl;
        asset.maskImageUrl = segmentStage.output.maskImageUrl || '';
        asset.displayImageUrl = segmentStage.output.cleanImageUrl;
        asset.imageSourceType = 'clean';
      } else {
        asset.cleanImageUrl = '';
        asset.aiSegmentImageUrl = '';
        asset.confirmReasons.push(segmentStage.errorMessage || 'segment_failed');
        asset.displayImageUrl = asset.cropImageUrl || asset.originalImageUrl;
        asset.imageSourceType = asset.cropImageUrl ? 'crop' : 'original';
      }
    } else {
      asset.stageStatus.segment = 'skipped';
      asset.confirmReasons.push('segment_skipped_without_crop');
    }

    const attributeInput = asset.cleanImageUrl || asset.cropImageUrl || asset.originalImageUrl;
    const attributeStage = await recognizeAttributes(attributeInput);
    asset.stageStatus.attribute = attributeStage.status;
    asset.providerTrace.push(attributeStage.trace);
    if (attributeStage.output) {
      applyAttributes(asset, attributeStage.output);
    } else {
      asset.detectStatus = 'failed';
      asset.needsUserConfirm = true;
      asset.confirmReasons.push(attributeStage.errorMessage || 'attribute_failed');
    }

    applyQualityScore(asset, {
      routerFailed: routerStage.status === 'failed',
      detectionFailed: detectionStage.status === 'failed',
      suspiciousMultiItem: Boolean(candidate.suspiciousMultiItem) || asset.confirmReasons.includes('suspected_multi_item'),
      bboxTooLarge: Boolean(candidate.bboxTooLarge) || asset.confirmReasons.includes('bbox_too_large'),
    });

    assets.push(asset);
  }

  removeDuplicateCleanImages(assets, warnings);

  return {
    routerResult,
    detectionRaw: detectionStage.raw,
    warnings,
    assets,
    detectedCount: candidates.length,
    rawDetectedCount: detectionStage.rawDetectedCount || 0,
    hadDetectionError: detectionStage.status === 'failed',
    hadProviderError: providerTrace.some((trace) => trace && trace.status === 'failed'),
    hadPipelineError: false,
    emptyReason: buildEmptyReason(routerStage, detectionStage, candidates),
    stageStatus,
  };
}

async function imageRouter(imageUrl) {
  const model = getModel('BAILIAN_ROUTER_MODEL');
  return runTracedStage('router', 'bailian', model, async () => {
    const raw = await callBailianJson({
      model,
      imageUrl,
      prompt: buildRouterPrompt(),
      maxTokens: 700,
    });
    return normalizeRouterResult(raw);
  });
}

async function detectGarments(imageUrl, routerResult, context = {}) {
  if (routerResult.recommendedPipeline === 'person_wearing_pipeline') {
    return detectPersonWearingGarments(imageUrl, routerResult, context);
  }

  return detectNonPersonGarments(imageUrl, routerResult);
}

async function detectPersonWearingGarments(imageUrl, routerResult, context) {
  const traces = [];
  const raw = {};
  const aitryonResult = await detectAitryonMainGarments(imageUrl, context);
  traces.push(...aitryonResult.traces);
  raw.aitryon = aitryonResult.raw;

  let rawDetectedCount = aitryonResult.rawDetectedCount;
  let items = aitryonResult.items;

  const needsFallback = items.length === 0;
  if (needsFallback) {
    const vlStage = await callVlDetection(imageUrl, buildPersonFallbackDetectionPrompt());
    traces.push(vlStage.trace);
    raw.vlFallback = vlStage.output || { errorMessage: vlStage.errorMessage };
    const fallbackItems = vlStage.output ? normalizeDetectionItems(vlStage.output, 'vl_fallback') : [];
    rawDetectedCount = Math.max(rawDetectedCount, countRawDetectionItems(vlStage.output));
    if (fallbackItems.length > 0) {
      return {
        status: 'success',
        items: fallbackItems,
        traces,
        raw,
        errorMessage: '',
        allowSingleImageFallback: false,
        rawDetectedCount,
      };
    }
    return {
      status: 'failed',
      items: [],
      traces,
      raw,
      errorMessage: vlStage.errorMessage || aitryonResult.errorMessage || 'person_detection_failed',
      allowSingleImageFallback: true,
      rawDetectedCount,
    };
  }

  const accessoryStage = await callVlDetection(imageUrl, buildAccessoryDetectionPrompt());
  traces.push(accessoryStage.trace);
  raw.accessories = accessoryStage.output || { errorMessage: accessoryStage.errorMessage };
  if (accessoryStage.output) {
    const accessories = normalizeDetectionItems(accessoryStage.output, 'vl_accessory')
      .filter((item) => isAccessoryCategory(item.roughCategory));
    items = mergeDetectionItems(items, accessories);
  }

  return {
    status: 'success',
    items,
    traces,
    raw,
    errorMessage: '',
    allowSingleImageFallback: false,
    rawDetectedCount,
  };
}

async function detectNonPersonGarments(imageUrl, routerResult) {
  const traces = [];
  const raw = {};
  const vlStage = await callVlDetection(imageUrl, buildNonPersonDetectionPrompt(routerResult));
  traces.push(vlStage.trace);
  raw.vl = vlStage.output || { errorMessage: vlStage.errorMessage };
  const items = vlStage.output ? normalizeDetectionItems(vlStage.output, 'vl') : [];
  const rawDetectedCount = countRawDetectionItems(vlStage.output);

  if (items.length > 0) {
    return {
      status: 'success',
      items,
      traces,
      raw,
      errorMessage: '',
      allowSingleImageFallback: false,
      rawDetectedCount,
    };
  }

  return {
    status: vlStage.status,
    items: [],
    traces,
    raw,
    errorMessage: vlStage.errorMessage || 'non_person_detection_empty',
    allowSingleImageFallback: shouldFallbackToSingleImage(routerResult),
    rawDetectedCount,
  };
}

async function callVlDetection(imageUrl, prompt) {
  const model = getModel('BAILIAN_DETECTION_MODEL');
  return runTracedStage('detection', 'bailian', model, async () => callBailianJson({
    model,
    imageUrl,
    prompt,
    maxTokens: 1600,
  }));
}

async function detectAitryonMainGarments(imageUrl, context) {
  const stages = [];
  const primaryItems = [];

  for (const clothesType of PRIMARY_AITRYON_CLOTHES_TYPES) {
    const stage = await runAitryonParsingStage({
      imageUrl,
      clothesType,
      context,
      itemIndexBase: primaryItems.length,
    });
    stages.push(stage);
    if (stage.output && Array.isArray(stage.output.items)) {
      primaryItems.push(...stage.output.items);
    }
  }

  if (primaryItems.length > 0) {
    return buildAitryonDetectionResult(stages, primaryItems);
  }

  const fallbackItems = [];
  for (const clothesType of FALLBACK_AITRYON_CLOTHES_TYPES) {
    const stage = await runAitryonParsingStage({
      imageUrl,
      clothesType,
      context,
      itemIndexBase: fallbackItems.length,
    });
    stages.push(stage);
    if (stage.output && Array.isArray(stage.output.items)) {
      fallbackItems.push(...stage.output.items);
    }
  }

  return buildAitryonDetectionResult(stages, fallbackItems);
}

async function runAitryonParsingStage({ imageUrl, clothesType, context, itemIndexBase }) {
  const startedAt = Date.now();
  const endpoint = getAitryonParsingEndpoint();
  const model = getAitryonParsingModel();
  const traceMeta = { endpoint, clothesType };

  try {
    const result = await retryTask(() => callAitryonParsing({
      imageUrl,
      clothesType,
      endpoint,
      model,
    }));
    const item = await normalizeAitryonParsingItem({
      cloud: context.cloud,
      batchId: context.batchId,
      sourceImageId: context.sourceImageId,
      itemIndex: itemIndexBase,
      clothesType,
      response: result,
    });
    return buildStageResult('detection', AITRYON_PROVIDER, model, 'success', {
      endpoint,
      clothesType,
      requestId: result.request_id || result.requestId || result.output && result.output.request_id,
      output: sanitizeAitryonParsingOutput(result.output),
      items: item ? [item] : [],
    }, item ? '' : 'aitryon_parsing_empty_item', startedAt, traceMeta);
  } catch (error) {
    return buildStageResult('detection', AITRYON_PROVIDER, model, 'failed', null, getErrorMessage(error), startedAt, traceMeta);
  }
}

function buildAitryonDetectionResult(stages, items) {
  return {
    traces: stages.map((stage) => stage.trace),
    items,
    rawDetectedCount: items.length,
    errorMessage: stages
      .filter((stage) => stage.status === 'failed' || stage.errorMessage)
      .map((stage) => `${stage.trace.clothesType || 'unknown'}:${stage.errorMessage || 'no_item'}`)
      .join('|'),
    raw: {
      stages: stages.map((stage) => stage.output || {
        clothesType: stage.trace.clothesType,
        endpoint: stage.trace.endpoint,
        errorMessage: stage.errorMessage,
      }),
    },
  };
}

async function cropGarment({ cloud, originalImageUrl, bbox, batchId, sourceImageId, itemIndex, allowLargeBbox }) {
  const startedAt = Date.now();
  if (!bbox) {
    return buildStageResult('crop', 'jimp', 'jimp', 'skipped', null, 'bbox_missing', startedAt);
  }

  try {
    const sourceBuffer = await downloadImageSource(cloud, originalImageUrl);
    const Jimp = require('jimp');
    const image = await Jimp.read(sourceBuffer);
    const bboxNormalize = normalizeBbox(bbox, image.bitmap.width, image.bitmap.height, { allowLargeBbox });
    if (!bboxNormalize.valid) {
      return buildStageResult('crop', 'jimp', 'jimp', 'skipped', { bboxNormalize }, bboxNormalize.errorMessage, startedAt);
    }
    const cropBox = toPaddedPixelBox(bboxNormalize.bbox, image.bitmap.width, image.bitmap.height, 0.12);
    if (cropBox.width < 2 || cropBox.height < 2) throw new Error('bbox is too small');
    const cropped = image.clone().crop(cropBox.x, cropBox.y, cropBox.width, cropBox.height).quality(92);
    const buffer = await cropped.getBufferAsync(Jimp.MIME_JPEG);
    const cloudPath = `wardrobe_uploads/crops/${batchId}/${sourceImageId}-${itemIndex}.jpg`;
    const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
    return buildStageResult('crop', 'jimp', 'jimp', 'success', {
      cropImageUrl: uploadRes.fileID,
      pixelBox: cropBox,
      bbox: bboxNormalize.bbox,
      bboxNormalize,
    }, '', startedAt);
  } catch (error) {
    return buildStageResult('crop', 'jimp', 'jimp', 'failed', null, getErrorMessage(error), startedAt);
  }
}

async function buildAitryonCropStage({ cloud, originalImageUrl, candidate }) {
  const startedAt = Date.now();
  const output = {
    cropImageUrl: candidate.aitryonCropImageUrl,
  };
  let errorMessage = '';

  if (candidate.rawBbox) {
    try {
      const sourceBuffer = await downloadImageSource(cloud, originalImageUrl);
      const Jimp = require('jimp');
      const image = await Jimp.read(sourceBuffer);
      const bboxNormalize = normalizeBbox(candidate.rawBbox, image.bitmap.width, image.bitmap.height, { allowLargeBbox: false });
      output.bboxNormalize = bboxNormalize;
      if (bboxNormalize.valid) {
        output.bbox = bboxNormalize.bbox;
      } else {
        errorMessage = bboxNormalize.errorMessage;
      }
    } catch (error) {
      errorMessage = `bbox_normalize_failed:${getErrorMessage(error)}`;
    }
  }

  return buildStageResult('crop', AITRYON_PROVIDER, getAitryonParsingModel(), 'success', output, errorMessage, startedAt);
}

async function segmentGarment({ cloud, openid, sourceFileID, batchId, sourceImageId, itemIndex, category }) {
  const model = isAccessoryCategory(category) || category === 'shoes' ? COMMODITY_SEGMENT_MODEL : CLOTH_SEGMENT_MODEL;
  return runTracedStage('segment', SEGMENT_PROVIDER, model, async () => {
    const sourceBuffer = await downloadImageSource(cloud, sourceFileID);
    const objectKey = `wardrobe/${openid}/viapi-source/${batchId}/${sourceImageId}-${itemIndex}-${Date.now()}${getFileExt(sourceFileID)}`;
    let ossObjectKey = '';
    try {
      ossObjectKey = objectKey;
      const imageUrl = await uploadBufferToOss({ buffer: sourceBuffer, objectKey });
      const resultUrl = await retryTask(() => callViapiSegment(imageUrl, model));
      const fileID = await saveRemoteImage({
        cloud,
        remoteUrl: resultUrl,
        cloudPath: `wardrobe_uploads/clean/${batchId}/${sourceImageId}-${itemIndex}.png`,
      });
      return {
        cleanImageUrl: fileID,
        maskImageUrl: '',
      };
    } finally {
      await deleteOssObject(ossObjectKey);
    }
  });
}

async function recognizeAttributes(imageUrlOrFileID) {
  const model = getModel('BAILIAN_ATTRIBUTE_MODEL');
  return runTracedStage('attribute', 'bailian', model, async () => {
    const imageUrl = /^cloud:\/\//.test(imageUrlOrFileID)
      ? await getTempUrlFromFileID(imageUrlOrFileID)
      : imageUrlOrFileID;
    const raw = await callBailianJson({
      model,
      imageUrl,
      prompt: buildAttributePrompt(),
      maxTokens: 900,
    });
    return normalizeAttributeResult(raw);
  });
}

async function runTracedStage(stage, provider, model, task) {
  const startedAt = Date.now();
  try {
    const output = await retryTask(task);
    return {
      status: 'success',
      output,
      errorMessage: '',
      trace: {
        stage,
        provider,
        model,
        status: 'success',
        durationMs: Date.now() - startedAt,
        errorMessage: '',
        estimatedCost: 0,
      },
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      status: 'failed',
      output: null,
      errorMessage: message,
      trace: {
        stage,
        provider,
        model,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        estimatedCost: 0,
      },
    };
  }
}

function buildStageResult(stage, provider, model, status, output, errorMessage, startedAt, traceMeta = {}) {
  const message = errorMessage || '';
  return {
    status,
    output,
    errorMessage: message,
    trace: {
      stage,
      provider,
      model,
      status,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      estimatedCost: 0,
      ...traceMeta,
    },
  };
}

async function callBailianJson({ model, imageUrl, prompt, maxTokens }) {
  const apiKey = getRequiredEnv('BAILIAN_API_KEY');
  const fetch = require('node-fetch');
  const response = await fetch(`${getBailianBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
    }),
    timeout: getAiTimeoutMs(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bailian_api_error_${response.status}:${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return parseJson(content);
}

async function callAitryonParsing({ imageUrl, clothesType, endpoint, model }) {
  const apiKey = getRequiredEnv('BAILIAN_API_KEY');
  const fetch = require('node-fetch');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: {
        image_url: imageUrl,
      },
      parameters: {
        clothes_type: clothesType,
      },
    }),
    timeout: getAiTimeoutMs(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`aitryon_parsing_api_error_${response.status}:${text.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.code && data.message) {
    throw new Error(`aitryon_parsing_api_error_${data.code}:${String(data.message).slice(0, 200)}`);
  }
  if (!data.output) {
    throw new Error('aitryon_parsing_api_empty_output');
  }
  return data;
}

function getAitryonParsingEndpoint() {
  return process.env.BAILIAN_TRYON_PARSING_ENDPOINT || DEFAULT_AITRYON_PARSING_ENDPOINT;
}

function getAitryonParsingModel() {
  return process.env.BAILIAN_TRYON_PARSING_MODEL || DEFAULT_AITRYON_PARSING_MODEL;
}

function buildRouterPrompt() {
  return [
    'You are the image router for a wardrobe asset pipeline.',
    'Return strict JSON only.',
    'Decide whether this image shows a person wearing garments or non-person product/closet/flat-lay content.',
    'Return exactly this shape:',
    '{"imageScene":"person_wearing|single_product|multi_product|product_screenshot|closet_scene|unknown","hasPerson":false,"garmentPresentation":"worn_on_person|flat_lay|product_display|unknown","estimatedGarmentCount":1,"containsAccessories":false,"recommendedPipeline":"person_wearing_pipeline|non_person_pipeline","confidence":0.8,"riskFlags":[]}',
    'Routing rule: hasPerson=true and garmentPresentation=worn_on_person means person_wearing_pipeline. Everything else means non_person_pipeline.',
  ].join('\n');
}

function buildPersonFallbackDetectionPrompt() {
  return [
    'You are the fallback visual-language bbox detector for a wardrobe app.',
    'Return strict JSON only.',
    'Detect each independent visible garment/accessory worn by the person: top, bottom, onepiece, shoes, bag, hat, accessory.',
    'Return relative 0-1 bboxes for each item. Never merge top and bottom into one full-body item.',
    'Every item must include bboxFormat. Prefer bboxFormat="relative_0_1". Allowed values: relative_0_1, percent_0_100, normalized_0_1000, pixel_xywh, pixel_xyxy.',
    '{"items":[{"itemIndex":0,"roughCategory":"top|bottom|onepiece|shoes|accessory|other","category":"string","bboxFormat":"relative_0_1","bbox":{"x":0.1,"y":0.1,"width":0.4,"height":0.4},"confidence":0.8}]}',
  ].join('\n');
}

function buildAccessoryDetectionPrompt() {
  return [
    'Return strict JSON only.',
    'Detect only shoes, bags, hats, scarves, belts, jewelry, glasses and other accessories in this person/model image.',
    'Return relative 0-1 bboxes.',
    'Every item must include bboxFormat. Prefer bboxFormat="relative_0_1". Allowed values: relative_0_1, percent_0_100, normalized_0_1000, pixel_xywh, pixel_xyxy.',
    '{"items":[{"itemIndex":0,"roughCategory":"shoes|accessory|other","category":"string","bboxFormat":"relative_0_1","bbox":{"x":0.1,"y":0.1,"width":0.2,"height":0.2},"confidence":0.8}]}',
  ].join('\n');
}

function buildNonPersonDetectionPrompt(routerResult) {
  return [
    'You are the non_person_pipeline detector for wardrobe asset generation.',
    'Return strict JSON only.',
    'Detect all independent clothing, shoes, bags, hats and accessories in a product, flat-lay, screenshot, closet or hanging photo.',
    'Each item must have its own relative bbox in 0-1 coordinates.',
    'Every item must include bboxFormat. Prefer bboxFormat="relative_0_1". Allowed values: relative_0_1, percent_0_100, normalized_0_1000, pixel_xywh, pixel_xyxy.',
    'Do not create several items sharing the whole image. If unsure, return only confident item bboxes.',
    `Router estimate: scene=${routerResult.imageScene}, count=${routerResult.estimatedGarmentCount}.`,
    '{"items":[{"itemIndex":0,"roughCategory":"top|bottom|onepiece|shoes|accessory|other","category":"string","bboxFormat":"relative_0_1","bbox":{"x":0.1,"y":0.1,"width":0.4,"height":0.4},"confidence":0.8}]}',
  ].join('\n');
}

function buildAttributePrompt() {
  return [
    'You are a wardrobe clothing attribute recognizer.',
    'Return strict JSON only. The image is a single clothing item crop/clean image whenever possible.',
    'Use Chinese values for category, subCategory, color, material, style and tags.',
    'Return this shape:',
    '{"category":"上衣","subCategory":"T恤","type":"top","color":"白色","colors":["白色"],"material":"棉","style":"休闲","styleTags":["休闲"],"seasonTags":["春季","夏季"],"confidence":0.9}',
    'Allowed type values: top, bottom, onepiece, shoes, accessory, other.',
    'If uncertain, keep useful guesses with lower confidence.',
  ].join('\n');
}

function normalizeRouterResult(raw) {
  const imageScene = readEnum(raw.imageScene, [
    'person_wearing',
    'single_product',
    'multi_product',
    'product_screenshot',
    'closet_scene',
    'unknown',
  ], 'unknown');
  const garmentPresentation = readEnum(raw.garmentPresentation, [
    'worn_on_person',
    'flat_lay',
    'product_display',
    'unknown',
  ], 'unknown');
  const hasPerson = Boolean(raw.hasPerson);
  const recommendedPipeline = hasPerson && garmentPresentation === 'worn_on_person'
    ? 'person_wearing_pipeline'
    : 'non_person_pipeline';

  return {
    imageScene,
    hasPerson,
    garmentPresentation,
    estimatedGarmentCount: Math.max(0, Math.round(Number(raw.estimatedGarmentCount || 0))),
    containsAccessories: Boolean(raw.containsAccessories),
    recommendedPipeline,
    confidence: normalizeProbability(raw.confidence),
    riskFlags: readStringArray(raw.riskFlags),
    raw,
  };
}

function buildDefaultRouterResult(errorMessage) {
  return {
    imageScene: 'unknown',
    hasPerson: false,
    garmentPresentation: 'unknown',
    estimatedGarmentCount: 1,
    containsAccessories: false,
    recommendedPipeline: 'non_person_pipeline',
    confidence: 0,
    riskFlags: ['router_failed', errorMessage].filter(Boolean),
    raw: null,
  };
}

function normalizeDetectionItems(raw, source) {
  const rawItems = getRawDetectionItems(raw);

  return rawItems
    .map((item, index) => normalizeDetectionItem(item, index, source))
    .filter(Boolean);
}

function normalizeDetectionItem(item, index, source) {
  if (!item || typeof item !== 'object') return null;
  const rawBboxValue = item.bbox || item.box || item.boundingBox || item.bounding_box || item.rect || item.rectangle || null;
  const rawBbox = attachBboxFormat(rawBboxValue, item.bboxFormat || item.bbox_format || item.sourceFormat || item.coordinateFormat);
  const roughCategory = normalizeType(item.roughCategory || item.type || item.category);
  const confidence = normalizeConfidence(item.confidence);
  return {
    itemIndex: Number.isFinite(Number(item.itemIndex)) ? Number(item.itemIndex) : index,
    roughCategory,
    category: readString(item.category || item.categoryName || roughCategory, roughCategory),
    bbox: null,
    rawBbox,
    confidence,
    source,
    bboxTooLarge: false,
    suspiciousMultiItem: false,
    raw: item,
  };
}

function attachBboxFormat(rawBbox, bboxFormat) {
  if (!rawBbox || !bboxFormat) return rawBbox;
  if (Array.isArray(rawBbox)) {
    return { values: rawBbox, bboxFormat };
  }
  if (typeof rawBbox === 'object') {
    return {
      ...rawBbox,
      bboxFormat: rawBbox.bboxFormat || bboxFormat,
    };
  }
  return rawBbox;
}

function getRawDetectionItems(raw) {
  return Array.isArray(raw && raw.items)
    ? raw.items
    : Array.isArray(raw && raw.garments)
      ? raw.garments
      : [];
}

function countRawDetectionItems(raw) {
  return getRawDetectionItems(raw).length;
}

async function normalizeAitryonParsingItem({ cloud, batchId, sourceImageId, itemIndex, clothesType, response }) {
  const output = response && response.output ? response.output : {};
  const bbox = normalizeAitryonPixelBbox(readAitryonOutputValue(output, 'bbox'));
  if (!bbox) return null;

  const cropImgUrl = readString(readAitryonOutputValue(output, 'crop_img_url'), '');
  const parsingImgUrl = readString(readAitryonOutputValue(output, 'parsing_img_url'), '');
  const persisted = await persistAitryonImages({
    cloud,
    batchId,
    sourceImageId,
    itemIndex,
    clothesType,
    cropImgUrl,
    parsingImgUrl,
  });
  const typeInfo = mapAitryonClothesType(clothesType);

  return {
    itemIndex,
    roughCategory: typeInfo.roughCategory,
    category: typeInfo.category,
    bbox: null,
    rawBbox: {
      bboxFormat: 'pixel_xyxy',
      x1: bbox[0],
      y1: bbox[1],
      x2: bbox[2],
      y2: bbox[3],
    },
    aitryonCropImageUrl: persisted.cropImageUrl,
    aitryonParsingImageUrl: persisted.parsingImageUrl,
    confidence: 90,
    source: 'aitryon_parsing',
    bboxTooLarge: false,
    suspiciousMultiItem: false,
    raw: {
      clothesType,
      bbox,
      bboxFormat: 'pixel_xyxy',
      hasCropImgUrl: Boolean(cropImgUrl),
      hasParsingImgUrl: Boolean(parsingImgUrl),
      cropImagePersisted: Boolean(persisted.cropImageUrl),
      parsingImagePersisted: Boolean(persisted.parsingImageUrl),
      persistErrors: persisted.errors,
    },
  };
}

function readAitryonOutputValue(output, key) {
  const value = output && output[key];
  if (Array.isArray(value) && key !== 'bbox') {
    return value.find((item) => typeof item === 'string' && item.trim()) || '';
  }
  return value;
}

function normalizeAitryonPixelBbox(value) {
  const source = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value;
  if (!Array.isArray(source) || source.length < 4) return null;
  const box = source.slice(0, 4).map((item) => Number(item));
  if (!box.every(Number.isFinite)) return null;
  const [x1, y1, x2, y2] = box;
  if (x2 <= x1 || y2 <= y1) return null;
  return box;
}

async function persistAitryonImages({ cloud, batchId, sourceImageId, itemIndex, clothesType, cropImgUrl, parsingImgUrl }) {
  const result = {
    cropImageUrl: '',
    parsingImageUrl: '',
    errors: [],
  };

  if (cropImgUrl) {
    try {
      result.cropImageUrl = await saveRemoteImage({
        cloud,
        remoteUrl: cropImgUrl,
        cloudPath: `wardrobe_uploads/aitryon/crops/${batchId}/${sourceImageId}-${itemIndex}-${clothesType}.jpg`,
      });
    } catch (error) {
      result.errors.push(`crop_img_url:${getErrorMessage(error)}`);
    }
  }

  if (parsingImgUrl) {
    try {
      result.parsingImageUrl = await saveRemoteImage({
        cloud,
        remoteUrl: parsingImgUrl,
        cloudPath: `wardrobe_uploads/aitryon/parsing/${batchId}/${sourceImageId}-${itemIndex}-${clothesType}.png`,
      });
    } catch (error) {
      result.errors.push(`parsing_img_url:${getErrorMessage(error)}`);
    }
  }

  return result;
}

function mapAitryonClothesType(value) {
  const map = {
    upper: { roughCategory: 'top', category: 'top' },
    lower: { roughCategory: 'bottom', category: 'bottom' },
    dress: { roughCategory: 'onepiece', category: 'onepiece' },
  };
  return map[value] || { roughCategory: 'other', category: 'other' };
}

function sanitizeAitryonParsingOutput(output) {
  if (!output || typeof output !== 'object') return {};
  const sanitized = {};
  if (Array.isArray(output.bbox)) sanitized.bbox = output.bbox;
  if (Array.isArray(output.crop_img_url)) sanitized.crop_img_url_count = output.crop_img_url.filter(Boolean).length;
  if (Array.isArray(output.parsing_img_url)) sanitized.parsing_img_url_count = output.parsing_img_url.filter(Boolean).length;
  if (output.task_status) sanitized.task_status = output.task_status;
  return sanitized;
}

function normalizeBbox(value, imageWidth, imageHeight, options = {}) {
  const declaredFormat = readDeclaredBboxFormat(value);
  const parsed = parseBboxValue(value, declaredFormat);
  if (!parsed.valid) return parsed;

  const inferred = inferBboxScale(parsed, imageWidth, imageHeight, declaredFormat);
  if (!inferred.valid) return inferred;

  const bbox = scaleParsedBbox(parsed, inferred.scaleX, inferred.scaleY);
  return validateNormalizedBbox(bbox, imageWidth, imageHeight, {
    allowLargeBbox: Boolean(options.allowLargeBbox),
    sourceFormat: inferred.sourceFormat,
  });
}

function parseBboxValue(value, declaredFormat = '') {
  if (!value) return invalidBbox('unknown', 'bbox_missing');
  let x;
  let y;
  let width;
  let height;
  let coordinateMode = 'xywh';
  const rawValue = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.values)
    ? value.values
    : value;

  if (Array.isArray(rawValue)) {
    if (rawValue.length < 4) return invalidBbox('array', 'bbox_array_too_short');
    x = Number(rawValue[0]);
    y = Number(rawValue[1]);
    const third = Number(rawValue[2]);
    const fourth = Number(rawValue[3]);
    if (declaredFormat && declaredFormat !== 'pixel_xyxy') {
      width = third;
      height = fourth;
    } else if (declaredFormat === 'pixel_xyxy') {
      width = third - x;
      height = fourth - y;
      coordinateMode = 'xyxy';
    } else if (third > x && fourth > y) {
      width = third - x;
      height = fourth - y;
      coordinateMode = 'xyxy';
    } else {
      width = third;
      height = fourth;
    }
  } else if (typeof rawValue === 'object') {
    x = Number(rawValue.x ?? rawValue.left ?? rawValue.x1);
    y = Number(rawValue.y ?? rawValue.top ?? rawValue.y1);
    if (declaredFormat === 'pixel_xyxy' && (rawValue.right !== undefined || rawValue.x2 !== undefined || rawValue.bottom !== undefined || rawValue.y2 !== undefined)) {
      const right = Number(rawValue.right ?? rawValue.x2);
      const bottom = Number(rawValue.bottom ?? rawValue.y2);
      width = right - x;
      height = bottom - y;
      coordinateMode = 'xyxy';
    } else if (rawValue.width !== undefined || rawValue.height !== undefined) {
      width = Number(rawValue.width);
      height = Number(rawValue.height);
    } else {
      const right = Number(rawValue.right ?? rawValue.x2);
      const bottom = Number(rawValue.bottom ?? rawValue.y2);
      width = right - x;
      height = bottom - y;
      coordinateMode = 'xyxy';
    }
  } else {
    return invalidBbox(typeof value, 'bbox_type_invalid');
  }

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return invalidBbox(coordinateMode, 'bbox_values_invalid');
  }

  return {
    valid: true,
    bbox: { x, y, width, height },
    sourceFormat: coordinateMode,
    errorMessage: '',
  };
}

function readDeclaredBboxFormat(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return normalizeDeclaredBboxFormat(value.format || value.bboxFormat || value.sourceFormat || value.coordinateFormat || value.coordType);
}

function normalizeDeclaredBboxFormat(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const map = {
    relative_0_1: 'relative_0_1',
    relative: 'relative_0_1',
    normalized_0_1: 'relative_0_1',
    percent_0_100: 'percent_0_100',
    percentage: 'percent_0_100',
    percent: 'percent_0_100',
    normalized_0_100: 'percent_0_100',
    normalized_0_1000: 'normalized_0_1000',
    normalized_1000: 'normalized_0_1000',
    pixel_xywh: 'pixel_xywh',
    pixel_xyxy: 'pixel_xyxy',
    px_xywh: 'pixel_xywh',
    px_xyxy: 'pixel_xyxy',
  };
  return map[text] || '';
}

function inferBboxScale(parsed, imageWidth, imageHeight, declaredFormat) {
  const box = parsed.bbox;
  if (declaredFormat === 'pixel_xywh' || declaredFormat === 'pixel_xyxy') {
    return hasImageSize(imageWidth, imageHeight)
      ? { valid: true, sourceFormat: declaredFormat, scaleX: imageWidth, scaleY: imageHeight, errorMessage: '' }
      : invalidBbox(declaredFormat, 'image_size_required_for_pixel_bbox');
  }
  if (declaredFormat === 'normalized_0_1000') {
    return { valid: true, sourceFormat: 'normalized_0_1000', scaleX: 1000, scaleY: 1000, errorMessage: '' };
  }
  if (declaredFormat === 'percent_0_100') {
    return { valid: true, sourceFormat: 'percent_0_100', scaleX: 100, scaleY: 100, errorMessage: '' };
  }
  if (declaredFormat === 'relative_0_1') {
    return { valid: true, sourceFormat: 'relative_0_1', scaleX: 1, scaleY: 1, errorMessage: '' };
  }

  if (fitsScale(box, 1, 1)) {
    return { valid: true, sourceFormat: 'relative_0_1', scaleX: 1, scaleY: 1, errorMessage: '' };
  }
  if (fitsScale(box, 100, 100)) {
    return { valid: true, sourceFormat: 'percent_0_100', scaleX: 100, scaleY: 100, errorMessage: '' };
  }

  const fitsPixel = hasImageSize(imageWidth, imageHeight) && fitsScale(box, imageWidth, imageHeight);
  const fitsNormalized1000 = fitsScale(box, 1000, 1000);
  const imageClearlyLargerThan1000 = Number(imageWidth) > 1000 || Number(imageHeight) > 1000;

  if (fitsPixel && !fitsNormalized1000) {
    return { valid: true, sourceFormat: 'pixel_inferred', scaleX: imageWidth, scaleY: imageHeight, errorMessage: '' };
  }
  if (fitsNormalized1000 && imageClearlyLargerThan1000) {
    return { valid: true, sourceFormat: 'normalized_0_1000', scaleX: 1000, scaleY: 1000, errorMessage: '' };
  }
  if (fitsPixel && fitsNormalized1000) {
    return invalidBbox('ambiguous', 'bbox_format_ambiguous');
  }
  if (fitsNormalized1000) {
    return invalidBbox('ambiguous', 'bbox_format_ambiguous');
  }
  if (fitsPixel) {
    return { valid: true, sourceFormat: 'pixel_inferred', scaleX: imageWidth, scaleY: imageHeight, errorMessage: '' };
  }

  return invalidBbox('unknown', 'bbox_out_of_bounds');
}

function scaleParsedBbox(parsed, scaleX, scaleY) {
  const box = parsed.bbox;
  return {
    x: box.x / scaleX,
    y: box.y / scaleY,
    width: box.width / scaleX,
    height: box.height / scaleY,
  };
}

function validateNormalizedBbox(bbox, imageWidth, imageHeight, options) {
  const sourceFormat = options.sourceFormat || 'unknown';
  if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
    return invalidBbox(sourceFormat, 'bbox_values_invalid');
  }
  if (bbox.x < 0 || bbox.y < 0 || bbox.width <= 0 || bbox.height <= 0) {
    return invalidBbox(sourceFormat, 'bbox_values_invalid');
  }
  if (bbox.x + bbox.width > 1 || bbox.y + bbox.height > 1) {
    return invalidBbox(sourceFormat, 'bbox_out_of_bounds');
  }

  const widthPx = hasImageSize(imageWidth, imageHeight) ? bbox.width * imageWidth : 0;
  const heightPx = hasImageSize(imageWidth, imageHeight) ? bbox.height * imageHeight : 0;
  if (bbox.width < 0.01 || bbox.height < 0.01 || (widthPx > 0 && widthPx < 8) || (heightPx > 0 && heightPx < 8)) {
    return invalidBbox(sourceFormat, 'bbox_too_small');
  }

  const area = bbox.width * bbox.height;
  if (area >= 0.9 && !options.allowLargeBbox) {
    return invalidBbox(sourceFormat, 'bbox_too_large');
  }

  return {
    valid: true,
    bbox,
    sourceFormat,
    errorMessage: '',
  };
}

function fitsScale(box, scaleX, scaleY) {
  return box.x >= 0
    && box.y >= 0
    && box.x + box.width <= scaleX
    && box.y + box.height <= scaleY;
}

function hasImageSize(imageWidth, imageHeight) {
  return Number.isFinite(Number(imageWidth))
    && Number.isFinite(Number(imageHeight))
    && Number(imageWidth) > 0
    && Number(imageHeight) > 0;
}

function invalidBbox(sourceFormat, errorMessage) {
  return {
    bbox: null,
    valid: false,
    sourceFormat,
    errorMessage,
  };
}

function buildFallbackWholeImageItem(routerResult, reason) {
  return {
    itemIndex: 0,
    roughCategory: 'other',
    category: 'other',
    bbox: null,
    confidence: 0,
    source: 'single_image_fallback',
    suspiciousMultiItem: routerResult.estimatedGarmentCount > 1,
    bboxTooLarge: false,
    fallbackReason: reason || 'detection_failed',
    raw: null,
  };
}

function buildBaseAsset({
  image,
  originalImageUrl,
  normalizedImageUrl,
  routerResult,
  routerStatus,
  detectionStatus,
  candidate,
  itemIndex,
  providerTrace,
}) {
  const type = normalizeType(candidate.roughCategory || candidate.category);
  const now = new Date().toISOString();
  const confirmReasons = [];
  if (routerStatus === 'failed') confirmReasons.push('router_failed_default_non_person');
  if (detectionStatus === 'failed') confirmReasons.push('detection_failed_fallback');
  if (candidate.fallbackReason) confirmReasons.push(candidate.fallbackReason);
  if (!candidate.bbox && !candidate.rawBbox) confirmReasons.push('bbox_missing');
  if (candidate.bboxTooLarge) confirmReasons.push('bbox_too_large');
  if (candidate.suspiciousMultiItem) confirmReasons.push('suspected_multi_item');

  return {
    assetVersion: PIPELINE_VERSION,
    batchId: image.batchId,
    sourceImageId: image._id,
    itemIndex,
    originalImageUrl,
    normalizedImageUrl,
    cropImageUrl: '',
    croppedImageUrl: '',
    maskImageUrl: '',
    cleanImageUrl: '',
    aiSegmentImageUrl: '',
    displayImageUrl: originalImageUrl,
    imageUrl: originalImageUrl,
    imageSourceType: 'original',
    assetStatus: 'needs_review',
    qualityScore: 0,
    needsUserConfirm: true,
    confirmReasons,
    bbox: candidate.bbox || null,
    cropBox: candidate.bbox || null,
    stageStatus: {
      ...DEFAULT_STAGE_STATUS,
      router: routerStatus,
      detection: detectionStatus,
    },
    providerTrace,
    routerResult,
    type,
    category: type,
    subCategory: candidate.category || type,
    categoryName: candidate.category || type,
    color: '',
    colors: [],
    material: '',
    style: '',
    styleTags: [],
    seasonTags: [],
    confidence: candidate.confidence || 0,
    detectStatus: 'pending',
    segmentStatus: 'skipped',
    manualCropStatus: 'unsupported',
    selected: true,
    status: 'pending',
    aiRawResult: {
      router: routerResult,
      candidate: candidate.raw,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function applyAttributes(asset, attributes) {
  asset.category = attributes.type || normalizeType(attributes.category);
  asset.type = attributes.type || asset.category;
  asset.subCategory = attributes.subCategory || attributes.category || asset.subCategory;
  asset.categoryName = asset.subCategory;
  asset.color = attributes.color || (attributes.colors && attributes.colors[0]) || '';
  asset.colors = attributes.colors && attributes.colors.length > 0 ? attributes.colors : (asset.color ? [asset.color] : []);
  asset.material = attributes.material || '';
  asset.style = attributes.style || (attributes.styleTags && attributes.styleTags[0]) || '';
  asset.styleTags = attributes.styleTags || [];
  asset.seasonTags = attributes.seasonTags || [];
  asset.confidence = attributes.confidence || asset.confidence || 0;
  asset.detectStatus = 'success';
  asset.aiRawResult = {
    ...asset.aiRawResult,
    attributes: attributes.raw,
  };
}

function applyQualityScore(asset, flags) {
  let score = 0;
  if (asset.bbox) score += 20;
  else score -= 30;

  if (asset.cropImageUrl) score += 25;
  if (asset.cleanImageUrl) score += 25;
  else if (asset.stageStatus.segment === 'failed') score -= 10;

  if (asset.stageStatus.attribute === 'success') score += 15;
  else score -= 15;

  if (asset.imageSourceType !== 'original') score += 10;
  else score -= 30;

  if (asset.confidence >= 80) score += 5;
  if (flags.routerFailed) score -= 5;
  if (flags.detectionFailed) score -= 10;
  if (flags.suspiciousMultiItem) score -= 20;
  if (flags.bboxTooLarge) score -= 20;

  asset.qualityScore = Math.max(0, Math.min(100, Math.round(score)));
  asset.imageUrl = resolveFinalImageUrl(asset);
  asset.displayImageUrl = asset.imageUrl;
  asset.segmentStatus = asset.stageStatus.segment;

  if (asset.qualityScore >= 80) {
    asset.assetStatus = 'ready';
  } else if (asset.qualityScore >= 50) {
    asset.assetStatus = 'needs_review';
  } else {
    asset.assetStatus = asset.imageUrl ? 'needs_review' : 'failed';
  }
  asset.needsUserConfirm = asset.assetStatus !== 'ready' || asset.confirmReasons.length > 0;
}

function addConfirmReason(asset, reason) {
  if (!reason) return;
  if (!Array.isArray(asset.confirmReasons)) asset.confirmReasons = [];
  if (!asset.confirmReasons.includes(reason)) asset.confirmReasons.push(reason);
}

function removeDuplicateCleanImages(assets, warnings) {
  const grouped = new Map();
  for (const asset of assets) {
    if (!asset.cleanImageUrl || asset.cleanImageUrl === asset.originalImageUrl) continue;
    const list = grouped.get(asset.cleanImageUrl) || [];
    list.push(asset);
    grouped.set(asset.cleanImageUrl, list);
  }

  for (const [cleanImageUrl, list] of grouped.entries()) {
    if (list.length <= 1) continue;
    warnings.push(`duplicate_clean_image:${cleanImageUrl}`);
    for (const asset of list) {
      asset.cleanImageUrl = '';
      asset.aiSegmentImageUrl = '';
      asset.displayImageUrl = asset.cropImageUrl || asset.originalImageUrl;
      asset.imageUrl = asset.displayImageUrl;
      asset.imageSourceType = asset.cropImageUrl ? 'crop' : 'original';
      asset.stageStatus.segment = 'skipped';
      asset.segmentStatus = 'skipped';
      asset.confirmReasons.push('duplicate_clean_image_reset_to_crop');
      applyQualityScore(asset, {
        routerFailed: asset.stageStatus.router === 'failed',
        detectionFailed: asset.stageStatus.detection === 'failed',
        suspiciousMultiItem: asset.confirmReasons.includes('suspected_multi_item'),
        bboxTooLarge: asset.confirmReasons.includes('bbox_too_large'),
      });
    }
  }
}

function toDraftData(asset, openid) {
  const finalImageUrl = resolveFinalImageUrl(asset);
  const color = asset.color || (Array.isArray(asset.colors) ? asset.colors[0] : '');
  return {
    _openid: openid,
    userId: openid,
    assetVersion: asset.assetVersion,
    batchId: asset.batchId,
    sourceImageId: asset.sourceImageId,
    itemIndex: asset.itemIndex,
    originalImageUrl: asset.originalImageUrl,
    normalizedImageUrl: asset.normalizedImageUrl || asset.originalImageUrl,
    cropImageUrl: asset.cropImageUrl || '',
    croppedImageUrl: asset.cropImageUrl || '',
    maskImageUrl: asset.maskImageUrl || '',
    cleanImageUrl: asset.cleanImageUrl || '',
    aiSegmentImageUrl: asset.cleanImageUrl || '',
    displayImageUrl: finalImageUrl,
    imageUrl: finalImageUrl,
    imageSourceType: asset.imageSourceType || 'original',
    assetStatus: asset.assetStatus,
    qualityScore: asset.qualityScore,
    needsUserConfirm: Boolean(asset.needsUserConfirm),
    confirmReasons: asset.confirmReasons || [],
    bbox: asset.bbox || null,
    cropBox: asset.bbox || null,
    stageStatus: asset.stageStatus,
    providerTrace: asset.providerTrace,
    detectStatus: asset.stageStatus.attribute === 'success' ? 'success' : 'failed',
    segmentStatus: asset.stageStatus.segment,
    manualCropStatus: 'unsupported',
    type: asset.type || 'other',
    category: asset.category || asset.type || 'other',
    subCategory: asset.subCategory || asset.categoryName || '',
    categoryName: asset.categoryName || asset.subCategory || '',
    color: color || '',
    colors: Array.isArray(asset.colors) ? asset.colors : (color ? [color] : []),
    material: asset.material || '',
    style: asset.style || '',
    styleTags: Array.isArray(asset.styleTags) ? asset.styleTags : [],
    seasonTags: Array.isArray(asset.seasonTags) ? asset.seasonTags : [],
    confidence: asset.confidence || 0,
    detectProvider: 'bailian',
    detectModel: getModel('BAILIAN_ATTRIBUTE_MODEL'),
    segmentProvider: SEGMENT_PROVIDER,
    segmentModel: isAccessoryCategory(asset.type) || asset.type === 'shoes' ? COMMODITY_SEGMENT_MODEL : CLOTH_SEGMENT_MODEL,
    selected: true,
    status: 'pending',
    aiRawResult: asset.aiRawResult || {},
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function toDraftResponse(item) {
  return {
    id: item._id,
    userId: item.userId || item._openid,
    assetVersion: item.assetVersion || 'v1',
    batchId: item.batchId,
    sourceImageId: item.sourceImageId,
    itemIndex: item.itemIndex || 0,
    originalImageUrl: item.originalImageUrl,
    normalizedImageUrl: item.normalizedImageUrl || item.originalImageUrl,
    cropImageUrl: item.cropImageUrl || item.croppedImageUrl || '',
    croppedImageUrl: item.croppedImageUrl || item.cropImageUrl || '',
    maskImageUrl: item.maskImageUrl || '',
    cleanImageUrl: item.cleanImageUrl || item.aiSegmentImageUrl || '',
    displayImageUrl: getDisplayImage(item),
    imageUrl: item.imageUrl || getDisplayImage(item),
    imageSourceType: normalizeImageSourceType(item.imageSourceType, item),
    assetStatus: item.assetStatus || inferAssetStatus(item),
    qualityScore: item.qualityScore || 0,
    needsUserConfirm: item.needsUserConfirm !== false,
    confirmReasons: item.confirmReasons || [],
    bbox: item.bbox || item.cropBox,
    cropBox: item.cropBox || item.bbox,
    stageStatus: normalizeStageStatusMap(item.stageStatus || {
      router: 'skipped',
      detection: item.detectStatus || item.aiRecognizeStatus || 'success',
      crop: item.cropImageUrl || item.croppedImageUrl ? 'success' : 'skipped',
      segment: item.segmentStatus || item.cutoutStatus || 'skipped',
      attribute: item.detectStatus || item.aiRecognizeStatus || 'success',
    }),
    providerTrace: item.providerTrace || [],
    aiSegmentImageUrl: item.aiSegmentImageUrl || item.cleanImageUrl || '',
    manualCropImageUrl: item.manualCropImageUrl || '',
    detectStatus: item.detectStatus || item.aiRecognizeStatus || 'success',
    segmentStatus: item.segmentStatus || item.cutoutStatus || 'not_started',
    manualCropStatus: item.manualCropStatus || 'unsupported',
    type: item.type || item.category || 'other',
    categoryName: item.categoryName || item.subCategory || item.subcategory || '',
    color: item.color,
    colors: item.colors || (item.color ? [item.color] : []),
    material: item.material,
    style: item.style,
    styleTags: item.styleTags || (item.style ? [item.style] : []),
    seasonTags: normalizeSeasonTags(item.seasonTags || []),
    confidence: item.confidence || 0,
    detectProvider: item.detectProvider || 'bailian',
    detectModel: item.detectModel || '',
    segmentProvider: item.segmentProvider || SEGMENT_PROVIDER,
    segmentModel: item.segmentModel || '',
    selected: item.selected !== false,
    status: item.status || 'pending',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function getDisplayImage(item) {
  return [
    item.cleanImageUrl,
    item.aiSegmentImageUrl,
    item.cropImageUrl,
    item.croppedImageUrl,
    item.displayImageUrl,
    item.imageUrl,
    item.manualCropImageUrl,
    item.originalImageUrl,
  ].find((value) => typeof value === 'string' && value.trim()) || '';
}

function resolveFinalImageUrl(asset) {
  return asset.cleanImageUrl || asset.cropImageUrl || asset.displayImageUrl || asset.originalImageUrl || '';
}

function normalizeAttributeResult(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const colors = normalizeTextArray(raw.colors || (raw.color ? [raw.color] : []));
  const styleTags = normalizeTextArray(raw.styleTags || raw.styles || (raw.style ? [raw.style] : []));
  const seasonTags = normalizeSeasonTags(raw.seasonTags || raw.seasons);
  return {
    raw,
    category: normalizeText(raw.category || raw.type || '其他'),
    subCategory: normalizeText(raw.subCategory || raw.subcategory || raw.category || '其他'),
    type: normalizeType(raw.type || raw.category),
    color: normalizeText(raw.color || colors[0] || ''),
    colors,
    material: normalizeText(raw.material || ''),
    style: normalizeText(raw.style || styleTags[0] || ''),
    styleTags,
    seasonTags,
    confidence: normalizeConfidence(raw.confidence),
  };
}

function normalizeType(value) {
  const text = String(value || '').trim().toLowerCase();
  const map = {
    top: 'top',
    shirt: 'top',
    tshirt: 'top',
    't-shirt': 'top',
    coat: 'top',
    jacket: 'top',
    blazer: 'top',
    sweater: 'top',
    hoodie: 'top',
    上衣: 'top',
    外套: 'top',
    bottom: 'bottom',
    pants: 'bottom',
    trousers: 'bottom',
    jeans: 'bottom',
    shorts: 'bottom',
    skirt: 'bottom',
    下装: 'bottom',
    裤子: 'bottom',
    裙子: 'bottom',
    dress: 'onepiece',
    onepiece: 'onepiece',
    jumpsuit: 'onepiece',
    连衣裙: 'onepiece',
    连体: 'onepiece',
    shoes: 'shoes',
    shoe: 'shoes',
    footwear: 'shoes',
    鞋子: 'shoes',
    accessory: 'accessory',
    accessories: 'accessory',
    bag: 'accessory',
    hat: 'accessory',
    scarf: 'accessory',
    belt: 'accessory',
    配饰: 'accessory',
    包: 'accessory',
    帽子: 'accessory',
    other: 'other',
    其他: 'other',
  };
  return map[text] || (['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other'].includes(text) ? text : 'other');
}

function normalizeText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const map = {
    cotton: '棉',
    polyester: '聚酯纤维',
    denim: '牛仔',
    wool: '羊毛',
    linen: '亚麻',
    leather: '皮革',
    silk: '丝绸',
    knit: '针织',
    loose: '宽松',
    slim: '修身',
    casual: '休闲',
    sporty: '运动',
    sport: '运动',
    formal: '正式',
    minimalist: '简约',
    elegant: '优雅',
    vintage: '复古',
    street: '街头',
    top: '上衣',
    bottom: '下装',
    dress: '连衣裙',
    onepiece: '连衣裙',
    shoes: '鞋子',
    accessory: '配饰',
    other: '其他',
    black: '黑色',
    white: '白色',
    gray: '灰色',
    grey: '灰色',
    red: '红色',
    blue: '蓝色',
    green: '绿色',
    yellow: '黄色',
    pink: '粉色',
    purple: '紫色',
    brown: '棕色',
    beige: '米色',
    orange: '橙色',
    navy: '藏青色',
  };
  return map[lower] || text;
}

function normalizeTextArray(value) {
  return readStringArray(value).map(normalizeText).filter(Boolean);
}

function normalizeSeasonTags(value) {
  const map = {
    spring: '春季',
    春: '春季',
    春季: '春季',
    summer: '夏季',
    夏: '夏季',
    夏季: '夏季',
    autumn: '秋季',
    fall: '秋季',
    秋: '秋季',
    秋季: '秋季',
    winter: '冬季',
    冬: '冬季',
    冬季: '冬季',
    all: '四季',
    'all-season': '四季',
    all_season: '四季',
    'all season': '四季',
    四季: '四季',
  };
  return readStringArray(value)
    .map((item) => map[String(item).trim().toLowerCase()] || map[String(item).trim()] || normalizeText(item))
    .filter(Boolean);
}

function normalizeImageSourceType(value, item) {
  if (value === 'clean' || value === 'crop' || value === 'original') return value;
  if (value === 'ai_segment') return 'clean';
  if (value === 'manual_crop') return 'crop';
  if (item.cleanImageUrl || item.aiSegmentImageUrl) return 'clean';
  if (item.cropImageUrl || item.croppedImageUrl || item.manualCropImageUrl) return 'crop';
  return 'original';
}

function normalizeStageStatusMap(value) {
  const source = value || {};
  return {
    router: normalizeStageStatusValue(source.router),
    detection: normalizeStageStatusValue(source.detection),
    crop: normalizeStageStatusValue(source.crop),
    segment: normalizeStageStatusValue(source.segment),
    attribute: normalizeStageStatusValue(source.attribute),
  };
}

function normalizeStageStatusValue(value) {
  return value === 'success' || value === 'failed' || value === 'skipped' ? value : 'skipped';
}

function inferAssetStatus(item) {
  if (item.assetStatus) return item.assetStatus;
  if (item.cleanImageUrl || item.cropImageUrl || item.aiSegmentImageUrl || item.croppedImageUrl) return 'ready';
  return 'needs_review';
}

function mergeDetectionItems(primary, secondary) {
  const merged = [...primary];
  for (const item of secondary) {
    if (!merged.some((current) => bboxIou(current.bbox, item.bbox) > 0.65)) {
      merged.push(item);
    }
  }
  return merged;
}

function bboxIou(a, b) {
  if (!a || !b) return 0;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function shouldFallbackToSingleImage(routerResult) {
  return routerResult.imageScene === 'single_product'
    || routerResult.estimatedGarmentCount <= 1
    || routerResult.confidence < 0.45;
}

function shouldAllowLargeBbox(routerResult, candidate) {
  return Boolean(candidate && candidate.source === 'single_image_fallback')
    || routerResult.imageScene === 'single_product'
    || (routerResult.recommendedPipeline === 'non_person_pipeline' && routerResult.estimatedGarmentCount <= 1);
}

function buildEmptyReason(routerStage, detectionStage, candidates) {
  if (candidates && candidates.length > 0) return '';
  if (routerStage.status === 'failed') return `router_failed:${routerStage.errorMessage || 'unknown'}`;
  if (detectionStage.status === 'failed') return `detection_failed:${detectionStage.errorMessage || 'unknown'}`;
  if ((detectionStage.rawDetectedCount || 0) > 0) return 'detection_items_unusable';
  return 'no_garment_detected';
}

function isMainGarmentCategory(category) {
  return ['top', 'bottom', 'onepiece'].includes(normalizeType(category));
}

function isAccessoryCategory(category) {
  return normalizeType(category) === 'accessory';
}

function toPaddedPixelBox(bbox, imageWidth, imageHeight, paddingRatio) {
  const x = bbox.x * imageWidth;
  const y = bbox.y * imageHeight;
  const width = bbox.width * imageWidth;
  const height = bbox.height * imageHeight;
  const padX = width * paddingRatio;
  const padY = height * paddingRatio;
  const left = Math.max(0, Math.floor(x - padX));
  const top = Math.max(0, Math.floor(y - padY));
  const right = Math.min(imageWidth, Math.ceil(x + width + padX));
  const bottom = Math.min(imageHeight, Math.ceil(y + height + padY));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

async function getTempUrl(cloud, fileID) {
  if (typeof fileID === 'string' && /^https?:\/\//.test(fileID)) return fileID;
  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
  const tempUrl = tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL;
  if (!tempUrl) throw new Error('failed to get image temp url');
  return tempUrl;
}

async function getTempUrlFromFileID(fileID) {
  const cloud = require('wx-server-sdk');
  return getTempUrl(cloud, fileID);
}

async function downloadImageSource(cloud, fileID) {
  if (fileID && typeof fileID === 'string' && /^https?:\/\//.test(fileID)) {
    const fetch = require('node-fetch');
    const response = await fetch(fileID, { timeout: getAiTimeoutMs() });
    if (!response.ok) throw new Error(`download_image_failed_${response.status}`);
    return response.buffer();
  }
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    throw new Error('image must be a WeChat cloud fileID or http url');
  }
  const res = await cloud.downloadFile({ fileID });
  const buffer = res && res.fileContent;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('downloaded image is empty');
  }
  return buffer;
}

async function uploadBufferToOss({ buffer, objectKey }) {
  const client = createOssClient();
  await client.put(objectKey, buffer, {
    headers: {
      'Content-Type': getContentType(objectKey),
      'x-oss-object-acl': getOssUseSignedUrl() ? 'private' : 'public-read',
    },
  });
  return getOssUseSignedUrl() ? normalizeOssUrl(client.signatureUrl(objectKey, {
    expires: Number(process.env.OSS_URL_EXPIRES_SECONDS || process.env.ALIYUN_OSS_URL_EXPIRES_SECONDS || 1800),
  })) : getStandardOssUrl(objectKey);
}

function createOssClient() {
  const OSS = require('ali-oss');
  return new OSS({
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || process.env.ALIYUN_OSS_ACCESS_KEY_ID || getRequiredEnv('ALIYUN_ACCESS_KEY_ID'),
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET'),
    bucket: getOssBucket(),
    region: getOssRegion(),
    secure: true,
  });
}

async function callViapiSegment(imageUrl, actionName) {
  const { RPCClient } = require('@alicloud/pop-core');
  const endpoint = actionName === COMMODITY_SEGMENT_MODEL
    ? process.env.ALIYUN_SEGMENT_COMMODITY_ENDPOINT || getDefaultViapiEndpoint()
    : process.env.ALIYUN_SEGMENT_CLOTH_ENDPOINT || getDefaultViapiEndpoint();
  const client = new RPCClient({
    accessKeyId: getRequiredEnv('ALIYUN_ACCESS_KEY_ID'),
    accessKeySecret: getRequiredEnv('ALIYUN_ACCESS_KEY_SECRET'),
    endpoint,
    apiVersion: '2019-12-30',
  });
  const response = await client.request(actionName, { ImageURL: imageUrl }, { method: 'POST', timeout: getSegmentTimeoutMs() });
  const resultUrl = extractResultUrl(response);
  if (!resultUrl) throw new Error(`${actionName} returned empty ImageURL`);
  return resultUrl;
}

async function saveRemoteImage({ cloud, remoteUrl, cloudPath }) {
  const fetch = require('node-fetch');
  const response = await fetch(remoteUrl, { timeout: getSegmentTimeoutMs() });
  if (!response.ok) throw new Error(`download_segment_result_failed_${response.status}`);
  const buffer = await response.buffer();
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  return uploadRes.fileID;
}

async function deleteOssObject(objectKey) {
  if (!objectKey) return;
  try {
    const client = createOssClient();
    await client.delete(objectKey);
  } catch (error) {
    console.warn('[wardrobeAssetPipeline] delete OSS transit object failed', {
      objectKey,
      message: getErrorMessage(error),
    });
  }
}

function extractResultUrl(response) {
  const element = response && response.Data && Array.isArray(response.Data.Elements)
    ? response.Data.Elements[0]
    : null;
  return (element && (element.ImageURL || element.ImageUrl))
    || (response && response.Data && (response.Data.ImageURL || response.Data.ImageUrl))
    || (response && response.ImageURL)
    || '';
}

function getDefaultViapiEndpoint() {
  const region = process.env.ALIYUN_REGION || process.env.ALIYUN_VIAPI_REGION || 'cn-shanghai';
  return `https://imageseg.${region}.aliyuncs.com`;
}

function getStandardOssUrl(objectKey) {
  return `https://${getStandardOssHost()}/${encodeOssObjectKey(objectKey)}`;
}

function normalizeOssUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = 'https:';
  parsed.host = getStandardOssHost();
  return parsed.toString();
}

function getStandardOssHost() {
  return `${getOssBucket()}.${getOssRegion()}.aliyuncs.com`;
}

function getOssBucket() {
  return process.env.OSS_BUCKET || process.env.ALIYUN_OSS_BUCKET || getRequiredEnv('ALIYUN_OSS_BUCKET');
}

function getOssRegion() {
  const region = process.env.OSS_REGION || process.env.ALIYUN_OSS_REGION || getRequiredEnv('ALIYUN_OSS_REGION');
  const normalized = String(region || '').trim().toLowerCase();
  return normalized.startsWith('oss-') ? normalized : `oss-${normalized}`;
}

function getOssUseSignedUrl() {
  const value = process.env.OSS_USE_SIGNED_URL
    ?? process.env.ALIYUN_OSS_USE_SIGNED_URL
    ?? 'false';
  return String(value).trim().toLowerCase() === 'true';
}

function encodeOssObjectKey(objectKey) {
  return objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function getContentType(objectKey) {
  const ext = getFileExt(objectKey);
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function getFileExt(fileID) {
  const pathname = String(fileID || '').split('?')[0] || '';
  const match = pathname.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
  return match ? match[0].toLowerCase() : '.jpg';
}

async function retryTask(task) {
  const maxRetry = Math.max(0, Number(process.env.AI_MAX_RETRY || 1));
  let lastError;
  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function parseJson(content) {
  const text = String(content || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(text);
}

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function readString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num <= 1 ? Math.round(num * 100) : Math.min(100, Math.round(num));
}

function normalizeProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num > 1 ? Math.min(1, num / 100) : Math.max(0, Math.min(1, num));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || []));
}

function getModel(name, fallback) {
  return process.env[name] || fallback || process.env.BAILIAN_MODEL || 'qwen3-vl-flash';
}

function getBailianBaseUrl() {
  return process.env.BAILIAN_BASE_URL || DEFAULT_BAILIAN_BASE_URL;
}

function getAiTimeoutMs() {
  return Number(process.env.AI_TIMEOUT_MS || process.env.QWEN_TIMEOUT_MS || 30000);
}

function getSegmentTimeoutMs() {
  return Number(process.env.SEGMENT_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 60000);
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

module.exports = {
  runWardrobeAssetPipeline,
  toDraftData,
  toDraftResponse,
  getDisplayImage,
  normalizeSeasonTags,
  normalizeImageSourceType,
  getErrorMessage,
};
