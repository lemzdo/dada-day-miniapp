import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
  type LocalWriteResult,
} from '@/lib/localStorage';
import {
  createUploadWorkflowEnvelope,
  markUploadWorkflowTerminal,
  reconcileUploadWorkflowRefs,
  upsertUploadWorkflowRef,
  type UploadWorkflowEnvelopeV2,
  type UploadWorkflowPhase,
} from './uploadWorkflowCore';
import type { ActiveAuthContext } from '@/stores/userStore';

const EMPTY_WRITE: LocalWriteResult = {
  ok: false,
  status: 'persistence-error',
  reason: 'auth-context-required',
  attempts: 0,
  bytes: 0,
  recoverability: 'memory-only',
};

export function readUploadWorkflow(authContext: ActiveAuthContext | null | undefined) {
  if (!authContext) return createUploadWorkflowEnvelope();
  const stored = readLocalStorage<UploadWorkflowEnvelopeV2>('uploadWorkflow:v2', {
    scope: authContext.userScope,
  });
  return createUploadWorkflowEnvelope(stored?.payload.refs);
}

export function upsertUploadWorkflow(
  authContext: ActiveAuthContext | null | undefined,
  input: {
    batchId: string;
    cloudImageIds?: string[];
    phase?: UploadWorkflowPhase;
    createdAt?: number;
    updatedAt?: number;
    needsServerVerification?: boolean;
    replaceCloudImageIds?: boolean;
  },
  now = Date.now(),
): { status: 'updated' | 'full' | 'invalid'; persistence: LocalWriteResult; envelope: UploadWorkflowEnvelopeV2 } {
  if (!authContext) return { status: 'invalid', persistence: EMPTY_WRITE, envelope: createUploadWorkflowEnvelope() };
  const updated = upsertUploadWorkflowRef(readUploadWorkflow(authContext), input, now);
  if (updated.status !== 'updated') {
    return { ...updated, persistence: EMPTY_WRITE };
  }
  return {
    ...updated,
    persistence: writeLocalStorage('uploadWorkflow:v2', updated.envelope, {
      scope: authContext.userScope,
      now,
    }),
  };
}

export function removeTerminalUploadWorkflow(
  authContext: ActiveAuthContext | null | undefined,
  batchId: string,
  status: string,
): LocalWriteResult | null {
  if (!authContext) return EMPTY_WRITE;
  const current = readUploadWorkflow(authContext);
  const next = markUploadWorkflowTerminal(current, batchId, status);
  if (next.refs.length === current.refs.length) return null;
  if (next.refs.length === 0) {
    removeLocalStorage('uploadWorkflow:v2', { scope: authContext.userScope });
    return null;
  }
  return writeLocalStorage('uploadWorkflow:v2', next, { scope: authContext.userScope });
}

export function reconcileUploadWorkflow(
  authContext: ActiveAuthContext | null | undefined,
  options: Parameters<typeof reconcileUploadWorkflowRefs>[1],
) {
  if (!authContext) return reconcileUploadWorkflowRefs(null, { cloudAvailable: false });
  const result = reconcileUploadWorkflowRefs(readUploadWorkflow(authContext), options);
  if (result.envelope.refs.length === 0) {
    removeLocalStorage('uploadWorkflow:v2', { scope: authContext.userScope });
  } else {
    writeLocalStorage('uploadWorkflow:v2', result.envelope, { scope: authContext.userScope });
  }
  return result;
}
