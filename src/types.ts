/** BitChord's own quality tiers. */
export type Quality = 'LOSSLESS' | 'HIGH' | 'LOW';

/** A track returned by an upstream music provider. */
export interface UpstreamTrack {
  upstreamId: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  artworkURL?: string;

  // Audio format and quality metadata
  format?: string;
  audioQuality?: string;
  bitDepth?: number;
  sampleRate?: number;
  bitrate?: number;
}

/** A playable stream returned by an upstream provider. */
export interface UpstreamStream {
  url: string;
  format?: string;
  quality?: string;
  manifest?: 'none' | 'hls' | 'dash';
  encrypted?: boolean;
}

/** Common interface implemented by every music provider. */
export interface Provider {
  search(
    query: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamTrack[]>;

  getStream(
    trackId: string,
    quality: Quality,
    atmos: string,
  ): Promise<UpstreamStream | null>;
}

/** A track exposed to BitChord. */
export interface PublicTrack extends Omit<UpstreamTrack, 'upstreamId'> {
  id: string;
}
