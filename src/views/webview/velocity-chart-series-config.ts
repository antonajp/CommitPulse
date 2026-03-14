/**
 * Series configuration for the Sprint Velocity vs LOC chart.
 * Defines colors, labels, and markers for each data series using
 * the Okabe-Ito colorblind-accessible palette.
 *
 * Ticket: IQS-944, IQS-946
 */

/**
 * Configuration for a single chart series including visual properties.
 */
export interface SeriesConfig {
  /** Okabe-Ito palette color for the series line and markers */
  readonly color: string;
  /** Full label for tooltips and legends */
  readonly label: string;
  /** Abbreviated label for compact displays */
  readonly shortLabel: string;
  /** Marker shape: 'circle', 'square', or 'triangle' */
  readonly marker: 'circle' | 'square' | 'triangle';
  /** Marker size in pixels */
  readonly markerSize: number;
}

/**
 * Series configuration object mapping series keys to their visual properties.
 * Uses Okabe-Ito palette for colorblind accessibility.
 */
export interface VelocitySeriesConfigs {
  readonly humanEstimate: SeriesConfig;
  readonly aiMeasurement: SeriesConfig;
  readonly locChanged: SeriesConfig;
}

/**
 * Default series configuration using Okabe-Ito colorblind-accessible palette.
 * Each series has distinct color and marker shape for maximum differentiation.
 */
export const VELOCITY_SERIES_CONFIG: VelocitySeriesConfigs = {
  humanEstimate: {
    color: '#0072B2', // Okabe-Ito Blue - 7.15:1 contrast on white
    label: 'Human Estimate (Story Points)',
    shortLabel: 'Human Est.',
    marker: 'circle',
    markerSize: 5,
  },
  aiMeasurement: {
    color: '#009E73', // Okabe-Ito Bluish Green - 4.64:1 contrast on white
    label: 'AI Measurement (Duration-Based)',
    shortLabel: 'AI Calc.',
    marker: 'square',
    markerSize: 5,
  },
  locChanged: {
    color: '#D55E00', // Okabe-Ito Vermillion - high contrast
    label: 'LOC Changed',
    shortLabel: 'LOC',
    marker: 'triangle',
    markerSize: 6,
  },
};

/**
 * Generate the JavaScript source for the series configuration.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source defining SERIES_CONFIG object
 */
export function generateSeriesConfigScript(): string {
  return `
      // ======================================================================
      // Series Configuration (colorblind-accessible: Okabe-Ito palette)
      // IQS-944: Added humanEstimate and aiMeasurement for dual story points
      // ======================================================================
      var SERIES_CONFIG = {
        humanEstimate: {
          color: '${VELOCITY_SERIES_CONFIG.humanEstimate.color}',
          label: '${VELOCITY_SERIES_CONFIG.humanEstimate.label}',
          shortLabel: '${VELOCITY_SERIES_CONFIG.humanEstimate.shortLabel}',
          marker: '${VELOCITY_SERIES_CONFIG.humanEstimate.marker}',
          markerSize: ${VELOCITY_SERIES_CONFIG.humanEstimate.markerSize},
        },
        aiMeasurement: {
          color: '${VELOCITY_SERIES_CONFIG.aiMeasurement.color}',
          label: '${VELOCITY_SERIES_CONFIG.aiMeasurement.label}',
          shortLabel: '${VELOCITY_SERIES_CONFIG.aiMeasurement.shortLabel}',
          marker: '${VELOCITY_SERIES_CONFIG.aiMeasurement.marker}',
          markerSize: ${VELOCITY_SERIES_CONFIG.aiMeasurement.markerSize},
        },
        locChanged: {
          color: '${VELOCITY_SERIES_CONFIG.locChanged.color}',
          label: '${VELOCITY_SERIES_CONFIG.locChanged.label}',
          shortLabel: '${VELOCITY_SERIES_CONFIG.locChanged.shortLabel}',
          marker: '${VELOCITY_SERIES_CONFIG.locChanged.marker}',
          markerSize: ${VELOCITY_SERIES_CONFIG.locChanged.markerSize},
        },
      };
  `;
}
