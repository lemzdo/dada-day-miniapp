// ============================================================
// GET /uploads/[...path]
// 开发环境：直接从本地文件系统读取上传的文件
// ============================================================

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeProcess = require('node:process') as typeof process;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: filePathParts } = await params;
  const filePath = filePathParts.join('/');

  const uploadDir =
    nodeProcess.env['UPLOAD_DIR'] ??
    path.join(nodeProcess.cwd(), '..', 'uploads');
  const fullPath = path.join(uploadDir, filePath);

  // 安全检查：确保文件在上传目录内，防止路径穿越
  if (!fullPath.startsWith(uploadDir)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const file = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.heic': 'image/heic',
    };

    const contentType = mimeTypes[ext] ?? 'application/octet-stream';

    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
