import type { Config } from '../config.js';
import type {
  Provider,
  UpstreamStream,
  UpstreamTrack,
  Quality,
} from '../types.js';
import { fetchJson, isRecord } from './upstream.js';

export class MonochromeProvider implements Provider {
  constructor(private readonly config: Config) {}

  async search(
    query: string,
    _quality: Quality,
    _atmos: string,
  ): Promise<UpstreamTrack[]> {
    const url = new URL('/search/tracks', this.config.monochromeBaseUrl);

    url.searchParams.set('q', query);
    url.searchParams.set('limit', '10');

    const body = await fetchJson(url, {
      name: 'Monochrome',
      timeoutMs: Math.max(this.config.requestTimeoutMs, 10_000),
      attempts: this.config.upstreamRetries + 1,
      cacheSeconds: Math.round(this.config.cacheTtlMs / 1000),
    });

    const items =
      isRecord(body) && Array.isArray(body.tracks)
        ? body.tracks
        : [];

    return items
      .filter(isRecord)
      .map(toTrack)
      .filter((track): track is UpstreamTrack => track !== null);
  }

  async getStream(
    trackId: string,
    _quality: Quality,
    _atmos: string,
  ): Promise<UpstreamStream | null> {
    if (!/^[A-Za-z0-9_-]+$/.test(trackId)) {
      return null;
    }

    const url = new URL(
      `/track/${encodeURIComponent(trackId)}`,
      this.config.monochromeBaseUrl,
    ).toString();

    const label = await this.sniff(url);

    return {
      url,
      ...label,
      manifest: 'none',
      encrypted: false,
    };
  }

  /**
   * Checks the actual file header.
   * Does not assume every Monochrome result is FLAC.
   */
  private async sniff(
    url: string,
  ): Promise<{ format?: string; quality?: string }> {
    try {
      const response = await fetch(url, {
        headers: { range: 'bytes=0-11' },
        signal: AbortSignal.timeout(
          Math.min(this.config.requestTimeoutMs, 5000),
        ),
      });

      if (response.status !== 206) {
        await response.body?.cancel();
        return {};
      }

      const head = new Uint8Array(await response.arrayBuffer());

      const text = (from: number, to: number) =>
        String.fromCharCode(...head.slice(from, to));

      if (text(0, 4) === 'fLaC') {
        return {
          format: 'flac',
          quality: 'LOSSLESS',
        };
      }

      if (text(4, 8) === 'ftyp') {
        return {
          format: 'm4a',
          quality: 'HIGH',
        };
      }

      return {};
    } catch {
      return {};
    }
  }
}

function toTrack(raw: Record<string, unknown>): UpstreamTrack | null {
  const id = raw.id ?? raw.trackId;
  const title = raw.title;

  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    typeof title !== 'string' ||
    !title.trim()
  ) {
    return null;
  }

  const artists = Array.isArray(raw.artistNames)
    ? raw.artistNames.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  const duration =
    typeof raw.duration === 'number'
      ? Math.round(raw.duration / 1000)
      : undefined;

  return {
    upstreamId: String(id),
    title: title.trim(),
    artist: artists.join(', ') || undefined,
    artworkURL:
      typeof raw.artwork === 'string'
        ? raw.artwork
        : undefined,
    duration,
  };
}
