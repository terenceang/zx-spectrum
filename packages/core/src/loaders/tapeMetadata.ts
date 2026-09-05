export type TapeMachineCompatibility = "48k" | "128k";

export function is128kOrAboveTape(
  name: string,
  filename: string,
  data?: ArrayBuffer | Uint8Array,
  machine?: string,
): boolean {
  if (machine === "128k" || machine === "plus3") return true;
  if (machine === "48k") return false;

  const text = `${name} ${filename}`;
  if (/(?:[\b_([-\s]|^)(?:128\w*|\+2|\+3|plus\s*[23])|\[128k?\]|\(128k?\)|128\s*k/i.test(text)) {
    return true;
  }

  if (data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let offset = 0;
    while (offset + 14 <= bytes.length) {
      const len = bytes[offset]! | (bytes[offset + 1]! << 8);
      offset += 2;
      if (len >= 12 && offset + len <= bytes.length && bytes[offset] === 0x00) {
        let blockName = "";
        for (let i = 2; i < Math.min(12, len); i++) {
          const ch = bytes[offset + i]!;
          if (ch >= 32 && ch <= 126) blockName += String.fromCharCode(ch);
        }
        if (/128|\+2|\+3/i.test(blockName)) return true;
      }
      offset += len;
    }
  }

  return false;
}

export function detectTapeMachine(
  name: string,
  filename: string,
  data?: ArrayBuffer | Uint8Array,
): TapeMachineCompatibility {
  return is128kOrAboveTape(name, filename, data) ? "128k" : "48k";
}
