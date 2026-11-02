/** Posts a file to a GPX tools endpoint and returns the file it answers with. Errors carry the server's message. */
export async function postForFile(path: string, form: FormData, fallbackName: string, action: string): Promise<File> {
  const response = await fetch(path, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { 'X-RPM-CSRF': '1' },
  });
  if (!response.ok) {
    let message = `${action} failed (${response.status}).`;
    try {
      const body = (await response.json()) as { title?: string };
      if (body.title) message = body.title;
    } catch {
      // Keep the HTTP status message when the server doesn't return JSON.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition');
  const fileName = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
  return new File([blob], fileName, { type: blob.type });
}

export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
