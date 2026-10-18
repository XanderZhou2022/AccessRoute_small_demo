const DIGITS = '零一二三四五六七八九';

function tens(n: number): string {
  return `${n < 20 ? '一' : DIGITS[Math.floor(n / 10)]}十${n % 10 ? DIGITS[n % 10] : ''}`;
}

function integerToCantonese(n: number): string {
  if (n < 10) return DIGITS[n];
  if (n < 100) return n < 20 ? tens(n).slice(1) : tens(n);
  const unit = n < 1000 ? 100 : 1000;
  const head = `${DIGITS[Math.floor(n / unit)]}${unit === 100 ? '百' : '千'}`;
  const rest = n % unit;
  if (rest === 0) return head;
  if (rest < unit / 10) return `${head}零${integerToCantonese(rest)}`;
  return `${head}${rest < 100 && rest >= 10 ? tens(rest) : integerToCantonese(rest)}`;
}

// Written floor labels and digits are not spoken Cantonese; convert them before TTS.
export function toSpokenText(text: string): string {
  const edge = '(?<![A-Za-z0-9])';
  return text
    .replace(new RegExp(`${edge}UG\\/?F(?![A-Za-z])`, 'g'), '上地下')
    .replace(new RegExp(`${edge}G\\/F(?![A-Za-z])`, 'g'), '地下')
    .replace(new RegExp(`${edge}M\\/F(?![A-Za-z])`, 'g'), '閣樓')
    .replace(
      new RegExp(`${edge}LG(\\d)(?:\\/F)?(?![A-Za-z0-9])`, 'g'),
      (_, n) => `低層${integerToCantonese(Number(n))}樓`,
    )
    .replace(
      new RegExp(`${edge}B(\\d)(?:\\/F)?(?![A-Za-z0-9]|\\s*出口)`, 'g'),
      (_, n) => `地庫${integerToCantonese(Number(n))}層`,
    )
    .replace(
      new RegExp(`${edge}(\\d{1,2})\\/F(?![A-Za-z])`, 'g'),
      (_, n) => `${integerToCantonese(Number(n))}樓`,
    )
    .replace(
      new RegExp(`${edge}Level\\s*(\\d{1,2})(?![A-Za-z0-9])`, 'gi'),
      (_, n) => `${integerToCantonese(Number(n))}樓`,
    )
    .replace(
      new RegExp(`${edge}(\\d{1,4})\\.(\\d+)(?![A-Za-z0-9])`, 'g'),
      (_, whole, fraction) =>
        `${integerToCantonese(Number(whole))}點${[...fraction].map((d) => DIGITS[Number(d)]).join('')}`,
    )
    .replace(new RegExp(`${edge}(\\d{1,4})(?![A-Za-z0-9.])`, 'g'), (_, n) =>
      integerToCantonese(Number(n)),
    );
}
