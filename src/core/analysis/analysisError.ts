import type { AnalysisError } from '../model/types';

export type AnalysisErrorDetails = Pick<AnalysisError, 'elementId' | 'nodeId' | 'diagnostics'>;

export class AnalysisException extends Error implements AnalysisError {
  readonly type: AnalysisError['type'];
  readonly elementId?: string;
  readonly nodeId?: string;
  readonly diagnostics?: NonNullable<AnalysisError['diagnostics']>;

  constructor(
    type: AnalysisError['type'],
    message: string,
    details: AnalysisErrorDetails = {}
  ) {
    super(message);
    this.name = 'AnalysisException';
    this.type = type;
    if (details.elementId !== undefined) this.elementId = details.elementId;
    if (details.nodeId !== undefined) this.nodeId = details.nodeId;
    if (details.diagnostics !== undefined) this.diagnostics = details.diagnostics;
  }
}

export function createAnalysisException(
  type: AnalysisError['type'],
  message: string,
  details: AnalysisErrorDetails = {}
): AnalysisException {
  return new AnalysisException(type, message, details);
}

/** Convert a validation/analysis error record into a throwable exception. */
export function toAnalysisException(error: AnalysisError): AnalysisException {
  const details: AnalysisErrorDetails = {};
  if (error.elementId !== undefined) details.elementId = error.elementId;
  if (error.nodeId !== undefined) details.nodeId = error.nodeId;
  if (error.diagnostics !== undefined) details.diagnostics = error.diagnostics;
  return new AnalysisException(error.type, error.message, details);
}
