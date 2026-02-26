## Description

<!-- Brief description of the changes in this PR -->

## Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Performance improvement
- [ ] Consensus change (changes that affect state calculation or validation)
- [ ] Refactoring (no functional changes)
- [ ] Documentation update
- [ ] CI/CD changes
- [ ] Dependencies update

## Checklist

### Build & Tests

- [ ] `npm install` completes without errors
- [ ] `npm run build` completes without errors
- [ ] `npm test` passes all tests

### Code Quality

- [ ] Code follows the project's coding standards
- [ ] No new compiler warnings introduced
- [ ] Error handling is appropriate
- [ ] Logging is appropriate for debugging and monitoring

### Documentation

- [ ] Code comments added for complex logic
- [ ] Public APIs are documented
- [ ] README updated (if applicable)

### Security

- [ ] No sensitive data (keys, credentials) committed
- [ ] No new security vulnerabilities introduced
- [ ] RPC endpoints properly authenticated
- [ ] Input validation in place for external data

### OP_NET Node Specific

- [ ] Changes are compatible with existing network state
- [ ] Consensus logic changes are documented and tested
- [ ] State transitions are deterministic
- [ ] WASM VM execution is reproducible across nodes
- [ ] P2P protocol changes are backward-compatible (or migration planned)
- [ ] Database schema changes include migration path
- [ ] Epoch finality and PoC/PoW logic unchanged (or documented if changed)

## Testing

<!-- Describe how you tested these changes -->

## Consensus Impact

<!-- If this PR affects consensus, describe the impact and testing methodology -->

## Related Issues

<!-- Link any related issues: Fixes #123, Relates to #456 -->

---
By submitting this PR, I confirm that my contribution is made under the terms of the project's license.
