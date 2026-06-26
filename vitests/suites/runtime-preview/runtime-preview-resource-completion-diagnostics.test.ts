import { describe, expect, it } from 'vitest';
import {
  createSummary,
  validateResourceCompletionResult,
} from '../../scripts/runtime-preview-resource-completion-diagnostics.mjs';

describe('runtime preview resource completion diagnostics', () => {
  it('validates the resource completion result schema with status and bucket summaries', () => {
    const result = createSummary('schema-sample', [
      {
        resourceResponseEndMs: 100,
        sameOriginLastFinishMs: 110,
        networkQuietMs: 1110,
        loadingFailedCount: 1,
        wireStatus: { 304: 10 },
        surfaceStatus: { 200: 1, 304: 9 },
        bucketMaxResponseEnd: {
          '/assets/*': { count: 2, maxResponseEndMs: 100 },
          '/query-extname/*': { count: 1, maxResponseEndMs: 90 },
          '/scene/*.json': { count: 1, maxResponseEndMs: 80 },
          '/chunks/*.js': { count: 1, maxResponseEndMs: 70 },
          '/scene-list': { count: 1, maxResponseEndMs: 60 },
          '/scripting/x/*': { count: 1, maxResponseEndMs: 50 },
          other: { count: 1, maxResponseEndMs: 40 },
        },
      },
      {
        resourceResponseEndMs: 200,
        sameOriginLastFinishMs: 210,
        networkQuietMs: 1210,
        loadingFailedCount: 0,
        wireStatus: { 304: 10 },
        surfaceStatus: { 304: 10 },
        bucketMaxResponseEnd: {
          '/assets/*': { count: 3, maxResponseEndMs: 200 },
          '/query-extname/*': { count: 1, maxResponseEndMs: 190 },
          '/scene/*.json': { count: 1, maxResponseEndMs: 180 },
          '/chunks/*.js': { count: 1, maxResponseEndMs: 170 },
          '/scene-list': { count: 1, maxResponseEndMs: 160 },
          '/scripting/x/*': { count: 1, maxResponseEndMs: 150 },
          other: { count: 1, maxResponseEndMs: 140 },
        },
      },
    ]);

    expect(result.resourceResponseEndMs).toEqual({ min: 100, median: 200, max: 200 });
    expect(result.loadingFailedCount).toEqual({ min: 0, median: 1, max: 1 });
    expect(result.bucketMaxResponseEnd['/assets/*']).toEqual({
      count: 5,
      maxResponseEndMs: 200,
    });
    expect(result.roundsRaw).toHaveLength(2);
    expect(() => validateResourceCompletionResult(result)).not.toThrow();
  });

  it('rejects missing timing fields', () => {
    expect(() => validateResourceCompletionResult({
      target: 'bad',
      rounds: 1,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      wireStatus: {},
      surfaceStatus: {},
      bucketMaxResponseEnd: {},
      roundsRaw: [],
    })).toThrow('Invalid networkQuietMs.min');
  });

  it('requires all resource buckets in the saved summary schema', () => {
    expect(() => validateResourceCompletionResult({
      target: 'bad-buckets',
      rounds: 1,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      networkQuietMs: { min: 1, median: 1, max: 1 },
      loadingFailedCount: { min: 0, median: 0, max: 0 },
      wireStatus: { 304: 1 },
      surfaceStatus: { 200: 1 },
      bucketMaxResponseEnd: {
        '/assets/*': { count: 1, maxResponseEndMs: 1 },
      },
      roundsRaw: [],
    })).toThrow('Invalid bucketMaxResponseEnd./query-extname/*');
  });

  it('rejects invalid aggregate counts', () => {
    const validBuckets = {
      '/assets/*': { count: 1, maxResponseEndMs: 1 },
      '/query-extname/*': { count: 0, maxResponseEndMs: 0 },
      '/scene/*.json': { count: 0, maxResponseEndMs: 0 },
      '/chunks/*.js': { count: 0, maxResponseEndMs: 0 },
      '/scene-list': { count: 0, maxResponseEndMs: 0 },
      '/scripting/x/*': { count: 0, maxResponseEndMs: 0 },
      other: { count: 0, maxResponseEndMs: 0 },
    };

    expect(() => validateResourceCompletionResult({
      target: 'bad-rounds-raw',
      rounds: 2,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      networkQuietMs: { min: 1, median: 1, max: 1 },
      loadingFailedCount: { min: 0, median: 0, max: 0 },
      wireStatus: { 304: 1 },
      surfaceStatus: { 200: 1 },
      bucketMaxResponseEnd: validBuckets,
      roundsRaw: [{}],
    })).toThrow('Invalid roundsRaw.length');

    expect(() => validateResourceCompletionResult({
      target: 'bad-status-count',
      rounds: 1,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      networkQuietMs: { min: 1, median: 1, max: 1 },
      loadingFailedCount: { min: 0, median: 0, max: 0 },
      wireStatus: { 304: -1 },
      surfaceStatus: { 200: 1 },
      bucketMaxResponseEnd: validBuckets,
      roundsRaw: [{}],
    })).toThrow('Invalid wireStatus.304');

    expect(() => validateResourceCompletionResult({
      target: 'bad-bucket-count',
      rounds: 1,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      networkQuietMs: { min: 1, median: 1, max: 1 },
      loadingFailedCount: { min: 0, median: 0, max: 0 },
      wireStatus: { 304: 1 },
      surfaceStatus: { 200: 1 },
      bucketMaxResponseEnd: {
        ...validBuckets,
        other: { count: 0, maxResponseEndMs: Number.NaN },
      },
      roundsRaw: [{}],
    })).toThrow('Invalid bucketMaxResponseEnd.other.maxResponseEndMs');
  });
});
