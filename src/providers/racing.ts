import type {
  Provider,
  UpstreamStream,
  UpstreamTrack,
  Quality,
} from '../types.js';

export interface Source {
  name: string;
  provider: Provider;
}

interface Candidate {
  source: string;
  id: string;
}

export class RacingProvider implements Provider {
  constructor(private readonly sources: Source[]) {}

  async search(
    query: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamTrack[]> {
    const results = await Promise.allSettled(
      this.sources.map(async (source) => {
        const tracks = await source.provider.search(query, quality, atmos);

        return tracks.map((track) => ({
          source: source.name,
          track,
        }));
      }),
    );

    const found: { source: string; track: UpstreamTrack }[] = [];
    let failures = 0;
    let lastError: unknown;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        found.push(...result.value);
      } else {
        failures++;
        lastError = result.reason;
      }
    }

    if (this.sources.length > 0 && failures === this.sources.length) {
      throw lastError;
    }

    const groups: typeof found[] = [];

    for (const item of found) {
      const existing = groups.find((group) =>
        sameTrack(group[0].track, item.track),
      );

      if (existing) {
        existing.push(item);
      } else {
        groups.push([item]);
      }
    }

    return groups.map((group) => {
      const ranked = [...group].sort(
        (a, b) => qualityScore(b.track) - qualityScore(a.track),
      );

      const best = ranked[0];

      const candidates: Candidate[] = ranked.map((item) => ({
        source: item.source,
        id: item.track.upstreamId,
      }));

      return {
        ...best.track,
        upstreamId: `multi:${JSON.stringify(candidates)}`,
      };
    });
  }

  async getStream(
    trackId: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamStream | null> {
    if (trackId.startsWith('multi:')) {
      let candidates: Candidate[];

      try {
        candidates = JSON.parse(trackId.slice(6));
      } catch {
        return null;
      }

      if (!Array.isArray(candidates)) return null;

      for (const candidate of candidates) {
        if (
          typeof candidate.source !== 'string' ||
          typeof candidate.id !== 'string'
        ) {
          continue;
        }

        const source = this.sources.find(
          (item) => item.name === candidate.source,
        );

        if (!source) continue;

        try {
          const stream = await source.provider.getStream(
            candidate.id,
            quality,
            atmos,
          );

          if (stream) return stream;
        } catch {
          // Try the next candidate.
        }
      }

      return null;
    }

    return null;
  }
}

function sameTrack(a: UpstreamTrack, b: UpstreamTrack): boolean {
  const titleA = normalizeText(a.title);
  const titleB = normalizeText(b.title);

  const artistA = normalizeText(a.artist ?? '');
  const artistB = normalizeText(b.artist ?? '');

  if (!titleA || titleA !== titleB) return false;
  if (artistA !== artistB) return false;

  if (
    typeof a.duration === 'number' &&
    typeof b.duration === 'number' &&
    Math.abs(a.duration - b.duration) > 2
  ) {
    return false;
  }

  const albumA = normalizeText(a.album ?? '');
  const albumB = normalizeText(b.album ?? '');

  if (albumA && albumB && albumA !== albumB) return false;

  return true;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function qualityScore(track: UpstreamTrack): number {
  const bitDepth = track.bitDepth ?? 0;
  const sampleRate = track.sampleRate ?? 0;

  if (bitDepth >= 24 && sampleRate >= 176400) return 500;
  if (bitDepth >= 24 && sampleRate >= 88200) return 400;
  if (bitDepth > 16 || sampleRate > 44100) return 300;
  if (bitDepth === 16 && sampleRate >= 44100) return 200;

  if (track.audioQuality?.toUpperCase() === 'HI-RES') return 300;
  if (track.audioQuality?.toUpperCase() === 'LOSSLESS') return 150;

  return 0;
}
