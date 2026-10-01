/** Small browser file helpers shared by the export / import actions. */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, type: string): void {
  downloadBlob(filename, new Blob([content], { type }));
}

/** Open the file picker and hand the chosen file's text to `onText`. */
export function pickTextFile(accept: string, onText: (text: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onText(reader.result as string);
    reader.readAsText(file);
  };
  input.click();
}

/**
 * Open generated HTML in a new window and print it once loaded.
 * Returns false when the popup was blocked.
 */
export function printHtmlInNewWindow(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  let revoked = false;
  const revokeUrl = () => {
    if (revoked) return;
    URL.revokeObjectURL(url);
    revoked = true;
  };
  win.addEventListener('load', () => {
    win.print();
    revokeUrl();
  }, { once: true });
  win.addEventListener('beforeunload', revokeUrl, { once: true });
  return true;
}
