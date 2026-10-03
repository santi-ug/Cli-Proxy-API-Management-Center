import 'react';

// Custom properties set from component props. Typed here so inline styles stay cast-free.
declare module 'react' {
  interface CSSProperties {
    /** Provider color for bars, plan labels and dots on the pools page. */
    '--pool-accent'?: string;
  }
}
