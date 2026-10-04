/** Cmd/Ctrl+B, outside text fields: toggles the navigation drawer. */
export function isSidebarToggleShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  target?: EventTarget | null;
}): boolean {
  if (!(event.metaKey || event.ctrlKey) || (event.key !== 'b' && event.key !== 'B')) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return false;
  }
  return true;
}
