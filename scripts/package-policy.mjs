import { readFileSync } from 'node:fs';
import path from 'node:path';

export function assertPackagingAllowed(root) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(path.join(root, 'PACKAGE_POLICY.json'), 'utf8'));
  } catch {
    throw new Error('PACKAGE_ALLOWED=FALSE: explicit user authorization is required before packaging or delivery.');
  }
  if (policy.PACKAGE_ALLOWED !== true || !policy.explicit_user_authorization) {
    throw new Error('PACKAGE_ALLOWED=FALSE: development is in progress; tests passing does not authorize packaging or delivery.');
  }
}
