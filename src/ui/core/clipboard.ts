// Copying a text to the clipboard from an app frame: `navigator.clipboard` where the frame may use
// it, else the browser's own copy of a selected text field.

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
