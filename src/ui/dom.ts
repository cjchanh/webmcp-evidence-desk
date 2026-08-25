/**
 * Tiny DOM builders. SECURITY RULE: every dynamic string enters the DOM via
 * textContent — never innerHTML — so corpus-derived (untrusted) text can
 * never inject markup.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function btn(
  label: string,
  onClick: () => void,
  className?: string
): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}
