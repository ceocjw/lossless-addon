import type { Provider, UpstreamStream, UpstreamTrack, Quality } from '../types.js';

export interface Source {
  name: string;
  provider: Provider;
}

export class RacingProvider implements Provider {
  constructor(private readonly sources: Source[]) {}

  /**
   * Search every source in parallel and collect all successful results.
   * A failed source does not prevent results from other sources being returned.
   */
  async search(
    query: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamTrack[]> {
    const results = await Promise.allSettled(
      this.sources.map(async (source) => {
        const tracks = await source.provider.search(query, quality, atmos);

        return tracks.map((track) => ({
          ...track,
          upstreamId: `${source.name}:${track.upstreamId}`,
        }));
      }),
    );

    const tracks: UpstreamTrack[] = [];
    let failures = 0;
    let lastError: unknown;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        tracks.push(...result.value);
      } else {
        failures++;
        lastError = result.reason;
      }
    }

    if (this.sources.length > 0 && failures === this.sources.length) {
      throw lastError;
    }

    return tracks;
  }

  /**
   * Resolve the track through the source that supplied its ID.
   * Do not pass one provider's ID to another provider:
   * their upstream track IDs are not interchangeable.
   */
  async getStream(
    trackId: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamStream | null> {
    const separator = trackId.indexOf(':');

    if (separator > 0) {
      const sourceName = trackId.slice(0, separator);
      const upstreamId = trackId.slice(separator + 1);

      const source = this.sources.find(
        (candidate) => candidate.name === sourceName,
      );

      if (!source || !upstreamId) {
        return null;
      }

      return source.provider.getStream(upstreamId, quality, atmos);
    }

    // Compatibility path for an unprefixed ID.
    for (const source of this.sources) {
      try {
        const stream = await source.provider.getStream(
          trackId,
          quality,
          atmos,
        );

        if (stream) return stream;
      } catch {
        // Continue to the next source.
      }
    }

    return null;
  }
}
