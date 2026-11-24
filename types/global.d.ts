/// <reference types="mocha" />
/// <reference types="chai" />

interface Window {
  Mocha?: new (options?: Record<string, unknown>) => {
    setup?: (options: Record<string, unknown>) => void;
    run: () => {
      abort?: () => void;
    };
    dispose?: () => void;
    suite?: {
      suites: unknown[];
      emit?: (event: string, context: unknown, file: string | null, mocha: unknown) => void;
    };
  };
  mocha?: {
    setup?: (options: Record<string, unknown>) => void;
    run: () => {
      abort?: () => void;
    };
    dispose?: () => void;
    suite?: {
      suites: unknown[];
      emit?: (event: string, context: unknown, file: string | null, mocha: unknown) => void;
    };
  };
}

declare const chai: Chai.ChaiStatic;
