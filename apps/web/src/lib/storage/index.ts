// ============================================================
// 搭一搭 · 存储抽象层
// 支持本地存储和阿里云 OSS，预留扩展点
// ============================================================

import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';

// ── 类型定义 ─────────────────────────────────────────────────

export interface UploadResult {
  /** 访问 URL（本地 / OSS 公网地址） */
  url: string;
  /** 缩略图 URL（如果有） */
  thumbnailUrl?: string;
  /** 文件原始名称 */
  originalName: string;
  /** 文件 MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 存储提供者 */
  provider: 'local' | 'oss';
}

export interface StorageProvider {
  /** 上传文件，返回访问 URL */
  upload(file: Buffer, options: UploadOptions): Promise<UploadResult>;
  /** 删除文件 */
  delete(url: string): Promise<void>;
}

// ── 上传选项 ─────────────────────────────────────────────────

export interface UploadOptions {
  /** 目标目录/路径 */
  dir?: string;
  /** 文件原始名称（用于扩展名） */
  originalName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 生成缩略图（仅衣服图片） */
  thumbnail?: boolean;
}

// ── 本地存储 Provider ────────────────────────────────────────

function getLocalUploadDir(): string {
  // 优先从环境变量读取，否则用项目根目录的 uploads 文件夹
  return process.env['UPLOAD_DIR'] ?? path.join(process.cwd(), '..', 'uploads');
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // 已存在
  }
}

async function generateThumbnail(_imageBuffer: Buffer): Promise<Buffer | null> {
  // TODO: Phase 1 可选实现
  // 方案 A: 由图片服务生成缩略图
  // 方案 B: 调用识别服务时顺便生成缩略图
  return null;
}

const localProvider: StorageProvider = {
  async upload(file: Buffer, options: UploadOptions): Promise<UploadResult> {
    const uploadDir = path.join(getLocalUploadDir(), options.dir ?? 'general');
    await ensureDir(uploadDir);

    // 生成唯一文件名
    const ext = path.extname(options.originalName) || getExtensionFromMime(options.mimeType);
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(uploadDir, filename);

    // 写入文件
    await fs.writeFile(filePath, file);

    // 生成缩略图（如果需要）
    let thumbnailUrl: string | undefined;
    if (options.thumbnail) {
      const thumb = await generateThumbnail(file);
      if (thumb) {
        const thumbFilename = `${randomUUID()}_thumb${ext}`;
        const thumbPath = path.join(uploadDir, thumbFilename);
        await fs.writeFile(thumbPath, thumb);
        // 本地缩略图 URL（相对路径）
        thumbnailUrl = `/uploads/${options.dir ?? 'general'}/${thumbFilename}`;
      }
    }

    // 构建访问 URL
    // 本地开发用 Next.js 静态文件服务，生产环境可能用 CDN 或 Nginx 反代
    const url = `/uploads/${options.dir ?? 'general'}/${filename}`;

    return {
      url,
      thumbnailUrl,
      originalName: options.originalName,
      mimeType: options.mimeType,
      size: file.length,
      provider: 'local',
    };
  },

  async delete(url: string): Promise<void> {
    // 从 URL 提取文件路径
    // 格式: /uploads/clothes/xxx.jpg
    const relativePath = url.replace(/^\/uploads\//, '');
    const filePath = path.join(getLocalUploadDir(), relativePath);
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件不存在或已删除，忽略
    }
  },
};

// ── OSS Provider（预留）──────────────────────────────────────

const ossProvider: StorageProvider = {
  async upload(file: Buffer, options: UploadOptions): Promise<UploadResult> {
    // TODO: 接入阿里云 OSS
    // const OSS = require('ali-oss');
    // const client = new OSS({
    //   region: process.env.OSS_REGION,
    //   accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    //   accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    //   bucket: process.env.OSS_BUCKET,
    // });
    // const ext = path.extname(options.originalName) || getExtensionFromMime(options.mimeType);
    // const filename = `${options.dir ?? 'general'}/${randomUUID()}${ext}`;
    // const result = await client.put(filename, file);
    // return {
    //   url: result.url,
    //   originalName: options.originalName,
    //   mimeType: options.mimeType,
    //   size: file.length,
    //   provider: 'oss',
    // };
    throw new Error('OSS Provider not configured. Please set OSS_* environment variables.');
  },

  async delete(url: string): Promise<void> {
    // TODO: 接入阿里云 OSS
    // const OSS = require('ali-oss');
    // const client = new OSS({ ... });
    // await client.delete(url.replace(/^https?:\/\/[^/]+\//, ''));
    throw new Error('OSS Provider not configured. Please set OSS_* environment variables.');
  },
};

// ── Storage 工厂函数 ─────────────────────────────────────────

/**
 * 根据环境变量选择存储提供者
 * STORAGE_PROVIDER=oss → 阿里云 OSS
 * STORAGE_PROVIDER=local 或其他 → 本地存储
 */
export function getStorageProvider(): StorageProvider {
  const provider = process.env['STORAGE_PROVIDER'] ?? 'local';
  if (provider === 'oss') {
    // 简单检查 OSS 配置是否完整
    const hasOssConfig =
      process.env['OSS_ACCESS_KEY_ID'] &&
      process.env['OSS_ACCESS_KEY_SECRET'] &&
      process.env['OSS_BUCKET'];
    if (!hasOssConfig) {
      console.warn('[Storage] OSS provider selected but OSS_* env vars not set, falling back to local');
      return localProvider;
    }
    return ossProvider;
  }
  return localProvider;
}

// ── 辅助函数 ─────────────────────────────────────────────────

function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
  };
  return map[mimeType] ?? '.bin';
}

// 导出单例
export const storage = getStorageProvider();
