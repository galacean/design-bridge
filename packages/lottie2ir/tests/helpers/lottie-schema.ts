import { Ajv2020 } from 'ajv/dist/2020';
import { LottieValidator, type LottieValidatorError } from '@lottie-animation-community/lottie-specs';
import lottieSchema from '@lottie-animation-community/lottie-specs/src/data/lottie.schema.json';

export interface LottieSchemaIssue {
  type: 'error' | 'warning';
  message: string;
  path: string;
  name: string;
  docs: string;
}

export interface LottieSchemaReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: LottieSchemaIssue[];
}

let validator: LottieValidator | undefined;

function getValidator(): LottieValidator {
  if (validator !== undefined) {
    return validator;
  }

  validator = new LottieValidator(Ajv2020, lottieSchema, {
    name_paths: true,
  });

  return validator;
}

function normalizeIssue(issue: LottieValidatorError): LottieSchemaIssue {
  return {
    type: issue.type,
    message: issue.message,
    path: issue.path ?? '',
    name: issue.name ?? 'Value',
    docs: issue.docs ?? '',
  };
}

export function validateLottieSchema(input: unknown, options: { includeWarnings?: boolean } = {}): LottieSchemaReport {
  const includeWarnings = options.includeWarnings ?? true;
  const rawIssues = getValidator().validate(input as Record<string, unknown>, includeWarnings);
  const issues = rawIssues.map(normalizeIssue);
  const errorCount = issues.filter(issue => issue.type === 'error').length;
  const warningCount = issues.filter(issue => issue.type === 'warning').length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}
