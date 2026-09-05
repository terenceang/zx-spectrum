export interface DskSector {
  c: number;
  h: number;
  r: number;
  n: number;
  st1: number;
  st2: number;
  data: Uint8Array;
}

export interface DskTrack {
  trackNumber: number;
  sideNumber: number;
  sectorSizeCode: number;
  gap3Length: number;
  fillerByte: number;
  sectors: DskSector[];
}

export class DskImage {
  readonly isExtended: boolean;
  readonly creator: string;
  readonly tracksCount: number;
  readonly sidesCount: number;
  private readonly tracks = new Map<number, DskTrack>();

  constructor(isExtended: boolean, creator: string, tracksCount: number, sidesCount: number) {
    this.isExtended = isExtended;
    this.creator = creator;
    this.tracksCount = tracksCount;
    this.sidesCount = sidesCount;
  }

  static trackKey(cylinder: number, side: number): number {
    return (cylinder << 1) | (side & 1);
  }

  setTrack(cylinder: number, side: number, track: DskTrack): void {
    this.tracks.set(DskImage.trackKey(cylinder, side), track);
  }

  getTrack(cylinder: number, side: number): DskTrack | undefined {
    return this.tracks.get(DskImage.trackKey(cylinder, side));
  }

  getSector(cylinder: number, side: number, sectorId: number): DskSector | undefined {
    const track = this.getTrack(cylinder, side);
    if (!track) return undefined;
    return track.sectors.find((s) => s.r === sectorId);
  }

  getAllTracks(): DskTrack[] {
    return Array.from(this.tracks.values());
  }

  serialize(): Uint8Array {
    const header = new Uint8Array(256);
    const magic = "EXTENDED CPC DSK File\r\n";
    for (let i = 0; i < magic.length; i++) header[i] = magic.charCodeAt(i);
    const creator = (this.creator || "TA://SPECTRUM").slice(0, 14);
    for (let i = 0; i < creator.length; i++) header[0x22 + i] = creator.charCodeAt(i);

    header[0x30] = this.tracksCount;
    header[0x31] = this.sidesCount;

    const serializedTracks: Uint8Array[] = [];
    const trackSizes: number[] = [];

    for (let cyl = 0; cyl < this.tracksCount; cyl++) {
      for (let side = 0; side < this.sidesCount; side++) {
        const track = this.getTrack(cyl, side);
        if (!track) {
          trackSizes.push(0);
          continue;
        }

        let sectorDataLength = 0;
        for (const s of track.sectors) {
          sectorDataLength += s.data.length;
        }

        const trackLength = 256 + sectorDataLength;
        trackSizes.push(trackLength);

        const trackBuf = new Uint8Array(trackLength);
        const tag = "Track-Info\r\n";
        for (let i = 0; i < tag.length; i++) trackBuf[i] = tag.charCodeAt(i);

        trackBuf[0x10] = track.trackNumber;
        trackBuf[0x11] = track.sideNumber;
        trackBuf[0x14] = track.sectorSizeCode;
        trackBuf[0x15] = track.sectors.length;
        trackBuf[0x16] = track.gap3Length;
        trackBuf[0x17] = track.fillerByte;

        let sectorOffset = 256;
        for (let i = 0; i < track.sectors.length; i++) {
          const s = track.sectors[i]!;
          const infoOffset = 0x18 + i * 8;
          trackBuf[infoOffset] = s.c;
          trackBuf[infoOffset + 1] = s.h;
          trackBuf[infoOffset + 2] = s.r;
          trackBuf[infoOffset + 3] = s.n;
          trackBuf[infoOffset + 4] = s.st1;
          trackBuf[infoOffset + 5] = s.st2;
          trackBuf[infoOffset + 6] = s.data.length & 0xff;
          trackBuf[infoOffset + 7] = (s.data.length >> 8) & 0xff;

          trackBuf.set(s.data, sectorOffset);
          sectorOffset += s.data.length;
        }

        serializedTracks.push(trackBuf);
      }
    }

    for (let i = 0; i < trackSizes.length; i++) {
      header[0x34 + i] = Math.ceil((trackSizes[i] || 0) / 256);
    }

    const totalLength = 256 + serializedTracks.reduce((acc, t) => acc + t.length, 0);
    const out = new Uint8Array(totalLength);
    out.set(header, 0);
    let offset = 256;
    for (const t of serializedTracks) {
      out.set(t, offset);
      offset += t.length;
    }
    return out;
  }
}

export function parseDsk(bytes: Uint8Array): DskImage {
  if (bytes.length < 256) {
    throw new Error(`Invalid DSK image: file length ${bytes.length} is too short`);
  }

  const headerStr = String.fromCharCode(...bytes.subarray(0, 16));
  const isExtended = headerStr.startsWith("EXTENDED");
  const isStandard = headerStr.startsWith("MV - CPC");

  if (!isExtended && !isStandard) {
    throw new Error(`Unrecognized DSK header signature: "${headerStr.slice(0, 8)}"`);
  }

  const creator = String.fromCharCode(...bytes.subarray(0x22, 0x30)).trim();
  const tracksCount = bytes[0x30]!;
  const sidesCount = bytes[0x31]!;
  const standardTrackSize = isStandard ? bytes[0x32]! | (bytes[0x33]! << 8) : 0;

  const image = new DskImage(isExtended, creator, tracksCount, sidesCount);

  let fileOffset = 256;
  let trackIndex = 0;

  for (let cyl = 0; cyl < tracksCount; cyl++) {
    for (let side = 0; side < sidesCount; side++) {
      let trackSize = 0;
      if (isExtended) {
        const sizeHigh = bytes[0x34 + trackIndex]!;
        trackSize = sizeHigh * 256;
      } else {
        trackSize = standardTrackSize;
      }

      trackIndex++;

      if (trackSize === 0) {
        continue;
      }

      if (fileOffset + 256 > bytes.length) {
        break;
      }

      const trackInfo = bytes.subarray(fileOffset, fileOffset + 256);
      const trackTag = String.fromCharCode(...trackInfo.subarray(0, 10));
      if (!trackTag.startsWith("Track-Info")) {
        fileOffset += trackSize;
        continue;
      }

      const trackNumber = trackInfo[0x10]!;
      const sideNumber = trackInfo[0x11]!;
      const sectorSizeCode = trackInfo[0x14]!;
      const numSectors = trackInfo[0x15]!;
      const gap3Length = trackInfo[0x16]!;
      const fillerByte = trackInfo[0x17]!;

      const sectors: DskSector[] = [];
      let sectorDataOffset = fileOffset + 256;

      for (let s = 0; s < numSectors; s++) {
        const infoOffset = 0x18 + s * 8;
        const c = trackInfo[infoOffset]!;
        const h = trackInfo[infoOffset + 1]!;
        const r = trackInfo[infoOffset + 2]!;
        const n = trackInfo[infoOffset + 3]!;
        const st1 = trackInfo[infoOffset + 4]!;
        const st2 = trackInfo[infoOffset + 5]!;

        let sectorLen = 0;
        if (isExtended) {
          sectorLen = trackInfo[infoOffset + 6]! | (trackInfo[infoOffset + 7]! << 8);
        }
        if (sectorLen === 0) {
          sectorLen = 128 << n;
        }

        const data = bytes.slice(sectorDataOffset, sectorDataOffset + sectorLen);
        sectorDataOffset += sectorLen;

        sectors.push({ c, h, r, n, st1, st2, data });
      }

      image.setTrack(cyl, side, {
        trackNumber,
        sideNumber,
        sectorSizeCode,
        gap3Length,
        fillerByte,
        sectors,
      });

      fileOffset += trackSize;
    }
  }

  return image;
}
