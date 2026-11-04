'use strict';
const messages = Object.freeze({
  UNAUTHENTICATED: '需要微信登录身份', VALIDATION: '输入字段不合法', NOT_FOUND: '记录不存在或不可访问',
  CONFLICT: '记录已更新，请重新读取并确认', INVALID_REFERENCE: '关联记录无效', HAS_DEPENDENTS: '请先处理关联记录',
  CONFIRMATION_REQUIRED: '请检查并明确确认', DUPLICATE_CHOICE_REQUIRED: '请选择合并或另存',
  DRAFT_EXPIRED: '导入草稿已过期，请重新识别', UNKNOWN_ACTION: '不支持的操作', INTERNAL: '服务暂时不可用'
});
class DomainError extends Error { constructor(code) { super(messages[code] || messages.INTERNAL); this.code = code; } }
const fail = code => { throw new DomainError(code); };
const resultError = error => ({ ok: false, error: { code: error instanceof DomainError ? error.code : 'INTERNAL', message: error instanceof DomainError ? error.message : messages.INTERNAL } });
module.exports = { DomainError, fail, resultError };
