const OTP_KEYWORD_RE =
  /(otp|verification.?code|one.?time.?pass(?:word|code)?|one.?time.?code|passcode|access.?code|security.?code|auth(?:entication)?.?code|login.?code|sign.?in.?code|activation.?code|reset.?code|password.?reset|temporary.?password|temp.?pass|2fa|two.?factor|2-factor|confirmation.?code|token|pin\b|\bcode\b|رمز|كود|تحقق|مفتاح|رمز المرور|كلمة السر المؤقتة)/i;

const STRONG_OTP_CONTEXT_RE =
  /(otp|verification.?code|one.?time.?pass(?:word|code)?|one.?time.?code|passcode|security.?code|auth(?:entication)?.?code|login.?code|sign.?in.?code|activation.?code|reset.?code|temporary.?password|2fa|two.?factor|2-factor|confirmation.?code|pin\b|رمز|كود|رمز المرور|كلمة السر المؤقتة)/i;

const MASKED_CARD_RE =
  /(?:ending|ending in|last\s+\d+\s+digits?|card|account|no\.?|number|acct|a\/c)[^\d]{0,15}$/i;

export function normalizeOtpSource(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\*_`~]/g, '');
}

function isLikelyYearCode(code: string): boolean {
  return /^(19|20)\d{2}$/.test(code);
}

function hasStrongOtpContextNear(
  normalized: string,
  matchIndex: number,
  matchLength: number,
): boolean {
  const from = Math.max(0, matchIndex - 24);
  const to = Math.min(normalized.length, matchIndex + matchLength + 24);
  return STRONG_OTP_CONTEXT_RE.test(normalized.slice(from, to));
}

function shouldAcceptOtpCandidate(
  normalized: string,
  code: string,
  matchIndex: number,
  matchLength: number,
): boolean {
  if (!isLikelyYearCode(code)) return true;
  return hasStrongOtpContextNear(normalized, matchIndex, matchLength);
}

export function extractOtpCode(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;

  const normalized = normalizeOtpSource(text);
  if (!normalized) return null;

  const kwMatch = normalized.match(OTP_KEYWORD_RE);
  if (!kwMatch || kwMatch.index == null) return null;

  const kwIdx = kwMatch.index + kwMatch[0].length;
  const afterWindow = normalized.slice(kwIdx, kwIdx + 80);
  const nearby = /\b(\d{4,8})\b/g;
  let nearbyMatch: RegExpExecArray | null = nearby.exec(afterWindow);
  while (nearbyMatch) {
    const code = nearbyMatch[1];
    const codeIdx = kwIdx + (nearbyMatch.index || 0);
    if (shouldAcceptOtpCandidate(normalized, code, codeIdx, code.length)) {
      return code;
    }
    nearbyMatch = nearby.exec(afterWindow);
  }

  const before = normalized.slice(Math.max(0, kwMatch.index - 40), kwMatch.index);
  const beforeStart = Math.max(0, kwMatch.index - 40);
  const beforeMatch = before.match(/\b(\d{4,8})\b/);
  if (beforeMatch && beforeMatch.index != null) {
    const beforeSlice = before.slice(0, beforeMatch.index + beforeMatch[0].length);
    if (!MASKED_CARD_RE.test(beforeSlice)) {
      const code = beforeMatch[1];
      const codeIdx = beforeStart + beforeMatch.index;
      if (shouldAcceptOtpCandidate(normalized, code, codeIdx, code.length)) {
        return code;
      }
    }
  }

  const anyMatch = normalized.match(/\b(\d{4,8})\b/);
  if (anyMatch && anyMatch.index != null) {
    const preceding = normalized.slice(Math.max(0, anyMatch.index - 30), anyMatch.index);
    if (!MASKED_CARD_RE.test(preceding)) {
      const code = anyMatch[1];
      if (shouldAcceptOtpCandidate(normalized, code, anyMatch.index, code.length)) {
        return code;
      }
    }
  }

  return null;
}

export function buildOtpSourceFromNotification(data: Record<string, any>): string {
  if (!data || typeof data !== 'object') return '';

  const candidates = [
    data.title,
    data.contactName,
    data.body,
    data.text,
    data.content,
    data.bigText,
    data.subText,
    data.summaryText,
    data.message,
    data.messages,
    data.tickerText,
  ];

  const seen = new Set<string>();
  const merged: string[] = [];
  candidates.forEach(value => {
    if (value == null) return;
    const str = String(value).trim();
    if (!str || seen.has(str)) return;
    seen.add(str);
    merged.push(str);
  });

  return merged.join(' ');
}

export function isLikelyEmailNotification(data: Record<string, any>): boolean {
  const pkg = String(data?.packageName || '').toLowerCase();
  const app = String(data?.appName || '').toLowerCase();
  return /mail|email|gmail|outlook|yahoo|proton|spark/.test(`${pkg} ${app}`);
}
