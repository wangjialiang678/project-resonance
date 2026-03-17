/**
 * Map API HTTP status codes and error payloads to user-friendly Chinese messages.
 *
 * Upstream APIs may return {error: {message, type}} or {error: string}.
 */

const STATUS_MESSAGES: Record<number, string> = {
  401: 'API 密钥无效或已过期，请检查配置',
  402: 'API 服务余额不足，请联系管理员',
  429: '请求过于频繁，请稍后重试',
  500: '服务器内部错误，请稍后重试',
  502: '服务暂时不可用，请稍后重试',
  503: '服务维护中，请稍后重试',
};

function extractErrorDetail(errData: Record<string, unknown>): string | undefined {
  if (typeof errData.error === 'string') return errData.error;
  if (errData.error && typeof errData.error === 'object') {
    const nested = errData.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  if (typeof errData.message === 'string') return errData.message;
  if (typeof errData.detail === 'string') return errData.detail;
  return undefined;
}

export function formatApiError(
  status: number,
  errData: Record<string, unknown>,
  context: string,
): string {
  // Priority 1: known status code with clear user action
  const statusMsg = STATUS_MESSAGES[status];
  if (statusMsg) return statusMsg;

  // Priority 2: extract detail from response body
  const detail = extractErrorDetail(errData);
  if (detail) return detail;

  // Priority 3: generic fallback with context
  return `${context}失败 (${status})`;
}
